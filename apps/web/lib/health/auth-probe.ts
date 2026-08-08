// Auth bootstrap dependency probe for GET /api/health.
//
// Mirrors the hard deps the CSRF bootstrap path needs after the #341 fix:
//   1. AUTH_COOKIE_SECRET present and strong enough to sign a bootstrap
//   2. DATABASE_URL present (buildRuntimeDeps refuses to start without it)
//   3. sessions table readable via the same query-builder shape the lazy
//      sweep uses first (select id … limit 1) — read-only, no delete
//   4. driver execute result shape usable (SELECT 1) so a rows-shape edge
//      cannot silently reappear on auth-adjacent SQL
//
// Never mints sessions, never creates/updates/deletes application rows.
//
// Cancellation / stacking:
//   - Postgres `statement_timeout` is set LOCAL to the probe transaction so
//     an in-flight query is actually cancelled server-side (Promise.race only
//     bounds the HTTP response; without LOCAL timeout the pool-level 8s
//     statement_timeout still holds a Neon connection).
//   - Process-local single-flight reuses one in-flight probe so frequent
//     /api/health polls cannot stack concurrent probe transactions during a
//     slow-DB episode.
import { asc, lte, sql } from "drizzle-orm";
import { sessions, type Db } from "@wcdraft/db";

/** Auth subsystem status on the health payload (honest-state; never fabricated green). */
export type AuthHealthStatus = "ready" | "degraded" | "error" | "unconfigured";

export const AUTH_PROBE_TIMEOUT_MS = 2_000;

/**
 * Cookie-secret strength gate matching handler-helpers.validateCookieSecret
 * (32 decoded base64url bytes). Returns false for missing/weak/garbage without
 * throwing or echoing the secret.
 */
export function cookieSecretIsConfigured(raw: string | undefined): boolean {
  const v = raw?.trim() ?? "";
  if (!v) return false;
  let decoded: Buffer;
  try {
    decoded = Buffer.from(v, "base64url");
  } catch {
    return false;
  }
  return decoded.length >= 32;
}

/** Test-only: clear the single-flight slot between cases. */
export function __resetAuthProbeSingleFlightForTests(): void {
  inFlightProbe = null;
}

let inFlightProbe: Promise<void> | null = null;

/**
 * Read-only sessions + execute probes. Throws on substrate failure.
 * Callers must race this against a timeout and must never treat throws as
 * green. Concurrent callers share one in-flight probe (single-flight).
 */
export async function probeAuthBootstrapDependencies(
  db: Db,
  nowMs: number,
  options?: { readonly statementTimeoutMs?: number },
): Promise<void> {
  if (inFlightProbe) return inFlightProbe;
  const run = runAuthBootstrapProbe(db, nowMs, options).finally(() => {
    if (inFlightProbe === run) inFlightProbe = null;
  });
  inFlightProbe = run;
  return run;
}

async function runAuthBootstrapProbe(
  db: Db,
  nowMs: number,
  options?: { readonly statementTimeoutMs?: number },
): Promise<void> {
  const statementTimeoutMs = Math.max(
    1,
    Math.min(
      AUTH_PROBE_TIMEOUT_MS,
      Math.trunc(options?.statementTimeoutMs ?? AUTH_PROBE_TIMEOUT_MS),
    ),
  );

  // Prefer a real transaction so SET LOCAL statement_timeout applies, then
  // falls off when the transaction ends. Fall back to bare statements when
  // the handle has no transaction (unit-test mocks).
  if (typeof db.transaction === "function") {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('statement_timeout', ${String(statementTimeoutMs)}, true)`,
      );
      await runReadOnlyAuthProbes(tx, nowMs);
    });
    return;
  }
  await runReadOnlyAuthProbes(db, nowMs);
}

async function runReadOnlyAuthProbes(
  db: Pick<Db, "select" | "execute">,
  nowMs: number,
): Promise<void> {
  // Same order/limit contract as sweepExpiredSessions' select step — no delete.
  await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(lte(sessions.expiresAt, new Date(nowMs)))
    .orderBy(asc(sessions.expiresAt), asc(sessions.id))
    .limit(1);

  // Execute result-shape canary (the historical CTE path failed as
  // `result.rows` undefined). A single-row SELECT must expose an array `.rows`.
  const result = await db.execute<{ ok: string }>(sql`SELECT '1'::text AS ok`);
  if (!result || !Array.isArray(result.rows)) {
    throw new Error("auth probe: execute result missing rows array");
  }
  if (result.rows[0]?.ok !== "1") {
    throw new Error("auth probe: execute result shape unexpected");
  }
}
