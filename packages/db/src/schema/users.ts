// F-1 — users.
//
// Minimal private identity is email. Public identity is username: nullable
// for legacy magic-link accounts until the player chooses one, unique by
// lower(username), and validated before writes. Leaderboard serializers must
// use username, never email, when an entry has no per-entry alias. Ranked
// writes additionally require email_verified_at; casual play/posts do not.
import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").unique(),
    username: text("username"),
    passwordHash: text("password_hash"),
    passwordSetAt: timestamp("password_set_at", { withTimezone: true }),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_username_ci_uq").on(sql`lower(${t.username})`),
    check(
      "users_username_format_chk",
      sql`${t.username} IS NULL OR (${t.username} = lower(${t.username}) AND ${t.username} ~ '^[a-z0-9_]{3,20}$')`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
