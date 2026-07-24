// Durable rate limiter for POST /api/og/sign.
//
// Thin adapter over the shared expensive-verify limiter (distinct kinds for
// og-sign / challenge-verify / lineup). Cache hits on the sign route are
// served before this limiter runs; cache misses consume the og-sign path
// bucket plus the cross-path aggregate.

import type { Db } from "@wcdraft/db";

import {
  allowAllExpensiveVerifyRateLimiter,
  createDbExpensiveVerifyRateLimiter,
  EXPENSIVE_VERIFY_CAPS,
  EXPENSIVE_VERIFY_STORE_ERROR_RETRY_AFTER_SECONDS,
  EXPENSIVE_VERIFY_SWEEP_PROBABILITY,
  EXPENSIVE_VERIFY_SWEEP_RETENTION_MS,
  type ExpensiveVerifyRateLimitDecision,
  type ExpensiveVerifyRateLimiter,
} from "./expensive-verify-rate-limiter-db";

export interface RunOgSignRateLimitContext {
  readonly ip: string;
}

export type RunOgSignRateLimitDecision = ExpensiveVerifyRateLimitDecision;

export interface RunOgSignRateLimiter {
  checkSign(ctx: RunOgSignRateLimitContext): Promise<RunOgSignRateLimitDecision>;
}

export const RUN_OG_SIGN_RATE_LIMIT = EXPENSIVE_VERIFY_CAPS["og-sign-ip-1m"];

export const RUN_OG_SIGN_STORE_ERROR_RETRY_AFTER_SECONDS =
  EXPENSIVE_VERIFY_STORE_ERROR_RETRY_AFTER_SECONDS;
export const RUN_OG_SIGN_SWEEP_PROBABILITY = EXPENSIVE_VERIFY_SWEEP_PROBABILITY;
export const RUN_OG_SIGN_SWEEP_RETENTION_MS = EXPENSIVE_VERIFY_SWEEP_RETENTION_MS;

export const allowAllRunOgSignRateLimiter: RunOgSignRateLimiter = {
  async checkSign(ctx) {
    return allowAllExpensiveVerifyRateLimiter.check(ctx);
  },
};

export interface DbRunOgSignRateLimiterDeps {
  readonly db: Db;
  readonly now: () => number;
  readonly random?: () => number;
}

export function createDbRunOgSignRateLimiter(
  deps: DbRunOgSignRateLimiterDeps,
): RunOgSignRateLimiter {
  const inner: ExpensiveVerifyRateLimiter = createDbExpensiveVerifyRateLimiter({
    ...deps,
    kind: "og-sign-ip-1m",
  });
  return {
    checkSign(ctx) {
      return inner.check(ctx);
    },
  };
}

export function createDbChallengeVerifyRateLimiter(
  deps: DbRunOgSignRateLimiterDeps,
): ExpensiveVerifyRateLimiter {
  return createDbExpensiveVerifyRateLimiter({ ...deps, kind: "challenge-verify-ip-1m" });
}

export function createDbLineupRateLimiter(
  deps: DbRunOgSignRateLimiterDeps,
): ExpensiveVerifyRateLimiter {
  return createDbExpensiveVerifyRateLimiter({ ...deps, kind: "lineup-ip-1m" });
}
