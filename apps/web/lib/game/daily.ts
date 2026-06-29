import type { DraftFlow, EraPresetId, RatingBasis } from "@wcdraft/core";

export const DAILY_CHALLENGE_KIND = "daily" as const;
export const SEASON_CHALLENGE_KIND = "season" as const;

export type LeaderboardChallengeKind = typeof SEASON_CHALLENGE_KIND | typeof DAILY_CHALLENGE_KIND;

export interface DailyChallenge {
  readonly kind: typeof DAILY_CHALLENGE_KIND;
  readonly date: string;
  readonly seed: string;
}

export const DAILY_FORMATION_ID = "4-3-3" as const;

export const DAILY_DRAFT_CONFIG = Object.freeze({
  mode: "classic" as const,
  draftFlow: "squad_first" as const satisfies DraftFlow,
  eraPreset: "all_time" as const satisfies EraPresetId,
  ratingBasis: "career" as const satisfies RatingBasis,
  formationId: DAILY_FORMATION_ID,
  teamName: "Daily XI",
});

const DAILY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

export function utcDateString(ms = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isDailyChallengeDate(value: unknown): value is string {
  if (typeof value !== "string" || !DAILY_DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Daily seed derivation, versioned and intentionally boring:
 * `parent_seed = "wcdraft:daily:v1:" + UTC YYYY-MM-DD`.
 *
 * `createDraft` then derives its normal `draft` substream from this parent
 * seed, so the daily path keeps the same engine lineage while skipping the
 * per-device nonce used by ordinary first drafts.
 */
export function deriveDailySeed(date: string): string {
  if (!isDailyChallengeDate(date)) {
    throw new RangeError(`deriveDailySeed expected UTC date YYYY-MM-DD, got ${date}`);
  }
  return `wcdraft:daily:v1:${date}`;
}

export function dailyChallengeForDate(date: string): DailyChallenge {
  return {
    kind: DAILY_CHALLENGE_KIND,
    date,
    seed: deriveDailySeed(date),
  };
}

export function dailyDateFromSearchParams(
  params: URLSearchParams | { get: (key: string) => string | null } | null | undefined,
  nowMs = Date.now(),
): string {
  const requested = params?.get("date") ?? null;
  return isDailyChallengeDate(requested) ? requested : utcDateString(nowMs);
}

export function isCanonicalDailyConfig(config: {
  readonly mode: "classic" | "hidden";
  readonly formationId: string;
  readonly draftFlow: DraftFlow;
  readonly eraPreset: EraPresetId;
  readonly ratingBasis: RatingBasis;
}): boolean {
  return (
    config.mode === DAILY_DRAFT_CONFIG.mode &&
    config.formationId === DAILY_DRAFT_CONFIG.formationId &&
    config.draftFlow === DAILY_DRAFT_CONFIG.draftFlow &&
    config.eraPreset === DAILY_DRAFT_CONFIG.eraPreset &&
    config.ratingBasis === DAILY_DRAFT_CONFIG.ratingBasis
  );
}
