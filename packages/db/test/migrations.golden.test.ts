// F-1 — migration SQL golden.
//
// Reads `migrations/0000_init.sql` and asserts it contains the load-bearing
// DDL for every required table + constraint + index. This is NOT a full
// byte-identity check — drizzle-kit's generated SQL embeds a non-determinstic
// timestamp in the journal, and the random tag in the SQL filename would
// require committing the renamed file (which we do, but contents could drift
// silently in tooling upgrades). Instead we assert SCHEMA-EQUIVALENT content:
// every table and every constraint the Phase F plan §3 calls for.
//
// If drizzle-kit's emit format changes, this test flags it for explicit
// review rather than letting the migrator quietly start producing different
// SQL.
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

const journal = JSON.parse(
  readFileSync(
    new URL("../migrations/meta/_journal.json", import.meta.url),
    "utf8",
  ),
) as { entries: Array<{ tag: string; idx: number }> };

describe("@wcdraft/db migrations — 0000_init", () => {
  it("journal references the renamed 0000_init tag", () => {
    expect(journal.entries).toHaveLength(1);
    expect(journal.entries[0]?.tag).toBe("0000_init");
    expect(journal.entries[0]?.idx).toBe(0);
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
    "saved_runs_owner_token_uq",
    "ranked_attempts_user_issued_idx",
    "ranked_attempts_session_issued_idx",
    "leaderboard_entries_top_idx",
    "leaderboard_entries_dedupe_uq",
  ])("creates index %s", (idx) => {
    expect(initSql).toContain(idx);
  });

  it("uses jsonb (not json) for stub columns version_anchors + verified_result + score_breakdown", () => {
    expect(initSql).toMatch(/"version_anchors"\s+jsonb/);
    expect(initSql).toMatch(/"verified_result"\s+jsonb/);
    expect(initSql).toMatch(/"score_breakdown"\s+jsonb/);
  });

  it("uses timestamp with time zone for all timestamp columns", () => {
    // Spot-check the columns that must be tz-aware (session/token expiry).
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
