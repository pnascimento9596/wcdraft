import { describe, expect, it } from "vitest";

import {
  dailyChallengeForDate,
  dailySeedSaltForDate,
  deriveDailySeed,
  isDailySeedForDate,
} from "../daily";

const TEST_SALT_MAP = {
  salts: {
    "2026-07-04": 2,
  },
};

describe("daily seed derivation", () => {
  it("defaults absent dates to the unsalted v1 seed", () => {
    expect(deriveDailySeed("2026-07-03", TEST_SALT_MAP)).toBe("wcdraft:daily:v1:2026-07-03");
    expect(dailySeedSaltForDate("2026-07-03", TEST_SALT_MAP)).toBe(0);
  });

  it("resolves published salt suffixes transparently", () => {
    expect(dailySeedSaltForDate("2026-07-04", TEST_SALT_MAP)).toBe(2);
    expect(deriveDailySeed("2026-07-04", TEST_SALT_MAP)).toBe("wcdraft:daily:v1:2026-07-04#2");
    expect(dailyChallengeForDate("2026-07-04", TEST_SALT_MAP)).toEqual({
      kind: "daily",
      date: "2026-07-04",
      seed: "wcdraft:daily:v1:2026-07-04#2",
    });
  });

  it("rejects stale salted/unsalted mismatches when a map is provided", () => {
    expect(isDailySeedForDate("2026-07-04", "wcdraft:daily:v1:2026-07-04#2", TEST_SALT_MAP)).toBe(
      true,
    );
    expect(isDailySeedForDate("2026-07-04", "wcdraft:daily:v1:2026-07-04", TEST_SALT_MAP)).toBe(
      false,
    );
    expect(isDailySeedForDate("2026-07-03", "wcdraft:daily:v1:2026-07-03#2", TEST_SALT_MAP)).toBe(
      false,
    );
  });

  it("keeps same-date salted syntax loadable when no map is available", () => {
    expect(isDailySeedForDate("2026-07-04", "wcdraft:daily:v1:2026-07-04#2")).toBe(true);
    expect(isDailySeedForDate("2026-07-04", "wcdraft:daily:v1:2026-07-05#2")).toBe(false);
  });
});
