import type { DraftFlow, EraPresetId, RatingBasis } from "@wcdraft/core";
import type { DailySeedSaltMap } from "@wcdraft/data";
import { DAILY_SEED_MAX_SALT_ATTEMPTS } from "@wcdraft/data/client";

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
 * `parent_seed = "wcdraft:daily:v1:" + UTC YYYY-MM-DD`, with an optional
 * published `#N` suffix when the shipped salt map clips a degenerate day.
 *
 * `createDraft` then derives its normal `draft` substream from this parent
 * seed, so the daily path keeps the same engine lineage while skipping the
 * per-device nonce used by ordinary first drafts.
 */
type DailySeedSaltLookup = Pick<DailySeedSaltMap, "dates" | "salts" | "window"> & {
  readonly population: Pick<DailySeedSaltMap["population"], "max_salt_attempts">;
};

export type DailyCoverage =
  | { readonly covered: true; readonly salt: number; readonly seed: string }
  | { readonly covered: false };

const UNCOVERED_DAILY: DailyCoverage = Object.freeze({ covered: false });
const DAY_MS = 24 * 60 * 60 * 1000;

function baseDailySeed(date: string): string {
  return `wcdraft:daily:v1:${date}`;
}

function dailySeedWithSalt(date: string, salt: number): string {
  const base = baseDailySeed(date);
  return salt === 0 ? base : `${base}#${salt.toString()}`;
}

function isRuntimeRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Single publication authority for Daily availability. Coverage is valid only
 * when the artifact's UTC window, explicit contiguous date inventory, and
 * salt/seed metadata agree. Any missing or inconsistent piece fails closed.
 */
export function dailyCoverageForDate(
  date: string,
  saltMap?: DailySeedSaltLookup | null,
): DailyCoverage {
  const rawMap: unknown = saltMap;
  if (!isDailyChallengeDate(date) || !isRuntimeRecord(rawMap)) return UNCOVERED_DAILY;

  const window = rawMap.window;
  const dates = rawMap.dates;
  const salts = rawMap.salts;
  const population = rawMap.population;
  if (
    !isRuntimeRecord(window) ||
    !Array.isArray(dates) ||
    !isRuntimeRecord(salts) ||
    !isRuntimeRecord(population) ||
    window.timezone !== "UTC" ||
    !isDailyChallengeDate(window.start_date) ||
    typeof window.days !== "number" ||
    !Number.isSafeInteger(window.days) ||
    window.days <= 0 ||
    dates.length !== window.days ||
    typeof population.max_salt_attempts !== "number" ||
    !Number.isSafeInteger(population.max_salt_attempts) ||
    population.max_salt_attempts < 1
  ) {
    return UNCOVERED_DAILY;
  }

  const startMs = Date.parse(`${window.start_date}T00:00:00.000Z`);
  const endMs = startMs + (window.days - 1) * DAY_MS;
  if (!Number.isFinite(endMs) || Math.abs(endMs) > 8.64e15) return UNCOVERED_DAILY;
  const expectedDates = new Set<string>();
  let target: DailyCoverage = UNCOVERED_DAILY;
  for (let i = 0; i < dates.length; i += 1) {
    const entry = dates[i];
    if (!isRuntimeRecord(entry)) return UNCOVERED_DAILY;
    const expectedDate = new Date(startMs + i * DAY_MS).toISOString().slice(0, 10);
    if (entry.date !== expectedDate || entry.selected !== true) return UNCOVERED_DAILY;
    expectedDates.add(expectedDate);

    const publishedSalt = salts[expectedDate] ?? 0;
    if (
      typeof publishedSalt !== "number" ||
      !Number.isSafeInteger(publishedSalt) ||
      (publishedSalt !== 0 &&
        (publishedSalt < 2 || publishedSalt > population.max_salt_attempts)) ||
      entry.salt !== publishedSalt
    ) {
      return UNCOVERED_DAILY;
    }
    const expectedSeed = dailySeedWithSalt(expectedDate, publishedSalt);
    if (entry.seed !== expectedSeed) return UNCOVERED_DAILY;
    if (expectedDate === date) {
      target = { covered: true, salt: publishedSalt, seed: expectedSeed };
    }
  }

  for (const [saltDate, salt] of Object.entries(salts)) {
    if (
      !expectedDates.has(saltDate) ||
      typeof salt !== "number" ||
      !Number.isSafeInteger(salt) ||
      salt < 2 ||
      salt > population.max_salt_attempts
    ) {
      return UNCOVERED_DAILY;
    }
  }
  return target;
}

export function dailySeedSaltForDate(
  date: string,
  saltMap?: DailySeedSaltLookup | null,
): number | null {
  const coverage = dailyCoverageForDate(date, saltMap);
  return coverage.covered ? coverage.salt : null;
}

export class DailyUnavailableError extends Error {
  readonly date: string;

  constructor(date: string) {
    super(`Daily seed is unavailable for ${date}`);
    this.name = "DailyUnavailableError";
    this.date = date;
  }
}

export function deriveDailySeed(date: string, saltMap?: DailySeedSaltLookup | null): string {
  if (!isDailyChallengeDate(date)) {
    throw new RangeError(`deriveDailySeed expected UTC date YYYY-MM-DD, got ${date}`);
  }
  const coverage = dailyCoverageForDate(date, saltMap);
  if (!coverage.covered) throw new DailyUnavailableError(date);
  return coverage.seed;
}

export function isDailySeedForDate(
  date: string,
  seed: string,
  saltMap?: DailySeedSaltLookup | null,
): boolean {
  if (!isDailyChallengeDate(date)) return false;
  const coverage = dailyCoverageForDate(date, saltMap);
  if (coverage.covered) return seed === coverage.seed;
  if (saltMap !== undefined) return false;

  // Historical local records outlive the rolling publication artifact. Keep
  // only canonical daily-v1 builder syntax: unsalted, or the versioned
  // candidate suffix range 2..8. The bound is shared with the builder.
  const base = baseDailySeed(date);
  if (seed === base) return true;
  if (!seed.startsWith(base)) return false;
  const suffix = seed.slice(base.length);
  if (!/^#[1-9]\d*$/u.test(suffix)) return false;
  const salt = Number(suffix.slice(1));
  return Number.isSafeInteger(salt) && salt >= 2 && salt <= DAILY_SEED_MAX_SALT_ATTEMPTS;
}

export function dailyChallengeForDate(
  date: string,
  saltMap?: DailySeedSaltLookup | null,
): DailyChallenge {
  return {
    kind: DAILY_CHALLENGE_KIND,
    date,
    seed: deriveDailySeed(date, saltMap),
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
