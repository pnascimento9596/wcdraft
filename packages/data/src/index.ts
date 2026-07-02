// Public surface of `@wcdraft/data`.
//
// Layers:
//   1. Runtime data CONTRACTS (types) — bridge between ETL output and
//      `@wcdraft/core` / `@wcdraft/web`.
//   2. The generated compact BUNDLES (read-only JSON in `src/generated/`,
//      locked by tracked manifest/report fingerprints), re-exported as typed values.
//
// Loaders for production code live in subpath entry points:
//   - `@wcdraft/data/client` — browser fetch-based loaders.
//   - `@wcdraft/data/node`   — file-system loaders (tests, scripts).
//
// The top-level barrel exports types + the generated locked bundles for tests,
// scripts, and server-only tooling. Browser code MUST use
// `@wcdraft/data/client`.

export * from "./types.js";
export * from "./validation.js";
export * from "./score-distribution.js";

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DailySeedSaltMap,
  DraftPoolBundle,
  Scenario2026Bundle,
  RuntimeDataManifest,
  ScoreDistribution,
} from "./types.js";
import {
  parseDailySeedSaltMap,
  parseDraftPoolBundle,
  parseRuntimeDataManifest,
  parseScenario2026Bundle,
  parseScoreDistribution,
} from "./validation.js";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const GENERATED_DIR_CANDIDATES = [
  join(MODULE_DIR, "generated"),
  join(MODULE_DIR, "..", "src", "generated"),
];

function readGeneratedJson<T>(fileName: string, parse: (value: unknown) => T): T {
  for (const dir of GENERATED_DIR_CANDIDATES) {
    const filePath = join(dir, fileName);
    if (existsSync(filePath)) return parse(JSON.parse(readFileSync(filePath, "utf8")));
  }
  throw new Error(
    `@wcdraft/data: generated runtime bundle ${fileName} was not found in ${GENERATED_DIR_CANDIDATES.join(" or ")}`,
  );
}

/**
 * Statically-imported draft pool. Use only in tests, scripts, and
 * server-rendered surfaces that want the full pool in-process. Web pages
 * MUST lazy-load via `@wcdraft/data/client`.
 */
export const DRAFT_POOL_BUNDLE = readGeneratedJson<DraftPoolBundle>(
  "draft-pool.compact.json",
  parseDraftPoolBundle,
);
export const SCENARIO_2026_BUNDLE = readGeneratedJson<Scenario2026Bundle>(
  "scenario-2026.compact.json",
  parseScenario2026Bundle,
);
export const RUNTIME_DATA_MANIFEST = readGeneratedJson<RuntimeDataManifest>(
  "manifest.json",
  parseRuntimeDataManifest,
);
function readGeneratedJsonOptional<T>(fileName: string, parse: (value: unknown) => T): T | null {
  for (const dir of GENERATED_DIR_CANDIDATES) {
    const filePath = join(dir, fileName);
    if (existsSync(filePath)) return parse(JSON.parse(readFileSync(filePath, "utf8")));
  }
  return null;
}

/**
 * Statically-imported reference score distribution (tests, scripts, server).
 * NULL only while the artifact is mid-regeneration (bootstrap: the generation
 * script's import chain passes through this module before the file exists).
 * The score-distribution golden asserts non-null, so a checkout that ships
 * without the artifact cannot pass CI.
 */
export const SCORE_DISTRIBUTION_BUNDLE: ScoreDistribution | null =
  readGeneratedJsonOptional<ScoreDistribution>(
    "score-distribution.compact.json",
    parseScoreDistribution,
  );

/**
 * Statically-imported Daily Draft salt map (tests, scripts, server). NULL only
 * for manifests/checkouts produced before the artifact existed.
 */
export const DAILY_SEED_SALT_MAP_BUNDLE: DailySeedSaltMap | null =
  readGeneratedJsonOptional<DailySeedSaltMap>(
    "daily-seed-salt-map.compact.json",
    parseDailySeedSaltMap,
  );
