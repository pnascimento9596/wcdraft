// One-shot script to regenerate `test/fixtures/e2e-real-run-golden.json`.
//
// Run via: pnpm --filter @wcdraft/data exec tsx scripts/generate-e2e-golden.mjs
//
// Regenerate ONLY when the engine / dataset / rating / ruleset versions
// intentionally change. The committed fixture is the locked contract — the
// test reads it, never writes it.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  autoDraft,
  buildRunScenario,
  runTournamentFull,
} from "@wcdraft/core";

import {
  DRAFT_POOL_BUNDLE,
  RUNTIME_DATA_MANIFEST,
  SCENARIO_2026_BUNDLE,
} from "../src/index.js";

const PARENT_SEED = "wcdraft:e2e-real-run:v1:14";
const RUN_SEED = PARENT_SEED;
const COMBINED_RATING_VERSION = `${RUNTIME_DATA_MANIFEST.rating_version_historical}+${RUNTIME_DATA_MANIFEST.rating_version_projected}`;

const dataset = {
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
};

const draft = autoDraft({
  run_id: "e2e-real-run-golden",
  parent_seed: RUN_SEED,
  formation_id: "4-3-3",
  mode: "classic",
  team_name: "Golden XI",
  dataset_version: RUNTIME_DATA_MANIFEST.dataset_version,
  rating_version: COMBINED_RATING_VERSION,
  engine_version: RUNTIME_DATA_MANIFEST.engine_version,
  dataset,
});

const scenarioBundle = buildRunScenario({
  parent_seed: RUN_SEED,
  teams: SCENARIO_2026_BUNDLE.teams,
  bracket: {
    groups: SCENARIO_2026_BUNDLE.groups,
    knockout_slots: SCENARIO_2026_BUNDLE.knockout_slots,
  },
  ruleset_version: RUNTIME_DATA_MANIFEST.ruleset_version,
});

const opponents = Object.fromEntries(SCENARIO_2026_BUNDLE.teams.map((t) => [t.team_id, t]));
const managerTournaments = Object.fromEntries(
  DRAFT_POOL_BUNDLE.manager_cards.map((m) => [
    m.manager_card_id,
    {
      manager_card_id: m.manager_card_id,
      manager_id: m.manager_id,
      tournament_id: m.tournament_id,
      nation_id: m.nation_id,
      matches: m.matches,
      final_placement: m.final_placement,
      sources: m.sources,
    },
  ]),
);

const world = {
  ratings: Object.fromEntries(DRAFT_POOL_BUNDLE.ratings.map((r) => [r.card_id, r])),
  opponents,
  managerTournaments,
  nationByCardId: DRAFT_POOL_BUNDLE.nation_by_card_id,
  bracket: {
    groups: SCENARIO_2026_BUNDLE.groups,
    knockout_slots: SCENARIO_2026_BUNDLE.knockout_slots,
  },
};

const result = runTournamentFull(draft, scenarioBundle.scenario, RUN_SEED, world);

const golden = {
  _comment:
    "REAL-DATA E2E GOLDEN — regenerate via scripts/generate-e2e-golden.mjs only when engine/dataset/rating/ruleset anchors intentionally change.",
  parent_seed: PARENT_SEED,
  run_seed: RUN_SEED,
  draft: JSON.parse(JSON.stringify(draft)),
  scenario: JSON.parse(JSON.stringify(scenarioBundle.scenario)),
  scenario_meta: JSON.parse(JSON.stringify(scenarioBundle.meta)),
  run: JSON.parse(JSON.stringify(result.run)),
  matches: JSON.parse(JSON.stringify(result.matches)),
  group_stage: JSON.parse(JSON.stringify(result.group_stage)),
  knockout_ladder_meta: JSON.parse(JSON.stringify(result.knockout_ladder_meta)),
};

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "..", "test", "fixtures", "e2e-real-run-golden.json");
writeFileSync(outPath, JSON.stringify(golden, null, 2) + "\n");

console.log(
  `wrote ${outPath} — reached=${result.run.reached_round} record=${result.run.record} ` +
    `qualified=${result.group_stage.user_qualified} matches=${result.matches.length}`,
);
