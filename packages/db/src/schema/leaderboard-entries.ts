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
//   - `display_name`: anonymous-first identity on the board (NOT NULL;
//     length 3–24 enforced at the DB so a write outside the validation
//     pipeline cannot land an out-of-contract name).
//   - `session_id`: anon ownership for my-entry lookup + the anon→account
//     claim. ON DELETE SET NULL, NOT cascade — board entries are public
//     artifacts that must survive session expiry/sweep (the entry just
//     becomes unclaimable). Deliberately NOT part of the dedupe constraint:
//     global (season, mode, user, token) dedupe is the anti-spam invariant.
//   - `draft_mode`: the token's `md` is a fairness dimension (hidden
//     drafting is blind); stored at write so board filtering never
//     re-parses tokens.
//   - `hidden_at`: reversible moderation hide; board queries filter
//     `hidden_at IS NULL`. Hard delete only for legal demands.
//   - RANKED IS ACCOUNT-REQUIRED (ruling): `leaderboard_entries_ranked_user_chk`
//     makes the bound-user requirement structural — a ranked row with a
//     NULL user cannot exist regardless of application-layer bugs. The
//     casual path stays anonymous-capable (nullable user + display_name).
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
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    displayName: text("display_name").notNull(),
    token: text("token").notNull(),
    verifiedScore: integer("verified_score").notNull(),
    scoreBreakdown: jsonb("score_breakdown"),
    attemptId: uuid("attempt_id").references(() => rankedAttempts.id, {
      onDelete: "set null",
    }),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Exact board read: filter (season, mode), sort verified_score DESC,
    // created_at ASC (first to reach a score ranks first), id for total
    // order — the same triple the keyset cursor paginates on. Partial on
    // `hidden_at IS NULL` because every ranking query filters hidden rows;
    // moderation/audit reads are rare and may seq-scan.
    index("leaderboard_entries_top_idx")
      .on(t.seasonKey, t.mode, t.verifiedScore.desc(), t.createdAt.asc(), t.id)
      .where(sql`${t.hiddenAt} IS NULL`),
    // Claim UPDATE + my-entry lookup; only anon-owned rows carry a session.
    index("leaderboard_entries_session_idx")
      .on(t.sessionId)
      .where(sql`${t.sessionId} IS NOT NULL`),
    unique("leaderboard_entries_dedupe_uq")
      .on(t.seasonKey, t.mode, t.userId, t.token)
      .nullsNotDistinct(),
    check(
      "leaderboard_entries_mode_chk",
      sql`${t.mode} IN ('casual', 'ranked')`,
    ),
    check(
      "leaderboard_entries_draft_mode_chk",
      sql`${t.draftMode} IN ('classic', 'hidden')`,
    ),
    check(
      "leaderboard_entries_display_name_chk",
      sql`char_length(${t.displayName}) BETWEEN 3 AND 24`,
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
