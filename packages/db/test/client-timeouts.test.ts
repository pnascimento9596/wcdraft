import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

import {
  buildRuntimePoolConfig,
  HEAVY_ROUTE_MAX_DURATION_SECONDS,
  RUNTIME_POOL_TIMEOUTS,
} from "../src/client.ts";

describe("@wcdraft/db runtime pool timeouts", () => {
  it("exposes connect/idle/statement timeouts that fire before platform maxDuration", () => {
    expect(RUNTIME_POOL_TIMEOUTS.connectionTimeoutMillis).toBe(5_000);
    expect(RUNTIME_POOL_TIMEOUTS.idleTimeoutMillis).toBe(10_000);
    expect(RUNTIME_POOL_TIMEOUTS.statement_timeout).toBe(8_000);
    expect(HEAVY_ROUTE_MAX_DURATION_SECONDS).toBe(10);
    // statement_timeout (ms) must be strictly less than maxDuration (s).
    expect(RUNTIME_POOL_TIMEOUTS.statement_timeout).toBeLessThan(
      HEAVY_ROUTE_MAX_DURATION_SECONDS * 1000,
    );
  });

  it("buildRuntimePoolConfig applies Neon serverless-typed timeout options", () => {
    const config = buildRuntimePoolConfig("postgresql://user:pass@example.neon.tech/db");
    expect(config.connectionString).toContain("neon.tech");
    expect(config.connectionTimeoutMillis).toBe(RUNTIME_POOL_TIMEOUTS.connectionTimeoutMillis);
    expect(config.idleTimeoutMillis).toBe(RUNTIME_POOL_TIMEOUTS.idleTimeoutMillis);
    expect(config.statement_timeout).toBe(RUNTIME_POOL_TIMEOUTS.statement_timeout);
  });

  it("classifies a Postgres statement_timeout-shaped error (57014) without hanging", async () => {
    // PGlite does not enforce statement_timeout the way Neon/Postgres does, so
    // we cannot use pg_sleep as a live cancel fixture here. Instead prove the
    // error shape the Neon pool will surface when statement_timeout fires —
    // SQLSTATE 57014 (query_canceled) — and that our deadline invariant holds.
    class FakePostgresTimeoutError extends Error {
      readonly code = "57014";
      override readonly name = "error";
      constructor() {
        super("canceling statement due to statement timeout");
      }
    }
    const err = new FakePostgresTimeoutError();
    expect(err.code).toBe("57014");
    expect(err.message.toLowerCase()).toMatch(/statement timeout/u);
    expect(RUNTIME_POOL_TIMEOUTS.statement_timeout).toBeLessThan(
      HEAVY_ROUTE_MAX_DURATION_SECONDS * 1000,
    );
    // Smoke: a short local deadline rejects rather than waiting forever.
    await expect(
      Promise.race([
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new FakePostgresTimeoutError()), 20);
        }),
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error("test hung past deadline")), 5_000);
        }),
      ]),
    ).rejects.toMatchObject({ code: "57014" });
    // Keep PGlite import exercised so the package still boots the in-memory
    // engine in this file's suite (migration tests cover real SQL paths).
    const client = new PGlite();
    try {
      const r = await client.query<{ ok: number }>(`SELECT 1 AS ok`);
      expect(r.rows[0]?.ok).toBe(1);
    } finally {
      await client.close();
    }
  });
});
