import { DEFAULT_SCORING_CONFIG, type MatchRound } from "@wcdraft/core";

import { isDailyChallengeDate, utcDateString } from "./daily";
import type { RunRecordV1 } from "./run-record";

const PERFECT_RUN_ROUNDS: readonly MatchRound[] = ["G1", "G2", "G3", "R32", "R16", "QF", "SF", "F"];
const PERFECT_RUN_MATCHES = PERFECT_RUN_ROUNDS.length;

export const PERFECT_RUN_REFERENCE_SCORE =
  PERFECT_RUN_MATCHES * DEFAULT_SCORING_CONFIG.goal_points +
  PERFECT_RUN_MATCHES * DEFAULT_SCORING_CONFIG.goal_difference_weight +
  PERFECT_RUN_MATCHES * DEFAULT_SCORING_CONFIG.clean_sheet_bonus +
  PERFECT_RUN_ROUNDS.reduce(
    (sum, round) => sum + (DEFAULT_SCORING_CONFIG.round_progression_multipliers[round] ?? 0),
    0,
  ) +
  DEFAULT_SCORING_CONFIG.undefeated_bonus;

export const PERFECT_RUN_REFERENCE_LABEL =
  `Max score: ${PERFECT_RUN_REFERENCE_SCORE} — eight 1-0 wins, no bookings or missed pens` as const;

export interface LocalProgressSummary {
  readonly targetDate: string;
  readonly streakDays: number | null;
  readonly todayBest: number | null;
  readonly allTimeBest: number | null;
  readonly completedRunCount?: number;
  readonly todaySetPersonalBest?: boolean;
}

export function buildLocalProgressSummary(
  records: readonly RunRecordV1[],
  opts: { readonly targetDate?: string; readonly nowMs?: number } = {},
): LocalProgressSummary {
  const nowMs = opts.nowMs ?? Date.now();
  const targetDate = isDailyChallengeDate(opts.targetDate) ? opts.targetDate : utcDateString(nowMs);
  const completed = records.filter((record) => record.simulation !== undefined);
  const completedDailyDates = new Set<string>();
  let todayBest: number | null = null;
  let allTimeBest: number | null = null;
  let bestBeforeTargetDate: number | null = null;
  let completedRunCount = 0;

  for (const record of completed) {
    const score = record.simulation?.run.score;
    if (typeof score === "number" && Number.isFinite(score)) {
      completedRunCount += 1;
      allTimeBest = allTimeBest === null ? score : Math.max(allTimeBest, score);
      if (record.challenge?.kind === "daily" && record.challenge.date === targetDate) {
        todayBest = todayBest === null ? score : Math.max(todayBest, score);
      } else {
        bestBeforeTargetDate =
          bestBeforeTargetDate === null ? score : Math.max(bestBeforeTargetDate, score);
      }
    }
    if (record.challenge?.kind === "daily") {
      completedDailyDates.add(record.challenge.date);
    }
  }

  return {
    targetDate,
    streakDays: dailyStreakFromDates(completedDailyDates, targetDate),
    todayBest,
    allTimeBest,
    completedRunCount,
    todaySetPersonalBest:
      todayBest !== null &&
      completedRunCount > 1 &&
      (bestBeforeTargetDate === null || todayBest > bestBeforeTargetDate),
  };
}

export type DailySignInNudgeTrigger =
  | { readonly kind: "streak"; readonly storageKey: string }
  | { readonly kind: "personal-best"; readonly storageKey: string };

export function dailySignInNudgeTrigger(
  summary: LocalProgressSummary,
  opts: { readonly signedIn: boolean },
): DailySignInNudgeTrigger | null {
  if (opts.signedIn) return null;
  if (
    summary.todaySetPersonalBest === true &&
    summary.allTimeBest !== null &&
    (summary.completedRunCount ?? 0) > 1
  ) {
    return {
      kind: "personal-best",
      storageKey: `wcdraft.daily-signin-nudge.personal-best.${summary.allTimeBest.toString()}`,
    };
  }
  if (typeof summary.streakDays === "number" && summary.streakDays >= 2) {
    return {
      kind: "streak",
      storageKey: "wcdraft.daily-signin-nudge.streak-2-plus",
    };
  }
  return null;
}

export function dailyStreakFromDates(
  completedDates: ReadonlySet<string>,
  targetDate = utcDateString(),
): number {
  const normalizedTarget = isDailyChallengeDate(targetDate) ? targetDate : utcDateString();
  const endDate = completedDates.has(normalizedTarget)
    ? normalizedTarget
    : previousUtcDate(normalizedTarget);
  if (!completedDates.has(endDate)) return 0;

  let streak = 0;
  let cursor = endDate;
  while (completedDates.has(cursor)) {
    streak += 1;
    cursor = previousUtcDate(cursor);
  }
  return streak;
}

export function millisecondsUntilNextUtcMidnight(nowMs = Date.now()): number {
  const now = new Date(nowMs);
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(0, next - nowMs);
}

export function formatUtcCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

export function formatBestScore(value: number | null): string {
  return value === null ? "—" : String(value);
}

function previousUtcDate(date: string): string {
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return utcDateString();
  const d = new Date(ms);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}
