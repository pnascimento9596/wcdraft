// Durable rate limiter for POST /api/og/sign.
//
// The route is a signing oracle over server-owned OG payloads. Cache hits are
// served before this limiter runs; cache misses consume one cheap IP bucket in
// the shared auth_rate_limits table so serverless instances cannot reset quota
// by cold-starting.

import type { Db } from "@wcdraft/db";

import { consumeRateLimit, sweepOldRateLimits } from "../auth/rate-limit";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export interface RunOgSignRateLimitContext {
  readonly ip: string;
}

export type RunOgSignRateLimitDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

export interface RunOgSignRateLimiter {
  checkSign(ctx: RunOgSignRateLimitContext): Promise<RunOgSignRateLimitDecision>;
}

export const RUN_OG_SIGN_RATE_LIMIT = {
  kind: "og-sign-ip-1m",
  windowMs: MINUTE_MS,
  maxCount: 30,
} as const;

export const RUN_OG_SIGN_STORE_ERROR_RETRY_AFTER_SECONDS = 60;
export const RUN_OG_SIGN_SWEEP_PROBABILITY = 1 / 50;
// Shared table: retain at least the longest known window family (leaderboard
// daily) so this route's sweep cannot erase another feature's active bucket.
export const RUN_OG_SIGN_SWEEP_RETENTION_MS = 2 * DAY_MS;

export const allowAllRunOgSignRateLimiter: RunOgSignRateLimiter = {
  async checkSign() {
    return { allowed: true };
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
  const random = deps.random ?? Math.random;
  const limitDeps = { db: deps.db, now: deps.now };

  async function checkSign(ctx: RunOgSignRateLimitContext): Promise<RunOgSignRateLimitDecision> {
    try {
      const result = await consumeRateLimit(
        {
          bucket: { kind: RUN_OG_SIGN_RATE_LIMIT.kind, value: ctx.ip },
          windowMs: RUN_OG_SIGN_RATE_LIMIT.windowMs,
          maxCount: RUN_OG_SIGN_RATE_LIMIT.maxCount,
        },
        limitDeps,
      );
      if (!result.allowed) {
        return { allowed: false, retryAfterSeconds: result.retryAfterSeconds ?? 1 };
      }
    } catch (err) {
      console.error("[run-og] sign rate-limit store error - failing CLOSED", err);
      return {
        allowed: false,
        retryAfterSeconds: RUN_OG_SIGN_STORE_ERROR_RETRY_AFTER_SECONDS,
      };
    }

    if (random() < RUN_OG_SIGN_SWEEP_PROBABILITY) {
      try {
        await sweepOldRateLimits(RUN_OG_SIGN_SWEEP_RETENTION_MS, limitDeps);
      } catch (err) {
        console.error("[run-og] sign rate-limit sweep failed (non-fatal)", err);
      }
    }
    return { allowed: true };
  }

  return { checkSign };
}
