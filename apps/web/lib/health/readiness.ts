import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import type { Db } from "@wcdraft/db";

import manifest from "../../../../packages/data/src/generated/manifest.json";
import {
  AUTH_PROBE_TIMEOUT_MS,
  cookieSecretIsConfigured,
  type AuthHealthStatus,
} from "./auth-probe";
import { journalEntryForCreatedAt, SUPPORTED_MIGRATION_RANGE } from "./migration-contract";
import { explicitSeasonKey } from "../leaderboard/season";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export interface LatestMigrationRow extends Record<string, unknown> {
  readonly id: number | string;
  readonly created_at: number | string | bigint;
}

export interface HealthDependencies {
  readonly databaseUrl: string | undefined;
  readonly authCookieSecret: string | undefined;
  readonly buildSha: string | undefined;
  readonly readLatestMigration: () => Promise<LatestMigrationRow | null>;
  /**
   * Read-only auth bootstrap dependency probe. Must not mint sessions or
   * create rows. Optional only so unit tests can inject failures; production
   * always wires `probeAuthBootstrapDependencies`.
   */
  readonly probeAuthBootstrap?: () => Promise<void>;
  /** Bound for the auth probe; defaults to AUTH_PROBE_TIMEOUT_MS. */
  readonly authProbeTimeoutMs?: number;
}

export const DATA_MANIFEST_ANCHOR = Object.freeze({
  schema_version: manifest.schema_version,
  dataset_version: manifest.dataset_version,
  engine_version: manifest.engine_version,
  rating_version_historical: manifest.rating_version_historical,
  rating_version_projected: manifest.rating_version_projected,
  ruleset_version: manifest.ruleset_version,
  draft_pool_sha256: manifest.bundles.draft_pool.sha256,
});

export async function readLatestAppliedMigration(db: Db): Promise<LatestMigrationRow | null> {
  // drizzle.__drizzle_migrations.id is the table's primary key. DESC + LIMIT 1
  // is one index-backed query; no table scan or application-table read occurs.
  const result = await db.execute<LatestMigrationRow>(sql`
    SELECT id, created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY id DESC
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

function normalizeInteger(value: number | string | bigint): number | null {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) ? normalized : null;
}

function actualSchema(row: LatestMigrationRow | null): {
  id: number | null;
  index: number | null;
  migration: string | null;
} {
  if (!row) return { id: null, index: null, migration: null };
  const id = normalizeInteger(row.id);
  const createdAt = normalizeInteger(row.created_at);
  const entry = createdAt === null ? null : journalEntryForCreatedAt(createdAt);
  return {
    id,
    index: entry?.idx ?? null,
    migration: entry?.tag ?? null,
  };
}

function schemaIsSupported(actual: ReturnType<typeof actualSchema>): boolean {
  return (
    actual.index !== null &&
    actual.index >= SUPPORTED_MIGRATION_RANGE.minimum.index &&
    actual.index <= SUPPORTED_MIGRATION_RANGE.maximum.index
  );
}

function basePayload(buildSha: string | undefined) {
  return {
    build: { sha: buildSha?.trim() || null },
    data: DATA_MANIFEST_ANCHOR,
    leaderboard: { season_key: explicitSeasonKey() },
    schema: { expected: SUPPORTED_MIGRATION_RANGE },
  };
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();
  return name.includes("timeout") || message.includes("timeout") || name === "aborterror";
}

/**
 * Resolve auth subsystem status without leaking secret material or driver
 * messages into the response body.
 */
export async function resolveAuthHealthStatus(
  deps: Pick<
    HealthDependencies,
    "databaseUrl" | "authCookieSecret" | "probeAuthBootstrap" | "authProbeTimeoutMs"
  >,
): Promise<AuthHealthStatus> {
  const dbConfigured = Boolean(deps.databaseUrl?.trim());
  const secretOk = cookieSecretIsConfigured(deps.authCookieSecret);
  if (!dbConfigured || !secretOk) {
    // Honest unconfigured: missing either half of the auth substrate.
    // Weak/garbage secret is treated as unconfigured (not a fabricated ready)
    // when empty; non-empty but weak is error below.
    if (!dbConfigured && !deps.authCookieSecret?.trim()) return "unconfigured";
    if (!dbConfigured) return "unconfigured";
    if (!deps.authCookieSecret?.trim()) return "unconfigured";
    // Non-empty but weak/invalid secret while DB is configured.
    return "error";
  }
  if (!deps.probeAuthBootstrap) {
    // Probe not wired — do not fabricate green.
    return "unconfigured";
  }

  const timeoutMs = deps.authProbeTimeoutMs ?? AUTH_PROBE_TIMEOUT_MS;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      deps.probeAuthBootstrap(),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          const err = new Error("auth bootstrap probe timed out");
          err.name = "TimeoutError";
          reject(err);
        }, timeoutMs);
      }),
    ]);
    return "ready";
  } catch (error) {
    if (isTimeoutError(error)) return "degraded";
    console.error(
      "[health] auth bootstrap probe failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return "error";
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

function authIsBlocking(status: AuthHealthStatus): boolean {
  return status === "error" || status === "degraded";
}

export async function handleHealthGet(deps: HealthDependencies): Promise<NextResponse> {
  const base = basePayload(deps.buildSha);
  const authStatus = await resolveAuthHealthStatus(deps);
  const auth = { status: authStatus };

  if (!deps.databaseUrl?.trim()) {
    // DB unconfigured: keep ok:true (existing contract) but never claim auth ready.
    return NextResponse.json(
      {
        ok: !authIsBlocking(authStatus),
        ...base,
        db: { status: "unconfigured" as const },
        auth,
        schema: { ...base.schema, actual: null },
      },
      { status: authIsBlocking(authStatus) ? 503 : 200, headers: NO_STORE },
    );
  }

  try {
    const actual = actualSchema(await deps.readLatestMigration());
    if (!schemaIsSupported(actual)) {
      return NextResponse.json(
        {
          ok: false,
          ...base,
          db: { status: "schema_mismatch" as const },
          auth,
          schema: { ...base.schema, actual },
        },
        { status: 503, headers: NO_STORE },
      );
    }
    if (authIsBlocking(authStatus)) {
      return NextResponse.json(
        {
          ok: false,
          ...base,
          db: { status: "ready" as const },
          auth,
          schema: { ...base.schema, actual },
        },
        { status: 503, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      {
        ok: true,
        ...base,
        db: { status: "ready" as const },
        auth,
        schema: { ...base.schema, actual },
      },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    // Do not serialize driver messages: they can contain endpoint details.
    console.error(
      "[health] migration readiness query failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return NextResponse.json(
      {
        ok: false,
        ...base,
        db: { status: "error" as const },
        auth,
        schema: { ...base.schema, actual: null },
      },
      { status: 503, headers: NO_STORE },
    );
  }
}
