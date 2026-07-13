// Season 2 S3 Option A — refresh the asymmetric realism gate golden after the
// manager-presence tactical tier and calibrated squad-depth mechanics land.
//
// What this updates: per-policy run counts + raw event totals + observed rates +
// per-observed Wilson half-widths + telemetry + score population.
//
// What this DELIBERATELY preserves byte-for-byte: `ensemble`, each policy's
// `_doc`, and the semantic shape-band centers/widths. S3 re-evaluated those
// existing bands against the final engine and retained them because the final
// strategic population still passes every band. A mechanics relock must not
// silently recenter acceptance around its own observation.
//
//   pnpm --filter @wcdraft/data exec tsx scripts/regen-asym-golden.mts

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ALL_POLICIES,
  runRealismEnsembleForPolicy,
  summarizeScorePopulation,
  wilsonHalfWidthObs,
  type RealismMeasurement,
} from "../test/realism/realism.harness.js";
import { RUNTIME_DATA_MANIFEST } from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = join(HERE, "..", "test", "realism", "asym-realism-golden.json");

const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf-8"));
const N: number = golden.ensemble.N_runs;
const seedPrefix: string = golden.ensemble.seed_prefix;

function observedOf(m: RealismMeasurement) {
  return {
    goals_per_game: m.matches > 0 ? m.goalsTotal / m.matches : 0,
    draw_pct: m.groupMatches > 0 ? m.draws / m.groupMatches : 0,
    margin4plus_pct: m.matches > 0 ? m.margin4plus / m.matches : 0,
    ko_et_pct: m.knockoutMatches > 0 ? m.koEt / m.knockoutMatches : 0,
    shootout_pct: m.knockoutMatches > 0 ? m.koShootout / m.knockoutMatches : 0,
  };
}

// Half-width derivations mirror scripts/measure-asym-realism.mts exactly:
// Poisson-ish 2·sqrt(obs/denom) for goals/game, Wilson for the rate metrics.
function halfWidthsOf(m: RealismMeasurement, obs: ReturnType<typeof observedOf>) {
  return {
    goals_per_game: 2 * Math.sqrt(obs.goals_per_game / Math.max(1, m.matches)),
    draw_pct: wilsonHalfWidthObs(obs.draw_pct, m.groupMatches),
    margin4plus_pct: wilsonHalfWidthObs(obs.margin4plus_pct, m.matches),
    ko_et_pct: wilsonHalfWidthObs(obs.ko_et_pct, m.knockoutMatches),
    shootout_pct: wilsonHalfWidthObs(obs.shootout_pct, m.knockoutMatches),
  };
}

for (const policy of ALL_POLICIES) {
  const { measurement: m, telemetry } = runRealismEnsembleForPolicy(policy, N, seedPrefix);
  const obs = observedOf(m);
  const prev = golden.policies[policy];
  golden.policies[policy] = {
    _doc: prev._doc, // preserved verbatim
    qualifying: m.qualifyingRuns,
    matches: m.matches,
    groupMatches: m.groupMatches,
    knockoutMatches: m.knockoutMatches,
    goalsTotal: m.goalsTotal,
    draws: m.draws,
    margin4plus: m.margin4plus,
    koEt: m.koEt,
    koShootout: m.koShootout,
    observed: obs,
    wilson_half_widths_around_observed: halfWidthsOf(m, obs),
    telemetry: {
      channelMean: telemetry.channelMean,
      synergyMultiplierMean: telemetry.synergyMultiplierMean,
      managerModifierMean: telemetry.managerModifierMean,
      coverageMean: telemetry.coverageMean,
    },
  };
  console.log(
    `[regen] ${policy}: qualifying=${m.qualifyingRuns} matches=${m.matches} ` +
      `groups=${m.groupMatches} KO=${m.knockoutMatches} goals/game=${obs.goals_per_game.toFixed(3)}`,
  );
}

const strategic = golden.policies.strategicAutoDraft;
const strategicMeasurement = runRealismEnsembleForPolicy(
  "strategicAutoDraft",
  N,
  seedPrefix,
).measurement;
golden.score_population = {
  _doc: "StrategicAutoDraft score distribution measured over the same locked N and seed_prefix as the asymmetric realism gate. Median and p95 use nearest-rank quantiles over sorted run.score values.",
  policy: "strategicAutoDraft",
  ...summarizeScorePopulation(strategicMeasurement),
};
golden.$schema_doc =
  "Season 2 S3 Option A final asymmetric realism relock. The gate sims the default/Career basis after the stable manager-presence tactical tier and calibrated bench-availability mechanics. Lambda, scoring, progression semantics, and the pre-S3 semantic shape-band centers remain unchanged; exact policy populations and telemetry are re-locked to the final engine. Runtime engine_version is " +
  RUNTIME_DATA_MANIFEST.engine_version +
  ".";
golden.engine_anchor =
  "Season 2 S3 manager-presence tactical tier plus calibrated bench availability and replacement contribution";
golden.engine_version = RUNTIME_DATA_MANIFEST.engine_version;
golden.shape_bands._doc =
  "Season 2 S3 deliberate realism re-lock: the final strategicAutoDraft observation was re-executed at N=2000 after the manager-presence and bench-calibration changes and still passes all pre-S3 semantic shape-band centers and widths. Those acceptance bands are therefore retained exactly rather than weakened or recentered around the new observation. Exact per-policy mechanics counts, telemetry, score population, Wilson evidence, and the goals/game floor are re-locked to the final engine.";
golden.goals_per_game_lower_floor._doc =
  "One-sided LOWER floor. No upper cap because total goal volume legitimately rises with the strategic-underdog gap and there is no real-world ceiling. Floor = strategicAutoDraft observed minus ~2x Wilson half-width, rounded down to keep honest residual cushion.";
golden.goals_per_game_lower_floor.lower_bound =
  Math.floor(
    (strategic.observed.goals_per_game -
      2 * strategic.wilson_half_widths_around_observed.goals_per_game) *
      100,
  ) / 100;
golden.wilson_target_for_ko_metrics._doc =
  "95% Wilson half-width at N=2000 for KO-only metrics (KO->ET, shootout) is the chosen-N tooth criterion. Season 2 S3 remeasures these widths on the final manager-presence and bench-calibrated engine while retaining the previously locked semantic shape bands.";
golden.wilson_target_for_ko_metrics.observed_half_width_pp = {
  ko_et_pct: Number((100 * strategic.wilson_half_widths_around_observed.ko_et_pct).toFixed(2)),
  shootout_pct: Number(
    (100 * strategic.wilson_half_widths_around_observed.shootout_pct).toFixed(2),
  ),
};

writeFileSync(GOLDEN_PATH, JSON.stringify(golden, null, 2) + "\n", "utf-8");
console.log(
  `\nWROTE ${GOLDEN_PATH} (engine_version=${RUNTIME_DATA_MANIFEST.engine_version}; landings remeasured)`,
);
