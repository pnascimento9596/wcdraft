import { describe, expect, it } from "vitest";
import type { DailySeedVettingMetrics } from "@wcdraft/data";

import {
  DailyUnavailableError,
  dailyChallengeForDate,
  dailyCoverageForDate,
  dailySeedSaltForDate,
  deriveDailySeed,
  isDailySeedForDate,
} from "../daily";

function dateEntry(date: string, salt: number): DailySeedVettingMetrics {
  return {
    date,
    salt,
    seed: `wcdraft:daily:v1:${date}${salt === 0 ? "" : `#${salt.toString()}`}`,
    sample_seed_prefix: `wcdraft:daily:v1:${date}:vet`,
    selected: true,
    degenerate: false,
    reason: "normal",
    runs: 1,
    perfect_runs: 0,
    perfect_rate: 0,
    qualifying_runs: 1,
    qualifying_rate: 1,
    mean: 1,
    median: 1,
    min: 1,
    max: 1,
    exact_seed_score: 1,
    exact_seed_qualified: true,
    exact_seed_perfect: false,
  };
}

const TEST_SALT_MAP = {
  window: { start_date: "2026-07-03", days: 2, timezone: "UTC" as const },
  population: { max_salt_attempts: 8 },
  salts: { "2026-07-04": 2 },
  dates: [dateEntry("2026-07-03", 0), dateEntry("2026-07-04", 2)],
};

describe("daily coverage and seed derivation", () => {
  it("covers both explicit window boundaries and rejects dates outside them", () => {
    expect(dailyCoverageForDate("2026-07-03", TEST_SALT_MAP)).toEqual({
      covered: true,
      salt: 0,
      seed: "wcdraft:daily:v1:2026-07-03",
    });
    expect(dailyCoverageForDate("2026-07-04", TEST_SALT_MAP)).toEqual({
      covered: true,
      salt: 2,
      seed: "wcdraft:daily:v1:2026-07-04#2",
    });
    expect(dailyCoverageForDate("2026-07-02", TEST_SALT_MAP)).toEqual({ covered: false });
    expect(dailyCoverageForDate("2026-07-05", TEST_SALT_MAP)).toEqual({ covered: false });
  });

  it("fails closed when the map is absent or its window/date inventory disagrees", () => {
    expect(dailyCoverageForDate("2026-07-03", undefined)).toEqual({ covered: false });
    expect(dailyCoverageForDate("2026-07-03", null)).toEqual({ covered: false });
    expect(
      dailyCoverageForDate("2026-07-03", {
        ...TEST_SALT_MAP,
        dates: [dateEntry("2026-07-03", 0)],
      }),
    ).toEqual({ covered: false });
    expect(
      dailyCoverageForDate("2026-07-03", {
        ...TEST_SALT_MAP,
        dates: [dateEntry("2026-07-03", 0), dateEntry("2026-07-05", 2)],
      }),
    ).toEqual({ covered: false });
  });

  it("fails closed when a date entry disagrees with its published salt or seed", () => {
    expect(
      dailyCoverageForDate("2026-07-04", {
        ...TEST_SALT_MAP,
        salts: {},
      }),
    ).toEqual({ covered: false });
    expect(
      dailyCoverageForDate("2026-07-04", {
        ...TEST_SALT_MAP,
        dates: [
          dateEntry("2026-07-03", 0),
          { ...dateEntry("2026-07-04", 2), seed: "wcdraft:daily:v1:2026-07-04" },
        ],
      }),
    ).toEqual({ covered: false });
  });

  it("derives only covered published seeds", () => {
    expect(dailySeedSaltForDate("2026-07-03", TEST_SALT_MAP)).toBe(0);
    expect(deriveDailySeed("2026-07-03", TEST_SALT_MAP)).toBe("wcdraft:daily:v1:2026-07-03");
    expect(dailySeedSaltForDate("2026-07-04", TEST_SALT_MAP)).toBe(2);
    expect(dailyChallengeForDate("2026-07-04", TEST_SALT_MAP)).toEqual({
      kind: "daily",
      date: "2026-07-04",
      seed: "wcdraft:daily:v1:2026-07-04#2",
    });
    expect(dailySeedSaltForDate("2026-07-05", TEST_SALT_MAP)).toBeNull();
    expect(() => deriveDailySeed("2026-07-05", TEST_SALT_MAP)).toThrow(DailyUnavailableError);
    expect(() => deriveDailySeed("2026-07-03")).toThrow(DailyUnavailableError);
  });

  it("requires the exact published seed when a map is provided", () => {
    expect(isDailySeedForDate("2026-07-04", "wcdraft:daily:v1:2026-07-04#2", TEST_SALT_MAP)).toBe(
      true,
    );
    expect(isDailySeedForDate("2026-07-04", "wcdraft:daily:v1:2026-07-04", TEST_SALT_MAP)).toBe(
      false,
    );
    expect(isDailySeedForDate("2026-07-03", "wcdraft:daily:v1:2026-07-03#2", TEST_SALT_MAP)).toBe(
      false,
    );
    expect(isDailySeedForDate("2026-07-05", "wcdraft:daily:v1:2026-07-05", TEST_SALT_MAP)).toBe(
      false,
    );
  });

  it("keeps only bounded builder-valid syntax for historical no-map records", () => {
    const base = "wcdraft:daily:v1:2026-07-04";
    expect(isDailySeedForDate("2026-07-04", base)).toBe(true);
    expect(isDailySeedForDate("2026-07-04", `${base}#2`)).toBe(true);
    expect(isDailySeedForDate("2026-07-04", `${base}#8`)).toBe(true);
    for (const suffix of ["#0", "#1", "#02", "#9", "#999", "#x", "#9007199254740992"]) {
      expect(isDailySeedForDate("2026-07-04", `${base}${suffix}`), suffix).toBe(false);
    }
    expect(isDailySeedForDate("2026-07-04", "wcdraft:daily:v1:2026-07-05#2")).toBe(false);
  });
});
