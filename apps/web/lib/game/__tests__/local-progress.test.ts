import { describe, expect, it } from "vitest";

import {
  PERFECT_RUN_REFERENCE_LABEL,
  buildLocalProgressSummary,
  dailyStreakFromDates,
  formatUtcCountdown,
  millisecondsUntilNextUtcMidnight,
} from "../local-progress";
import type { RunRecordV1 } from "../run-record";

function completedDaily(date: string, score: number, runId = date): RunRecordV1 {
  return {
    run_id: `run-${runId}`,
    challenge: { kind: "daily", date, seed: `wcdraft:daily:v1:${date}` },
    simulation: { run: { score } },
  } as unknown as RunRecordV1;
}

function completedClassic(score: number): RunRecordV1 {
  return {
    run_id: "classic-best",
    simulation: { run: { score } },
  } as unknown as RunRecordV1;
}

describe("dailyStreakFromDates", () => {
  it("counts a consecutive streak ending today", () => {
    expect(
      dailyStreakFromDates(new Set(["2026-06-27", "2026-06-28", "2026-06-29"]), "2026-06-29"),
    ).toBe(3);
  });

  it("keeps yesterday's streak alive before today's daily is completed", () => {
    expect(dailyStreakFromDates(new Set(["2026-06-27", "2026-06-28"]), "2026-06-29")).toBe(2);
  });

  it("breaks when a UTC day is missed", () => {
    expect(dailyStreakFromDates(new Set(["2026-06-26", "2026-06-27"]), "2026-06-29")).toBe(0);
  });
});

describe("buildLocalProgressSummary", () => {
  it("derives today's best from daily history and all-time best from every completed run", () => {
    const summary = buildLocalProgressSummary(
      [
        completedDaily("2026-06-28", 41),
        completedDaily("2026-06-29", 52, "today-a"),
        completedDaily("2026-06-29", 47, "today-b"),
        completedClassic(88),
      ],
      { targetDate: "2026-06-29" },
    );
    expect(summary.todayBest).toBe(52);
    expect(summary.allTimeBest).toBe(88);
    expect(summary.streakDays).toBe(2);
  });

  it("uses honest dashes via null values when no history exists", () => {
    const summary = buildLocalProgressSummary([], { targetDate: "2026-06-29" });
    expect(summary.todayBest).toBeNull();
    expect(summary.allTimeBest).toBeNull();
    expect(summary.streakDays).toBe(0);
  });
});

describe("UTC countdown helpers", () => {
  it("formats a countdown to UTC midnight as HH:MM:SS", () => {
    const now = Date.parse("2026-06-29T23:59:30.000Z");
    expect(formatUtcCountdown(millisecondsUntilNextUtcMidnight(now))).toBe("00:00:30");
  });

  it("exposes the current perfect-run reference", () => {
    expect(PERFECT_RUN_REFERENCE_LABEL).toBe("Perfect 1-0 run: 108 pts");
  });
});
