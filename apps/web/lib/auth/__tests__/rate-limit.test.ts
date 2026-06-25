// F-2 — DB-backed rate-limit (pglite).
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { setupTestDb } from "./_test-db";
import { consumeRateLimit, sweepOldRateLimits } from "@/lib/auth/rate-limit";

let env: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  env = await setupTestDb();
});
afterEach(async () => {
  await env.reset();
});

const HOUR = 60 * 60 * 1000;

describe("consumeRateLimit", () => {
  it("allows up to maxCount within a single window", async () => {
    const now = Date.UTC(2026, 5, 1);
    for (let i = 1; i <= 3; i++) {
      const r = await consumeRateLimit(
        { bucket: { kind: "email", value: "u@example.com" }, windowMs: HOUR, maxCount: 3 },
        { db: env.db, now: () => now },
      );
      expect(r.allowed).toBe(true);
      expect(r.count).toBe(i);
    }
  });

  it("rejects once count exceeds maxCount", async () => {
    const now = Date.UTC(2026, 5, 1);
    for (let i = 1; i <= 3; i++) {
      await consumeRateLimit(
        { bucket: { kind: "email", value: "u@example.com" }, windowMs: HOUR, maxCount: 3 },
        { db: env.db, now: () => now },
      );
    }
    const r = await consumeRateLimit(
      { bucket: { kind: "email", value: "u@example.com" }, windowMs: HOUR, maxCount: 3 },
      { db: env.db, now: () => now },
    );
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("buckets per kind+value: email != ip", async () => {
    const now = Date.UTC(2026, 5, 1);
    for (let i = 0; i < 3; i++) {
      await consumeRateLimit(
        { bucket: { kind: "email", value: "u@example.com" }, windowMs: HOUR, maxCount: 3 },
        { db: env.db, now: () => now },
      );
    }
    // Same plaintext, different KIND → separate bucket; allowed.
    const r = await consumeRateLimit(
      { bucket: { kind: "ip", value: "u@example.com" }, windowMs: HOUR, maxCount: 3 },
      { db: env.db, now: () => now },
    );
    expect(r.allowed).toBe(true);
    expect(r.count).toBe(1);
  });

  it("resets across windows", async () => {
    const start = Date.UTC(2026, 5, 1);
    for (let i = 0; i < 3; i++) {
      await consumeRateLimit(
        { bucket: { kind: "email", value: "x@example.com" }, windowMs: HOUR, maxCount: 3 },
        { db: env.db, now: () => start },
      );
    }
    const next = await consumeRateLimit(
      { bucket: { kind: "email", value: "x@example.com" }, windowMs: HOUR, maxCount: 3 },
      { db: env.db, now: () => start + HOUR },
    );
    expect(next.allowed).toBe(true);
    expect(next.count).toBe(1);
  });

  it("plaintext is never persisted — bucket_key is sha256-hashed", async () => {
    const now = Date.UTC(2026, 5, 1);
    await consumeRateLimit(
      {
        bucket: { kind: "email", value: "secret-address@example.com" },
        windowMs: HOUR,
        maxCount: 3,
      },
      { db: env.db, now: () => now },
    );
    const r = await env.db.execute(`SELECT bucket_key FROM auth_rate_limits`);
    const keys = (r as unknown as { rows: { bucket_key: string }[] }).rows.map((x) => x.bucket_key);
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain("secret-address");
    expect(keys[0]).toMatch(/^email:[0-9a-f]{64}$/);
  });

  it("sweepOldRateLimits deletes rows beyond retention", async () => {
    const start = Date.UTC(2026, 5, 1);
    await consumeRateLimit(
      { bucket: { kind: "email", value: "old@example.com" }, windowMs: HOUR, maxCount: 3 },
      { db: env.db, now: () => start },
    );
    const deleted = await sweepOldRateLimits(HOUR / 2, {
      db: env.db,
      now: () => start + HOUR,
    });
    expect(deleted).toBe(1);
  });
});
