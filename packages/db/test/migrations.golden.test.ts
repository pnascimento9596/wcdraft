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

const initSql = readFileSync(new URL("../migrations/0000_init.sql", import.meta.url), "utf8");

const downSql = readFileSync(new URL("../migrations/0000_init.down.sql", import.meta.url), "utf8");

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

const f4Sql = readFileSync(
  new URL("../migrations/0004_f4_leaderboard.sql", import.meta.url),
  "utf8",
);

const f4DownSql = readFileSync(
  new URL("../migrations/0004_f4_leaderboard.down.sql", import.meta.url),
  "utf8",
);

const profilesSql = readFileSync(
  new URL("../migrations/0005_leaderboard_profiles.sql", import.meta.url),
  "utf8",
);

const profilesDownSql = readFileSync(
  new URL("../migrations/0005_leaderboard_profiles.down.sql", import.meta.url),
  "utf8",
);

const configSql = readFileSync(
  new URL("../migrations/0006_leaderboard_config_filters.sql", import.meta.url),
  "utf8",
);

const configDownSql = readFileSync(
  new URL("../migrations/0006_leaderboard_config_filters.down.sql", import.meta.url),
  "utf8",
);

const userRecentSql = readFileSync(
  new URL("../migrations/0007_leaderboard_user_recent_idx.sql", import.meta.url),
  "utf8",
);

const userRecentDownSql = readFileSync(
  new URL("../migrations/0007_leaderboard_user_recent_idx.down.sql", import.meta.url),
  "utf8",
);

const dailySql = readFileSync(
  new URL("../migrations/0008_leaderboard_daily_challenge.sql", import.meta.url),
  "utf8",
);

const dailyDownSql = readFileSync(
  new URL("../migrations/0008_leaderboard_daily_challenge.down.sql", import.meta.url),
  "utf8",
);

const journal = JSON.parse(
  readFileSync(new URL("../migrations/meta/_journal.json", import.meta.url), "utf8"),
) as { entries: Array<{ tag: string; idx: number }> };

describe("@wcdraft/db migrations — 0000_init", () => {
  it("journal references the renamed 0000/0001/0002/0003/0004 tags", () => {
    expect(journal.entries).toHaveLength(9);
    expect(journal.entries[0]?.tag).toBe("0000_init");
    expect(journal.entries[0]?.idx).toBe(0);
    expect(journal.entries[1]?.tag).toBe("0001_auth_rate_limits");
    expect(journal.entries[1]?.idx).toBe(1);
    expect(journal.entries[2]?.tag).toBe("0002_history_session_scope");
    expect(journal.entries[2]?.idx).toBe(2);
    expect(journal.entries[3]?.tag).toBe("0003_summary_jsonb");
    expect(journal.entries[3]?.idx).toBe(3);
    expect(journal.entries[4]?.tag).toBe("0004_f4_leaderboard");
    expect(journal.entries[4]?.idx).toBe(4);
    expect(journal.entries[5]?.tag).toBe("0005_leaderboard_profiles");
    expect(journal.entries[5]?.idx).toBe(5);
    expect(journal.entries[6]?.tag).toBe("0006_leaderboard_config_filters");
    expect(journal.entries[6]?.idx).toBe(6);
    expect(journal.entries[7]?.tag).toBe("0007_leaderboard_user_recent_idx");
    expect(journal.entries[7]?.idx).toBe(7);
    expect(journal.entries[8]?.tag).toBe("0008_leaderboard_daily_challenge");
    expect(journal.entries[8]?.idx).toBe(8);
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
    expect(initSql).not.toMatch(/CREATE UNIQUE INDEX[^;]*"saved_runs_owner_token_uq"/);
    expect(initSql).not.toMatch(/CREATE UNIQUE INDEX[^;]*"leaderboard_entries_dedupe_uq"/);
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
    expect(initSql).toMatch(/"expires_at"\s+timestamp\s+with\s+time\s+zone\s+NOT\s+NULL/);
    expect(initSql).toMatch(/"window_expires_at"\s+timestamp\s+with\s+time\s+zone\s+NOT\s+NULL/);
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

describe("@wcdraft/db migrations — 0008_leaderboard_daily_challenge", () => {
  it("adds challenge/date/rating-version columns without rewriting rows", () => {
    expect(dailySql).toMatch(/ADD COLUMN "challenge_type" text DEFAULT 'season' NOT NULL/);
    expect(dailySql).toMatch(/ADD COLUMN "challenge_date" text/);
    expect(dailySql).toMatch(/ADD COLUMN "rating_version" text/);
    expect(dailySql).not.toMatch(/DELETE FROM "leaderboard_entries"/);
    expect(dailySql).not.toMatch(/TRUNCATE/);
  });

  it("guards season-vs-daily date shape and stamps rating version bounds", () => {
    expect(dailySql).toMatch(/leaderboard_entries_challenge_type_chk/);
    expect(dailySql).toMatch(/'season', 'daily'/);
    expect(dailySql).toMatch(/leaderboard_entries_daily_mode_chk/);
    expect(dailySql).toMatch(/"challenge_type" <> 'daily' OR "leaderboard_entries"\."mode" = 'casual'/);
    expect(dailySql).toMatch(/leaderboard_entries_challenge_date_chk/);
    expect(dailySql).toMatch(/\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}\$/);
    expect(dailySql).toMatch(/leaderboard_entries_rating_version_chk/);
  });

  it("narrows token dedupe to season rows and adds daily identity uniqueness", () => {
    expect(dailySql).toMatch(/DROP CONSTRAINT IF EXISTS "leaderboard_entries_dedupe_uq"/);
    expect(dailySql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "leaderboard_entries_season_dedupe_uq"/,
    );
    expect(dailySql).toMatch(/NULLS NOT DISTINCT/);
    expect(dailySql).toMatch(/WHERE "leaderboard_entries"\."challenge_type" = 'season'/);
    expect(dailySql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "leaderboard_entries_daily_identity_uq"/,
    );
    expect(dailySql).toMatch(/COALESCE\("user_id"::text, "session_id", "display_alias"\)/);
  });

  it("adds a daily top index and extends the season top index with challenge_type", () => {
    expect(dailySql).toMatch(/CREATE INDEX IF NOT EXISTS "leaderboard_entries_daily_top_idx"/);
    expect(dailySql).toMatch(/"challenge_type",\s*"challenge_date",\s*"mode",\s*"draft_mode"/s);
    expect(dailySql).toMatch(/"season_key",\s*"challenge_type",\s*"mode",\s*"draft_mode"/s);
  });

  it("down-migration removes daily artifacts and restores the prior dedupe constraint", () => {
    expect(dailyDownSql).toMatch(/DROP INDEX IF EXISTS "leaderboard_entries_daily_identity_uq"/);
    expect(dailyDownSql).toMatch(/DROP INDEX IF EXISTS "leaderboard_entries_season_dedupe_uq"/);
    expect(dailyDownSql).toMatch(
      /DELETE FROM "leaderboard_entries"\s+WHERE "challenge_type" = 'daily'/,
    );
    expect(dailyDownSql).toMatch(/DROP COLUMN IF EXISTS "rating_version"/);
    expect(dailyDownSql).toMatch(/DROP COLUMN IF EXISTS "challenge_date"/);
    expect(dailyDownSql).toMatch(/DROP COLUMN IF EXISTS "challenge_type"/);
    expect(dailyDownSql).toMatch(/DROP CONSTRAINT IF EXISTS "leaderboard_entries_daily_mode_chk"/);
    expect(dailyDownSql).toMatch(/ADD CONSTRAINT "leaderboard_entries_dedupe_uq"/);
  });
});

describe("@wcdraft/db migrations — 0006_leaderboard_config_filters", () => {
  it("adds nullable explicit config columns and exact-config top index", () => {
    expect(configSql).toMatch(/ADD COLUMN "draft_order" text/);
    expect(configSql).toMatch(/ADD COLUMN "era" text/);
    expect(configSql).toMatch(/ADD COLUMN "rating_basis" text/);
    expect(configSql).toMatch(
      /"season_key",\s*"mode",\s*"draft_mode",\s*"draft_order",\s*"era",\s*"rating_basis",\s*"verified_score" DESC/s,
    );
  });

  it("backfills only current-season derivable token configs without guessing legacy rows", () => {
    expect(configSql).toContain(
      "engine-2026.06.16-merit-v4.4_wc-perf-6.4.0+proj-career-5.4.0_2026-06-04_ruleset-2026.06.04_f79ba870",
    );
    expect(configSql).toMatch(/__wcdraft_leaderboard_token_json/);
    expect(configSql).toMatch(/c\.token_mode = e\."draft_mode"/);
    expect(configSql).toMatch(/c\.body#>>'\{ef,min\}' = '1930'/);
  });

  it("guards legal config values and all-or-null legacy completeness", () => {
    expect(configSql).toMatch(/leaderboard_entries_draft_order_chk/);
    expect(configSql).toMatch(/'squad_first', 'position_first'/);
    expect(configSql).toMatch(/leaderboard_entries_era_chk/);
    expect(configSql).toMatch(/'all_time', 'post_2000', 'post_2010', 'modern'/);
    expect(configSql).toMatch(/leaderboard_entries_rating_basis_chk/);
    expect(configSql).toMatch(/'career', 'current'/);
    expect(configSql).toMatch(/leaderboard_entries_config_complete_chk/);
  });

  it("down-migration drops config artifacts and restores the 0005 top index shape", () => {
    expect(configDownSql).toMatch(/DROP COLUMN IF EXISTS "rating_basis"/);
    expect(configDownSql).toMatch(/DROP COLUMN IF EXISTS "era"/);
    expect(configDownSql).toMatch(/DROP COLUMN IF EXISTS "draft_order"/);
    expect(configDownSql).toMatch(
      /"season_key",\s*"mode",\s*"verified_score" DESC NULLS LAST,\s*"created_at",\s*"id"/s,
    );
  });
});

describe("@wcdraft/db migrations — 0007_leaderboard_user_recent_idx", () => {
  it("adds a partial user recent lookup index for account-owned leaderboard reads", () => {
    expect(userRecentSql).toMatch(
      /CREATE INDEX IF NOT EXISTS "leaderboard_entries_user_recent_idx"/,
    );
    expect(userRecentSql).toMatch(
      /"user_id",\s*"season_key",\s*"mode",\s*"created_at" DESC NULLS LAST/s,
    );
    expect(userRecentSql).toMatch(/WHERE "leaderboard_entries"\."user_id" IS NOT NULL/);
  });

  it("does not rewrite unchanged leaderboard constraints", () => {
    expect(userRecentSql).not.toMatch(/DROP CONSTRAINT/);
    expect(userRecentSql).not.toMatch(/ADD CONSTRAINT/);
  });

  it("drops only the user recent index on rollback", () => {
    expect(userRecentDownSql.trim()).toBe(
      'DROP INDEX IF EXISTS "leaderboard_entries_user_recent_idx";',
    );
  });
});

describe("@wcdraft/db migrations — 0005_leaderboard_profiles", () => {
  it("adds users.username with case-insensitive unique index and lowercase format CHECK", () => {
    expect(profilesSql).toMatch(/ALTER TABLE "users" ADD COLUMN "username" text/);
    expect(profilesSql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "users_username_ci_uq" ON "users" USING btree \(lower\("username"\)\)/,
    );
    expect(profilesSql).toMatch(/users_username_format_chk/);
    expect(profilesSql).toMatch(/\^\[a-z0-9_\]\{3,20\}\$/);
  });

  it("replaces leaderboard_entries.display_name with nullable display_alias", () => {
    expect(profilesSql).toMatch(
      /ALTER TABLE "leaderboard_entries" ADD COLUMN "display_alias" text/,
    );
    expect(profilesSql).toMatch(/UPDATE "leaderboard_entries" AS e/);
    expect(profilesSql).toMatch(/DROP COLUMN "display_name"/);
    expect(profilesSql).toMatch(/leaderboard_entries_display_alias_chk/);
    expect(profilesSql).toMatch(/leaderboard_entries_public_name_chk/);
  });

  it("backfills legacy display names deterministically without selecting email", () => {
    expect(profilesSql).toMatch(/regexp_replace\(lower\("display_name"\)/);
    expect(profilesSql).toMatch(/reserved_terms\(term\)/);
    expect(profilesSql).toMatch(/blocked_stems\(term\)/);
    expect(profilesSql).toMatch(/replace\(n\.candidate, '_', ''\)/);
    expect(profilesSql).toMatch(/'player_' \|\| substring\(md5\(e\."id"::text\)/);
    expect(profilesSql).not.toMatch(/"email"/);
  });

  it("does NOT change leaderboard dedupe or top-rank indexes", () => {
    expect(profilesSql).not.toMatch(/leaderboard_entries_dedupe_uq/);
    expect(profilesSql).not.toMatch(/leaderboard_entries_top_idx/);
  });

  it("down-migration restores display_name and drops username artifacts", () => {
    expect(profilesDownSql).toMatch(
      /ALTER TABLE "leaderboard_entries" ADD COLUMN "display_name" text/,
    );
    expect(profilesDownSql).toMatch(/ALTER COLUMN "display_name" SET NOT NULL/);
    expect(profilesDownSql).toMatch(/leaderboard_entries_display_name_chk/);
    expect(profilesDownSql).toMatch(/DROP COLUMN IF EXISTS "display_alias"/);
    expect(profilesDownSql).toMatch(/DROP INDEX IF EXISTS "users_username_ci_uq"/);
    expect(profilesDownSql).toMatch(/DROP COLUMN IF EXISTS "username"/);
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
    expect(histSql).toMatch(/ALTER TABLE "saved_runs" DROP CONSTRAINT "saved_runs_owner_token_uq"/);
  });

  it("adds saved_runs.session_id column (nullable text)", () => {
    expect(histSql).toMatch(/ALTER TABLE "saved_runs" ADD COLUMN "session_id" text/);
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
    expect(summarySql).toMatch(/ALTER TABLE "saved_runs" ADD COLUMN "summary" jsonb/);
    // Single-statement additive migration — no schema reshape.
    expect(summarySql).not.toMatch(/CREATE TABLE/);
    expect(summarySql).not.toMatch(/DROP/);
  });

  it("down-migration drops the summary column (idempotent IF EXISTS)", () => {
    expect(summaryDownSql).toMatch(/ALTER TABLE "saved_runs" DROP COLUMN IF EXISTS "summary"/);
  });

  it("does NOT touch any other table (additive on saved_runs only)", () => {
    expect(summarySql).not.toMatch(/ALTER TABLE "users"/);
    expect(summarySql).not.toMatch(/ALTER TABLE "sessions"/);
    expect(summarySql).not.toMatch(/ALTER TABLE "magic_link_tokens"/);
    expect(summarySql).not.toMatch(/ALTER TABLE "leaderboard_entries"/);
    expect(summarySql).not.toMatch(/ALTER TABLE "ranked_attempts"/);
  });
});

describe("@wcdraft/db migrations — 0004_f4_leaderboard", () => {
  // ── F-4 plan §7 columns ────────────────────────────────────────────────
  it("adds leaderboard_entries.display_name as NOT NULL text", () => {
    expect(f4Sql).toMatch(
      /ALTER TABLE "leaderboard_entries" ADD COLUMN "display_name" text NOT NULL/,
    );
  });

  it("enforces display_name length 3–24 at the DB", () => {
    expect(f4Sql).toMatch(
      /ADD CONSTRAINT "leaderboard_entries_display_name_chk" CHECK \(char_length\("leaderboard_entries"\."display_name"\) BETWEEN 3 AND 24\)/,
    );
  });

  it("adds leaderboard_entries.session_id with ON DELETE SET NULL (NOT cascade — board entries survive session sweep)", () => {
    expect(f4Sql).toMatch(/ALTER TABLE "leaderboard_entries" ADD COLUMN "session_id" text/);
    expect(f4Sql).toMatch(
      /ADD CONSTRAINT "leaderboard_entries_session_id_sessions_id_fk" FOREIGN KEY \("session_id"\) REFERENCES "public"\."sessions"\("id"\) ON DELETE set null/,
    );
    expect(f4Sql).not.toMatch(
      /"leaderboard_entries_session_id_sessions_id_fk"[^;]*ON DELETE cascade/,
    );
  });

  it("adds leaderboard_entries.draft_mode (classic|hidden) as NOT NULL with CHECK", () => {
    expect(f4Sql).toMatch(
      /ALTER TABLE "leaderboard_entries" ADD COLUMN "draft_mode" text NOT NULL/,
    );
    expect(f4Sql).toMatch(
      /ADD CONSTRAINT "leaderboard_entries_draft_mode_chk" CHECK \("leaderboard_entries"\."draft_mode" IN \('classic', 'hidden'\)\)/,
    );
  });

  it("adds nullable leaderboard_entries.hidden_at (timestamptz) for reversible moderation", () => {
    expect(f4Sql).toMatch(
      /ALTER TABLE "leaderboard_entries" ADD COLUMN "hidden_at" timestamp with time zone/,
    );
    expect(f4Sql).not.toMatch(/"hidden_at" timestamp with time zone NOT NULL/);
  });

  // ── F-4 plan §7 index changes ──────────────────────────────────────────
  it("replaces the top index with the exact board sort + keyset triple, partial on hidden_at IS NULL", () => {
    expect(f4Sql).toMatch(/DROP INDEX IF EXISTS "leaderboard_entries_top_idx"/);
    expect(f4Sql).toMatch(
      /CREATE INDEX IF NOT EXISTS "leaderboard_entries_top_idx" ON "leaderboard_entries" USING btree \("season_key","mode","verified_score" DESC NULLS LAST,"created_at","id"\) WHERE "leaderboard_entries"\."hidden_at" IS NULL/,
    );
  });

  it("adds the partial session_id index for claim UPDATE + my-entry lookup", () => {
    expect(f4Sql).toMatch(
      /CREATE INDEX IF NOT EXISTS "leaderboard_entries_session_idx" ON "leaderboard_entries" USING btree \("session_id"\) WHERE "leaderboard_entries"\."session_id" IS NOT NULL/,
    );
  });

  // ── Lead-Architect ruling: RANKED IS ACCOUNT-REQUIRED (structural) ─────
  it("makes ranked_attempts.user_id NOT NULL (server-issued seeds tie to a user)", () => {
    expect(f4Sql).toMatch(/ALTER TABLE "ranked_attempts" ALTER COLUMN "user_id" SET NOT NULL/);
  });

  it("forbids ranked leaderboard rows with a NULL user at the DB", () => {
    expect(f4Sql).toMatch(
      /ADD CONSTRAINT "leaderboard_entries_ranked_user_chk" CHECK \("leaderboard_entries"\."mode" <> 'ranked' OR "leaderboard_entries"\."user_id" IS NOT NULL\)/,
    );
  });

  // ── Invariants that must NOT move ──────────────────────────────────────
  it("does NOT touch the dedupe constraint (NULLS NOT DISTINCT global dedupe stays; session_id deliberately excluded)", () => {
    expect(f4Sql).not.toMatch(/leaderboard_entries_dedupe_uq/);
  });

  it("derive-only seasons: no seasons table, no new tables at all", () => {
    // (season_key on leaderboard_entries is the derive-only carrier and is
    // expected in the index DDL; what must NOT exist is a seasons relation.)
    expect(f4Sql).not.toMatch(/CREATE TABLE/);
    expect(f4Sql).not.toMatch(/"seasons"/);
  });

  it("does NOT touch users / sessions / saved_runs / magic_link_tokens / auth_rate_limits", () => {
    expect(f4Sql).not.toMatch(/ALTER TABLE "users"/);
    expect(f4Sql).not.toMatch(/ALTER TABLE "sessions"/);
    expect(f4Sql).not.toMatch(/ALTER TABLE "saved_runs"/);
    expect(f4Sql).not.toMatch(/ALTER TABLE "magic_link_tokens"/);
    expect(f4Sql).not.toMatch(/ALTER TABLE "auth_rate_limits"/);
  });

  // ── Hand-paired down-migration restores the 0003 snapshot shape ────────
  it("down-migration drops both new indexes before the columns", () => {
    expect(f4DownSql).toMatch(/DROP INDEX IF EXISTS "leaderboard_entries_session_idx"/);
    expect(f4DownSql).toMatch(/DROP INDEX IF EXISTS "leaderboard_entries_top_idx"/);
  });

  it("down-migration drops the three CHECKs + FK + four columns", () => {
    for (const constraint of [
      "leaderboard_entries_ranked_user_chk",
      "leaderboard_entries_display_name_chk",
      "leaderboard_entries_draft_mode_chk",
      "leaderboard_entries_session_id_sessions_id_fk",
    ]) {
      expect(f4DownSql).toContain(`DROP CONSTRAINT IF EXISTS "${constraint}"`);
    }
    for (const column of ["hidden_at", "display_name", "session_id", "draft_mode"]) {
      expect(f4DownSql).toContain(`DROP COLUMN IF EXISTS "${column}"`);
    }
  });

  it("down-migration restores the F-1 top index and nullable ranked_attempts.user_id", () => {
    expect(f4DownSql).toMatch(
      /CREATE INDEX IF NOT EXISTS "leaderboard_entries_top_idx"\s+ON "leaderboard_entries" USING btree \("season_key","mode","verified_score"\)/,
    );
    expect(f4DownSql).toMatch(/ALTER TABLE "ranked_attempts" ALTER COLUMN "user_id" DROP NOT NULL/);
  });
});
