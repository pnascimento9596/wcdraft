// F-4 U3 — server-side data singletons for the leaderboard routes.
//
// Builds the SAME server-shaped inputs the U2 test harness prototyped
// (the harness now delegates here, so route and tests cannot drift): full
// `GameData` over the committed static bundles for the submit pipeline, plus
// the light current-season key for the read routes.
//
// This module reads the committed web runtime assets from
// `public/data/wcdraft/` — SERVER ONLY, never reachable from a client bundle
// (the client loads the same files via `@wcdraft/data/client` fetch — see
// lib/game/data.ts header). Do not import the top-level `@wcdraft/data`
// bundle exports here: Vercel's function tracer can omit package-side
// generated JSON files, while the web public assets are the deployed source of
// truth for the app.
// Import cost (bundle JSON parse) is paid once per serverless process; the
// heavier catalog/index build is lazy and memoized behind `getValidationData()`
// so read routes that only need the season key never pay it.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDraftCatalog, type DraftDataset } from "@wcdraft/core";
import type {
  DailySeedSaltMap,
  DraftPoolBundle,
  RuntimeDataManifest,
  Scenario2026Bundle,
} from "@wcdraft/data";

import {
  buildGameDataIndexes,
  composeVersions,
  type GameData,
  type RunRecordVersions,
} from "../game/data";
import { explicitSeasonKey } from "./season";
import type { ValidationData } from "./validate";

/** Build the `DraftDataset` consumed by `createDraft`/`buildDraftCatalog`. */
function buildDataset(draftPool: DraftPoolBundle): DraftDataset {
  const ratingByCardId = new Map(draftPool.ratings.map((r) => [r.card_id, r.overall]));
  return {
    players: draftPool.player_cards.map((c) => ({
      player_id: c.player_id,
      tournament_id: c.tournament_id,
      nation_id: c.nation_id,
      eligible_positions: c.eligible_positions,
      choice_overall: ratingByCardId.get(c.card_id) ?? null,
    })),
    managers: draftPool.manager_cards.map((m) => ({
      manager_id: m.manager_id,
      tournament_id: m.tournament_id,
      nation_id: m.nation_id,
    })),
    tournaments: Object.entries(draftPool.tournaments).map(([tid, t]) => ({
      tournament_id: Number(tid),
      year: t.year,
    })),
  };
}

const RUNTIME_DATA_DIR_CANDIDATES = [
  join(process.cwd(), "public", "data", "wcdraft"),
  join(process.cwd(), "apps", "web", "public", "data", "wcdraft"),
] as const;

function runtimeDataDir(): string {
  for (const dir of RUNTIME_DATA_DIR_CANDIDATES) {
    if (existsSync(join(dir, "manifest.json"))) return dir;
  }
  throw new Error(
    `leaderboard server data: public runtime data manifest not found in ${RUNTIME_DATA_DIR_CANDIDATES.join(
      " or ",
    )}`,
  );
}

function readRuntimeJson<T>(fileName: string): T {
  const filePath = join(runtimeDataDir(), fileName);
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

let cachedManifest: RuntimeDataManifest | null = null;
let cachedDraftPool: DraftPoolBundle | null = null;
let cachedScenario2026: Scenario2026Bundle | null = null;
let cachedDailySeedSaltMap: DailySeedSaltMap | null | undefined;

function serverManifest(): RuntimeDataManifest {
  cachedManifest ??= readRuntimeJson<RuntimeDataManifest>("manifest.json");
  return cachedManifest;
}

function serverDraftPool(): DraftPoolBundle {
  cachedDraftPool ??= readRuntimeJson<DraftPoolBundle>("draft-pool.compact.json");
  return cachedDraftPool;
}

function serverDailySeedSaltMap(): DailySeedSaltMap | null {
  if (cachedDailySeedSaltMap !== undefined) return cachedDailySeedSaltMap;
  cachedDailySeedSaltMap =
    serverManifest().bundles.daily_seed_salt_map === undefined
      ? null
      : readRuntimeJson<DailySeedSaltMap>("daily-seed-salt-map.compact.json");
  return cachedDailySeedSaltMap;
}

/**
 * Server-shaped `GameData` over the generated locked compact bundles. Mirrors the
 * e2e golden construction (`packages/data/test/e2e-real-run.golden.test.ts`)
 * field-for-field. Fresh build per call — production callers go through the
 * memoized `getValidationData()`.
 */
export function buildServerGameData(): GameData {
  const manifest = serverManifest();
  const draftPool = serverDraftPool();
  const versions: RunRecordVersions = composeVersions(manifest);
  const draftDataset = buildDataset(draftPool);
  return {
    manifest,
    draftPool,
    versions,
    indexes: buildGameDataIndexes(draftPool),
    draftDataset,
    catalog: buildDraftCatalog(draftDataset),
    nationByCardId: draftPool.nation_by_card_id,
    dailySeedSaltMap: serverDailySeedSaltMap(),
  };
}

/** The committed 2026 scenario bundle (teams + bracket). */
export function serverScenarioBundle(): Scenario2026Bundle {
  cachedScenario2026 ??= readRuntimeJson<Scenario2026Bundle>("scenario-2026.compact.json");
  return cachedScenario2026;
}

let cachedValidationData: ValidationData | null = null;

/**
 * Process-memoized `ValidationData` for `validateSubmission` — one catalog +
 * index build per serverless process (~150 ms cold, plan §0.1), then free.
 */
export function getValidationData(): ValidationData {
  cachedValidationData ??= {
    gameData: buildServerGameData(),
    scenario: serverScenarioBundle(),
    seasonKey: currentSeasonKey(),
  };
  return cachedValidationData;
}

let cachedSeasonKey: string | null = null;

/**
 * The CURRENT season key — explicit policy id, not a rating/runtime hash.
 */
export function currentSeasonKey(): string {
  cachedSeasonKey ??= explicitSeasonKey();
  return cachedSeasonKey;
}
