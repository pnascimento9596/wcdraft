// WS-B implementation of `aggregateUserXiStrength` — folds the user XI's 11
// starters into the four-channel `TeamStrength` the sim consumes.
//
//   team_channel = clamp_int(
//     mean_over_11( rating[channel] × position_compatibility )   // talent × fit
//     × synergy.multiplier                                       // bounded amplifier
//     × manager_modifier,                                        // manager-link band
//     0, 100 )
//
// CALIBRATION: tune vs historical scorelines. The fold (per-channel MEAN of
// compatibility-weighted ratings) lives in `calibration.ts`; the manager
// modifier uses only the sim-legal `SynergyResult.manager_link` field.
//
// BOUNDED INVARIANT: the `synergy.multiplier` is confined to a tight band
// around 1.0 (and the manager modifier is confined to its reserved positive
// band), so a high-Synergy weak XI can never out-aggregate a low-Synergy
// superstar XI.
//
// ─── DECOUPLING GUARD (ws-core/decoupling-guards) ────────────────────────────
// `managerModifier` USED TO read `ManagerRating.overall`, the display-only
// composite the type contract explicitly forbids the sim from reading
// (see `types/manager.ts`: "The sim MUST NOT read this field."). It was
// behaviorally inert against production runtime data — none ships a manager
// rating — but `sim-fixtures.ts` exercised the forbidden path with
// `overall: 80`, so the sim-golden regen on this branch IS the proof.
// The modifier is now wired through `SynergyResult.manager_link`, which is
// driven by the drafted ManagerTournament's managed nation and the starter
// nation mix. Do NOT re-introduce the display-overall read.

import type { ManagerRating } from "../types/manager.js";
import type { TeamStrength } from "../types/rating.js";
import type { AggregateUserXiStrengthFn, StarterContribution } from "../api/team-strength.js";
import type { SynergyResult } from "../types/synergy.js";
import { MANAGER_MODIFIER, clamp, toChannelInt } from "./calibration.js";

type Channel = "attack" | "midfield" | "defense" | "goalkeeping";
const CHANNELS: readonly Channel[] = ["attack", "midfield", "defense", "goalkeeping"];

/**
 * Manager modifier — bounded by the reserved manager band and driven only by
 * `SynergyResult.manager_link`. `ManagerRating.overall` is display-only and the
 * sim MUST NOT read it. A missing manager tournament is represented upstream as
 * `manager_link === 0`; a null `ManagerRating` only means no manager rating row
 * is available. No `manager.overall` read here, by design — see
 * `manager-modifier-decoupling.guard.test.ts`.
 */
export function managerBandModifier(
  synergy: Pick<SynergyResult, "manager_link">,
  manager: ManagerRating | null,
): number {
  // The manager param stays in the signature so a future sim-legal manager
  // rating field can be threaded without changing the public aggregator shape.
  // Today the only manager signal used by the sim is the already-computed
  // manager_link from Synergy; the param does not suppress that link.
  void manager;
  return 1 + MANAGER_MODIFIER.BAND * clamp(synergy.manager_link, 0, 1);
}

export const aggregateUserXiStrength: AggregateUserXiStrengthFn = (starters, synergy, manager) => {
  if (starters.length !== 11) {
    throw new RangeError(
      `aggregateUserXiStrength requires exactly 11 starters, received ${starters.length}`,
    );
  }
  const modifier = managerBandModifier(synergy, manager);
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
