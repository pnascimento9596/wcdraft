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
// Client driver: `@neondatabase/serverless` WebSocket `Pool` (NOT node-postgres
// `pg.Pool`). Timeouts below are options typed on that driver's ClientConfig /
// PoolConfig and are applied at construction time.
//
// Determinism: a single module-level pool per process is created lazily on
// first call. We do NOT create the pool at import time so a stray import in
// a test or build script that never calls `getDb()` cannot dial Neon.
import { Pool, type PoolConfig } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import * as schema from "./schema/index.ts";

export type Db = NeonDatabase<typeof schema>;

/**
 * Runtime pool timeouts. Chosen so a hung query fails with a typed driver
 * error *before* Vercel kills the function (`maxDuration = 10` on heavy
 * routes). See `docs/runbooks/db-timeouts.md`.
 *
 * - connectionTimeoutMillis: fail fast if the Neon WS handshake hangs
 * - idleTimeoutMillis: release idle sockets in serverless isolates
 * - statement_timeout: Postgres-side query ceiling (milliseconds); supported
 *   on `@neondatabase/serverless` ClientConfig and enforced by the server
 */
export const RUNTIME_POOL_TIMEOUTS = {
  /** Max wait to establish a connection (ms). */
  connectionTimeoutMillis: 5_000,
  /** Close idle pool clients after this many ms. */
  idleTimeoutMillis: 10_000,
  /** Postgres statement_timeout in milliseconds. */
  statement_timeout: 8_000,
} as const;

/** Platform maxDuration (seconds) for heavy routes that use getDb(). */
export const HEAVY_ROUTE_MAX_DURATION_SECONDS = 10;

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

/** Build the PoolConfig used by runtime handlers (exported for unit tests). */
export function buildRuntimePoolConfig(connectionString: string): PoolConfig {
  return {
    connectionString,
    connectionTimeoutMillis: RUNTIME_POOL_TIMEOUTS.connectionTimeoutMillis,
    idleTimeoutMillis: RUNTIME_POOL_TIMEOUTS.idleTimeoutMillis,
    statement_timeout: RUNTIME_POOL_TIMEOUTS.statement_timeout,
  };
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
  cachedPool = new Pool(buildRuntimePoolConfig(connectionString));
  cachedDb = drizzle(cachedPool, { schema });
  return cachedDb;
}

/**
 * Open a one-shot Drizzle handle bound to the DIRECT (unpooled) URL, for the
 * migration runner and rollback-check. Caller owns lifecycle and MUST call
 * `pool.end()` (the second tuple element) before exit.
 *
 * Migrator uses a longer statement timeout so multi-statement migrations are
 * not killed by the tight runtime ceiling.
 */
export function openMigratorDb(): { db: Db; pool: Pool } {
  const connectionString = readConnectionString("migrate");
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: RUNTIME_POOL_TIMEOUTS.connectionTimeoutMillis,
    // Migrations are CLI-owned; allow longer statements than route handlers.
    statement_timeout: 60_000,
  });
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
