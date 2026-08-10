// F-1 — destructive apply → anonymous-dedupe assertion → rollback round-trip.
//
// HARD SAFETY POSTURE
// -------------------
// This script runs DROP TABLE. It refuses to start unless the connected
// database is API-bound to the exact ephemeral Neon branch sentinel:
//
//   1. NEON_EPHEMERAL_BRANCH_ID env var MUST be set. The CI workflow's
//      branch-create step emits this; the local run sources it from the
//      env file emitted by `neon-branch-create.ts`.
//
//   2. NEON_API_KEY and NEON_PROJECT_ID are mandatory. Sentinel-only mode is
//      forbidden even for local reruns.
//
//   3. Before any destructive statement, the shared guard queries Neon server
//      identity through the same DB handle and cross-checks the endpoint,
//      project, branch, and sentinel through the Neon API. Identity must agree
//      without ambiguity; the DSN is never treated as branch identity.
//
//   4. Primary, default, API-protected, and protected-name branches are denied.
//
// ROUND-TRIP STEPS
// ----------------
//   step 1 — apply all up-migrations
//   step 2 — INSERT two anonymous saved_runs rows (NULL owner) with the
//            same token; assert the second is rejected by the
//            UNIQUE NULLS NOT DISTINCT constraint
//   step 3 — assert leaderboard constraints, including rejection of a ranked
//            row bound to another user's unconsumed cross-config attempt and
//            the successful session lifecycle of a durable ranked binding
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
import { NeonBranchIdentityError, runWithVerifiedNeonBranchMutation } from "./neon-branch-guard.ts";

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
  return readFileSync(new URL(`../migrations/${tag}.down.sql`, import.meta.url), "utf8");
}

async function assertDuplicateRejected(
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
  const msg = errorDiagnostics(actualError);
  // Verify the rejection was the unique-constraint violation we expect,
  // not some unrelated error (e.g. connection drop).
  if (!/unique|duplicate|23505/i.test(msg)) {
    throw new Error(
      `[rollback-check] FATAL: ${description} — rejection was not a unique ` +
        `constraint violation. Error: ${msg.slice(0, 300)}`,
    );
  }
  console.log(`  ✓ ${description}`);
}

// F-4 U1 — generic rejection probe for CHECK / NOT NULL violations (the
// leaderboard column-shape guards). Same posture as assertDuplicateRejected:
// the insert MUST fail, and it must fail for the expected reason.
async function assertInsertRejected(
  description: string,
  insert: () => Promise<unknown>,
  expectedReason: RegExp,
): Promise<void> {
  let actualError: unknown = null;
  try {
    await insert();
  } catch (e) {
    actualError = e;
  }
  if (actualError === null) {
    throw new Error(
      `[rollback-check] FATAL: ${description} — INSERT SHOULD have been ` +
        "rejected but succeeded. A 0004 column constraint is missing or " +
        "its name drifted from the schema.",
    );
  }
  const msg = errorDiagnostics(actualError);
  if (!expectedReason.test(msg)) {
    throw new Error(
      `[rollback-check] FATAL: ${description} — rejection did not match ` +
        `${expectedReason.toString()}. Error: ${msg.slice(0, 300)}`,
    );
  }
  console.log(`  ✓ ${description}`);
}

async function assertMutationRejected(
  description: string,
  mutation: () => Promise<unknown>,
  expectedReason: RegExp,
): Promise<void> {
  let actualError: unknown = null;
  try {
    await mutation();
  } catch (e) {
    actualError = e;
  }
  if (actualError === null) {
    throw new Error(
      `[rollback-check] FATAL: ${description} — mutation SHOULD have been rejected but succeeded.`,
    );
  }
  const msg = errorDiagnostics(actualError);
  if (!expectedReason.test(msg)) {
    throw new Error(
      `[rollback-check] FATAL: ${description} — rejection did not match ` +
        `${expectedReason.toString()}. Error: ${msg.slice(0, 300)}`,
    );
  }
  console.log(`  ✓ ${description}`);
}

function errorDiagnostics(err: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  const queue: unknown[] = [err];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === null || current === undefined || seen.has(current)) {
      continue;
    }
    seen.add(current);
    if (current instanceof Error) {
      parts.push(current.message);
      queue.push((current as { cause?: unknown }).cause);
      if (current instanceof AggregateError) {
        queue.push(...current.errors);
      }
      const detail = current as {
        code?: unknown;
        constraint?: unknown;
        detail?: unknown;
        severity?: unknown;
      };
      for (const key of ["code", "constraint", "detail", "severity"] as const) {
        const value = detail[key];
        if (typeof value === "string" && value.length > 0) {
          parts.push(`${key}=${value}`);
        }
      }
      continue;
    }
    if (typeof current === "object") {
      const detail = current as {
        cause?: unknown;
        errors?: unknown;
        message?: unknown;
        code?: unknown;
        constraint?: unknown;
        detail?: unknown;
        severity?: unknown;
      };
      for (const key of ["message", "code", "constraint", "detail", "severity"] as const) {
        const value = detail[key];
        if (typeof value === "string" && value.length > 0) {
          parts.push(`${key}=${value}`);
        }
      }
      queue.push(detail.cause);
      if (Array.isArray(detail.errors)) {
        queue.push(...detail.errors);
      }
      continue;
    }
    parts.push(String(current));
  }
  return parts.join("\n");
}

async function main(): Promise<void> {
  const { db, pool } = openMigratorDb();
  const migrationsFolder = new URL("../migrations", import.meta.url).pathname;
  try {
    await runWithVerifiedNeonBranchMutation(
      {
        intendedBranchId: process.env.NEON_EPHEMERAL_BRANCH_ID,
        apiKey: process.env.NEON_API_KEY,
        projectId: process.env.NEON_PROJECT_ID,
      },
      { verifiedHandle: db },
      async (_target, verifiedDb) => {
        // VERIFIED_ROLLBACK_MUTATION_SCOPE_START — every apply, probe mutation,
        // purge, down migration, and clean-state assertion stays inside this
        // callback so target verification dominates the full destructive run.
        console.log(
          "[rollback-check] guard: connected database is bound to one API-verified " +
            "non-primary, unprotected ephemeral branch",
        );

        // STEP 1 — APPLY. This callback is unreachable until target verification passes.
        console.log("[rollback-check] step 1/6 — applying all up-migrations");
        await migrate(verifiedDb, { migrationsFolder });

        // STEP 2 — assert anonymous saved_runs dedupe is now SESSION-SCOPED
        //
        // F-3 split the F-1 global `UNIQUE NULLS NOT DISTINCT (owner_user_id, token)`
        // into two PARTIAL unique indexes so anon rows dedupe per-session, not
        // globally. The F-1 anti-spam invariant remains true at the session
        // level — the test now exercises that more specific shape PLUS the
        // negative case: anon rows with the SAME token across DIFFERENT
        // sessions are allowed.
        console.log("[rollback-check] step 2/6 — saved_runs anonymous dedupe (session-scoped)");
        const dupToken = `rollback-check-token-${Math.floor(performance.now()).toString()}`;
        const sessionA = `rollback-check-session-a-${Math.floor(performance.now()).toString()}`;
        const sessionB = `rollback-check-session-b-${Math.floor(performance.now()).toString()}`;
        const sessionCsrf = "csrf-secret-for-rollback-check";
        // Seed the sessions we'll bind anon rows to.
        await verifiedDb.execute(sql`
      INSERT INTO sessions (id, user_id, csrf_secret, expires_at)
      VALUES (${sessionA}, NULL, ${sessionCsrf}, NOW() + INTERVAL '1 hour')
    `);
        await verifiedDb.execute(sql`
      INSERT INTO sessions (id, user_id, csrf_secret, expires_at)
      VALUES (${sessionB}, NULL, ${sessionCsrf}, NOW() + INTERVAL '1 hour')
    `);
        // Row 1: anon, session A, token T → succeed.
        await verifiedDb.execute(sql`
      INSERT INTO saved_runs (owner_user_id, session_id, token, claim_state)
      VALUES (NULL, ${sessionA}, ${dupToken}, 'anonymous')
    `);
        // Row 2: anon, SAME session, SAME token → MUST be rejected (session-scoped dedupe).
        await assertDuplicateRejected(
          "saved_runs: two NULL-owner rows in the SAME session with the same token must be rejected",
          () =>
            verifiedDb.execute(sql`
          INSERT INTO saved_runs (owner_user_id, session_id, token, claim_state)
          VALUES (NULL, ${sessionA}, ${dupToken}, 'anonymous')
        `),
        );
        // Row 3: anon, DIFFERENT session, SAME token → MUST succeed (no cross-session collision).
        await verifiedDb.execute(sql`
      INSERT INTO saved_runs (owner_user_id, session_id, token, claim_state)
      VALUES (NULL, ${sessionB}, ${dupToken}, 'anonymous')
    `);
        console.log(
          "  ✓ saved_runs: NULL-owner rows in DIFFERENT sessions with the same token are allowed",
        );

        // STEP 3 — assert users.username + anonymous leaderboard_entries dedupe
        // + column-shape probes (0004_f4_leaderboard, 0005_leaderboard_profiles).
        console.log(
          "[rollback-check] step 3/6 — username/profile shape + leaderboard_entries anonymous dedupe",
        );
        const lbToken = `rollback-check-lb-token-${Math.floor(performance.now()).toString()}`;
        const lbSeason = "rollback-check-season-001";
        await verifiedDb.execute(sql`
      INSERT INTO users (email, username)
      VALUES ('rollback-check-a@example.com', 'caseuser')
    `);
        await assertInsertRejected(
          "users: duplicate username must be rejected by users_username_ci_uq",
          () =>
            verifiedDb.execute(sql`
          INSERT INTO users (email, username)
          VALUES ('rollback-check-b@example.com', 'caseuser')
        `),
          /users_username_ci_uq|unique|duplicate|23505/i,
        );
        await assertInsertRejected(
          "users: uppercase username must be rejected by format CHECK (server normalizes before write)",
          () =>
            verifiedDb.execute(sql`
          INSERT INTO users (email, username)
          VALUES ('rollback-check-c@example.com', 'CaseUser')
        `),
          /users_username_format_chk|check constraint/i,
        );
        await verifiedDb.execute(sql`
      UPDATE users
      SET email_verified_at = NOW()
      WHERE email = 'rollback-check-a@example.com'
    `);
        const verifiedProbe = await verifiedDb.execute<{
          email_verified_at: Date | string | null;
        }>(sql`
      SELECT email_verified_at
      FROM users
      WHERE email = 'rollback-check-a@example.com'
    `);
        if (verifiedProbe.rows[0]?.email_verified_at == null) {
          throw new Error("[rollback-check] FATAL: users.email_verified_at did not persist");
        }
        console.log("  ✓ users: email_verified_at nullable verification timestamp persists");
        await verifiedDb.execute(sql`
      INSERT INTO leaderboard_entries
        (season_key, mode, draft_mode, draft_order, era, rating_basis, user_id, session_id, display_alias, token, verified_score)
      VALUES (${lbSeason}, 'casual', 'classic', 'squad_first', 'all_time', 'career', NULL, ${sessionA}, 'rollback_check', ${lbToken}, 0)
    `);
        await assertDuplicateRejected(
          "leaderboard_entries: two NULL-user rows with the same (season,mode,token) must be rejected",
          () =>
            verifiedDb.execute(sql`
          INSERT INTO leaderboard_entries
            (season_key, mode, draft_mode, user_id, session_id, display_alias, token, verified_score)
          VALUES (${lbSeason}, 'casual', 'classic', NULL, ${sessionA}, 'rollback_check', ${lbToken}, 0)
        `),
        );
        // NULLS-NOT-DISTINCT × new-column interaction: the dedupe key is still
        // (season_key, mode, user_id, token) ONLY — a different session_id,
        // display_alias, draft_mode, or config must NOT open a second row for
        // the same anon token. (The token IS the run and carries config.)
        await assertDuplicateRejected(
          "leaderboard_entries: differing session_id/display_alias/draft_mode must NOT bypass the anon dedupe",
          () =>
            verifiedDb.execute(sql`
          INSERT INTO leaderboard_entries
            (season_key, mode, draft_mode, draft_order, era, rating_basis, user_id, session_id, display_alias, token, verified_score)
          VALUES (${lbSeason}, 'casual', 'hidden', 'position_first', 'modern', 'current', NULL, ${sessionB}, 'other_name', ${lbToken}, 0)
        `),
        );
        // 0004 CHECK probes — every constraint must hold at the DB layer.
        await assertInsertRejected(
          "leaderboard_entries: display_alias shorter than 3 chars must be rejected (CHECK)",
          () =>
            verifiedDb.execute(sql`
          INSERT INTO leaderboard_entries
            (season_key, mode, draft_mode, draft_order, era, rating_basis, user_id, display_alias, token, verified_score)
          VALUES (${lbSeason}, 'casual', 'classic', 'squad_first', 'all_time', 'career', NULL, 'ab', ${`${lbToken}-shortname`}, 0)
        `),
          /leaderboard_entries_display_alias_chk|check constraint/i,
        );
        await assertInsertRejected(
          "leaderboard_entries: anonymous row without display_alias must be rejected (CHECK)",
          () =>
            verifiedDb.execute(sql`
          INSERT INTO leaderboard_entries
            (season_key, mode, draft_mode, draft_order, era, rating_basis, user_id, display_alias, token, verified_score)
          VALUES (${lbSeason}, 'casual', 'classic', 'squad_first', 'all_time', 'career', NULL, NULL, ${`${lbToken}-noname`}, 0)
        `),
          /leaderboard_entries_public_name_chk|check constraint/i,
        );
        await assertInsertRejected(
          "leaderboard_entries: draft_mode outside (classic|hidden) must be rejected (CHECK)",
          () =>
            verifiedDb.execute(sql`
          INSERT INTO leaderboard_entries
            (season_key, mode, draft_mode, draft_order, era, rating_basis, user_id, display_alias, token, verified_score)
          VALUES (${lbSeason}, 'casual', 'speedrun', 'squad_first', 'all_time', 'career', NULL, 'rollback_check', ${`${lbToken}-badmode`}, 0)
        `),
          /leaderboard_entries_draft_mode_chk|check constraint/i,
        );
        await assertInsertRejected(
          "leaderboard_entries: draft_order outside (squad_first|position_first) must be rejected (CHECK)",
          () =>
            verifiedDb.execute(sql`
          INSERT INTO leaderboard_entries
            (season_key, mode, draft_mode, draft_order, era, rating_basis, user_id, display_alias, token, verified_score)
          VALUES (${lbSeason}, 'casual', 'classic', 'speedrun', 'all_time', 'career', NULL, 'rollback_check', ${`${lbToken}-badorder`}, 0)
        `),
          /leaderboard_entries_draft_order_chk|check constraint/i,
        );
        await assertInsertRejected(
          "leaderboard_entries: era outside preset ids must be rejected (CHECK)",
          () =>
            verifiedDb.execute(sql`
          INSERT INTO leaderboard_entries
            (season_key, mode, draft_mode, draft_order, era, rating_basis, user_id, display_alias, token, verified_score)
          VALUES (${lbSeason}, 'casual', 'classic', 'squad_first', '2026_only', 'career', NULL, 'rollback_check', ${`${lbToken}-badera`}, 0)
        `),
          /leaderboard_entries_era_chk|check constraint/i,
        );
        await assertInsertRejected(
          "leaderboard_entries: rating_basis outside (career|current) must be rejected (CHECK)",
          () =>
            verifiedDb.execute(sql`
          INSERT INTO leaderboard_entries
            (season_key, mode, draft_mode, draft_order, era, rating_basis, user_id, display_alias, token, verified_score)
          VALUES (${lbSeason}, 'casual', 'classic', 'squad_first', 'all_time', 'prime', NULL, 'rollback_check', ${`${lbToken}-badbasis`}, 0)
        `),
          /leaderboard_entries_rating_basis_chk|check constraint/i,
        );
        await assertInsertRejected(
          "leaderboard_entries: partial config must be rejected (CHECK)",
          () =>
            verifiedDb.execute(sql`
          INSERT INTO leaderboard_entries
            (season_key, mode, draft_mode, draft_order, era, rating_basis, user_id, display_alias, token, verified_score)
          VALUES (${lbSeason}, 'casual', 'classic', 'squad_first', NULL, 'career', NULL, 'rollback_check', ${`${lbToken}-partialconfig`}, 0)
        `),
          /leaderboard_entries_config_complete_chk|check constraint/i,
        );
        // RANKED IS ACCOUNT-REQUIRED (Lead-Architect ruling) — structural at
        // BOTH tables: a ranked entry with NULL user and a ranked attempt
        // without a user must be impossible regardless of application bugs.
        await assertInsertRejected(
          "leaderboard_entries: ranked row with NULL user_id must be rejected (CHECK)",
          () =>
            verifiedDb.execute(sql`
          INSERT INTO leaderboard_entries
            (season_key, mode, draft_mode, draft_order, era, rating_basis, user_id, display_alias, token, verified_score)
          VALUES (${lbSeason}, 'ranked', 'classic', 'squad_first', 'all_time', 'career', NULL, 'rollback_check', ${`${lbToken}-ranked`}, 0)
        `),
          /leaderboard_entries_ranked_(user|attempt)_chk|check constraint/i,
        );
        await assertInsertRejected(
          "ranked_attempts: NULL user_id must be rejected (NOT NULL)",
          () =>
            verifiedDb.execute(sql`
          INSERT INTO ranked_attempts
            (user_id, session_id, season_key, formation_id, draft_mode, draft_order, era, rating_basis, issued_parent_seed, nonce, window_expires_at)
          VALUES (NULL, ${sessionA}, ${lbSeason}, '4-3-3', 'classic', 'squad_first', 'all_time', 'career', 'rollback-check-seed', 'rollback-check-nonce', NOW() + INTERVAL '10 minutes')
        `),
          /not-null constraint|null value/i,
        );
        // Audit S1 B3 adversarial reproduction: an application bug or direct SQL
        // writer must not be able to attach a ranked row to another user's
        // unconsumed attempt from a different season/config. Supply non-null
        // witnesses so the composite FK (not merely the ranked CHECK) adjudicates.
        await verifiedDb.execute(sql`
      INSERT INTO users (email, username)
      VALUES ('rollback-check-rival@example.com', 'rivaluser')
    `);
        const ownerRows = await verifiedDb.execute<{ id: string }>(sql`
      SELECT id FROM users WHERE email = 'rollback-check-a@example.com'
    `);
        const rivalRows = await verifiedDb.execute<{ id: string }>(sql`
      SELECT id FROM users WHERE email = 'rollback-check-rival@example.com'
    `);
        const ownerId = ownerRows.rows[0]?.id;
        const rivalId = rivalRows.rows[0]?.id;
        if (!ownerId || !rivalId) {
          throw new Error("[rollback-check] FATAL: ranked binding probe users were not created");
        }
        await assertInsertRejected(
          "leaderboard_entries: non-exempt ranked row without an attempt must be rejected",
          () =>
            verifiedDb.execute(sql`
          INSERT INTO leaderboard_entries
            (season_key, mode, draft_mode, draft_order, era, rating_basis, user_id, token, verified_score)
          VALUES
            (${lbSeason}, 'ranked', 'classic', 'squad_first', 'all_time', 'career', ${ownerId}::uuid, ${`${lbToken}-attemptless-non-exempt`}, 999)
        `),
          /leaderboard_entries_ranked_attempt_(binding_)?chk|check constraint|23514/i,
        );
        const attemptRows = await verifiedDb.execute<{ id: string }>(sql`
      INSERT INTO ranked_attempts
        (user_id, season_key, formation_id, draft_mode, draft_order, era, rating_basis, issued_parent_seed, nonce, window_expires_at)
      VALUES
        (${rivalId}::uuid, 'rollback-check-rival-season', '3-5-2', 'hidden', 'position_first', 'modern', 'current', 'rollback-check-rival-seed', 'rollback-check-rival-nonce', NOW() + INTERVAL '10 minutes')
      RETURNING id
    `);
        const adversarialAttemptId = attemptRows.rows[0]?.id;
        if (!adversarialAttemptId) {
          throw new Error("[rollback-check] FATAL: adversarial ranked attempt was not created");
        }
        await assertInsertRejected(
          "leaderboard_entries: another user's unconsumed cross-config attempt must be rejected",
          () =>
            verifiedDb.execute(sql`
          INSERT INTO leaderboard_entries
            (season_key, mode, draft_mode, draft_order, era, rating_basis, user_id, attempt_id, attempt_formation_id, attempt_consumed_at, token, verified_score)
          VALUES
            (${lbSeason}, 'ranked', 'classic', 'squad_first', 'all_time', 'career', ${ownerId}::uuid, ${adversarialAttemptId}::uuid, '4-3-3', NOW(), ${`${lbToken}-adversarial-binding`}, 999)
        `),
          /leaderboard_entries_ranked_attempt_binding_fk|foreign key|23503/i,
        );
        // Review fix-forward: a successful ranked graph must not make session
        // revocation fail. Both session references detach, while the attempt and
        // public entry retain their exact composite binding. User ownership still
        // cascades both artifacts, and direct attempt mutation/deletion remains
        // restricted for the lifetime of the entry.
        const rankedSessionId = `rollback-check-ranked-session-${Math.floor(performance.now()).toString()}`;
        const rankedToken = `${lbToken}-ranked-lifecycle`;
        await verifiedDb.execute(sql`
      INSERT INTO sessions (id, user_id, csrf_secret, expires_at)
      VALUES (${rankedSessionId}, ${ownerId}::uuid, ${sessionCsrf}, NOW() + INTERVAL '1 hour')
    `);
        const lifecycleAttempts = await verifiedDb.execute<{
          id: string;
          consumed_at: Date | string;
        }>(sql`
      INSERT INTO ranked_attempts
        (user_id, session_id, season_key, formation_id, draft_mode, draft_order, era, rating_basis, issued_parent_seed, nonce, window_expires_at, consumed_at)
      VALUES
        (${ownerId}::uuid, ${rankedSessionId}, ${lbSeason}, '4-3-3', 'classic', 'squad_first', 'all_time', 'career', 'rollback-check-lifecycle-seed', 'rollback-check-lifecycle-nonce', NOW() + INTERVAL '10 minutes', NOW())
      RETURNING id, consumed_at
    `);
        const lifecycleAttemptId = lifecycleAttempts.rows[0]?.id;
        const lifecycleConsumedAt = lifecycleAttempts.rows[0]?.consumed_at;
        if (!lifecycleAttemptId || lifecycleConsumedAt == null) {
          throw new Error("[rollback-check] FATAL: ranked lifecycle attempt was not created");
        }
        await verifiedDb.execute(sql`
      INSERT INTO leaderboard_entries
        (season_key, mode, draft_mode, draft_order, era, rating_basis, user_id, session_id, attempt_id, attempt_formation_id, attempt_consumed_at, token, verified_score)
      VALUES
        (${lbSeason}, 'ranked', 'classic', 'squad_first', 'all_time', 'career', ${ownerId}::uuid, ${rankedSessionId}, ${lifecycleAttemptId}::uuid, '4-3-3', ${lifecycleConsumedAt}, ${rankedToken}, 180)
    `);

        await verifiedDb.execute(sql`DELETE FROM sessions WHERE id = ${rankedSessionId}`);
        const lifecycleGraph = await verifiedDb.execute<{
          attempt_session_id: string | null;
          entry_session_id: string | null;
          session_deleted: boolean;
          binding_intact: boolean;
        }>(sql`
      SELECT
        attempt.session_id AS attempt_session_id,
        entry.session_id AS entry_session_id,
        NOT EXISTS (SELECT 1 FROM sessions WHERE id = ${rankedSessionId}) AS session_deleted,
        (
          entry.attempt_id = attempt.id
          AND entry.user_id = attempt.user_id
          AND entry.season_key = attempt.season_key
          AND entry.attempt_formation_id = attempt.formation_id
          AND entry.draft_mode = attempt.draft_mode
          AND entry.draft_order = attempt.draft_order
          AND entry.era = attempt.era
          AND entry.rating_basis = attempt.rating_basis
          AND entry.attempt_consumed_at = attempt.consumed_at
        ) AS binding_intact
      FROM leaderboard_entries AS entry
      JOIN ranked_attempts AS attempt ON attempt.id = entry.attempt_id
      WHERE entry.token = ${rankedToken}
    `);
        const lifecycleRow = lifecycleGraph.rows[0];
        if (
          lifecycleGraph.rows.length !== 1 ||
          lifecycleRow?.attempt_session_id !== null ||
          lifecycleRow.entry_session_id !== null ||
          lifecycleRow.session_deleted !== true ||
          lifecycleRow.binding_intact !== true
        ) {
          throw new Error(
            "[rollback-check] FATAL: session deletion did not preserve the detached ranked binding",
          );
        }
        console.log(
          "  ✓ ranked lifecycle: session deleted; attempt + entry detached; binding intact",
        );

        await assertMutationRejected(
          "ranked lifecycle: referenced attempt key mutation remains restricted",
          () =>
            verifiedDb.execute(sql`
          UPDATE ranked_attempts SET formation_id = '4-4-2'
          WHERE id = ${lifecycleAttemptId}::uuid
        `),
          /leaderboard_entries_ranked_attempt_binding_fk|foreign key|23001|23503/i,
        );
        await assertMutationRejected(
          "ranked lifecycle: direct referenced attempt deletion remains restricted",
          () =>
            verifiedDb.execute(sql`
          DELETE FROM ranked_attempts WHERE id = ${lifecycleAttemptId}::uuid
        `),
          /leaderboard_entries_ranked_attempt_binding_fk|foreign key|23001|23503/i,
        );

        await verifiedDb.execute(sql`DELETE FROM users WHERE id = ${ownerId}::uuid`);
        const userCascade = await verifiedDb.execute<{
          users: number;
          sessions: number;
          attempts: number;
          entries: number;
        }>(sql`
      SELECT
        (SELECT count(*)::integer FROM users WHERE id = ${ownerId}::uuid) AS users,
        (SELECT count(*)::integer FROM sessions WHERE user_id = ${ownerId}::uuid) AS sessions,
        (SELECT count(*)::integer FROM ranked_attempts WHERE id = ${lifecycleAttemptId}::uuid) AS attempts,
        (SELECT count(*)::integer FROM leaderboard_entries WHERE token = ${rankedToken}) AS entries
    `);
        const cascadeRow = userCascade.rows[0];
        if (
          cascadeRow?.users !== 0 ||
          cascadeRow.sessions !== 0 ||
          cascadeRow.attempts !== 0 ||
          cascadeRow.entries !== 0
        ) {
          throw new Error(
            "[rollback-check] FATAL: user deletion did not cascade ranked graph cleanly",
          );
        }
        console.log("  ✓ ranked lifecycle: user deletion cascades attempt + entry cleanly");

        // ON DELETE SET NULL semantics: board entries are public artifacts that
        // must SURVIVE session expiry/sweep (unlike cascading operational rows).
        // sessionB owns no leaderboard rows yet — bind one, delete the session,
        // assert the row remains with session_id NULL.
        const setNullToken = `${lbToken}-setnull`;
        await verifiedDb.execute(sql`
      INSERT INTO leaderboard_entries
        (season_key, mode, draft_mode, draft_order, era, rating_basis, user_id, session_id, display_alias, token, verified_score)
      VALUES (${lbSeason}, 'casual', 'classic', 'squad_first', 'all_time', 'career', NULL, ${sessionB}, 'rollback_check', ${setNullToken}, 0)
    `);
        await verifiedDb.execute(sql`DELETE FROM sessions WHERE id = ${sessionB}`);
        const survivors = await verifiedDb.execute<{ session_id: string | null }>(sql`
      SELECT session_id FROM leaderboard_entries WHERE token = ${setNullToken}
    `);
        if (survivors.rows.length !== 1 || survivors.rows[0]?.session_id !== null) {
          throw new Error(
            "[rollback-check] FATAL: leaderboard entry did not survive session " +
              "deletion with session_id NULL — the FK must be ON DELETE SET NULL " +
              `(rows=${survivors.rows.length.toString()}, session_id=${String(survivors.rows[0]?.session_id)})`,
          );
        }
        console.log(
          "  ✓ leaderboard_entries: row survives session deletion with session_id SET NULL",
        );

        // CLEANUP — drop the runtime-test rows BEFORE attempting to roll back.
        // The session-scoped positive case in step 2 seeds two NULL-owner rows
        // with the same token across two different sessions. That is LEGAL
        // under F-3 (session-scoped dedupe) but ILLEGAL under F-1's restored
        // global `UNIQUE NULLS NOT DISTINCT (owner_user_id, token)`. If we
        // tried to ALTER TABLE … ADD CONSTRAINT … on a populated table, the
        // index build would fail with 23505. A real-world rollback would need
        // the same purge (or a per-row dedupe), so this is also a documentary
        // signal: F-3 → F-1 rollback on a populated DB requires data cleanup.
        console.log("[rollback-check] step 4/6 — purging runtime-test rows pre-rollback");
        await verifiedDb.execute(sql`DELETE FROM saved_runs`);
        await verifiedDb.execute(sql`DELETE FROM leaderboard_entries`);
        await verifiedDb.execute(sql`DELETE FROM sessions`);

        // STEP 5 — ROLLBACK in reverse journal order
        const journal = readJournal();
        const ordered = [...journal.entries].sort((a, b) => b.idx - a.idx);
        console.log(
          `[rollback-check] step 5/6 — running ${ordered.length.toString()} down-migration(s) in reverse`,
        );
        for (const entry of ordered) {
          const downSql = readDown(entry.tag);
          console.log(`  ↩ ${entry.tag}.down.sql`);
          await verifiedDb.execute(sql.raw(downSql));
        }

        // STEP 5 — assert clean state
        console.log("[rollback-check] step 6/6 — asserting public schema is empty");
        const tables = await verifiedDb.execute<{ table_name: string }>(sql`
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
        const drizzleSchema = await verifiedDb.execute<{ schema_name: string }>(sql`
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
        // VERIFIED_ROLLBACK_MUTATION_SCOPE_END
      },
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(
    "[rollback-check] FAILED",
    err instanceof NeonBranchIdentityError
      ? err.message
      : "rollback check failed; protected diagnostics are not printed",
  );
  process.exit(1);
});
