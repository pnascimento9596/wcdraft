// F-1 — ranked_attempts.
//
// Server-issued seed binding for F-4 ranked leaderboard. The client requests
// an attempt at draft creation; the server stores a short-window
// `issued_parent_seed` bound to the user plus exact draft config, and rejects
// any ranked submission whose token's parent_seed/config does not match.
//
// RANKED IS ACCOUNT-REQUIRED (Lead-Architect ruling, F-4 U1 / migration
// 0004): server-issued single-use seeds tie to a USER, so `user_id` is
// NOT NULL — the requirement is structural, not an application check. The
// F-1 "one of user_id / session_id" convention is superseded. `session_id`
// stays nullable as an optional record of the issuing session. Migration 0012
// changes that FK to ON DELETE SET NULL: a consumed attempt may become the
// durable parent of a public board entry, so session revocation must detach
// provenance rather than cascade into the board-to-attempt RESTRICT edge.
// Outstanding attempts remain user-owned and bounded by expiry/sweep.
import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uuid, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { users } from "./users.ts";
import { sessions } from "./sessions.ts";

export const rankedAttempts = pgTable(
  "ranked_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    seasonKey: text("season_key").notNull(),
    formationId: text("formation_id").notNull(),
    draftMode: text("draft_mode").notNull(),
    draftOrder: text("draft_order").notNull(),
    era: text("era").notNull(),
    ratingBasis: text("rating_basis").notNull(),
    issuedParentSeed: text("issued_parent_seed").notNull(),
    nonce: text("nonce").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    windowExpiresAt: timestamp("window_expires_at", {
      withTimezone: true,
    }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (t) => [
    // Per-user "recent attempts" for per-season caps + rate-limiting.
    index("ranked_attempts_user_issued_idx").on(t.userId, t.issuedAt),
    // Per-session same.
    index("ranked_attempts_session_issued_idx").on(t.sessionId, t.issuedAt),
    // Submit path: exact issued seed lookup for this user/config.
    index("ranked_attempts_user_seed_idx").on(t.userId, t.issuedParentSeed),
    index("ranked_attempts_user_config_idx").on(
      t.userId,
      t.seasonKey,
      t.formationId,
      t.draftMode,
      t.draftOrder,
      t.era,
      t.ratingBasis,
      t.issuedAt,
    ),
    // Migration 0012 references the complete consumed-attempt identity from
    // leaderboard_entries. `id` is already unique, but the wider key makes
    // user/season/config/consumption equality a structural FK invariant.
    uniqueIndex("ranked_attempts_binding_uq").on(
      t.id,
      t.userId,
      t.seasonKey,
      t.formationId,
      t.draftMode,
      t.draftOrder,
      t.era,
      t.ratingBasis,
      t.consumedAt,
    ),
    check("ranked_attempts_season_key_chk", sql`char_length(${t.seasonKey}) BETWEEN 1 AND 256`),
    check("ranked_attempts_formation_id_chk", sql`char_length(${t.formationId}) BETWEEN 1 AND 64`),
    check("ranked_attempts_draft_mode_chk", sql`${t.draftMode} IN ('classic', 'hidden')`),
    check(
      "ranked_attempts_draft_order_chk",
      sql`${t.draftOrder} IN ('squad_first', 'position_first')`,
    ),
    check(
      "ranked_attempts_era_chk",
      sql`${t.era} IN ('all_time', 'post_2000', 'post_2010', 'modern')`,
    ),
    check("ranked_attempts_rating_basis_chk", sql`${t.ratingBasis} IN ('career', 'current')`),
    check("ranked_attempts_seed_chk", sql`char_length(${t.issuedParentSeed}) BETWEEN 1 AND 256`),
    check("ranked_attempts_nonce_chk", sql`char_length(${t.nonce}) BETWEEN 16 AND 128`),
    check("ranked_attempts_window_chk", sql`${t.windowExpiresAt} > ${t.issuedAt}`),
  ],
);

export type RankedAttempt = typeof rankedAttempts.$inferSelect;
export type NewRankedAttempt = typeof rankedAttempts.$inferInsert;
