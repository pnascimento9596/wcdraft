// F-1 — magic_link_tokens.
//
// We store the SHA-256 of the issued token (never the token itself); F-2 will
// hash before insert and re-hash on consume to compare. `email` is recorded
// so links can be issued to addresses that do not yet have a user row;
// `user_id` is populated on consume when the email matches.
//
// Single-use: `consumed_at` flips from NULL on first claim. Expired or
// consumed rows are reaped lazily.
import { pgTable, text, timestamp, uuid, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users.ts";

export const magicLinkTokens = pgTable(
  "magic_link_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    email: text("email").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    purpose: text("purpose").notNull().default("signin"),
    deliveryStatus: text("delivery_status").notNull().default("unknown"),
    deliveryAttemptedAt: timestamp("delivery_attempted_at", { withTimezone: true }),
    deliveryCorrelationId: text("delivery_correlation_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Lookup-by-email for rate-limiting + UI ("we already sent a link").
    index("magic_link_tokens_email_idx").on(t.email),
    // Expiry sweep / "expired or consumed" cleanup.
    index("magic_link_tokens_expires_at_idx").on(t.expiresAt),
    check(
      "magic_link_tokens_purpose_chk",
      sql`${t.purpose} IN ('signin', 'verification', 'reset')`,
    ),
    check(
      "magic_link_tokens_delivery_status_chk",
      sql`${t.deliveryStatus} IN ('unknown', 'pending', 'delivered', 'failed', 'not_eligible')`,
    ),
  ],
);

export type MagicLinkToken = typeof magicLinkTokens.$inferSelect;
export type NewMagicLinkToken = typeof magicLinkTokens.$inferInsert;
