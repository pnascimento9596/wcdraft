import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { authRateLimits } from "@wcdraft/db";
import type { Db } from "@wcdraft/db";

import { setupTestDb } from "../../auth/__tests__/_test-db";
import {
  createDbRunOgSignRateLimiter,
  RUN_OG_SIGN_RATE_LIMIT,
  RUN_OG_SIGN_STORE_ERROR_RETRY_AFTER_SECONDS,
  RUN_OG_SIGN_SWEEP_PROBABILITY,
  RUN_OG_SIGN_SWEEP_RETENTION_MS,
} from "../run-og-sign-rate-limiter-db";

const { db, pg, reset } = await setupTestDb();
afterAll(async () => pg.close());
beforeEach(async () => reset());

const BASE = Date.UTC(2026, 5, 15, 12, 0, 30);
const MINUTE = 60 * 1000;
const neverSweep = () => 1;

function limiterAt(nowMs: () => number, random: () => number = neverSweep) {
  return createDbRunOgSignRateLimiter({ db, now: nowMs, random });
}

describe("run OG sign durable rate limiter", () => {
  it("allows 30 IP attempts per minute and denies the 31st with exact Retry-After", async () => {
    const limiter = limiterAt(() => BASE);
    for (let i = 0; i < RUN_OG_SIGN_RATE_LIMIT.maxCount; i += 1) {
      expect((await limiter.checkSign({ ip: "198.51.100.77" })).allowed).toBe(true);
    }

    const denied = await limiter.checkSign({ ip: "198.51.100.77" });
    expect(denied).toEqual({ allowed: false, retryAfterSeconds: 30 });
  });

  it("resets in a new minute and isolates other IPs", async () => {
    let now = BASE;
    const limiter = limiterAt(() => now);
    for (let i = 0; i <= RUN_OG_SIGN_RATE_LIMIT.maxCount; i += 1) {
      await limiter.checkSign({ ip: "198.51.100.77" });
    }

    expect((await limiter.checkSign({ ip: "198.51.100.78" })).allowed).toBe(true);
    now = BASE + MINUTE;
    expect((await limiter.checkSign({ ip: "198.51.100.77" })).allowed).toBe(true);
  });

  it("hashes IP bucket keys before persistence", async () => {
    const limiter = limiterAt(() => BASE);
    await limiter.checkSign({ ip: "198.51.100.77" });

    const rows = await db.select().from(authRateLimits);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.bucketKey).toMatch(/^og-sign-ip-1m:[0-9a-f]{64}$/u);
    expect(rows[0]!.bucketKey).not.toContain("198.51.100.77");
  });

  it("fails closed on store errors", async () => {
    const broken = { execute: () => Promise.reject(new Error("neon down")) } as unknown as Db;
    const limiter = createDbRunOgSignRateLimiter({
      db: broken,
      now: () => BASE,
      random: neverSweep,
    });

    await expect(limiter.checkSign({ ip: "198.51.100.77" })).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: RUN_OG_SIGN_STORE_ERROR_RETRY_AFTER_SECONDS,
    });
  });

  it("lazy sweep retains windows for every auth_rate_limits family", async () => {
    const oldButRetained = limiterAt(() => BASE - RUN_OG_SIGN_SWEEP_RETENTION_MS + MINUTE);
    await oldButRetained.checkSign({ ip: "198.51.100.10" });

    const expired = limiterAt(() => BASE - RUN_OG_SIGN_SWEEP_RETENTION_MS - MINUTE);
    await expired.checkSign({ ip: "198.51.100.11" });

    const sweeping = limiterAt(
      () => BASE,
      () => RUN_OG_SIGN_SWEEP_PROBABILITY / 2,
    );
    const decision = await sweeping.checkSign({ ip: "198.51.100.12" });
    expect(decision.allowed).toBe(true);

    const rows = await db.select().from(authRateLimits);
    expect(rows.map((row) => row.bucketKey).sort()).toHaveLength(2);
    const cutoff = new Date(BASE - RUN_OG_SIGN_SWEEP_RETENTION_MS);
    for (const row of rows) expect(row.windowStart >= cutoff).toBe(true);
  });
});
