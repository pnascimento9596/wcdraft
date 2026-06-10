// WS-B implementation of `aggregateUserXiStrength` — folds the user XI's 11
// starters into the four-channel `TeamStrength` the sim consumes.
//
//   team_channel = clamp_int(
//     mean_over_11( rating[channel] × position_compatibility )   // talent × fit
//     × synergy.multiplier                                       // bounded amplifier
//     × manager_modifier,                                        // identity (1.0)
//     0, 100 )
//
// CALIBRATION: tune vs historical scorelines. The fold (per-channel MEAN of
// compatibility-weighted ratings) lives in `calibration.ts`; the manager
// modifier is currently the identity element (see `managerModifier` below).
//
// BOUNDED INVARIANT: the `synergy.multiplier` is confined to a tight band
// around 1.0 (and the manager modifier is identity), so a high-Synergy weak
// XI can never out-aggregate a low-Synergy superstar XI.
//
// ─── DECOUPLING GUARD (ws-core/decoupling-guards) ────────────────────────────
// `managerModifier` USED TO read `ManagerRating.overall`, the display-only
// composite the type contract explicitly forbids the sim from reading
// (see `types/manager.ts`: "The sim MUST NOT read this field."). It was
// behaviorally inert against production runtime data — none ships a manager
// rating — but `sim-fixtures.ts` exercised the forbidden path with
// `overall: 80`, so the sim-golden regen on this branch IS the proof.
// The modifier is now EXPLICITLY IDENTITY (1.0). When a sim-legal manager
// field is defined, wire that field here; do NOT re-introduce the
// display-overall read.

import type { ManagerRating } from "../types/manager.js";
import type { TeamStrength } from "../types/rating.js";
import type { AggregateUserXiStrengthFn, StarterContribution } from "../api/team-strength.js";
import { clamp, toChannelInt } from "./calibration.js";

type Channel = "attack" | "midfield" | "defense" | "goalkeeping";
const CHANNELS: readonly Channel[] = ["attack", "midfield", "defense", "goalkeeping"];

/**
 * Manager modifier — EXPLICITLY IDENTITY (1.0) until a sim-legal manager
 * field exists. `ManagerRating.overall` is display-only and the sim MUST NOT
 * read it; `null` manager also folds as 1.0. No `manager.overall` read here,
 * by design — see `manager-modifier-decoupling.guard.test.ts`.
 */
function managerModifier(manager: ManagerRating | null): number {
  // Read the param explicitly so the linter doesn't flag it as unused. We
  // intentionally ignore the value — see header.
  void manager;
  return 1.0;
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
