import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import type { Db } from "@wcdraft/db";

import manifest from "../../../../packages/data/src/generated/manifest.json";
import { journalEntryForCreatedAt, SUPPORTED_MIGRATION_RANGE } from "./migration-contract";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export interface LatestMigrationRow extends Record<string, unknown> {
  readonly id: number | string;
  readonly created_at: number | string | bigint;
}

export interface HealthDependencies {
  readonly databaseUrl: string | undefined;
  readonly buildSha: string | undefined;
  readonly readLatestMigration: () => Promise<LatestMigrationRow | null>;
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
    schema: { expected: SUPPORTED_MIGRATION_RANGE },
  };
}

export async function handleHealthGet(deps: HealthDependencies): Promise<NextResponse> {
  const base = basePayload(deps.buildSha);
  if (!deps.databaseUrl?.trim()) {
    return NextResponse.json(
      {
        ok: true,
        ...base,
        db: { status: "unconfigured" as const },
        schema: { ...base.schema, actual: null },
      },
      { status: 200, headers: NO_STORE },
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
        schema: { ...base.schema, actual: null },
      },
      { status: 503, headers: NO_STORE },
    );
  }
}
