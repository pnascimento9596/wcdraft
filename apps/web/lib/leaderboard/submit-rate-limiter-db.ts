// F-4 U5 — the REAL SubmitRateLimiter (plan §5.2), swapped in at the submit
// route's deps builder. Backed by the existing `auth_rate_limits` DB
// sliding-window buckets (lib/auth/rate-limit.ts) — serverless-safe and
// durable: every check is one atomic upsert round-trip, no in-memory state.
//
// Caps (plan §5.2 / §10 Q4 — config constants, exported for tests/report):
//   - 6 / hour  per identity   (identity = userId ?? sessionId, so a claimed
//                               account can't reset its cap by rotating anon
//                               sessions; plan §4 keys boards the same way)
//   - 20 / day  per identity
//   - 30 / hour per IP         (first x-forwarded-for hop, hashed — same
//                               treatment as the magic-link limiter; the
//                               plaintext never reaches the table)
//
// Semantics & posture:
//   - Buckets count ATTEMPTS that reach pipeline step 6, not accepted rows —
//     that is what an increment-then-check bucket can enforce, and it is
//     strictly more conservative than the plan's "accepted submissions"
//     phrasing (honest players essentially never burn quota on rejects).
//   - Checks short-circuit on the first denied bucket (cheapest-deny: a
//     hammered identity stops costing Neon after one query). Retry-After is
//     the honest window remainder of THAT bucket.
//   - Store errors FAIL CLOSED (plan is silent; a submit lost to a transient
//     error is recoverable — an unbounded write path is not). The seam only
//     speaks 429, so a store error denies with a short fixed Retry-After
//     rather than surfacing as a 500.
//   - Lazy sweep (plan §5.2: piggyback, no cron): after an ALLOWED decision,
//     with probability 1/50, delete bucket rows older than 2× the longest
//     window. Sweep failure never affects the decision.

import type { Db } from "@wcdraft/db";

import { consumeRateLimit, sweepOldRateLimits } from "../auth/rate-limit";
import type {
  SubmitRateLimitContext,
  SubmitRateLimitDecision,
  SubmitRateLimiter,
} from "./submit-rate-limit";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface SubmitCap {
  readonly kind: "lb-identity-1h" | "lb-identity-1d" | "lb-ip-1h";
  readonly scope: "identity" | "ip";
  readonly windowMs: number;
  readonly maxCount: number;
}

/** Checked in order; the first denied bucket short-circuits. */
export const SUBMIT_CAPS: readonly SubmitCap[] = [
  { kind: "lb-identity-1h", scope: "identity", windowMs: HOUR_MS, maxCount: 6 },
  { kind: "lb-identity-1d", scope: "identity", windowMs: DAY_MS, maxCount: 20 },
  { kind: "lb-ip-1h", scope: "ip", windowMs: HOUR_MS, maxCount: 30 },
];

/** Fail-closed deny: short, fixed — the store blip is transient, not a window. */
export const STORE_ERROR_RETRY_AFTER_SECONDS = 60;

/** Lazy-sweep tuning: 1-in-50 allowed submits; retain 2× the longest window. */
export const SWEEP_PROBABILITY = 1 / 50;
export const SWEEP_RETENTION_MS = 2 * DAY_MS;

export interface DbSubmitRateLimiterDeps {
  readonly db: Db;
  readonly now: () => number;
  /** Sweep dice — injectable for tests; production passes Math.random. */
  readonly random?: () => number;
}

export function createDbSubmitRateLimiter(deps: DbSubmitRateLimiterDeps): SubmitRateLimiter {
  const random = deps.random ?? Math.random;
  const limitDeps = { db: deps.db, now: deps.now };

  async function checkSubmit(ctx: SubmitRateLimitContext): Promise<SubmitRateLimitDecision> {
    // The identity gate always yields a session today; the ?? chain is the
    // defensive floor — a hypothetical no-identity caller still gets the
    // identity caps applied to its IP rather than a free pass.
    const identityValue = ctx.userId ?? ctx.sessionId ?? `no-identity:${ctx.ip}`;
    try {
      for (const cap of SUBMIT_CAPS) {
        const result = await consumeRateLimit(
          {
            bucket: {
              kind: cap.kind,
              value: cap.scope === "identity" ? identityValue : ctx.ip,
            },
            windowMs: cap.windowMs,
            maxCount: cap.maxCount,
          },
          limitDeps,
        );
        if (!result.allowed) {
          return { allowed: false, retryAfterSeconds: result.retryAfterSeconds ?? 1 };
        }
      }
    } catch (err) {
      console.error("[leaderboard] rate-limit store error — failing CLOSED", err);
      return { allowed: false, retryAfterSeconds: STORE_ERROR_RETRY_AFTER_SECONDS };
    }
    // Decision is final (allowed) — the sweep can no longer affect it.
    if (random() < SWEEP_PROBABILITY) {
      try {
        await sweepOldRateLimits(SWEEP_RETENTION_MS, limitDeps);
      } catch (err) {
        console.error("[leaderboard] lazy rate-limit sweep failed (non-fatal)", err);
      }
    }
    return { allowed: true };
  }

  return { checkSubmit };
}
