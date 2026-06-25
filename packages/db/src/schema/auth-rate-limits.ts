// F-2 — auth_rate_limits (DB-backed counter buckets).
//
// One row = (bucket_key, window_start) → count of requests in that window.
// Used by the magic-link request handler to throttle per-email and per-IP
// abuse without leaking real-time rate state to the client.
//
// bucket_key is a tagged sha256 hash:
//   "email:<sha256>"  for per-email throttling
//   "ip:<sha256>"     for per-IP throttling
// Hashing means a CI log dump or a misconfigured backup never reveals real
// email addresses or IPs.
//
// window_start is the floored start of the current window
// (e.g. epoch_ms - epoch_ms % window_ms). UPSERTs increment count for the
// current window; old windows are reaped lazily by a separate sweep query.
//
// Composite primary key (bucket_key, window_start) lets the UPSERT path be
// a single SQL round-trip with `ON CONFLICT DO UPDATE`.
import { pgTable, text, timestamp, integer, primaryKey, index } from "drizzle-orm/pg-core";

export const authRateLimits = pgTable(
  "auth_rate_limits",
  {
    bucketKey: text("bucket_key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "auth_rate_limits_pk",
      columns: [t.bucketKey, t.windowStart],
    }),
    // Lazy-sweep query: "delete WHERE window_start < now() - retention".
    index("auth_rate_limits_window_idx").on(t.windowStart),
  ],
);

export type AuthRateLimit = typeof authRateLimits.$inferSelect;
export type NewAuthRateLimit = typeof authRateLimits.$inferInsert;
