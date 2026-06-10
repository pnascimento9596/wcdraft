// F-4 U3 — server-side data singletons for the leaderboard routes.
//
// Builds the SAME server-shaped inputs the U2 test harness prototyped
// (the harness now delegates here, so route and tests cannot drift): full
// `GameData` over the committed static bundles for the submit pipeline, plus
// the light current-season key for the read routes.
//
// This module imports the top-level `@wcdraft/data` static-JSON exports —
// SERVER ONLY, never reachable from a client bundle (the client loads
// bundles via `@wcdraft/data/client` fetch — see lib/game/data.ts header).
// Import cost (bundle JSON parse) is paid once per serverless process;
// the heavier catalog/index build is lazy and memoized behind
// `getValidationData()` so read routes that only need the season key never
// pay it.

import { buildDraftCatalog, type DraftDataset } from "@wcdraft/core";
import {
  DRAFT_POOL_BUNDLE,
  RUNTIME_DATA_MANIFEST,
  SCENARIO_2026_BUNDLE,
  type RuntimeDataManifest,
  type Scenario2026Bundle,
} from "@wcdraft/data";

import {
  buildGameDataIndexes,
  composeVersions,
  type GameData,
  type RunRecordVersions,
} from "../game/data";
import { deriveSeasonKey } from "./season";
import type { ValidationData } from "./validate";

/** Build the `DraftDataset` consumed by `createDraft`/`buildDraftCatalog`. */
function buildDataset(): DraftDataset {
  return {
    players: DRAFT_POOL_BUNDLE.player_cards.map((c) => ({
      player_id: c.player_id,
      tournament_id: c.tournament_id,
      nation_id: c.nation_id,
      eligible_positions: c.eligible_positions,
    })),
    managers: DRAFT_POOL_BUNDLE.manager_cards.map((m) => ({
      manager_id: m.manager_id,
      tournament_id: m.tournament_id,
      nation_id: m.nation_id,
    })),
    tournaments: Object.entries(DRAFT_POOL_BUNDLE.tournaments).map(([tid, t]) => ({
      tournament_id: Number(tid),
      year: t.year,
    })),
  };
}

/**
 * Server-shaped `GameData` over the committed compact bundles. Mirrors the
 * e2e golden construction (`packages/data/test/e2e-real-run.golden.test.ts`)
 * field-for-field. Fresh build per call — production callers go through the
 * memoized `getValidationData()`.
 */
export function buildServerGameData(): GameData {
  const manifest = RUNTIME_DATA_MANIFEST as RuntimeDataManifest;
  const versions: RunRecordVersions = composeVersions(manifest);
  const draftDataset = buildDataset();
  return {
    manifest,
    draftPool: DRAFT_POOL_BUNDLE,
    versions,
    indexes: buildGameDataIndexes(DRAFT_POOL_BUNDLE),
    draftDataset,
    catalog: buildDraftCatalog(draftDataset),
    nationByCardId: DRAFT_POOL_BUNDLE.nation_by_card_id,
  };
}

/** The committed 2026 scenario bundle (teams + bracket). */
export function serverScenarioBundle(): Scenario2026Bundle {
  return SCENARIO_2026_BUNDLE as Scenario2026Bundle;
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
  };
  return cachedValidationData;
}

let cachedSeasonKey: string | null = null;

/**
 * The CURRENT season key — pure function of the served manifest (plan §3).
 * Light: composes versions from the manifest only; no catalog build.
 */
export function currentSeasonKey(): string {
  cachedSeasonKey ??= deriveSeasonKey(
    composeVersions(RUNTIME_DATA_MANIFEST as RuntimeDataManifest),
  );
  return cachedSeasonKey;
}
