// F-1 — ranked_attempts.
//
// Server-issued seed binding for F-4 ranked leaderboard. The client requests
// an attempt; the server derives `issued_parent_seed` from (user_id|session_id,
// nonce, server secret), stores it with a short window, and rejects any
// ranked submission whose token's parent_seed does not match.
//
// One of `user_id` / `session_id` MUST be set (enforced by F-4 application
// logic; F-1 leaves both nullable so the column-only scaffold is unambiguous).
import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { sessions } from "./sessions.js";

export const rankedAttempts = pgTable(
  "ranked_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "cascade",
    }),
    issuedParentSeed: text("issued_parent_seed").notNull(),
    nonce: text("nonce").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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
  ],
);

export type RankedAttempt = typeof rankedAttempts.$inferSelect;
export type NewRankedAttempt = typeof rankedAttempts.$inferInsert;
