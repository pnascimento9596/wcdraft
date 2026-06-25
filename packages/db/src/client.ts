// F-1 — Neon serverless client (server-only).
//
// Cost firewall: this module is imported ONLY by server-side consumers
// (later Vercel route handlers in F-2/F-3/F-4). It must never be imported
// from `apps/web/lib/game/*` or any client bundle — the client sim runs
// entirely in the browser and never holds a DB connection.
//
// Connection model:
//   - Runtime route handlers use `DATABASE_URL` (Neon POOLED URL,
//     `...-pooler.neon.tech`). Pooling matters: serverless route handlers
//     spike concurrency past Postgres' connection cap if we point them at
//     the direct URL.
//   - CLI migrations use `DATABASE_URL_UNPOOLED` (Neon DIRECT URL,
//     `...neon.tech`) via `scripts/migrate.ts` / `scripts/rollback-check.ts`
//     — pooled URLs reject CREATE/ALTER inside a transaction the way the
//     migrator needs them.
//
// Determinism: a single module-level pool per process is created lazily on
// first call. We do NOT create the pool at import time so a stray import in
// a test or build script that never calls `getDb()` cannot dial Neon.
import { Pool } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import * as schema from "./schema/index.ts";

export type Db = NeonDatabase<typeof schema>;

let cachedPool: Pool | null = null;
let cachedDb: Db | null = null;

/**
 * Return the connection-string env var for the requested mode. Migrations
 * MUST use the direct URL; runtime route handlers MUST use the pooled URL.
 */
function readConnectionString(mode: "runtime" | "migrate"): string {
  const varName = mode === "migrate" ? "DATABASE_URL_UNPOOLED" : "DATABASE_URL";
  const value = process.env[varName];
  if (!value) {
    throw new Error(
      `@wcdraft/db: ${varName} is not set. F-1 README documents the gitignored ` +
        `env file path; never log, echo, or commit the value.`,
    );
  }
  return value;
}

/**
 * Acquire (or lazily create) the runtime Drizzle handle, bound to the Neon
 * pooled URL. Route handlers in F-2/F-3/F-4 should call this once per
 * invocation.
 *
 * Safe to call repeatedly within a single process — the underlying pool is
 * memoised. Tests that need a fresh pool can call `__resetClientForTests()`.
 */
export function getDb(): Db {
  if (cachedDb) return cachedDb;
  const connectionString = readConnectionString("runtime");
  cachedPool = new Pool({ connectionString });
  cachedDb = drizzle(cachedPool, { schema });
  return cachedDb;
}

/**
 * Open a one-shot Drizzle handle bound to the DIRECT (unpooled) URL, for the
 * migration runner and rollback-check. Caller owns lifecycle and MUST call
 * `pool.end()` (the second tuple element) before exit.
 */
export function openMigratorDb(): { db: Db; pool: Pool } {
  const connectionString = readConnectionString("migrate");
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

/**
 * Test-only escape hatch. Not exported from the public barrel — only the
 * test files in `test/` reach for it via the explicit subpath.
 */
export function __resetClientForTests(): void {
  cachedDb = null;
  if (cachedPool) {
    void cachedPool.end();
    cachedPool = null;
  }
}
