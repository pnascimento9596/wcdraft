// V7 — refresh the asymmetric realism gate golden after a rating-channel + λ
// refit.
//
// What this updates: per-policy run counts + raw event totals + observed rates +
// per-observed Wilson half-widths + telemetry, then re-centers the shape bands
// around the strategicAutoDraft landing using the pre-existing recipe:
// max(WilsonHalfWidthAroundObs at locked N, 1.5pp floor).
//
// What this DELIBERATELY preserves byte-for-byte: `ensemble` and each policy's
// `_doc`. V8 updates the engine_version header to the season stamp while
// preserving the V7 tuple and shape-band recipe.
//
//   pnpm --filter @wcdraft/data exec tsx scripts/regen-asym-golden.mts

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ALL_POLICIES,
  runRealismEnsembleForPolicy,
  wilsonHalfWidthObs,
  type RealismMeasurement,
} from "../test/realism/realism.harness.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = join(HERE, "..", "test", "realism", "asym-realism-golden.json");

const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf-8"));
const N: number = golden.ensemble.N_runs;
const seedPrefix: string = golden.ensemble.seed_prefix;
const SHAPE_KEYS = ["draw_pct", "margin4plus_pct", "ko_et_pct", "shootout_pct"] as const;
const SHAPE_FLOOR = 0.015;

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
golden.$schema_doc =
  "merit-v3 V8 asymmetric realism gate -- locked landings + Wilson/floor shape bands after the V7 lambda refit. Runtime engine_version is engine-2026.06.12.";
golden.engine_anchor =
  "merit-v3 V8 season stamp for the V7 lambda refit on post-V6 Career channels";
golden.engine_version = "engine-2026.06.12";
golden.shape_bands._doc =
  "V7 RE-LOCK: shape bands are centered on strategicAutoDraft after the post-V6 Career-channel lambda refit. Half-width = max(WilsonHalfWidthAroundObs at locked N, 1.5pp floor). The four shape norms are tracked together (each +/-halfWidth around the strategic golden); goals/game is handled separately as a one-sided LOWER floor (no upper cap -- total volume legitimately tracks the underdog gap).";
for (const key of SHAPE_KEYS) {
  golden.shape_bands[key] = {
    center_policy: "strategicAutoDraft",
    half_width: Math.max(strategic.wilson_half_widths_around_observed[key], SHAPE_FLOOR),
  };
}
golden.goals_per_game_lower_floor._doc =
  "One-sided LOWER floor. No upper cap because total goal volume legitimately rises with the strategic-underdog gap and there is no real-world ceiling. Floor = strategicAutoDraft observed minus ~2x Wilson half-width, rounded down to keep honest residual cushion.";
golden.goals_per_game_lower_floor.lower_bound = Math.floor(
  (strategic.observed.goals_per_game - 2 * strategic.wilson_half_widths_around_observed.goals_per_game) * 100,
) / 100;
golden.wilson_target_for_ko_metrics._doc =
  "95% Wilson half-width at N=2000 for KO-only metrics (KO->ET, shootout) is the chosen-N tooth criterion. V7 records the strategicAutoDraft observed half-widths under the post-V6 Career-channel lambda refit.";
golden.wilson_target_for_ko_metrics.observed_half_width_pp = {
  ko_et_pct: Number((100 * strategic.wilson_half_widths_around_observed.ko_et_pct).toFixed(2)),
  shootout_pct: Number((100 * strategic.wilson_half_widths_around_observed.shootout_pct).toFixed(2)),
};

writeFileSync(GOLDEN_PATH, JSON.stringify(golden, null, 2) + "\n", "utf-8");
console.log(`\nWROTE ${GOLDEN_PATH} (shape_bands re-derived, engine_version stamped for V8)`);
