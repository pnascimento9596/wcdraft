// DC-2 — generator for the era-preset golden fixture
// (test/fixtures/era-presets-golden.json).
//
// ONE parameterized fixture: a single fixed seed auto-drafted through each of
// the four era-preset catalogs. Regen discipline (same as the e2e golden):
// tests never write this file; regenerate manually on anchor bumps and land
// the inspected diff in the same PR:
//
//   pnpm build && pnpm --filter @wcdraft/data gen:era-golden

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { autoDraft, ERA_PRESET_IDS, type DraftDataset } from "@wcdraft/core";

import { DRAFT_POOL_BUNDLE, RUNTIME_DATA_MANIFEST } from "../src/index.js";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../test/fixtures/era-presets-golden.json");

const PARENT_SEED = "wcdraft:era-presets-golden:v1:1";
const COMBINED_RATING_VERSION = `${RUNTIME_DATA_MANIFEST.rating_version_historical}+${RUNTIME_DATA_MANIFEST.rating_version_projected}`;

const dataset: DraftDataset = {
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

const records = ERA_PRESET_IDS.map((preset) => {
  const draft = autoDraft({
    run_id: `era-golden-${preset}`,
    parent_seed: PARENT_SEED,
    formation_id: "4-3-3",
    mode: "classic",
    team_name: "Era Golden XI",
    dataset_version: RUNTIME_DATA_MANIFEST.dataset_version,
    rating_version: COMBINED_RATING_VERSION,
    engine_version: RUNTIME_DATA_MANIFEST.engine_version,
    era_preset: preset,
    dataset,
  });
  return {
    era_preset: preset,
    parent_seed: PARENT_SEED,
    manager_card_id: draft.manager_card_id as string,
    spins: draft.spins.map((s) => ({
      index: s.index,
      tournament_id: s.tournament_id,
      nation_id: s.nation_id,
      rare: s.rare,
      picked_kind: s.picked_kind,
      picked_card_id: (s.picked_card_id as string | null) ?? null,
      assigned_slot_id: s.assigned_slot_id,
    })),
  };
});

const golden = {
  _comment:
    "DC-2 era-preset golden — one deterministic autoDraft per preset from one seed. Regen: pnpm --filter @wcdraft/data gen:era-golden",
  rating_version: COMBINED_RATING_VERSION,
  engine_version: RUNTIME_DATA_MANIFEST.engine_version,
  dataset_version: RUNTIME_DATA_MANIFEST.dataset_version,
  parent_seed: PARENT_SEED,
  records,
};

writeFileSync(OUT, JSON.stringify(golden, null, 2) + "\n", "utf8");
console.log(`wrote ${OUT} (${records.length} preset records, seed=${PARENT_SEED})`);
