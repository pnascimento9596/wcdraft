// Builds the shipped Daily Draft seed salt map:
//   packages/data/src/generated/daily-seed-salt-map.compact.json
//
// Regen order:
//   1. pnpm --filter @wcdraft/data run build:compact
//   2. pnpm --filter @wcdraft/data run build:score-distribution
//   3. pnpm --filter @wcdraft/data run build:compact
//   4. pnpm --filter @wcdraft/data run build:daily-seed-salt-map
//   5. pnpm --filter @wcdraft/data run build:compact
//
// The salt-map artifact is deliberately small and committed. Runtime code only
// reads the map; it never runs reference simulations.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { RUNTIME_DATA_MANIFEST, SCORE_DISTRIBUTION_BUNDLE } from "../src/index.js";
import {
  DAILY_SEED_MAX_SALT_ATTEMPTS,
  DAILY_SEED_SALT_MAP_SCHEMA_VERSION,
  type DailySeedSaltMap,
  type DailySeedVettingBand,
  type DailySeedVettingMetrics,
} from "../src/types.js";
import {
  runRealismEnsembleForParentSeeds,
  summarizeScorePopulation,
} from "../test/realism/realism.harness.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = join(HERE, "..", "src", "generated");
const OUT_FILE = "daily-seed-salt-map.compact.json";

const POLICY = "greedyOverallAutoDraft" as const;
const WINDOW_DAYS = 45;
const RUNS_PER_CANDIDATE = 128;
const SAMPLE_SUFFIX = "vet";

export const DEFAULT_DAILY_SEED_VETTING_BAND: DailySeedVettingBand = {
  easy_perfect_rate_gte: 0.1,
  easy_qualifying_rate_gte: 0.95,
  cruel_qualifying_rate_lte: 0.1,
  cruel_median_score_lte: SCORE_DISTRIBUTION_BUNDLE?.quantiles[10] ?? -8,
  cruel_median_source: "score-distribution.q10",
};

export interface DailySeedSaltMapBuildArgs {
  outDir: string;
  startDate: string;
  windowDays: number;
  runsPerCandidate: number;
  maxSaltAttempts: number;
}

interface ClassifiedMetrics {
  degenerate: boolean;
  reason: DailySeedVettingMetrics["reason"];
}

function usage(): string {
  return [
    "usage: build-daily-seed-salt-map [--out-dir DIR] [--start-date YYYY-MM-DD]",
    "                                 [--window-days N] [--population N]",
    "                                 [--max-salt-attempts N]",
  ].join("\n");
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function isUtcDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parsePositiveInteger(raw: string, label: string): number {
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error(`${label} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return n;
}

function parseArgs(argv: readonly string[]): DailySeedSaltMapBuildArgs {
  const out: DailySeedSaltMapBuildArgs = {
    outDir: DEFAULT_OUT_DIR,
    startDate: process.env.WCDRAFT_DAILY_SEED_START_DATE ?? utcToday(),
    windowDays: Number(process.env.WCDRAFT_DAILY_SEED_WINDOW_DAYS ?? WINDOW_DAYS),
    runsPerCandidate: Number(process.env.WCDRAFT_DAILY_SEED_POPULATION ?? RUNS_PER_CANDIDATE),
    maxSaltAttempts: Number(
      process.env.WCDRAFT_DAILY_SEED_MAX_SALT_ATTEMPTS ?? DAILY_SEED_MAX_SALT_ATTEMPTS,
    ),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = argv[i + 1];
    if (arg === "--out-dir" && typeof next === "string") {
      out.outDir = resolve(next);
      i += 1;
    } else if (arg === "--start-date" && typeof next === "string") {
      out.startDate = next;
      i += 1;
    } else if (arg === "--window-days" && typeof next === "string") {
      out.windowDays = parsePositiveInteger(next, "window-days");
      i += 1;
    } else if (arg === "--population" && typeof next === "string") {
      out.runsPerCandidate = parsePositiveInteger(next, "population");
      i += 1;
    } else if (arg === "--max-salt-attempts" && typeof next === "string") {
      out.maxSaltAttempts = parsePositiveInteger(next, "max-salt-attempts");
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    } else {
      throw new Error(`unrecognised argument: ${arg}\n${usage()}`);
    }
  }
  if (!isUtcDate(out.startDate)) {
    throw new Error(`start-date must be a valid UTC YYYY-MM-DD date, got ${out.startDate}`);
  }
  for (const [label, value] of [
    ["window-days", out.windowDays],
    ["population", out.runsPerCandidate],
    ["max-salt-attempts", out.maxSaltAttempts],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${label} must be a positive integer, got ${value}`);
    }
  }
  return out;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, sortReplacer, 2) + "\n";
}

function sortReplacer(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(value).sort()) {
    sorted[k] = (value as Record<string, unknown>)[k];
  }
  return sorted;
}

function addUtcDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00.000Z`);
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

export function dailySeedForSalt(date: string, salt: number): string {
  if (!isUtcDate(date)) throw new Error(`dailySeedForSalt expected UTC date, got ${date}`);
  if (!Number.isSafeInteger(salt) || salt < 0 || salt === 1) {
    throw new Error(`daily salt must be 0 or >=2, got ${salt}`);
  }
  const base = `wcdraft:daily:v1:${date}`;
  return salt === 0 ? base : `${base}#${salt}`;
}

function sampleSeeds(seed: string, n: number): string[] {
  return Array.from(
    { length: n },
    (_, i) => `${seed}:${SAMPLE_SUFFIX}:${String(i).padStart(4, "0")}`,
  );
}

export function classifyDailySeedMetrics(args: {
  perfectRate: number;
  qualifyingRate: number;
  median: number;
  band?: DailySeedVettingBand;
}): ClassifiedMetrics {
  const band = args.band ?? DEFAULT_DAILY_SEED_VETTING_BAND;
  if (args.perfectRate >= band.easy_perfect_rate_gte) {
    return { degenerate: true, reason: "easy_perfect" };
  }
  if (args.qualifyingRate >= band.easy_qualifying_rate_gte) {
    return { degenerate: true, reason: "easy_qualifying" };
  }
  if (args.qualifyingRate <= band.cruel_qualifying_rate_lte) {
    return { degenerate: true, reason: "cruel_qualifying" };
  }
  if (args.median <= band.cruel_median_score_lte) {
    return { degenerate: true, reason: "cruel_median" };
  }
  return { degenerate: false, reason: "normal" };
}

function roundRate(n: number): number {
  return Number(n.toFixed(6));
}

function severity(metrics: DailySeedVettingMetrics, band: DailySeedVettingBand): number {
  if (!metrics.degenerate) return 0;
  switch (metrics.reason) {
    case "easy_perfect":
      return metrics.perfect_rate / band.easy_perfect_rate_gte;
    case "easy_qualifying":
      return metrics.qualifying_rate / band.easy_qualifying_rate_gte;
    case "cruel_qualifying":
      return (
        (band.cruel_qualifying_rate_lte - metrics.qualifying_rate) / band.cruel_qualifying_rate_lte
      );
    case "cruel_median":
      return band.cruel_median_score_lte - metrics.median + 1;
    case "normal":
      return 0;
  }
}

function measureCandidate(
  date: string,
  salt: number,
  runsPerCandidate: number,
  band: DailySeedVettingBand,
): DailySeedVettingMetrics {
  const seed = dailySeedForSalt(date, salt);
  const sampled = runRealismEnsembleForParentSeeds(POLICY, sampleSeeds(seed, runsPerCandidate));
  const exact = runRealismEnsembleForParentSeeds(POLICY, [seed]).measurement;
  const summary = summarizeScorePopulation(sampled.measurement);
  const perfectRate = sampled.measurement.perfectRuns / summary.runs;
  const qualifyingRate = summary.qualifyingRuns / summary.runs;
  const classified = classifyDailySeedMetrics({
    perfectRate,
    qualifyingRate,
    median: summary.median,
    band,
  });
  const exactScore = exact.scores[0]!;
  return {
    date,
    salt,
    seed,
    sample_seed_prefix: `${seed}:${SAMPLE_SUFFIX}`,
    selected: false,
    degenerate: classified.degenerate,
    reason: classified.reason,
    runs: summary.runs,
    perfect_runs: sampled.measurement.perfectRuns,
    perfect_rate: roundRate(perfectRate),
    qualifying_runs: summary.qualifyingRuns,
    qualifying_rate: roundRate(qualifyingRate),
    mean: roundRate(summary.mean),
    median: summary.median,
    min: summary.min,
    max: summary.max,
    exact_seed_score: exactScore,
    exact_seed_qualified: exact.qualifyingRuns === 1,
    exact_seed_perfect: exact.perfectRuns === 1,
  };
}

function selectCandidate(
  date: string,
  runsPerCandidate: number,
  maxSaltAttempts: number,
  band: DailySeedVettingBand,
): DailySeedVettingMetrics {
  const measured: DailySeedVettingMetrics[] = [];
  for (let attempt = 0; attempt < maxSaltAttempts; attempt += 1) {
    const salt = attempt === 0 ? 0 : attempt + 1;
    const metrics = measureCandidate(date, salt, runsPerCandidate, band);
    measured.push(metrics);
    if (!metrics.degenerate) {
      return { ...metrics, selected: true };
    }
  }
  let best = measured[0]!;
  for (const candidate of measured.slice(1)) {
    if (severity(candidate, band) < severity(best, band)) best = candidate;
  }
  return { ...best, selected: true };
}

export function buildDailySeedSaltMap(args: DailySeedSaltMapBuildArgs): DailySeedSaltMap {
  if (SCORE_DISTRIBUTION_BUNDLE === null) {
    throw new Error("score-distribution.compact.json must exist before daily seed vetting");
  }
  const band: DailySeedVettingBand = {
    ...DEFAULT_DAILY_SEED_VETTING_BAND,
    cruel_median_score_lte: SCORE_DISTRIBUTION_BUNDLE.quantiles[10]!,
  };
  const dates: DailySeedVettingMetrics[] = [];
  const salts: Record<string, number> = {};

  for (let offset = 0; offset < args.windowDays; offset += 1) {
    const date = addUtcDays(args.startDate, offset);
    const selected = selectCandidate(date, args.runsPerCandidate, args.maxSaltAttempts, band);
    dates.push(selected);
    if (selected.salt !== 0) salts[date] = selected.salt;
  }

  return {
    schema_version: DAILY_SEED_SALT_MAP_SCHEMA_VERSION,
    _doc: "Daily Draft seed salt map. Dates absent from salts resolve to the unsalted base seed. Non-zero salt N resolves to wcdraft:daily:v1:<date>#N. Generated deterministically by build-daily-seed-salt-map.mts; runtime code only reads this artifact and never simulates.",
    anchors: {
      dataset_version: RUNTIME_DATA_MANIFEST.dataset_version,
      engine_version: RUNTIME_DATA_MANIFEST.engine_version,
      rating_version_historical: RUNTIME_DATA_MANIFEST.rating_version_historical,
      rating_version_projected: RUNTIME_DATA_MANIFEST.rating_version_projected,
      ruleset_version: RUNTIME_DATA_MANIFEST.ruleset_version,
      draft_pool_sha256: RUNTIME_DATA_MANIFEST.bundles.draft_pool.sha256,
      scenario_2026_sha256: RUNTIME_DATA_MANIFEST.bundles.scenario_2026.sha256,
    },
    window: {
      start_date: args.startDate,
      days: args.windowDays,
      timezone: "UTC",
    },
    policy: POLICY,
    population: {
      runs_per_candidate: args.runsPerCandidate,
      max_salt_attempts: args.maxSaltAttempts,
      sample_seed_suffix: `:${SAMPLE_SUFFIX}:0000..`,
    },
    degeneracy_band: band,
    salts,
    dates,
  };
}

export function buildAndWriteDailySeedSaltMap(args: DailySeedSaltMapBuildArgs): DailySeedSaltMap {
  const artifact = buildDailySeedSaltMap(args);
  const outPath = join(args.outDir, OUT_FILE);
  mkdirSync(args.outDir, { recursive: true });
  writeFileSync(outPath, stableStringify(artifact), "utf-8");
  return artifact;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const t0 = performance.now();
  try {
    const args = parseArgs(process.argv.slice(2));
    const artifact = buildAndWriteDailySeedSaltMap(args);
    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    const salted = Object.entries(artifact.salts)
      .map(([date, salt]) => `${date}#${salt}`)
      .join(", ");
    process.stdout.write(
      `[DAILY-SEED] wrote ${join(args.outDir, OUT_FILE)} ` +
        `(window=${artifact.window.start_date}+${artifact.window.days - 1}d ` +
        `N=${artifact.population.runs_per_candidate} policy=${artifact.policy} ` +
        `salted=${salted || "none"}) in ${elapsed}s\n`,
    );
  } catch (err) {
    process.stderr.write(
      `build-daily-seed-salt-map: FATAL - ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}
