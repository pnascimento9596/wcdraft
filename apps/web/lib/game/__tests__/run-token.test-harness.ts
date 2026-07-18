// Shared run-token test harness — real-bundle GameData + deterministic origin
// records. Extracted from run-token.test.ts so the DC-1 `t2.` suite
// (run-token-v2.test.ts) exercises the exact same construction path.

import { autoDraft, buildDraftCatalog, type DraftDataset, type RatingBasis } from "@wcdraft/core";
import {
  DAILY_SEED_SALT_MAP_BUNDLE,
  DRAFT_POOL_BUNDLE,
  RUNTIME_DATA_MANIFEST,
  type RuntimeDataManifest,
} from "@wcdraft/data";

import type { GameData, RunRecordVersions } from "../data";
import { buildGameDataIndexes, composeVersions } from "../data";
import type { RunRecordV1 } from "../run-record";

export const PARENT_SEED = "wcdraft:e2e-real-run:v1:14";

export function buildDataset(): DraftDataset {
  const ratingByCardId = new Map(DRAFT_POOL_BUNDLE.ratings.map((r) => [r.card_id, r]));
  return {
    players: DRAFT_POOL_BUNDLE.player_cards.map((c) => ({
      player_id: c.player_id,
      tournament_id: c.tournament_id,
      nation_id: c.nation_id,
      eligible_positions: c.eligible_positions,
      choice_overall: {
        career: ratingByCardId.get(c.card_id)?.overall ?? null,
        current: ratingByCardId.get(c.card_id)?.basis_ratings.current.overall ?? null,
      },
    })),
    managers: DRAFT_POOL_BUNDLE.manager_cards.map((m) => ({
      manager_id: m.manager_id,
      tournament_id: m.tournament_id,
      nation_id: m.nation_id,
    })),
    // ENGINE-V2 E-1: era-weighted sampling needs tournament years.
    tournaments: Object.entries(DRAFT_POOL_BUNDLE.tournaments).map(([tid, t]) => ({
      tournament_id: Number(tid),
      year: t.year,
    })),
  };
}

export function buildGameDataFromBundles(): GameData {
  const manifest = RUNTIME_DATA_MANIFEST as RuntimeDataManifest;
  const versions: RunRecordVersions = composeVersions(manifest);
  const indexes = buildGameDataIndexes(DRAFT_POOL_BUNDLE);
  const draftDataset = buildDataset();
  const catalog = buildDraftCatalog(draftDataset);
  return {
    manifest,
    draftPool: DRAFT_POOL_BUNDLE,
    versions,
    indexes,
    draftDataset,
    catalog,
    nationByCardId: DRAFT_POOL_BUNDLE.nation_by_card_id,
    dailySeedSaltMap: DAILY_SEED_SALT_MAP_BUNDLE,
  };
}

export function buildOriginRecord(
  gameData: GameData,
  seed = PARENT_SEED,
  rating_basis: RatingBasis = "career",
): RunRecordV1 {
  const draft = autoDraft({
    run_id: "token-origin",
    parent_seed: seed,
    formation_id: "4-3-3",
    mode: "classic",
    team_name: "Origin XI",
    dataset_version: gameData.versions.dataset_version,
    rating_version: gameData.versions.rating_version,
    engine_version: gameData.versions.engine_version,
    rating_basis,
    dataset: gameData.draftDataset,
  });
  return {
    record_version: 1,
    run_id: "token-origin",
    parent_seed: seed,
    created_seq: 1,
    updated_seq: 1,
    versions: gameData.versions,
    draft,
  };
}
