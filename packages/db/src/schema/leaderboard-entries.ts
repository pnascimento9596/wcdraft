// F-1 — leaderboard_entries.
//
// One row = one VERIFIED submission. F-4 will:
//   1) re-simulate the token via `reconstructDraftFromToken` +
//      `runTournamentFull` to derive `verified_score`,
//   2) derive `season_key` from the token's embedded anchors (dataset +
//      rating + engine version) so a rating recalibration rolls a new season
//      automatically without code change,
//   3) require `attempt_id` for ranked mode and verify the token's
//      parent_seed matches the issued attempt's seed.
//
// `user_id` is NULLABLE only because casual-mode anon submissions are
// allowed; ranked mode requires a bound user (F-4 application check).
// `mode` is a DB-level CHECK enum so a write outside the F-4 application
// layer cannot silently land an unknown mode.
//
// Dedupe is via a UNIQUE CONSTRAINT with NULLS NOT DISTINCT (Postgres 15+).
// Casual leaderboard is anonymous-first by default: a plain unique index
// on (season_key, mode, user_id, token) would let two NULL-user rows with
// the same token both insert under Postgres' default NULLS-DISTINCT
// semantics. NULLS NOT DISTINCT closes the spam vector while remaining
// anon-friendly because the (season_key, mode, token) combination still
// uniquely identifies a casual entry. Global-effective anti-spam is the
// right F-4 surface regardless of the F-3 anon-history scoping decision.
//
// F-4 U1 (migration 0004) additions, per the F-4 plan §7 + Lead-Architect
// rulings:
//   - `display_alias`: optional per-entry public alias. Board serializers
//     render COALESCE(display_alias, users.username), never email. Anonymous
//     casual rows must carry an alias because they have no username fallback.
//   - `session_id`: anon ownership for my-entry lookup + the anon→account
//     claim. ON DELETE SET NULL, NOT cascade — board entries are public
//     artifacts that must survive session expiry/sweep (the entry just
//     becomes unclaimable). Deliberately NOT part of the dedupe constraint:
//     global (season, mode, user, token) dedupe is the anti-spam invariant.
//   - `draft_mode`: the token's `md` is a fairness dimension (hidden
//     drafting is blind); stored at write so board filtering never
//     re-parses tokens.
//   - `draft_order` / `era` / `rating_basis`: the rest of the token's draft
//     config. Existing legacy rows may be NULL when the config was not safely
//     derivable; new accepted submissions always write all three.
//   - `hidden_at`: reversible moderation hide; board queries filter
//     `hidden_at IS NULL`. Hard delete only for legal demands.
//   - RANKED IS ACCOUNT-REQUIRED (ruling): `leaderboard_entries_ranked_user_chk`
//     makes the bound-user requirement structural — a ranked row with a
//     NULL user cannot exist regardless of application-layer bugs. The
//     casual path stays anonymous-capable (nullable user + display_alias).
import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  jsonb,
  index,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users.ts";
import { sessions } from "./sessions.ts";
import { rankedAttempts } from "./ranked-attempts.ts";

export const leaderboardEntries = pgTable(
  "leaderboard_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonKey: text("season_key").notNull(),
    mode: text("mode").notNull(),
    draftMode: text("draft_mode").notNull(),
    draftOrder: text("draft_order"),
    era: text("era"),
    ratingBasis: text("rating_basis"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    displayAlias: text("display_alias"),
    token: text("token").notNull(),
    verifiedScore: integer("verified_score").notNull(),
    scoreBreakdown: jsonb("score_breakdown"),
    attemptId: uuid("attempt_id").references(() => rankedAttempts.id, {
      onDelete: "set null",
    }),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Exact board read: filter (season, lane, full config), sort verified_score
    // DESC, created_at ASC (first to reach a score ranks first), id for total
    // order. Partial on `hidden_at IS NULL` because every ranking query
    // filters hidden rows; moderation/audit reads are rare and may seq-scan.
    index("leaderboard_entries_top_idx")
      .on(
        t.seasonKey,
        t.mode,
        t.draftMode,
        t.draftOrder,
        t.era,
        t.ratingBasis,
        t.verifiedScore.desc(),
        t.createdAt.asc(),
        t.id,
      )
      .where(sql`${t.hiddenAt} IS NULL`),
    // Claim UPDATE + my-entry lookup; only anon-owned rows carry a session.
    index("leaderboard_entries_session_idx")
      .on(t.sessionId)
      .where(sql`${t.sessionId} IS NOT NULL`),
    // User-owned entry lookup for account `/me` and moderation read paths.
    index("leaderboard_entries_user_recent_idx")
      .on(t.userId, t.seasonKey, t.mode, t.createdAt.desc())
      .where(sql`${t.userId} IS NOT NULL`),
    unique("leaderboard_entries_dedupe_uq")
      .on(t.seasonKey, t.mode, t.userId, t.token)
      .nullsNotDistinct(),
    check("leaderboard_entries_mode_chk", sql`${t.mode} IN ('casual', 'ranked')`),
    check("leaderboard_entries_draft_mode_chk", sql`${t.draftMode} IN ('classic', 'hidden')`),
    check(
      "leaderboard_entries_draft_order_chk",
      sql`${t.draftOrder} IS NULL OR ${t.draftOrder} IN ('squad_first', 'position_first')`,
    ),
    check(
      "leaderboard_entries_era_chk",
      sql`${t.era} IS NULL OR ${t.era} IN ('all_time', 'post_2000', 'post_2010', 'modern')`,
    ),
    check(
      "leaderboard_entries_rating_basis_chk",
      sql`${t.ratingBasis} IS NULL OR ${t.ratingBasis} IN ('career', 'current')`,
    ),
    check(
      "leaderboard_entries_config_complete_chk",
      sql`(
        ${t.draftOrder} IS NULL AND ${t.era} IS NULL AND ${t.ratingBasis} IS NULL
      ) OR (
        ${t.draftOrder} IS NOT NULL AND ${t.era} IS NOT NULL AND ${t.ratingBasis} IS NOT NULL
      )`,
    ),
    check(
      "leaderboard_entries_display_alias_chk",
      sql`${t.displayAlias} IS NULL OR ${t.displayAlias} ~ '^[a-z0-9_]{3,20}$'`,
    ),
    check(
      "leaderboard_entries_public_name_chk",
      sql`${t.userId} IS NOT NULL OR ${t.displayAlias} IS NOT NULL`,
    ),
    // RANKED IS ACCOUNT-REQUIRED — structural, not application-layer.
    check(
      "leaderboard_entries_ranked_user_chk",
      sql`${t.mode} <> 'ranked' OR ${t.userId} IS NOT NULL`,
    ),
  ],
);

export type LeaderboardEntry = typeof leaderboardEntries.$inferSelect;
export type NewLeaderboardEntry = typeof leaderboardEntries.$inferInsert;
