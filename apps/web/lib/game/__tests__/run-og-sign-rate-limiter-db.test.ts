import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { authRateLimits } from "@wcdraft/db";
import type { Db } from "@wcdraft/db";

import { setupTestDb } from "../../auth/__tests__/_test-db";
import {
  createDbChallengeVerifyRateLimiter,
  createDbLineupRateLimiter,
  createDbRunOgSignRateLimiter,
  RUN_OG_SIGN_RATE_LIMIT,
  RUN_OG_SIGN_STORE_ERROR_RETRY_AFTER_SECONDS,
  RUN_OG_SIGN_SWEEP_PROBABILITY,
  RUN_OG_SIGN_SWEEP_RETENTION_MS,
} from "../run-og-sign-rate-limiter-db";
import {
  EXPENSIVE_VERIFY_AGGREGATE,
  EXPENSIVE_VERIFY_CAPS,
  EXPENSIVE_VERIFY_HISTORICAL_SHARED_CEILING,
  expensiveVerifyPathBudgetSum,
} from "../expensive-verify-rate-limiter-db";

const { db, pg, reset } = await setupTestDb();
afterAll(async () => pg.close());
beforeEach(async () => reset());

const BASE = Date.UTC(2026, 5, 15, 12, 0, 30);
const MINUTE = 60 * 1000;
const neverSweep = () => 1;

function ogAt(nowMs: () => number, random: () => number = neverSweep) {
  return createDbRunOgSignRateLimiter({ db, now: nowMs, random });
}

describe("expensive-verify budget arithmetic", () => {
  it("keeps path budget sum equal to the historical shared ceiling", () => {
    expect(expensiveVerifyPathBudgetSum()).toBe(EXPENSIVE_VERIFY_HISTORICAL_SHARED_CEILING);
    expect(EXPENSIVE_VERIFY_AGGREGATE.maxCount).toBe(EXPENSIVE_VERIFY_HISTORICAL_SHARED_CEILING);
    expect(RUN_OG_SIGN_RATE_LIMIT.maxCount).toBe(EXPENSIVE_VERIFY_CAPS["og-sign-ip-1m"].maxCount);
  });
});

describe("run OG sign durable rate limiter", () => {
  it("allows the og-sign path cap and denies the next with exact Retry-After", async () => {
    const limiter = ogAt(() => BASE);
    for (let i = 0; i < RUN_OG_SIGN_RATE_LIMIT.maxCount; i += 1) {
      expect((await limiter.checkSign({ ip: "198.51.100.77" })).allowed).toBe(true);
    }

    const denied = await limiter.checkSign({ ip: "198.51.100.77" });
    expect(denied).toMatchObject({
      allowed: false,
      reason: "capped",
      retryAfterSeconds: 30,
      deniedKind: "og-sign-ip-1m",
    });
  });

  it("resets in a new minute and isolates other IPs", async () => {
    let now = BASE;
    const limiter = ogAt(() => now);
    for (let i = 0; i <= RUN_OG_SIGN_RATE_LIMIT.maxCount; i += 1) {
      await limiter.checkSign({ ip: "198.51.100.77" });
    }

    expect((await limiter.checkSign({ ip: "198.51.100.78" })).allowed).toBe(true);
    now = BASE + MINUTE;
    expect((await limiter.checkSign({ ip: "198.51.100.77" })).allowed).toBe(true);
  });

  it("hashes IP bucket keys before persistence", async () => {
    const limiter = ogAt(() => BASE);
    await limiter.checkSign({ ip: "198.51.100.77" });

    const rows = await db.select().from(authRateLimits);
    // path + aggregate rows
    expect(rows).toHaveLength(2);
    const kinds = rows.map((row) => row.bucketKey.split(":")[0]).sort();
    expect(kinds).toEqual(["expensive-verify-ip-1m", "og-sign-ip-1m"]);
    for (const row of rows) {
      expect(row.bucketKey).toMatch(/^[a-z0-9-]+:[0-9a-f]{64}$/u);
      expect(row.bucketKey).not.toContain("198.51.100.77");
    }
  });

  it("fails closed on store errors with store_unavailable", async () => {
    const broken = { execute: () => Promise.reject(new Error("neon down")) } as unknown as Db;
    const limiter = createDbRunOgSignRateLimiter({
      db: broken,
      now: () => BASE,
      random: neverSweep,
    });

    const decision = await limiter.checkSign({ ip: "198.51.100.77" });
    expect(decision).toMatchObject({
      allowed: false,
      reason: "store_unavailable",
      retryAfterSeconds: RUN_OG_SIGN_STORE_ERROR_RETRY_AFTER_SECONDS,
    });
    if (decision.allowed || decision.reason !== "store_unavailable") {
      throw new Error("expected store_unavailable");
    }
    expect(decision.correlationId).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("lazy sweep retains windows for every auth_rate_limits family", async () => {
    const oldButRetained = ogAt(() => BASE - RUN_OG_SIGN_SWEEP_RETENTION_MS + MINUTE);
    await oldButRetained.checkSign({ ip: "198.51.100.10" });

    const expired = ogAt(() => BASE - RUN_OG_SIGN_SWEEP_RETENTION_MS - MINUTE);
    await expired.checkSign({ ip: "198.51.100.11" });

    const sweeping = ogAt(
      () => BASE,
      () => RUN_OG_SIGN_SWEEP_PROBABILITY / 2,
    );
    const decision = await sweeping.checkSign({ ip: "198.51.100.12" });
    expect(decision.allowed).toBe(true);

    const rows = await db.select().from(authRateLimits);
    // current IP: path + aggregate; retained old IP: path + aggregate
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const cutoff = new Date(BASE - RUN_OG_SIGN_SWEEP_RETENTION_MS);
    for (const row of rows) expect(row.windowStart >= cutoff).toBe(true);
  });
});

describe("split kinds: no cross-starvation + aggregate exposure", () => {
  it("exhausting og-sign leaves challenge-verify and lineup serving", async () => {
    const og = createDbRunOgSignRateLimiter({ db, now: () => BASE, random: neverSweep });
    const challenge = createDbChallengeVerifyRateLimiter({
      db,
      now: () => BASE,
      random: neverSweep,
    });
    const lineup = createDbLineupRateLimiter({ db, now: () => BASE, random: neverSweep });
    const ip = "198.51.100.50";

    for (let i = 0; i < EXPENSIVE_VERIFY_CAPS["og-sign-ip-1m"].maxCount; i += 1) {
      expect((await og.checkSign({ ip })).allowed).toBe(true);
    }
    expect((await og.checkSign({ ip })).allowed).toBe(false);

    // Distinct path kinds still allow traffic (aggregate still has headroom).
    expect((await challenge.check({ ip })).allowed).toBe(true);
    expect((await lineup.check({ ip })).allowed).toBe(true);
  });

  it("aggregate cap blocks further expensive work once historical ceiling is hit", async () => {
    const og = createDbRunOgSignRateLimiter({ db, now: () => BASE, random: neverSweep });
    const challenge = createDbChallengeVerifyRateLimiter({
      db,
      now: () => BASE,
      random: neverSweep,
    });
    const lineup = createDbLineupRateLimiter({ db, now: () => BASE, random: neverSweep });
    const ip = "198.51.100.51";

    // Drain path budgets until aggregate (30) is exhausted.
    for (let i = 0; i < EXPENSIVE_VERIFY_CAPS["og-sign-ip-1m"].maxCount; i += 1) {
      expect((await og.checkSign({ ip })).allowed).toBe(true);
    }
    for (let i = 0; i < EXPENSIVE_VERIFY_CAPS["challenge-verify-ip-1m"].maxCount; i += 1) {
      expect((await challenge.check({ ip })).allowed).toBe(true);
    }
    for (let i = 0; i < EXPENSIVE_VERIFY_CAPS["lineup-ip-1m"].maxCount; i += 1) {
      expect((await lineup.check({ ip })).allowed).toBe(true);
    }

    // Any further expensive path is denied by the aggregate (or residual path cap).
    const denied = await og.checkSign({ ip: "198.51.100.51" });
    // New IP would work — prove the denial is for this IP only.
    expect(denied.allowed).toBe(false);
    if (!denied.allowed && denied.reason === "capped") {
      expect(["og-sign-ip-1m", "expensive-verify-ip-1m"]).toContain(denied.deniedKind);
    }
    expect(
      (await createDbRunOgSignRateLimiter({ db, now: () => BASE, random: neverSweep }).checkSign({
        ip: "198.51.100.99",
      })).allowed,
    ).toBe(true);
  });
});
