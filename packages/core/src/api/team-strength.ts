// Team-strength aggregation — contract surface only (WS-0c).
//
// This is the signature update demanded by the WS-0c brief: aggregating the
// USER XI's strength is now a function of THREE inputs, not one:
//
//   team_strength = f(
//     player ratings × position_compatibility,   // each starter weighted
//     Synergy multiplier,                        // bounded amplifier
//     manager modifier                           // optional ManagerRating fold
//   )
//
// HONEST-STATE / SIM CONTRACT:
//  - The sim consumes the four numeric channels of TeamStrength
//    (attack / midfield / defense / goalkeeping + coverage), exactly as today.
//    The aggregation signature here PRODUCES that TeamStrength; it does not
//    change what the sim reads.
//  - The multiplier is BOUNDED (see SynergyResult.multiplier comment) — the
//    aggregator MUST NOT let a high-Synergy weak XI out-aggregate a
//    low-Synergy superstar XI. The bound is calibrated + locked in WS-B.
//  - Manager modifier is `null` for runs where no manager has been drafted
//    yet (or where coverage on `ManagerRating` is insufficient). In that
//    case the aggregator MUST fall back to a 1.0 multiplier — no implicit
//    "0" coercion.
//
// SCOPE: signature + per-starter view type only. The folding formula
// (channel-by-channel weighted mean? max-of-eligibles? something else?) is
// WS-B calibration and is locked by the `team-strength-golden` test.

import type { ManagerRating } from "../types/manager.js";
import type { Rating, TeamStrength } from "../types/rating.js";
import type { SynergyResult } from "../types/synergy.js";

/**
 * One starter's contribution view, materialised before folding. Carrying the
 * already-computed `position_compatibility` as a sibling of the `Rating`
 * keeps the aggregator pure of position-compatibility-recomputation logic.
 */
export interface StarterContribution {
  /** Pointer back to the SquadSlot this starter occupies. */
  slot_id: string;
  /** Per-card rating for the starter. */
  rating: Rating;
  /**
   * Pre-computed graduated compatibility in [0, 1] for this starter in this
   * slot (matches `SquadSlot.position_compatibility`). The aggregator folds
   * this directly — it does NOT call `positionCompatibility` itself.
   */
  position_compatibility: number;
}

/**
 * Aggregate the user XI's team strength.
 *
 * INPUTS:
 *  - `starters`  — exactly 11 `StarterContribution` rows (one per assigned
 *    starter slot). The aggregator MUST throw `RangeError` if the count is
 *    not exactly 11 — bench cards never contribute to team strength.
 *  - `synergy`   — output of `computeSynergy` for the same XI / formation /
 *    manager triple.
 *  - `manager`   — the drafted manager's `ManagerRating`, or `null` when no
 *    manager has been drafted yet (or `ManagerRating.overall` is null).
 *    `null` MUST be folded as a 1.0 modifier — no implicit zero.
 *
 * OUTPUT: `TeamStrength` — the same shape the sim already consumes.
 *
 * DETERMINISM: identical inputs → identical TeamStrength. No RNG / I/O /
 * globals.
 */
export type AggregateUserXiStrengthFn = (
  starters: readonly StarterContribution[],
  synergy: SynergyResult,
  manager: ManagerRating | null,
) => TeamStrength;

/**
 * WS-B team-strength aggregation (engine body in `../engine/team-strength.ts`).
 * Per-channel MEAN of compatibility-weighted starter ratings × bounded Synergy
 * multiplier × bounded manager modifier. Locked by `team-strength.golden.test.ts`.
 */
import { aggregateUserXiStrength as aggregateUserXiStrengthImpl } from "../engine/team-strength.js";

export const aggregateUserXiStrength: AggregateUserXiStrengthFn = aggregateUserXiStrengthImpl;

// Re-declare the existing `UserXiSimView` here in plain English (NOT a type
// alias; the canonical declaration stays in `api/sim.ts`):
//
//   UserXiSimView = { draft_id, squad_ratings: Rating[], aggregate: TeamStrength }
//
// In the WS-B implementation, `UserXiSimView.aggregate` will be produced by
// THIS aggregator from per-starter `StarterContribution[]` (built by the
// rating engine) + `computeSynergy()` + the manager's `ManagerRating`. The
// `simulateMatch` sim signature is UNCHANGED — it still consumes only
// `UserXiSimView`, blind to how the aggregate was folded.
