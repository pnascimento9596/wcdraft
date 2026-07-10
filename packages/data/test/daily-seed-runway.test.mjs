import { describe, expect, it } from "vitest";

import {
  captureUtcDate,
  compareOverlappingSalts,
  decideRunway,
  evaluateRunwayAtCapture,
  planRefreshPullRequest,
  validateDailySeedArtifact,
  validateWorkflowBuilderInvocation,
} from "../scripts/daily-seed-runway.mjs";

const DAY_MS = 86_400_000;

function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function artifact({ start = "2026-07-01", days = 30, salts = {} } = {}) {
  return {
    window: { start_date: start, days, timezone: "UTC" },
    salts,
    dates: Array.from({ length: days }, (_, index) => {
      const date = addDays(start, index);
      return { date, salt: salts[date] ?? 0 };
    }),
  };
}

describe("daily seed runway policy", () => {
  it.each([
    [22, false, false],
    [21, true, false],
    [14, true, false],
    [13, true, true],
  ])("%i remaining days => refresh=%s fail=%s", (remainingDays, refreshRequired, failFreshness) => {
    expect(decideRunway(remainingDays)).toEqual({
      remainingDays,
      refreshRequired,
      failFreshness,
    });
  });

  it("counts inclusive coverage through the artifact end", () => {
    const result = evaluateRunwayAtCapture(artifact({ days: 30 }), () => "2026-07-10");
    expect(result.remainingDays).toBe(21);
  });

  it("captures the UTC boundary exactly once", () => {
    let calls = 0;
    const result = evaluateRunwayAtCapture(artifact({ start: "2026-07-02", days: 45 }), () => {
      calls += 1;
      return "2026-07-02";
    });
    expect(calls).toBe(1);
    expect(result.today).toBe("2026-07-02");
    expect(result.remainingDays).toBe(45);
    expect(captureUtcDate(new Date("2026-07-01T23:59:59.999Z"))).toBe("2026-07-01");
    expect(captureUtcDate(new Date("2026-07-02T00:00:00.000Z"))).toBe("2026-07-02");
  });
});

describe("daily seed artifact validation", () => {
  it.each([
    [
      "missing date",
      () => {
        const value = artifact({ days: 3 });
        value.dates.pop();
        return value;
      },
    ],
    [
      "duplicate date",
      () => {
        const value = artifact({ days: 3 });
        value.dates[1].date = value.dates[0].date;
        return value;
      },
    ],
    [
      "noncontiguous date",
      () => {
        const value = artifact({ days: 3 });
        value.dates[1].date = addDays(value.window.start_date, 2);
        return value;
      },
    ],
    ["malformed date", () => artifact({ start: "2026-02-30", days: 1 })],
  ])("fails closed for a %s artifact", (_label, makeArtifact) => {
    expect(() => validateDailySeedArtifact(makeArtifact())).toThrow(/daily seed runway/u);
  });
});

describe("overlap determinism", () => {
  it("passes when every overlapping effective salt is unchanged", () => {
    const committed = artifact({
      start: "2026-07-01",
      days: 4,
      salts: { "2026-07-03": 2 },
    });
    const generated = artifact({
      start: "2026-07-03",
      days: 4,
      salts: { "2026-07-03": 2 },
    });
    expect(compareOverlappingSalts(committed, generated)).toEqual({
      overlapDays: 2,
      mismatches: [],
      matches: true,
    });
  });

  it("fails when an implicit zero becomes an explicit non-zero salt", () => {
    const committed = artifact({ start: "2026-07-01", days: 3 });
    const generated = artifact({
      start: "2026-07-02",
      days: 3,
      salts: { "2026-07-02": 2 },
    });
    expect(compareOverlappingSalts(committed, generated)).toMatchObject({
      overlapDays: 2,
      matches: false,
      mismatches: [{ date: "2026-07-02", committedSalt: 0, generatedSalt: 2 }],
    });
  });
});

describe("refresh PR planning", () => {
  it("opens when no existing PR was found", () => {
    expect(planRefreshPullRequest("")).toEqual({ action: "open", prNumber: null });
  });

  it("updates the one existing PR", () => {
    expect(planRefreshPullRequest("123")).toEqual({ action: "update", prNumber: 123 });
  });

  it("fails closed instead of choosing between duplicate open PRs", () => {
    expect(() => planRefreshPullRequest("123,124")).toThrow(/positive integer/u);
  });

  it("forwards builder arguments without a literal pnpm separator", () => {
    const directInvocation = `pnpm --filter @wcdraft/data run build:daily-seed-salt-map \\
            --start-date "$CAPTURED_DATE" \\
            --window-days 45`;
    const separatedInvocation = `pnpm --filter @wcdraft/data run build:daily-seed-salt-map -- \\
            --start-date "$CAPTURED_DATE" \\
            --window-days 45`;
    expect(validateWorkflowBuilderInvocation(directInvocation)).toBe(true);
    expect(() => validateWorkflowBuilderInvocation(separatedInvocation)).toThrow(
      /literal -- argument/u,
    );
  });

  it("fails when the workflow drops the captured-date or 45-day arguments", () => {
    expect(() =>
      validateWorkflowBuilderInvocation(
        "pnpm --filter @wcdraft/data run build:daily-seed-salt-map",
      ),
    ).toThrow(/captured date and 45-day window/u);
  });
});
