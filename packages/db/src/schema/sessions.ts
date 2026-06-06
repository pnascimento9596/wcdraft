// F-1 — sessions.
//
// Opaque session id (random base64url, NOT a uuid — clients should not be
// able to enumerate / guess from a uuid v4 surface). user_id is NULLABLE so
// anonymous server sessions can exist (needed by F-4 to bind a ranked
// attempt's parent_seed to a session before any claim).
//
// CSRF: each session gets its own server-stored secret; F-2 emits a
// double-submit token cookie derived from this secret and verifies it on
// mutating handlers.
import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    csrfSecret: text("csrf_secret").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    // "All sessions for this user" — used by F-2 sign-out-everywhere.
    index("sessions_user_id_idx").on(t.userId),
    // Expiry sweep.
    index("sessions_expires_at_idx").on(t.expiresAt),
  ],
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
