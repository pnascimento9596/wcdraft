// F-1 — users.
//
// Minimal private identity is email. Public identity is username: nullable
// until the player chooses one, unique by lower(username), and validated by
// the profile API before writes. Leaderboard serializers must use username,
// never email, when an entry has no per-entry alias.
import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").unique(),
    username: text("username"),
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
