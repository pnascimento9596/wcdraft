// Durable IP rate limiters for CPU-expensive token re-derive paths.
//
// POST /api/og/sign, POST /api/challenge/verify, and the lineup inspector all
// re-verify a run token through the same `verifyRunTokenForOg` (or equivalent)
// path. They share the auth_rate_limits table but use DISTINCT bucket kinds so
// one activity cannot starve another (including across users behind one NAT).
//
// Budget arithmetic (see PR body / unit tests):
//   Historical shared ceiling: 30 expensive ops / IP / minute.
//   Split (aggregate ≤ 30):
//     og-sign-ip-1m            15/min  — share + Track A prewarm (≤1/token/session)
//     challenge-verify-ip-1m    8/min  — human challenge accept is low-frequency
//     lineup-ip-1m              7/min  — inspector browse
//   Aggregate cap kind expensive-verify-ip-1m: 30/min across all three paths.
//   Net per-IP expensive-work capacity does not increase vs the prior ceiling.

import type { Db } from "@wcdraft/db";

import { consumeRateLimit, sweepOldRateLimits, type RateLimitBucketKind } from "../auth/rate-limit";
import { createRequestCorrelationId, logRequestError } from "../http/request-error-log";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type ExpensiveVerifyKind = "og-sign-ip-1m" | "challenge-verify-ip-1m" | "lineup-ip-1m";

export interface ExpensiveVerifyCap {
  readonly kind: ExpensiveVerifyKind;
  readonly windowMs: number;
  readonly maxCount: number;
}

/** Per-path caps. Sum of maxCounts = 30 = historical shared ceiling. */
export const EXPENSIVE_VERIFY_CAPS: Readonly<Record<ExpensiveVerifyKind, ExpensiveVerifyCap>> = {
  "og-sign-ip-1m": { kind: "og-sign-ip-1m", windowMs: MINUTE_MS, maxCount: 15 },
  "challenge-verify-ip-1m": {
    kind: "challenge-verify-ip-1m",
    windowMs: MINUTE_MS,
    maxCount: 8,
  },
  "lineup-ip-1m": { kind: "lineup-ip-1m", windowMs: MINUTE_MS, maxCount: 7 },
} as const;

/**
 * Cross-path aggregate. Every expensive verify consumes this bucket too so
 * a client that fans out across kinds cannot exceed the historical 30/min.
 */
export const EXPENSIVE_VERIFY_AGGREGATE = {
  kind: "expensive-verify-ip-1m" as const satisfies RateLimitBucketKind,
  windowMs: MINUTE_MS,
  maxCount: 30,
} as const;

export const EXPENSIVE_VERIFY_STORE_ERROR_RETRY_AFTER_SECONDS = 60;
export const EXPENSIVE_VERIFY_SWEEP_PROBABILITY = 1 / 50;
export const EXPENSIVE_VERIFY_SWEEP_RETENTION_MS = 2 * DAY_MS;

/** Historical single-bucket ceiling kept as a named constant for docs/tests. */
export const EXPENSIVE_VERIFY_HISTORICAL_SHARED_CEILING = 30;

export interface ExpensiveVerifyRateLimitContext {
  readonly ip: string;
}

export type ExpensiveVerifyRateLimitDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: "capped";
      readonly retryAfterSeconds: number;
      readonly deniedKind: RateLimitBucketKind;
    }
  | {
      readonly allowed: false;
      readonly reason: "store_unavailable";
      readonly retryAfterSeconds: number;
      readonly correlationId: string;
    };

export interface ExpensiveVerifyRateLimiter {
  check(ctx: ExpensiveVerifyRateLimitContext): Promise<ExpensiveVerifyRateLimitDecision>;
}

export const allowAllExpensiveVerifyRateLimiter: ExpensiveVerifyRateLimiter = {
  async check() {
    return { allowed: true };
  },
};

export interface DbExpensiveVerifyRateLimiterDeps {
  readonly db: Db;
  readonly now: () => number;
  readonly random?: () => number;
  readonly kind: ExpensiveVerifyKind;
}

export function createDbExpensiveVerifyRateLimiter(
  deps: DbExpensiveVerifyRateLimiterDeps,
): ExpensiveVerifyRateLimiter {
  const random = deps.random ?? Math.random;
  const limitDeps = { db: deps.db, now: deps.now };
  const pathCap = EXPENSIVE_VERIFY_CAPS[deps.kind];

  async function check(
    ctx: ExpensiveVerifyRateLimitContext,
  ): Promise<ExpensiveVerifyRateLimitDecision> {
    try {
      // Path bucket first (cheapest isolation signal), then aggregate.
      for (const cap of [pathCap, EXPENSIVE_VERIFY_AGGREGATE] as const) {
        const result = await consumeRateLimit(
          {
            bucket: { kind: cap.kind, value: ctx.ip },
            windowMs: cap.windowMs,
            maxCount: cap.maxCount,
          },
          limitDeps,
        );
        if (!result.allowed) {
          return {
            allowed: false,
            reason: "capped",
            retryAfterSeconds: result.retryAfterSeconds ?? 1,
            deniedKind: cap.kind,
          };
        }
      }
    } catch (err) {
      const correlationId = createRequestCorrelationId();
      logRequestError({
        code: "RATE_LIMIT_UNAVAILABLE",
        correlationId,
        route: `rate-limit:${deps.kind}`,
        error: err,
      });
      return {
        allowed: false,
        reason: "store_unavailable",
        retryAfterSeconds: EXPENSIVE_VERIFY_STORE_ERROR_RETRY_AFTER_SECONDS,
        correlationId,
      };
    }

    if (random() < EXPENSIVE_VERIFY_SWEEP_PROBABILITY) {
      try {
        await sweepOldRateLimits(EXPENSIVE_VERIFY_SWEEP_RETENTION_MS, limitDeps);
      } catch (err) {
        console.error("[expensive-verify] rate-limit sweep failed (non-fatal)", err);
      }
    }
    return { allowed: true };
  }

  return { check };
}

/** Σ path maxCounts must equal historical shared ceiling (budget invariant). */
export function expensiveVerifyPathBudgetSum(): number {
  return (
    EXPENSIVE_VERIFY_CAPS["og-sign-ip-1m"].maxCount +
    EXPENSIVE_VERIFY_CAPS["challenge-verify-ip-1m"].maxCount +
    EXPENSIVE_VERIFY_CAPS["lineup-ip-1m"].maxCount
  );
}
