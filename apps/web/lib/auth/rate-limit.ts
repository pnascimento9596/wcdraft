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
 * buckets (plan §5.2 reuses this mechanism); `ranked-attempt-user-1h` caps new
 * competitive seeds; the `*-ip-1m` expensive-verify kinds protect CPU-heavy
 * token re-derive routes (og-sign / challenge-verify / lineup) plus their
 * cross-path aggregate `expensive-verify-ip-1m`.
 * Each window length gets its OWN kind: window floors of different lengths can
 * coincide (hour 0 of a day), so sharing a key across windows would
 * double-increment one row.
 */
export type RateLimitBucketKind =
  | "email"
  | "ip"
  | "lb-identity-1h"
  | "lb-identity-1d"
  | "lb-ip-1h"
  | "ranked-attempt-user-1h"
  | "og-sign-ip-1m"
  | "challenge-verify-ip-1m"
  | "lineup-ip-1m"
  | "expensive-verify-ip-1m"
  | "password-email-15m"
  | "password-ip-15m"
  | "verification-session-15m";

/** Lower than the coarse 10-request/hour source cap by design. */
export const MAGIC_LINK_DISTINCT_IDENTIFIERS_PER_IP = {
  maxCount: 5,
  windowMs: 60 * 60 * 1000,
} as const;

export interface RateLimitArgs {
  /** "<kind>:<plaintext>" — hashed inside. */
  readonly bucket: { kind: RateLimitBucketKind; value: string };
  /** Window length in milliseconds. */
  readonly windowMs: number;
  /** Maximum allowed count per window. */
  readonly maxCount: number;
}

export interface RateLimitDeps {
  readonly db: Pick<Db, "execute">;
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
 * Record one distinct normalized identifier for an IP in the current window.
 * Both persisted keys are family-prefixed SHA-256 digests. The marker primary
 * key makes only the first request for a pair increment the shared IP counter.
 * A counter-row `FOR UPDATE` lock serializes every identifier for an IP. The
 * lock is acquired in a later statement than the insert-on-conflict, which is
 * important under PostgreSQL READ COMMITTED: a waiter gets a fresh snapshot
 * after the winning transaction commits instead of trusting a stale statement
 * snapshot. The caller must invoke this helper inside a transaction.
 */
export async function consumeDistinctIdentifierPerIp(
  args: {
    readonly ipAddress: string;
    readonly identifier: string;
    readonly windowMs: number;
    readonly maxCount: number;
  },
  deps: RateLimitDeps,
): Promise<RateLimitResult & { readonly inserted: boolean }> {
  const nowMs = deps.now();
  const windowStartMs = nowMs - (nowMs % args.windowMs);
  const windowStart = new Date(windowStartMs);
  const normalizedIp = args.ipAddress.trim().toLowerCase() || "unknown";
  const ipHash = sha256Hex(normalizedIp);
  const identifierHash = sha256Hex(args.identifier.trim().toLowerCase());
  const markerKey = `magic-distinct-marker:${sha256Hex(`${ipHash}:${identifierHash}`)}`;
  const counterKey = `magic-distinct-ip:${ipHash}`;

  await deps.db.execute(sql`
    INSERT INTO ${authRateLimits} (bucket_key, window_start, count, updated_at)
    VALUES (${counterKey}, ${windowStart}, 0, NOW())
    ON CONFLICT (bucket_key, window_start) DO NOTHING
  `);
  const locked = await deps.db.execute<{ count: number }>(sql`
    SELECT count
    FROM ${authRateLimits}
    WHERE bucket_key = ${counterKey} AND window_start = ${windowStart}
    FOR UPDATE
  `);
  let count = locked.rows[0]?.count ?? 0;
  const marker = await deps.db.execute<{ inserted: number }>(sql`
    INSERT INTO ${authRateLimits} (bucket_key, window_start, count, updated_at)
    VALUES (${markerKey}, ${windowStart}, 1, NOW())
    ON CONFLICT (bucket_key, window_start) DO NOTHING
    RETURNING 1 AS inserted
  `);
  const inserted = marker.rows.length === 1;
  if (inserted) {
    const incremented = await deps.db.execute<{ count: number }>(sql`
      UPDATE ${authRateLimits}
      SET count = count + 1, updated_at = NOW()
      WHERE bucket_key = ${counterKey} AND window_start = ${windowStart}
      RETURNING count
    `);
    count = incremented.rows[0]?.count ?? count + 1;
  }
  const allowed = count <= args.maxCount;
  const retryAfterSeconds = allowed
    ? null
    : Math.max(1, Math.ceil((windowStartMs + args.windowMs - nowMs) / 1000));
  return { allowed, count, inserted, windowStart, retryAfterSeconds };
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
