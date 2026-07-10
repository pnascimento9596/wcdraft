import { describe, expect, it, vi } from "vitest";

import { DATA_MANIFEST_ANCHOR, handleHealthGet, type LatestMigrationRow } from "../readiness";
import { MIGRATION_JOURNAL_ENTRIES, SUPPORTED_MIGRATION_RANGE } from "../migration-contract";

const latest = MIGRATION_JOURNAL_ENTRIES[MIGRATION_JOURNAL_ENTRIES.length - 1]!;
const previous = MIGRATION_JOURNAL_ENTRIES[MIGRATION_JOURNAL_ENTRIES.length - 2]!;

function rowFor(entry: (typeof MIGRATION_JOURNAL_ENTRIES)[number]): LatestMigrationRow {
  return { id: entry.idx + 1, created_at: String(entry.when) };
}

describe("GET /api/health readiness contract", () => {
  it("reports an honest unconfigured DB without constructing a connection", async () => {
    const readLatestMigration = vi.fn<() => Promise<LatestMigrationRow | null>>();
    const response = await handleHealthGet({
      databaseUrl: " ",
      buildSha: undefined,
      readLatestMigration,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: true,
      build: { sha: null },
      data: DATA_MANIFEST_ANCHOR,
      db: { status: "unconfigured" },
      schema: { expected: SUPPORTED_MIGRATION_RANGE, actual: null },
    });
    expect(readLatestMigration).not.toHaveBeenCalled();
  });

  it("returns ready after exactly one latest-migration read at the supported schema", async () => {
    const readLatestMigration = vi.fn(async () => rowFor(latest));
    const response = await handleHealthGet({
      databaseUrl: "postgresql://configured.invalid/db",
      buildSha: "abcdef0123456789",
      readLatestMigration,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      build: { sha: "abcdef0123456789" },
      db: { status: "ready" },
      schema: {
        expected: SUPPORTED_MIGRATION_RANGE,
        actual: { id: latest.idx + 1, index: latest.idx, migration: latest.tag },
      },
    });
    expect(readLatestMigration).toHaveBeenCalledTimes(1);
  });

  it("fails readiness when the configured database is behind", async () => {
    const response = await handleHealthGet({
      databaseUrl: "postgresql://configured.invalid/db",
      buildSha: "abc",
      readLatestMigration: async () => rowFor(previous),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      db: { status: "schema_mismatch" },
      schema: { actual: { index: previous.idx, migration: previous.tag } },
    });
  });

  it("fails closed with a scrubbed body when the migration query errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await handleHealthGet({
        databaseUrl: "postgresql://configured.invalid/db",
        buildSha: "abc",
        readLatestMigration: async () => {
          throw new Error("postgresql://user:secret@example.invalid/private");
        },
      });

      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body).toMatchObject({ ok: false, db: { status: "error" } });
      expect(JSON.stringify(body)).not.toMatch(/user|secret|example\.invalid|private/u);
      expect(errorSpy).toHaveBeenCalledWith("[health] migration readiness query failed", "Error");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("publishes the six data anchors without loading a secret-bearing value", () => {
    expect(DATA_MANIFEST_ANCHOR).toEqual({
      schema_version: "runtime-data-2.9.0",
      dataset_version: "2026-07-01",
      engine_version: "engine-2026.06.30-manager-attrition",
      rating_version_historical: "wc-perf-6.6.0",
      rating_version_projected: "proj-career-5.6.0",
      ruleset_version: "ruleset-2026.06.04",
      draft_pool_sha256: "461601c64221289ccddabc97db426d54fbd4d39ef06bcd2a9bbdae129d2a487a",
    });
  });
});
