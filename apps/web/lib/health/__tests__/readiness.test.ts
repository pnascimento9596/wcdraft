import { describe, expect, it, vi } from "vitest";

import { DATA_MANIFEST_ANCHOR, handleHealthGet, type LatestMigrationRow } from "../readiness";
import { MIGRATION_JOURNAL_ENTRIES, SUPPORTED_MIGRATION_RANGE } from "../migration-contract";
import { DEFAULT_LEADERBOARD_SEASON_ID } from "../../leaderboard/season";

const latest = MIGRATION_JOURNAL_ENTRIES[MIGRATION_JOURNAL_ENTRIES.length - 1]!;
const previous = MIGRATION_JOURNAL_ENTRIES[MIGRATION_JOURNAL_ENTRIES.length - 2]!;

/** 32-byte secret as base64url (matches validateCookieSecret gate). */
const STRONG_SECRET = Buffer.alloc(32, 7).toString("base64url");

function rowFor(entry: (typeof MIGRATION_JOURNAL_ENTRIES)[number]): LatestMigrationRow {
  return { id: entry.idx + 1, created_at: String(entry.when) };
}

describe("GET /api/health readiness contract", () => {
  it("reports an honest unconfigured DB without constructing a connection", async () => {
    const readLatestMigration = vi.fn<() => Promise<LatestMigrationRow | null>>();
    const probeAuthBootstrap = vi.fn(async () => undefined);
    const response = await handleHealthGet({
      databaseUrl: " ",
      authCookieSecret: undefined,
      buildSha: undefined,
      readLatestMigration,
      probeAuthBootstrap,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: true,
      build: { sha: null },
      data: DATA_MANIFEST_ANCHOR,
      leaderboard: { season_key: DEFAULT_LEADERBOARD_SEASON_ID },
      db: { status: "unconfigured" },
      auth: { status: "unconfigured" },
      schema: { expected: SUPPORTED_MIGRATION_RANGE, actual: null },
    });
    expect(readLatestMigration).not.toHaveBeenCalled();
    expect(probeAuthBootstrap).not.toHaveBeenCalled();
  });

  it("returns ready after exactly one latest-migration read at the supported schema", async () => {
    const readLatestMigration = vi.fn(async () => rowFor(latest));
    const probeAuthBootstrap = vi.fn(async () => undefined);
    const response = await handleHealthGet({
      databaseUrl: "postgresql://configured.invalid/db",
      authCookieSecret: STRONG_SECRET,
      buildSha: "abcdef0123456789",
      readLatestMigration,
      probeAuthBootstrap,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      build: { sha: "abcdef0123456789" },
      leaderboard: { season_key: DEFAULT_LEADERBOARD_SEASON_ID },
      db: { status: "ready" },
      auth: { status: "ready" },
      schema: {
        expected: SUPPORTED_MIGRATION_RANGE,
        actual: { id: latest.idx + 1, index: latest.idx, migration: latest.tag },
      },
    });
    expect(readLatestMigration).toHaveBeenCalledTimes(1);
    expect(probeAuthBootstrap).toHaveBeenCalledTimes(1);
  });

  it("fails readiness when the configured database is behind", async () => {
    const response = await handleHealthGet({
      databaseUrl: "postgresql://configured.invalid/db",
      authCookieSecret: STRONG_SECRET,
      buildSha: "abc",
      readLatestMigration: async () => rowFor(previous),
      probeAuthBootstrap: async () => undefined,
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      db: { status: "schema_mismatch" },
      auth: { status: "ready" },
      schema: { actual: { index: previous.idx, migration: previous.tag } },
    });
  });

  it("fails closed with a scrubbed body when the migration query errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await handleHealthGet({
        databaseUrl: "postgresql://configured.invalid/db",
        authCookieSecret: STRONG_SECRET,
        buildSha: "abc",
        readLatestMigration: async () => {
          throw new Error("postgresql://user:secret@example.invalid/private");
        },
        probeAuthBootstrap: async () => undefined,
      });

      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body).toMatchObject({
        ok: false,
        db: { status: "error" },
        auth: { status: "ready" },
      });
      expect(JSON.stringify(body)).not.toMatch(/user|secret|example\.invalid|private/u);
      expect(errorSpy).toHaveBeenCalledWith("[health] migration readiness query failed", "Error");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("publishes the six data anchors without loading a secret-bearing value", () => {
    expect(DATA_MANIFEST_ANCHOR).toEqual({
      schema_version: "runtime-data-2.11.0",
      dataset_version: "2026-07-01",
      engine_version: "engine-2026.07.18-basis-aware-tiering",
      rating_version_historical: "wc-perf-6.6.0",
      rating_version_projected: "proj-career-5.6.0",
      ruleset_version: "ruleset-2026.06.04",
      draft_pool_sha256: "67d9e89f067b551c7be1e8c754fee5944d89450f94c0b9712bf27c3c5ac15552",
    });
  });

  it("reports auth unconfigured when cookie secret is missing but DB is configured", async () => {
    const probeAuthBootstrap = vi.fn(async () => undefined);
    const response = await handleHealthGet({
      databaseUrl: "postgresql://configured.invalid/db",
      authCookieSecret: "   ",
      buildSha: "abc",
      readLatestMigration: async () => rowFor(latest),
      probeAuthBootstrap,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      db: { status: "ready" },
      auth: { status: "unconfigured" },
    });
    expect(probeAuthBootstrap).not.toHaveBeenCalled();
  });

  it("goes non-green when the auth bootstrap dependency probe throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await handleHealthGet({
        databaseUrl: "postgresql://configured.invalid/db",
        authCookieSecret: STRONG_SECRET,
        buildSha: "abc",
        readLatestMigration: async () => rowFor(latest),
        probeAuthBootstrap: async () => {
          throw new Error("simulated bootstrap dependency failure");
        },
      });

      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body).toMatchObject({
        ok: false,
        db: { status: "ready" },
        auth: { status: "error" },
      });
      expect(JSON.stringify(body)).not.toMatch(/bootstrap dependency failure/u);
      expect(errorSpy).toHaveBeenCalledWith("[health] auth bootstrap probe failed", "Error");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("degrades auth (non-green) when the bootstrap probe times out", async () => {
    const response = await handleHealthGet({
      databaseUrl: "postgresql://configured.invalid/db",
      authCookieSecret: STRONG_SECRET,
      buildSha: "abc",
      readLatestMigration: async () => rowFor(latest),
      authProbeTimeoutMs: 20,
      probeAuthBootstrap: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      },
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      db: { status: "ready" },
      auth: { status: "degraded" },
    });
  });

  it("reports auth error for a weak non-empty cookie secret without probing", async () => {
    const probeAuthBootstrap = vi.fn(async () => undefined);
    const response = await handleHealthGet({
      databaseUrl: "postgresql://configured.invalid/db",
      authCookieSecret: "too-short",
      buildSha: "abc",
      readLatestMigration: async () => rowFor(latest),
      probeAuthBootstrap,
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      db: { status: "ready" },
      auth: { status: "error" },
    });
    expect(probeAuthBootstrap).not.toHaveBeenCalled();
  });
});
