/**
 * Regenerate the golden SIM fixture (`test/fixtures/sim-golden.json`).
 *
 * Run via:  pnpm --filter @wcdraft/core run gen:sim-golden
 *
 * For each of the four characteristic scenarios it SEARCHES seeds for one that
 * exhibits the scenario's defining behaviour (blowout / upset / draw-into-pens /
 * injury-cascade), then records (seed, RunResult). The committed JSON is the
 * locked contract; `sim.golden.test.ts` only READS it and asserts byte-identity.
 *
 * Regenerate ONLY when the engine is deliberately changed — a diff here means a
 * RunResult byte moved and therefore `engine_version` must be bumped.
 *
 * BUMP-LEDGER EXCEPTIONS (sanctioned, honest log — not loopholes):
 *  1. Fixture-input changes: a diff caused purely by editing
 *     `test/fixtures/sim-fixtures.ts` scenario inputs moves this golden with
 *     no engine semantics change — no `engine_version` bump.
 *  2. PR #62 (decoupling guards): `managerModifier` became explicit identity
 *     because the fixtures exercised a contract violation (sim reading the
 *     display-only `ManagerRating.overall`) that production runtime never
 *     ships. Production-flow goldens (e2e-real-run, asym-realism) stayed
 *     byte-identical, so no `engine_version` bump was taken.
 * Any OTHER diff still means the unconditional rule applies.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { runTournamentFull } from "../src/index.ts";
import type { MatchResult, RunResult } from "../src/index.ts";
import {
  SCENARIO_NAMES,
  buildScenarioInputs,
  type ScenarioName,
} from "../test/fixtures/sim-fixtures.ts";

const MAX_SEARCH = 40000;

function tournamentEndingInjuryCount(matches: MatchResult[]): number {
  let n = 0;
  for (const m of matches) {
    for (const e of m.events) {
      if (e.type === "injury" && e.tournament_ending) n++;
    }
  }
  return n;
}

function exhibits(name: ScenarioName, run: RunResult, matches: MatchResult[]): boolean {
  switch (name) {
    case "blowout":
      return run.round_results.some((r) => r.outcome === "W" && r.goals_for - r.goals_against >= 4);
    case "upset":
      // Weak user qualifies out of group AND wins a knockout match.
      return matches.some((m) => m.phase === "knockout" && m.outcome === "W");
    case "draw_into_pens":
      return matches.some((m) => m.shootout !== null);
    case "injury_cascade":
      return tournamentEndingInjuryCount(matches) >= 2;
    case "group_elimination":
      // User is eliminated in the group stage — no knockouts played.
      return (
        run.reached_round === "G3" &&
        run.is_champion === false &&
        matches.length === 3 &&
        matches.every((m) => m.phase === "group")
      );
    default:
      return false;
  }
}

interface GoldenEntry {
  name: ScenarioName;
  seed: string;
  run: RunResult;
}

function searchScenario(name: ScenarioName): GoldenEntry {
  const inputs = buildScenarioInputs(name);
  for (let n = 0; n < MAX_SEARCH; n++) {
    const seed = `wcb-golden-${name}-${n}`;
    const { run, matches } = runTournamentFull(inputs.draft, inputs.scenario, seed, inputs.world);
    if (exhibits(name, run, matches)) {
      const injuries = tournamentEndingInjuryCount(matches);
      console.log(
        `${name}: seed="${seed}" reached=${run.reached_round} record=${run.record} ` +
          `score=${run.score} champion=${run.is_champion} shootouts=${matches.filter((m) => m.shootout).length} ` +
          `te_injuries=${injuries}`,
      );
      return { name, seed, run };
    }
  }
  throw new Error(`could not find a seed exhibiting "${name}" within ${MAX_SEARCH} seeds`);
}

const entries = SCENARIO_NAMES.map((name) => searchScenario(name));

const fixture = {
  _comment:
    "GOLDEN FIXTURE — locked WS-B RunResults for four characteristic scenarios. Do not hand-edit; regenerate via scripts/generate-sim-golden.ts only when the engine intentionally changes (bump engine_version).",
  scenarios: entries,
};

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "..", "test", "fixtures", "sim-golden.json");
writeFileSync(outPath, JSON.stringify(fixture, null, 2) + "\n");
console.log(`wrote ${outPath}`);
