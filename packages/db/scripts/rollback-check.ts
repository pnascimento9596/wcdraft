// F-1 — destructive apply → anonymous-dedupe assertion → rollback round-trip.
//
// HARD SAFETY POSTURE
// -------------------
// This script runs DROP TABLE. It refuses to start unless the caller has
// explicitly opted into an ephemeral Neon branch:
//
//   1. NEON_EPHEMERAL_BRANCH_ID env var MUST be set. The CI workflow's
//      branch-create step emits this; the local run sources it from the
//      env file emitted by `neon-branch-create.ts`.
//
//   2. When NEON_API_KEY is also present (CI), we verify via the Neon API
//      that the target branch is NOT the project's primary/default branch.
//      A misconfigured workflow that pointed at production would be caught
//      here before any SQL ran.
//
//   3. If NEON_API_KEY is absent (offline rerun on local state), we still
//      enforce (1) — the sentinel is the load-bearing guard.
//
// ROUND-TRIP STEPS
// ----------------
//   step 1 — apply all up-migrations
//   step 2 — INSERT two anonymous saved_runs rows (NULL owner) with the
//            same token; assert the second is rejected by the
//            UNIQUE NULLS NOT DISTINCT constraint
//   step 3 — INSERT two anonymous leaderboard_entries rows (NULL user)
//            with the same (season, mode, token); assert the second is
//            rejected
//   step 4 — run paired down-migrations in reverse journal order
//   step 5 — assert the public schema is empty (no tables, no drizzle bookkeeping)
//
// Designed for a disposable Neon branch (NEVER prod). A botched down-migration
// or a duplicate-INSERT that DIDN'T fail are both fatal.
//
// Invocation: `pnpm --filter @wcdraft/db db:rollback-check`.
import { readFileSync } from "node:fs";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { sql } from "drizzle-orm";
import { openMigratorDb } from "../src/client.ts";

const NEON_API_HOST = "console.neon.tech";

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
  version: string;
  breakpoints: boolean;
}
interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

function readJournal(): Journal {
  const journalUrl = new URL("../migrations/meta/_journal.json", import.meta.url);
  return JSON.parse(readFileSync(journalUrl, "utf8")) as Journal;
}

function readDown(tag: string): string {
  return readFileSync(
    new URL(`../migrations/${tag}.down.sql`, import.meta.url),
    "utf8",
  );
}

async function neonGet<T>(path: string, apiKey: string): Promise<T> {
  const resp = await fetch(`https://${NEON_API_HOST}/api/v2${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `Neon API GET ${path} failed: HTTP ${resp.status.toString()} ${text.slice(0, 300)}`,
    );
  }
  return (await resp.json()) as T;
}

async function guardEphemeralBranch(): Promise<void> {
  const ephemeralId = process.env.NEON_EPHEMERAL_BRANCH_ID?.trim();
  if (!ephemeralId) {
    throw new Error(
      "[rollback-check] REFUSING TO RUN: NEON_EPHEMERAL_BRANCH_ID is not set. " +
        "This script runs DROP TABLE and must target a disposable Neon branch. " +
        "Use `neon-branch-create.ts` to provision an ephemeral branch first, " +
        "then source the emitted env file before invoking rollback-check.",
    );
  }
  const apiKey = process.env.NEON_API_KEY?.trim();
  const projectId = process.env.NEON_PROJECT_ID?.trim();
  if (!apiKey || !projectId) {
    console.log(
      "[rollback-check] guard: NEON_API_KEY/PROJECT_ID absent — relying on " +
        "NEON_EPHEMERAL_BRANCH_ID sentinel only (acceptable for local rerun).",
    );
    return;
  }
  interface BranchResp {
    branch: { id: string; default?: boolean; primary?: boolean; name?: string };
  }
  const fetched = await neonGet<BranchResp>(
    `/projects/${projectId}/branches/${ephemeralId}`,
    apiKey,
  );
  if (fetched.branch.default || fetched.branch.primary) {
    throw new Error(
      `[rollback-check] REFUSING TO RUN: target branch ${ephemeralId} is ` +
        `default/primary (name=${fetched.branch.name ?? "<?>"}). ` +
        "Rollback-check is only safe against an ephemeral branch.",
    );
  }
  console.log(
    `[rollback-check] guard: confirmed branch ${ephemeralId} is non-primary`,
  );
}

async function assertDuplicateRejected(
  db: Awaited<ReturnType<typeof openMigratorDb>>["db"],
  description: string,
  insert: () => Promise<unknown>,
): Promise<void> {
  let rejected = false;
  let actualError: unknown = null;
  try {
    await insert();
  } catch (e) {
    rejected = true;
    actualError = e;
  }
  if (!rejected) {
    throw new Error(
      `[rollback-check] FATAL: ${description} — duplicate INSERT SHOULD have ` +
        "been rejected by UNIQUE NULLS NOT DISTINCT but succeeded. The " +
        "constraint is missing or the index name drifted from the schema. " +
        "This is the spam vector the independent reviewer caught.",
    );
  }
  const msg = String(actualError);
  // Verify the rejection was the unique-constraint violation we expect,
  // not some unrelated error (e.g. connection drop).
  if (!/unique|duplicate/i.test(msg)) {
    throw new Error(
      `[rollback-check] FATAL: ${description} — rejection was not a unique ` +
        `constraint violation. Error: ${msg.slice(0, 300)}`,
    );
  }
  console.log(`  ✓ ${description}`);
  void db;
}

async function main(): Promise<void> {
  await guardEphemeralBranch();

  const { db, pool } = openMigratorDb();
  const migrationsFolder = new URL("../migrations", import.meta.url).pathname;
  try {
    // STEP 1 — APPLY
    console.log("[rollback-check] step 1/5 — applying all up-migrations");
    await migrate(db, { migrationsFolder });

    // STEP 2 — assert anonymous saved_runs dedupe
    console.log("[rollback-check] step 2/5 — saved_runs anonymous dedupe");
    const dupToken = `rollback-check-token-${Math.floor(performance.now()).toString()}`;
    await db.execute(sql`
      INSERT INTO saved_runs (owner_user_id, token, claim_state)
      VALUES (NULL, ${dupToken}, 'anonymous')
    `);
    await assertDuplicateRejected(
      db,
      "saved_runs: two NULL-owner rows with the same token must be rejected",
      () =>
        db.execute(sql`
          INSERT INTO saved_runs (owner_user_id, token, claim_state)
          VALUES (NULL, ${dupToken}, 'anonymous')
        `),
    );

    // STEP 3 — assert anonymous leaderboard_entries dedupe
    console.log("[rollback-check] step 3/5 — leaderboard_entries anonymous dedupe");
    const lbToken = `rollback-check-lb-token-${Math.floor(performance.now()).toString()}`;
    const lbSeason = "rollback-check-season-001";
    await db.execute(sql`
      INSERT INTO leaderboard_entries
        (season_key, mode, user_id, token, verified_score)
      VALUES (${lbSeason}, 'casual', NULL, ${lbToken}, 0)
    `);
    await assertDuplicateRejected(
      db,
      "leaderboard_entries: two NULL-user rows with the same (season,mode,token) must be rejected",
      () =>
        db.execute(sql`
          INSERT INTO leaderboard_entries
            (season_key, mode, user_id, token, verified_score)
          VALUES (${lbSeason}, 'casual', NULL, ${lbToken}, 0)
        `),
    );

    // STEP 4 — ROLLBACK in reverse journal order
    const journal = readJournal();
    const ordered = [...journal.entries].sort((a, b) => b.idx - a.idx);
    console.log(
      `[rollback-check] step 4/5 — running ${ordered.length.toString()} down-migration(s) in reverse`,
    );
    for (const entry of ordered) {
      const downSql = readDown(entry.tag);
      console.log(`  ↩ ${entry.tag}.down.sql`);
      await db.execute(sql.raw(downSql));
    }

    // STEP 5 — assert clean state
    console.log("[rollback-check] step 5/5 — asserting public schema is empty");
    const tables = await db.execute<{ table_name: string }>(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
    `);
    const remaining = tables.rows.map((r) => r.table_name);
    if (remaining.length > 0) {
      throw new Error(
        `public schema is not empty after rollback. Remaining tables: ${remaining.join(", ")}`,
      );
    }
    const drizzleSchema = await db.execute<{ schema_name: string }>(sql`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name = 'drizzle'
    `);
    if (drizzleSchema.rows.length > 0) {
      throw new Error(
        "drizzle bookkeeping schema still present after rollback. " +
          "Down-migration must drop it (see 0000_init.down.sql).",
      );
    }

    console.log("[rollback-check] OK — apply → dedupe → rollback round-trip clean");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("[rollback-check] FAILED", err);
  process.exit(1);
});
