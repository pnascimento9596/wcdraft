// F-2 — DB-backed sliding-window-bucket rate limit.
//
// Each `consume()` call:
//   1. Floors `now` to the start of the current window (`window_start = now − now%windowMs`).
//   2. UPSERTs `(bucket_key, window_start)` and increments `count`.
//   3. Compares the post-increment count to `maxCount`; returns `{ allowed: false }`
//      if exceeded.
//
// Per-email and per-IP buckets are separately fingerprinted (sha-256) so
// a leaked DB never reveals real email addresses or IPs.
//
// The function is pure with respect to (db, now) so tests pass deterministic
// values; the production caller passes `() => Date.now()`.
import { sha256Hex } from "./tokens";
import type { Db } from "@wcdraft/db";
import { authRateLimits } from "@wcdraft/db";
import { sql } from "drizzle-orm";

/**
 * Bucket families sharing the `auth_rate_limits` table. `email`/`ip` are the
 * F-2 magic-link buckets; the `lb-*` kinds are the F-4 U5 leaderboard-submit
 * buckets (plan §5.2 reuses this mechanism); `og-sign-ip-1m` protects the
 * dynamic OG signing route. Each window length gets its OWN kind: window
 * floors of different lengths can coincide (hour 0 of a day), so sharing a key
 * across windows would double-increment one row.
 */
export type RateLimitBucketKind =
  | "email"
  | "ip"
  | "lb-identity-1h"
  | "lb-identity-1d"
  | "lb-ip-1h"
  | "og-sign-ip-1m"
  | "password-email-15m"
  | "password-ip-15m";

export interface RateLimitArgs {
  /** "<kind>:<plaintext>" — hashed inside. */
  readonly bucket: { kind: RateLimitBucketKind; value: string };
  /** Window length in milliseconds. */
  readonly windowMs: number;
  /** Maximum allowed count per window. */
  readonly maxCount: number;
}

export interface RateLimitDeps {
  readonly db: Db;
  readonly now: () => number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly count: number;
  readonly windowStart: Date;
  readonly retryAfterSeconds: number | null;
}

export async function consumeRateLimit(
  args: RateLimitArgs,
  deps: RateLimitDeps,
): Promise<RateLimitResult> {
  const nowMs = deps.now();
  const winMs = args.windowMs;
  const windowStartMs = nowMs - (nowMs % winMs);
  const windowStart = new Date(windowStartMs);
  const bucketKey = `${args.bucket.kind}:${sha256Hex(args.bucket.value.trim().toLowerCase())}`;
  // ON CONFLICT DO UPDATE increments count atomically. We don't need to
  // pre-read; a single round-trip is enough.
  const result = await deps.db.execute<{ count: number }>(sql`
    INSERT INTO ${authRateLimits} (bucket_key, window_start, count, updated_at)
    VALUES (${bucketKey}, ${windowStart}, 1, NOW())
    ON CONFLICT (bucket_key, window_start) DO UPDATE
      SET count = ${authRateLimits.count} + 1,
          updated_at = NOW()
    RETURNING count
  `);
  const count = result.rows[0]?.count ?? 0;
  const allowed = count <= args.maxCount;
  const retryAfterSeconds = allowed
    ? null
    : Math.max(1, Math.ceil((windowStartMs + winMs - nowMs) / 1000));
  return { allowed, count, windowStart, retryAfterSeconds };
}

/**
 * Lazy-sweep helper: deletes counter rows whose window is older than
 * `retentionMs`. Called by a periodic job (cron / scheduler); not required
 * for correctness — only for keeping table size bounded.
 */
export async function sweepOldRateLimits(
  retentionMs: number,
  deps: RateLimitDeps,
): Promise<number> {
  const cutoff = new Date(deps.now() - retentionMs);
  const r = await deps.db.execute<{ count: string }>(sql`
    WITH deleted AS (
      DELETE FROM ${authRateLimits} WHERE window_start < ${cutoff}
      RETURNING 1
    )
    SELECT COUNT(*) AS count FROM deleted
  `);
  return Number(r.rows[0]?.count ?? "0");
}
