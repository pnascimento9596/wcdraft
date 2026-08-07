// Daily seed salt-map artifact golden.
//
// Locks the committed salt-map JSON to the current runtime-data anchors and
// proves a clean regeneration with the committed window start is byte-identical.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DAILY_SEED_SALT_MAP_BUNDLE, RUNTIME_DATA_MANIFEST } from "../src/index.js";
import type { DailySeedSaltMap } from "../src/types.js";
import {
  classifyDailySeedMetrics,
  dailySeedForSalt,
} from "../scripts/build-daily-seed-salt-map.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = join(HERE, "..");
const ARTIFACT_PATH = join(PACKAGE_DIR, "src", "generated", "daily-seed-salt-map.compact.json");
const OUT_FILE = "daily-seed-salt-map.compact.json";
const REGEN_TIMEOUT_MS = 600_000;
const EXPECTED_WINDOW_START = "2026-08-07";
const EXPECTED_WINDOW_DAYS = 45;
const EXPECTED_WINDOW_END = "2026-09-20";

function requireArtifact(): DailySeedSaltMap {
  expect(
    DAILY_SEED_SALT_MAP_BUNDLE,
    "daily-seed-salt-map.compact.json must be committed (run build:daily-seed-salt-map)",
  ).not.toBeNull();
  return DAILY_SEED_SALT_MAP_BUNDLE!;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function addUtcDays(date: string, days: number): string {
  const start = Date.parse(`${date}T00:00:00.000Z`);
  return new Date(start + days * 86_400_000).toISOString().slice(0, 10);
}

describe("daily seed salt-map artifact", () => {
  let tmpDir = "";
  let regenerated: Buffer;
  let committed: Buffer;

  beforeAll(() => {
    const artifact = requireArtifact();
    tmpDir = mkdtempSync(join(tmpdir(), "wcdraft-daily-salt-"));
    mkdirSync(tmpDir, { recursive: true });
    const result = spawnSync(
      "pnpm",
      [
        "--filter",
        "@wcdraft/data",
        "exec",
        "tsx",
        "scripts/build-daily-seed-salt-map.mts",
        "--out-dir",
        tmpDir,
        "--start-date",
        artifact.window.start_date,
        "--population",
        String(artifact.population.runs_per_candidate),
        "--max-salt-attempts",
        String(artifact.population.max_salt_attempts),
      ],
      {
        cwd: join(PACKAGE_DIR, "..", ".."),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: REGEN_TIMEOUT_MS,
      },
    );
    if (result.status !== 0) {
      throw new Error(
        `daily salt-map regen exited ${result.status}. stderr:\n${result.stderr}\nstdout:\n${result.stdout}`,
      );
    }
    committed = readFileSync(ARTIFACT_PATH);
    regenerated = readFileSync(join(tmpDir, OUT_FILE));
  }, REGEN_TIMEOUT_MS);

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("is anchored to the current manifest and source bundle hashes", () => {
    const saltMap = requireArtifact();
    expect(saltMap.anchors).toEqual({
      dataset_version: RUNTIME_DATA_MANIFEST.dataset_version,
      engine_version: RUNTIME_DATA_MANIFEST.engine_version,
      rating_version_historical: RUNTIME_DATA_MANIFEST.rating_version_historical,
      rating_version_projected: RUNTIME_DATA_MANIFEST.rating_version_projected,
      ruleset_version: RUNTIME_DATA_MANIFEST.ruleset_version,
      draft_pool_sha256: RUNTIME_DATA_MANIFEST.bundles.draft_pool.sha256,
      scenario_2026_sha256: RUNTIME_DATA_MANIFEST.bundles.scenario_2026.sha256,
    });
  });

  it("is fingerprinted by the manifest, matching the on-disk bytes", () => {
    const fingerprint = RUNTIME_DATA_MANIFEST.bundles.daily_seed_salt_map;
    expect(
      fingerprint,
      "manifest.bundles.daily_seed_salt_map must be stamped (run build:compact)",
    ).toBeDefined();
    expect(fingerprint!.path).toBe(OUT_FILE);
    expect(fingerprint!.bytes).toBe(committed.length);
    expect(fingerprint!.sha256).toBe(sha256(committed));
  });

  it("regenerates byte-identically for the committed rolling window", () => {
    expect(sha256(regenerated)).toBe(sha256(committed));
    expect(regenerated.toString("utf8")).toBe(committed.toString("utf8"));
  });

  it("publishes the intended 45-day UTC runway", () => {
    const saltMap = requireArtifact();
    expect(saltMap.window).toEqual({
      start_date: EXPECTED_WINDOW_START,
      days: EXPECTED_WINDOW_DAYS,
      timezone: "UTC",
    });
    expect(saltMap.dates[0]?.date).toBe(EXPECTED_WINDOW_START);
    expect(saltMap.dates.at(-1)?.date).toBe(EXPECTED_WINDOW_END);
  });

  it("lists exactly the contiguous dates advertised by the window", () => {
    const saltMap = requireArtifact();
    const advertisedDates = Array.from({ length: saltMap.window.days }, (_, offset) =>
      addUtcDays(saltMap.window.start_date, offset),
    );
    expect(saltMap.dates.map(({ date }) => date)).toEqual(advertisedDates);
  });

  it("publishes only non-zero salts and keeps absent dates as default-0", () => {
    const saltMap = requireArtifact();
    const datesBySalt = new Map(saltMap.dates.map((d) => [d.date, d.salt]));
    for (const [date, salt] of Object.entries(saltMap.salts)) {
      expect(salt).toBeGreaterThanOrEqual(2);
      expect(datesBySalt.get(date)).toBe(salt);
    }
    for (const date of datesBySalt.keys()) {
      if (saltMap.salts[date] === undefined) {
        expect(datesBySalt.get(date)).toBe(0);
      }
    }
  });

  it("derives transparent unsalted and salted seed strings", () => {
    expect(dailySeedForSalt("2026-07-02", 0)).toBe("wcdraft:daily:v1:2026-07-02");
    expect(dailySeedForSalt("2026-07-02", 2)).toBe("wcdraft:daily:v1:2026-07-02#2");
    expect(() => dailySeedForSalt("2026-07-02", 1)).toThrow(/0 or >=2/u);
  });
});

describe("daily seed degeneracy classifier", () => {
  it("clips known easy and cruel metric shapes while leaving normal variance untouched", () => {
    expect(
      classifyDailySeedMetrics({ perfectRate: 0.101, qualifyingRate: 0.6, median: 9 }),
    ).toEqual({ degenerate: true, reason: "easy_perfect" });
    expect(
      classifyDailySeedMetrics({ perfectRate: 0.01, qualifyingRate: 0.951, median: 20 }),
    ).toEqual({ degenerate: true, reason: "easy_qualifying" });
    expect(classifyDailySeedMetrics({ perfectRate: 0, qualifyingRate: 0.099, median: 0 })).toEqual({
      degenerate: true,
      reason: "cruel_qualifying",
    });
    expect(classifyDailySeedMetrics({ perfectRate: 0, qualifyingRate: 0.5, median: -8 })).toEqual({
      degenerate: true,
      reason: "cruel_median",
    });
    expect(
      classifyDailySeedMetrics({ perfectRate: 0.02, qualifyingRate: 0.66, median: 9 }),
    ).toEqual({ degenerate: false, reason: "normal" });
  });
});
