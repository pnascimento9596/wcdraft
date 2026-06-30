// Regenerates `test/fixtures/e2e-real-run-golden.json`.
//
// Run via: pnpm --filter @wcdraft/data exec node scripts/generate-e2e-golden.mjs
//
// Regenerate ONLY when the rating / draft pool / engine / scenario intentionally
// change. The committed fixture is the locked contract — the test reads it.
//
// SEED SEARCH (Phase 1.1): the recalibrated draft pool may not satisfy the e2e
// test's qualifying criteria under any single pinned seed. This script loops
// `seed = "${PREFIX}:${i}"` for i in 0..SEED_LIMIT and picks the FIRST seed
// that satisfies:
//   1. drafted squad includes ≥ 1 baseline_anchor_estimate-flagged card
//      (honest-state path exercised by test_drafted_squad_includes_estimate),
//   2. group_stage.user_qualified === true (user advances to KO),
//   3. knockout_ladder_meta.rounds[0] exists, round === "R32",
//      bracket_constrained === true, fallback === false (real bracket path).
// The chosen seed is persisted in the fixture's `parent_seed` AND the search
// criteria are documented here so a reviewer can re-derive it.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { autoDraft, buildRunScenario, runTournamentFull } from "@wcdraft/core";

import { DRAFT_POOL_BUNDLE, RUNTIME_DATA_MANIFEST, SCENARIO_2026_BUNDLE } from "../src/index.js";

const SEED_PREFIX = "wcdraft:e2e-real-run:engine-v2-e3a";
const SEED_LIMIT = 2000;
const COMBINED_RATING_VERSION = `${RUNTIME_DATA_MANIFEST.rating_version_historical}+${RUNTIME_DATA_MANIFEST.rating_version_projected}`;
const ratingByCardId = new Map(DRAFT_POOL_BUNDLE.ratings.map((r) => [r.card_id, r.overall]));

const dataset = {
  players: DRAFT_POOL_BUNDLE.player_cards.map((c) => ({
    player_id: c.player_id,
    tournament_id: c.tournament_id,
    nation_id: c.nation_id,
    eligible_positions: c.eligible_positions,
    choice_overall: ratingByCardId.get(c.card_id) ?? null,
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

const estimateCardIds = new Set(
  DRAFT_POOL_BUNDLE.ratings
    .filter((r) => r.overall_basis === "baseline_anchor_estimate")
    .map((r) => r.card_id),
);

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

function tryRun(parentSeed) {
  const draft = autoDraft({
    run_id: "e2e-real-run-golden",
    parent_seed: parentSeed,
    formation_id: "4-3-3",
    mode: "classic",
    team_name: "Golden XI",
    dataset_version: RUNTIME_DATA_MANIFEST.dataset_version,
    rating_version: COMBINED_RATING_VERSION,
    engine_version: RUNTIME_DATA_MANIFEST.engine_version,
    dataset,
  });
  const scenarioBundle = buildRunScenario({
    parent_seed: parentSeed,
    teams: SCENARIO_2026_BUNDLE.teams,
    bracket: {
      groups: SCENARIO_2026_BUNDLE.groups,
      knockout_slots: SCENARIO_2026_BUNDLE.knockout_slots,
    },
    ruleset_version: RUNTIME_DATA_MANIFEST.ruleset_version,
  });
  const result = runTournamentFull(draft, scenarioBundle.scenario, parentSeed, world);
  return { draft, scenarioBundle, result };
}

function meetsCriteria({ draft, result }) {
  const hasEstimate = draft.squad.some((s) => s.card_id !== null && estimateCardIds.has(s.card_id));
  if (!hasEstimate) return { ok: false, why: "no-estimate-in-squad" };
  if (!result.group_stage.user_qualified) return { ok: false, why: "user-not-qualified" };
  const r32 = result.knockout_ladder_meta.rounds[0];
  if (!r32 || r32.round !== "R32") return { ok: false, why: "no-R32" };
  if (!r32.bracket_constrained) return { ok: false, why: "R32-not-bracket-constrained" };
  if (r32.fallback) return { ok: false, why: "R32-fallback" };
  return { ok: true };
}

let chosenSeed = null;
let chosenRun = null;
for (let i = 0; i < SEED_LIMIT; i++) {
  const seed = `${SEED_PREFIX}:${i}`;
  const r = tryRun(seed);
  const verdict = meetsCriteria(r);
  if (verdict.ok) {
    chosenSeed = seed;
    chosenRun = r;
    console.log(`seed search: ACCEPTED seed=${seed} (i=${i})`);
    break;
  }
  if (i < 5 || i % 25 === 0) console.log(`seed search: rejected i=${i} reason=${verdict.why}`);
}
if (!chosenSeed) {
  throw new Error(`No seed in 0..${SEED_LIMIT - 1} met the qualifying criteria. Widen the search.`);
}

const { draft, scenarioBundle, result } = chosenRun;
const golden = {
  _comment:
    "REAL-DATA E2E GOLDEN — regenerate via scripts/generate-e2e-golden.mjs. The script searches a seed namespace (see SEED_PREFIX) and locks the first seed whose run meets the test's qualifying criteria. Document the criteria in the generator, not just here.",
  _seed_search: {
    prefix: SEED_PREFIX,
    limit: SEED_LIMIT,
    criteria: [
      "drafted squad includes >=1 baseline_anchor_estimate card",
      "group_stage.user_qualified === true",
      "knockout_ladder_meta.rounds[0].round === 'R32' && bracket_constrained && !fallback",
    ],
  },
  parent_seed: chosenSeed,
  run_seed: chosenSeed,
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
  `wrote ${outPath} — seed=${chosenSeed} reached=${result.run.reached_round} ` +
    `record=${result.run.record} matches=${result.matches.length}`,
);
