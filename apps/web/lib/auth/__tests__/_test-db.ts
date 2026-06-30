// F-2 — pglite-backed test DB.
//
// Spawns an embedded Postgres (pglite) per test file, applies both F-1 and
// F-2 migrations, and hands back a Drizzle handle. Tests get REAL Postgres
// semantics — including UNIQUE NULLS NOT DISTINCT, foreign-key cascades,
// and the rate-limit UPSERT — without standing up a Neon branch.
//
// The cast to `Db` lets us reuse the production type without changing the
// signature of every auth function for a test-only driver. Runtime
// equivalence is what matters for the assertions.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@wcdraft/db";
import type { Db } from "@wcdraft/db";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, "../../../../../packages/db/migrations");

function loadMigration(file: string): string {
  return readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
}

/** Spawn a fresh in-memory Postgres and apply both up-migrations. */
export async function setupTestDb(): Promise<{
  db: Db;
  pg: PGlite;
  reset: () => Promise<void>;
}> {
  const pg = new PGlite();
  // pglite ships PostgreSQL 16, where gen_random_uuid() is in CORE
  // (no pgcrypto required). The contrib pgcrypto extension is NOT bundled
  // with pglite by default — `CREATE EXTENSION pgcrypto` errors out.
  // The schema's uuid defaults work without it.

  // Apply migrations in order. The .sql files contain `--> statement-breakpoint`
  // markers between statements — drizzle's migrator splits on those.
  // pglite's `.exec()` accepts a multi-statement script, so we strip the
  // marker comments and let pg parse the whole script.
  for (const file of [
    "0000_init.sql",
    "0001_auth_rate_limits.sql",
    "0002_history_session_scope.sql",
    "0003_summary_jsonb.sql",
    "0004_f4_leaderboard.sql",
    "0005_leaderboard_profiles.sql",
    "0006_leaderboard_config_filters.sql",
    "0007_leaderboard_user_recent_idx.sql",
    "0008_leaderboard_daily_challenge.sql",
    "0009_ranked_attempt_binding.sql",
    "0010_account_password.sql",
  ]) {
    const sql = loadMigration(file).replace(/-->\s*statement-breakpoint/g, "");
    await pg.exec(sql);
  }
  const db = drizzle(pg, { schema }) as unknown as Db;
  return {
    db,
    pg,
    reset: async () => {
      // Truncate everything for the next test. Cascade so FKs fire.
      await pg.exec(`
        TRUNCATE TABLE
          leaderboard_entries,
          ranked_attempts,
          saved_runs,
          sessions,
          magic_link_tokens,
          users,
          auth_rate_limits
        RESTART IDENTITY CASCADE;
      `);
    },
  };
}

/**
 * 32-byte base64url string suitable as the cookie HMAC secret. Deterministic
 * across tests when seed is set; varied per-test by default.
 */
export function testCookieSecret(seed = "ws-f-2-test"): string {
  return Buffer.from(`${seed}--${"x".repeat(32)}`)
    .toString("base64url")
    .slice(0, 43);
}
