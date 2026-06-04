// WS-B implementation of `aggregateUserXiStrength` — folds the user XI's 11
// starters into the four-channel `TeamStrength` the sim consumes.
//
//   team_channel = clamp_int(
//     mean_over_11( rating[channel] × position_compatibility )   // talent × fit
//     × synergy.multiplier                                       // bounded amplifier
//     × manager_modifier,                                        // bounded, null → 1.0
//     0, 100 )
//
// CALIBRATION: tune vs historical scorelines. The fold (per-channel MEAN of
// compatibility-weighted ratings) and the manager-modifier band live in
// `calibration.ts`; locked by `team-strength.golden.test.ts`.
//
// BOUNDED INVARIANT: both `synergy.multiplier` and the manager modifier are
// confined to tight bands around 1.0, so a high-Synergy weak XI can never
// out-aggregate a low-Synergy superstar XI.

import type { ManagerRating } from "../types/manager.js";
import type { TeamStrength } from "../types/rating.js";
import type { AggregateUserXiStrengthFn, StarterContribution } from "../api/team-strength.js";
import { MANAGER_MODIFIER, clamp, toChannelInt } from "./calibration.js";

type Channel = "attack" | "midfield" | "defense" | "goalkeeping";
const CHANNELS: readonly Channel[] = ["attack", "midfield", "defense", "goalkeeping"];

/**
 * Manager modifier ∈ [1 - BAND, 1 + BAND]; `null` manager (or null overall)
 * folds as exactly 1.0 — never an implicit zero.
 */
function managerModifier(manager: ManagerRating | null): number {
  if (manager === null || manager.overall === null) return 1.0;
  const delta = clamp((manager.overall - MANAGER_MODIFIER.PIVOT) / MANAGER_MODIFIER.PIVOT, -1, 1);
  return 1 + MANAGER_MODIFIER.BAND * delta;
}

export const aggregateUserXiStrength: AggregateUserXiStrengthFn = (starters, synergy, manager) => {
  if (starters.length !== 11) {
    throw new RangeError(
      `aggregateUserXiStrength requires exactly 11 starters, received ${starters.length}`,
    );
  }
  const modifier = managerModifier(manager);
  const amp = synergy.multiplier * modifier;

  const out = {} as Record<Channel, number>;
  for (const ch of CHANNELS) {
    let sum = 0;
    for (const s of starters) {
      sum += s.rating[ch] * s.position_compatibility;
    }
    const mean = sum / starters.length;
    out[ch] = toChannelInt(mean * amp);
  }

  let coverageSum = 0;
  for (const s of starters as readonly StarterContribution[]) coverageSum += s.rating.coverage;
  const coverage = clamp(coverageSum / starters.length, 0, 1);

  return {
    attack: out.attack,
    midfield: out.midfield,
    defense: out.defense,
    goalkeeping: out.goalkeeping,
    coverage,
  } satisfies TeamStrength;
};
