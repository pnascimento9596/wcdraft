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
import { rankedAttempts } from "./ranked-attempts.ts";

export const leaderboardEntries = pgTable(
  "leaderboard_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonKey: text("season_key").notNull(),
    mode: text("mode").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    verifiedScore: integer("verified_score").notNull(),
    scoreBreakdown: jsonb("score_breakdown"),
    attemptId: uuid("attempt_id").references(() => rankedAttempts.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("leaderboard_entries_top_idx").on(
      t.seasonKey,
      t.mode,
      t.verifiedScore,
    ),
    unique("leaderboard_entries_dedupe_uq")
      .on(t.seasonKey, t.mode, t.userId, t.token)
      .nullsNotDistinct(),
    check(
      "leaderboard_entries_mode_chk",
      sql`${t.mode} IN ('casual', 'ranked')`,
    ),
  ],
);

export type LeaderboardEntry = typeof leaderboardEntries.$inferSelect;
export type NewLeaderboardEntry = typeof leaderboardEntries.$inferInsert;
