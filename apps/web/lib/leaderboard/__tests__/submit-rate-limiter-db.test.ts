// F-4 U5 — unit tests for the REAL SubmitRateLimiter over PGlite.
//
// Coverage:
//   - window math per cap: 6/h identity, 20/day identity, 30/h per-IP
//   - Retry-After honesty: exact seconds to the denying bucket's window end
//   - identity keying: userId ?? sessionId (account can't rotate sessions);
//     no-identity fallback still caps on IP; buckets are hashed (no raw
//     session/user/IP plaintext in bucket_key)
//   - store error → FAIL CLOSED (deny + fixed Retry-After, no throw)
//   - lazy sweep: fires at probability threshold, deletes only rows older
//     than retention, and a sweep failure never flips the decision

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { authRateLimits } from "@wcdraft/db";
import type { Db } from "@wcdraft/db";

import { setupTestDb } from "../../auth/__tests__/_test-db";
import {
  createDbSubmitRateLimiter,
  STORE_ERROR_RETRY_AFTER_SECONDS,
  SUBMIT_CAPS,
  SWEEP_PROBABILITY,
  SWEEP_RETENTION_MS,
} from "../submit-rate-limiter-db";
import type { SubmitRateLimitContext } from "../submit-rate-limit";

const { db, pg, reset } = await setupTestDb();
afterAll(async () => pg.close());
beforeEach(async () => reset());

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// UTC-midnight base → hour AND day windows start exactly here, so the
// Retry-After assertions below are exact arithmetic, not ranges.
const BASE = Date.UTC(2026, 5, 3);

const neverSweep = () => 1;

function ctx(over: Partial<SubmitRateLimitContext> = {}): SubmitRateLimitContext {
  return { sessionId: "sess-a", userId: null, ip: "203.0.113.7", ...over };
}

function limiterAt(nowMs: () => number, random: () => number = neverSweep) {
  return createDbSubmitRateLimiter({ db, now: nowMs, random });
}

describe("caps and window math", () => {
  it("identity hourly: 6 allowed, 7th denied with exact Retry-After", async () => {
    const now = BASE + 10 * 60 * 1000; // 10 min into the hour window
    const limiter = limiterAt(() => now);
    for (let i = 0; i < 6; i++) {
      expect((await limiter.checkSubmit(ctx())).allowed).toBe(true);
    }
    const denied = await limiter.checkSubmit(ctx());
    expect(denied).toEqual({ allowed: false, retryAfterSeconds: 50 * 60 });
  });

  it("a new hour window resets the hourly cap", async () => {
    let now = BASE;
    const limiter = limiterAt(() => now);
    for (let i = 0; i < 7; i++) await limiter.checkSubmit(ctx());
    now = BASE + HOUR; // next hourly window; daily count is 7 (+1 below) ≤ 20
    expect((await limiter.checkSubmit(ctx())).allowed).toBe(true);
  });

  it("identity daily: 20 allowed across hours, 21st denied with exact Retry-After", async () => {
    let now = BASE;
    const limiter = limiterAt(() => now);
    // 5 per hour over 4 hours — never trips 6/h, lands daily count at 20.
    for (let hour = 0; hour < 4; hour++) {
      now = BASE + hour * HOUR;
      for (let i = 0; i < 5; i++) {
        expect((await limiter.checkSubmit(ctx())).allowed).toBe(true);
      }
    }
    now = BASE + 4 * HOUR;
    const denied = await limiter.checkSubmit(ctx());
    // Hourly bucket is fresh (count 1); the DAILY bucket denies → Retry-After
    // is the remainder of the day window: 20 hours.
    expect(denied).toEqual({ allowed: false, retryAfterSeconds: (DAY - 4 * HOUR) / 1000 });
  });

  it("per-IP hourly: 30 allowed across many sessions, 31st session denied", async () => {
    const now = BASE;
    const limiter = limiterAt(() => now);
    for (let s = 0; s < 6; s++) {
      for (let i = 0; i < 5; i++) {
        const r = await limiter.checkSubmit(ctx({ sessionId: `sess-${s}` }));
        expect(r.allowed).toBe(true);
      }
    }
    const denied = await limiter.checkSubmit(ctx({ sessionId: "sess-fresh" }));
    expect(denied).toEqual({ allowed: false, retryAfterSeconds: HOUR / 1000 });
    // A different IP is NOT affected.
    const other = await limiter.checkSubmit(ctx({ sessionId: "sess-other", ip: "198.51.100.9" }));
    expect(other.allowed).toBe(true);
  });
});

describe("identity keying", () => {
  it("userId dominates: same account over rotating sessions shares one bucket", async () => {
    const limiter = limiterAt(() => BASE);
    for (let i = 0; i < 6; i++) {
      const r = await limiter.checkSubmit(ctx({ userId: "user-1", sessionId: `rotated-${i}` }));
      expect(r.allowed).toBe(true);
    }
    const denied = await limiter.checkSubmit(ctx({ userId: "user-1", sessionId: "rotated-7" }));
    expect(denied.allowed).toBe(false);
  });

  it("distinct anon sessions get distinct identity buckets", async () => {
    const limiter = limiterAt(() => BASE);
    for (let i = 0; i < 6; i++) await limiter.checkSubmit(ctx({ sessionId: "sess-a" }));
    const r = await limiter.checkSubmit(ctx({ sessionId: "sess-b" }));
    expect(r.allowed).toBe(true);
  });

  it("no identity at all → identity caps still bind, keyed on IP", async () => {
    const limiter = limiterAt(() => BASE);
    for (let i = 0; i < 6; i++) {
      const r = await limiter.checkSubmit(ctx({ sessionId: null, userId: null }));
      expect(r.allowed).toBe(true);
    }
    const denied = await limiter.checkSubmit(ctx({ sessionId: null, userId: null }));
    expect(denied.allowed).toBe(false); // hourly identity cap, not the 30/h IP cap
  });

  it("bucket keys are hashed — no raw session/user/IP in the table", async () => {
    const limiter = limiterAt(() => BASE);
    await limiter.checkSubmit(ctx({ userId: "user-PLAINTEXT", ip: "203.0.113.7" }));
    const rows = await db.select().from(authRateLimits);
    expect(rows.length).toBe(SUBMIT_CAPS.length);
    for (const row of rows) {
      expect(row.bucketKey).toMatch(/^lb-(identity|ip)-1[hd]:[0-9a-f]{64}$/);
      expect(row.bucketKey).not.toContain("PLAINTEXT");
      expect(row.bucketKey).not.toContain("203.0.113.7");
    }
  });
});

describe("fail-closed on store errors", () => {
  it("a throwing store denies with the fixed Retry-After instead of throwing", async () => {
    const broken = { execute: () => Promise.reject(new Error("neon down")) } as unknown as Db;
    const limiter = createDbSubmitRateLimiter({ db: broken, now: () => BASE, random: neverSweep });
    const decision = await limiter.checkSubmit(ctx());
    expect(decision).toEqual({
      allowed: false,
      retryAfterSeconds: STORE_ERROR_RETRY_AFTER_SECONDS,
    });
  });
});

describe("lazy sweep", () => {
  it("fires below the probability threshold and deletes only expired rows", async () => {
    // Seed an old row (beyond retention) and a recent one.
    const old = limiterAt(() => BASE - SWEEP_RETENTION_MS - HOUR);
    await old.checkSubmit(ctx({ sessionId: "ancient" }));
    const sweeping = limiterAt(
      () => BASE,
      () => SWEEP_PROBABILITY / 2,
    );
    const r = await sweeping.checkSubmit(ctx());
    expect(r.allowed).toBe(true);
    const rows = await db.select().from(authRateLimits);
    const cutoff = new Date(BASE - SWEEP_RETENTION_MS);
    expect(rows.length).toBe(SUBMIT_CAPS.length); // current attempt's rows only
    for (const row of rows) expect(row.windowStart >= cutoff).toBe(true);
  });

  it("does not fire at/above the threshold", async () => {
    const old = limiterAt(() => BASE - SWEEP_RETENTION_MS - HOUR);
    await old.checkSubmit(ctx({ sessionId: "ancient" }));
    const limiter = limiterAt(
      () => BASE,
      () => SWEEP_PROBABILITY,
    );
    await limiter.checkSubmit(ctx());
    const rows = await db.select().from(authRateLimits);
    expect(rows.length).toBe(2 * SUBMIT_CAPS.length); // ancient rows retained
  });

  it("a sweep failure never flips an allowed decision", async () => {
    let calls = 0;
    const flaky = {
      execute: (q: unknown) => {
        calls += 1;
        // Calls 1–3 are the cap checks; call 4 is the sweep DELETE.
        if (calls > SUBMIT_CAPS.length) return Promise.reject(new Error("sweep died"));
        return (db as unknown as { execute: (q: unknown) => Promise<unknown> }).execute(q);
      },
    } as unknown as Db;
    const limiter = createDbSubmitRateLimiter({ db: flaky, now: () => BASE, random: () => 0 });
    const decision = await limiter.checkSubmit(ctx());
    expect(decision).toEqual({ allowed: true });
    expect(calls).toBe(SUBMIT_CAPS.length + 1); // the sweep WAS attempted
  });
});
