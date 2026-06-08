// E-4.7 — refresh the EMPIRICAL measurement block of the asymmetric realism gate
// golden after a rating-channel change, WITHOUT touching the locked gate bands.
//
// What this updates: per-policy run counts + raw event totals + observed rates +
// per-observed Wilson half-widths + telemetry (the count-lock and documentation
// the gate measures against).
//
// What this DELIBERATELY preserves byte-for-byte: `shape_bands`,
// `goals_per_game_lower_floor`, `wilson_target_for_ko_metrics`, `ensemble`,
// `engine_version`, `engine_anchor`, `$schema_doc`, and each policy's `_doc`.
// The realism BANDS that E-3b locked are NOT re-centered on the new data — they
// stay put, and the new data is re-verified to still fall inside them by the gate.
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

writeFileSync(GOLDEN_PATH, JSON.stringify(golden, null, 2) + "\n", "utf-8");
console.log(`\nWROTE ${GOLDEN_PATH} (shape_bands + gate params untouched)`);
