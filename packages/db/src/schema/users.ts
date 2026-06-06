// F-1 — users.
//
// Minimal PII: an email is the only identity. Email is NULLABLE so an
// anonymous session in `sessions` can later be claimed into a user row
// without a forced sign-up loop. F-2 will enforce that a claim consumes a
// magic-link token before populating the email.
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
