// F-1 — migration SQL golden + structural NULLS NOT DISTINCT guard.
//
// Reads `migrations/0000_init.sql` and asserts it contains the load-bearing
// DDL for every required table + constraint + index, INCLUDING the
// UNIQUE NULLS NOT DISTINCT semantics on both anonymous-dedupe constraints
// (the bug an independent reviewer caught by inserting duplicate NULL rows
// on a Neon branch).
//
// This is the cheap CI-tier static guard. The RUNTIME proof — actually
// inserting duplicates and verifying Postgres rejects them — lives in
// `scripts/rollback-check.ts` and runs against an ephemeral Neon branch.
//
// If drizzle-kit's emit format changes, this file flags the drift instead
// of letting the migrator quietly start producing different SQL.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const initSql = readFileSync(
  new URL("../migrations/0000_init.sql", import.meta.url),
  "utf8",
);

const downSql = readFileSync(
  new URL("../migrations/0000_init.down.sql", import.meta.url),
  "utf8",
);

const authSql = readFileSync(
  new URL("../migrations/0001_auth_rate_limits.sql", import.meta.url),
  "utf8",
);

const authDownSql = readFileSync(
  new URL("../migrations/0001_auth_rate_limits.down.sql", import.meta.url),
  "utf8",
);

const histSql = readFileSync(
  new URL("../migrations/0002_history_session_scope.sql", import.meta.url),
  "utf8",
);

const histDownSql = readFileSync(
  new URL("../migrations/0002_history_session_scope.down.sql", import.meta.url),
  "utf8",
);

const summarySql = readFileSync(
  new URL("../migrations/0003_summary_jsonb.sql", import.meta.url),
  "utf8",
);

const summaryDownSql = readFileSync(
  new URL("../migrations/0003_summary_jsonb.down.sql", import.meta.url),
  "utf8",
);

const journal = JSON.parse(
  readFileSync(
    new URL("../migrations/meta/_journal.json", import.meta.url),
    "utf8",
  ),
) as { entries: Array<{ tag: string; idx: number }> };

describe("@wcdraft/db migrations — 0000_init", () => {
  it("journal references the renamed 0000/0001/0002/0003 tags", () => {
    expect(journal.entries).toHaveLength(4);
    expect(journal.entries[0]?.tag).toBe("0000_init");
    expect(journal.entries[0]?.idx).toBe(0);
    expect(journal.entries[1]?.tag).toBe("0001_auth_rate_limits");
    expect(journal.entries[1]?.idx).toBe(1);
    expect(journal.entries[2]?.tag).toBe("0002_history_session_scope");
    expect(journal.entries[2]?.idx).toBe(2);
    expect(journal.entries[3]?.tag).toBe("0003_summary_jsonb");
    expect(journal.entries[3]?.idx).toBe(3);
  });

  it.each([
    "users",
    "magic_link_tokens",
    "sessions",
    "saved_runs",
    "ranked_attempts",
    "leaderboard_entries",
  ])("creates table %s", (table) => {
    expect(initSql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`));
  });

  // ── FIX 1 — UNIQUE NULLS NOT DISTINCT on the two anonymous-dedupe constraints
  //
  // Plain UNIQUE indexes on nullable columns are TOOTHLESS against the
  // default anonymous case (Postgres treats NULLs as distinct, so two
  // anon rows with the same token both insert). The constraint MUST use
  // NULLS NOT DISTINCT (Postgres 15+). These tests are the static guard;
  // rollback-check.ts is the runtime proof.

  it("emits UNIQUE NULLS NOT DISTINCT on saved_runs_owner_token_uq", () => {
    expect(initSql).toMatch(
      /CONSTRAINT\s+"saved_runs_owner_token_uq"\s+UNIQUE\s+NULLS\s+NOT\s+DISTINCT\("owner_user_id","token"\)/,
    );
  });

  it("emits UNIQUE NULLS NOT DISTINCT on leaderboard_entries_dedupe_uq", () => {
    expect(initSql).toMatch(
      /CONSTRAINT\s+"leaderboard_entries_dedupe_uq"\s+UNIQUE\s+NULLS\s+NOT\s+DISTINCT\("season_key","mode","user_id","token"\)/,
    );
  });

  it("does NOT regress to a plain unique index on either dedupe key", () => {
    // Belt-and-suspenders: catch a future refactor that quietly swaps the
    // constraint back to `uniqueIndex(...)` (which would re-introduce the
    // anonymous-spam vector).
    expect(initSql).not.toMatch(
      /CREATE UNIQUE INDEX[^;]*"saved_runs_owner_token_uq"/,
    );
    expect(initSql).not.toMatch(
      /CREATE UNIQUE INDEX[^;]*"leaderboard_entries_dedupe_uq"/,
    );
  });

  it("emits CHECK on saved_runs.claim_state (anonymous|claimed)", () => {
    expect(initSql).toMatch(/saved_runs_claim_state_chk/);
    expect(initSql).toMatch(/'anonymous'/);
    expect(initSql).toMatch(/'claimed'/);
  });

  it("emits CHECK on leaderboard_entries.mode (casual|ranked)", () => {
    expect(initSql).toMatch(/leaderboard_entries_mode_chk/);
    expect(initSql).toMatch(/'casual'/);
    expect(initSql).toMatch(/'ranked'/);
  });

  it.each([
    "users_email_unique",
    "magic_link_tokens_user_id_users_id_fk",
    "sessions_user_id_users_id_fk",
    "saved_runs_owner_user_id_users_id_fk",
    "ranked_attempts_user_id_users_id_fk",
    "ranked_attempts_session_id_sessions_id_fk",
    "leaderboard_entries_user_id_users_id_fk",
    "leaderboard_entries_attempt_id_ranked_attempts_id_fk",
  ])("declares constraint %s", (constraint) => {
    expect(initSql).toContain(constraint);
  });

  it.each([
    "magic_link_tokens_email_idx",
    "magic_link_tokens_expires_at_idx",
    "sessions_user_id_idx",
    "sessions_expires_at_idx",
    "saved_runs_owner_created_idx",
    "ranked_attempts_user_issued_idx",
    "ranked_attempts_session_issued_idx",
    "leaderboard_entries_top_idx",
  ])("creates index %s", (idx) => {
    expect(initSql).toContain(idx);
  });

  it("uses jsonb (not json) for stub columns version_anchors + verified_result + score_breakdown", () => {
    expect(initSql).toMatch(/"version_anchors"\s+jsonb/);
    expect(initSql).toMatch(/"verified_result"\s+jsonb/);
    expect(initSql).toMatch(/"score_breakdown"\s+jsonb/);
  });

  it("uses timestamp with time zone for all timestamp columns", () => {
    expect(initSql).toMatch(
      /"expires_at"\s+timestamp\s+with\s+time\s+zone\s+NOT\s+NULL/,
    );
    expect(initSql).toMatch(
      /"window_expires_at"\s+timestamp\s+with\s+time\s+zone\s+NOT\s+NULL/,
    );
  });

  it("does NOT touch the legacy LeaderboardSubmissionSchema (that's F-4)", () => {
    expect(initSql).not.toMatch(/leaderboard_submissions/i);
  });

  it("does NOT include monetization tables (deferred)", () => {
    expect(initSql).not.toMatch(/entitlements/i);
    expect(initSql).not.toMatch(/stripe_events/i);
  });

  it("down-migration drops in FK-safe reverse order", () => {
    const lines = downSql
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("DROP TABLE"));
    expect(lines).toEqual([
      'DROP TABLE IF EXISTS "leaderboard_entries";',
      'DROP TABLE IF EXISTS "ranked_attempts";',
      'DROP TABLE IF EXISTS "saved_runs";',
      'DROP TABLE IF EXISTS "sessions";',
      'DROP TABLE IF EXISTS "magic_link_tokens";',
      'DROP TABLE IF EXISTS "users";',
    ]);
  });

  it("down-migration also drops the drizzle bookkeeping schema", () => {
    expect(downSql).toMatch(/DROP SCHEMA IF EXISTS "drizzle" CASCADE/);
  });
});

describe("@wcdraft/db migrations — 0001_auth_rate_limits", () => {
  it("creates auth_rate_limits table", () => {
    expect(authSql).toMatch(/CREATE TABLE IF NOT EXISTS "auth_rate_limits"/);
  });

  it("uses composite primary key (bucket_key, window_start)", () => {
    expect(authSql).toMatch(
      /CONSTRAINT\s+"auth_rate_limits_pk"\s+PRIMARY KEY\("bucket_key","window_start"\)/,
    );
  });

  it("creates the window_start sweep index", () => {
    expect(authSql).toContain("auth_rate_limits_window_idx");
  });

  it("uses jsonb-incompatible plain integer for count column", () => {
    expect(authSql).toMatch(/"count"\s+integer/);
  });

  it("down-migration drops auth_rate_limits", () => {
    expect(authDownSql).toMatch(/DROP TABLE IF EXISTS "auth_rate_limits"/);
  });
});

describe("@wcdraft/db migrations — 0002_history_session_scope", () => {
  it("DROPS the F-1 global UNIQUE NULLS NOT DISTINCT constraint", () => {
    expect(histSql).toMatch(
      /ALTER TABLE "saved_runs" DROP CONSTRAINT "saved_runs_owner_token_uq"/,
    );
  });

  it("adds saved_runs.session_id column (nullable text)", () => {
    expect(histSql).toMatch(
      /ALTER TABLE "saved_runs" ADD COLUMN "session_id" text/,
    );
  });

  it("adds FK saved_runs.session_id → sessions.id ON DELETE set null", () => {
    expect(histSql).toMatch(
      /ADD CONSTRAINT "saved_runs_session_id_sessions_id_fk"\s+FOREIGN KEY \("session_id"\) REFERENCES "public"\."sessions"\("id"\) ON DELETE set null/,
    );
  });

  it("creates account-scoped partial UNIQUE on (owner_user_id, token) WHERE owner IS NOT NULL", () => {
    expect(histSql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "saved_runs_owner_token_uq" ON "saved_runs" USING btree \("owner_user_id","token"\) WHERE "saved_runs"\."owner_user_id" IS NOT NULL/,
    );
  });

  it("creates session-scoped partial UNIQUE on (session_id, token) WHERE anon AND session IS NOT NULL", () => {
    expect(histSql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "saved_runs_session_token_uq" ON "saved_runs" USING btree \("session_id","token"\) WHERE "saved_runs"\."owner_user_id" IS NULL AND "saved_runs"\."session_id" IS NOT NULL/,
    );
  });

  it("creates a session_id lookup index", () => {
    expect(histSql).toMatch(
      /CREATE INDEX IF NOT EXISTS "saved_runs_session_idx" ON "saved_runs" USING btree \("session_id"\)/,
    );
  });

  it("does NOT touch users / magic_link_tokens / sessions tables (additive on saved_runs only)", () => {
    expect(histSql).not.toMatch(/CREATE TABLE/);
    expect(histSql).not.toMatch(/ALTER TABLE "users"/);
    expect(histSql).not.toMatch(/ALTER TABLE "sessions"/);
  });

  it("down-migration restores F-1's global UNIQUE NULLS NOT DISTINCT constraint", () => {
    expect(histDownSql).toMatch(
      /ADD CONSTRAINT "saved_runs_owner_token_uq"\s+UNIQUE NULLS NOT DISTINCT \("owner_user_id", "token"\)/,
    );
  });

  it("down-migration drops F-3 partial uniques + session_id column", () => {
    expect(histDownSql).toMatch(/DROP INDEX IF EXISTS "saved_runs_session_token_uq"/);
    expect(histDownSql).toMatch(/DROP INDEX IF EXISTS "saved_runs_owner_token_uq"/);
    expect(histDownSql).toMatch(/DROP INDEX IF EXISTS "saved_runs_session_idx"/);
    expect(histDownSql).toMatch(/DROP COLUMN IF EXISTS "session_id"/);
  });
});

describe("@wcdraft/db migrations — 0003_summary_jsonb", () => {
  it("adds saved_runs.summary as a nullable jsonb column", () => {
    expect(summarySql).toMatch(
      /ALTER TABLE "saved_runs" ADD COLUMN "summary" jsonb/,
    );
    // Single-statement additive migration — no schema reshape.
    expect(summarySql).not.toMatch(/CREATE TABLE/);
    expect(summarySql).not.toMatch(/DROP/);
  });

  it("down-migration drops the summary column (idempotent IF EXISTS)", () => {
    expect(summaryDownSql).toMatch(
      /ALTER TABLE "saved_runs" DROP COLUMN IF EXISTS "summary"/,
    );
  });

  it("does NOT touch any other table (additive on saved_runs only)", () => {
    expect(summarySql).not.toMatch(/ALTER TABLE "users"/);
    expect(summarySql).not.toMatch(/ALTER TABLE "sessions"/);
    expect(summarySql).not.toMatch(/ALTER TABLE "magic_link_tokens"/);
    expect(summarySql).not.toMatch(/ALTER TABLE "leaderboard_entries"/);
    expect(summarySql).not.toMatch(/ALTER TABLE "ranked_attempts"/);
  });
});

