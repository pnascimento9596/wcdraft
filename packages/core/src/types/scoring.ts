// Scoring layer of the wcdraft data contract.
//
// This file declares the scoring contract shape only:
//   - the field set on `ScoringConfig`,
//   - the per-round multiplier map shape, and
//   - the breakdown component shape returned by `computeScore`.
//
// Live engine defaults live in `engine/calibration.ts` as
// `DEFAULT_SCORING_CONFIG`; this type module intentionally does not export
// fallback weights.
//
// DETERMINISM CONTRACT: a fixed (DraftState, RunScenario, seed, version
// anchors) → identical RunResult INCLUDING score + breakdown. Therefore
// `ScoringConfig` is fully part of `engine_version`; changing any weight is
// a major engine-version bump.

import type { MatchRound } from "./primitives.js";

/**
 * Tournament-wide scoring weights. This module defines the shape only; live
 * calibrated defaults are exported from `engine/calibration.ts`.
 *
 * `round_progression_multipliers` is a per-round bonus map covering every
 * MatchRound (group rounds get small multipliers; knockout rounds escalate).
 */
export interface ScoringConfig {
  /** Points per goal scored. */
  goal_points: number;
  /** Multiplier on (goals_for - goals_against). */
  goal_difference_weight: number;
  /** Flat bonus per clean sheet. */
  clean_sheet_bonus: number;
  /** Per-round bonus multiplier — exhaustive over MatchRound. */
  round_progression_multipliers: Record<MatchRound, number>;
  /** Flat bonus for an undefeated REGULATION run (no shootouts needed). */
  undefeated_bonus: number;
  /** Penalty per goal conceded. */
  conceded_penalty: number;
  /** Penalty per yellow card. */
  yellow_penalty: number;
  /** Penalty per red card. */
  red_penalty: number;
  /** Penalty per foul committed. */
  foul_penalty: number;
  /** Penalty per offside committed. */
  offside_penalty: number;
  /** Penalty per missed penalty kick (in-match). */
  missed_pen_penalty: number;
}

/**
 * One component of a score breakdown. The breakdown is exposed in the UI as
 * a transparent line-by-line tally so users can trace their final score back
 * to specific events.
 *
 * `raw` × `weight` should equal `points` — the contract here only declares
 * the shape; the engine enforces the equality.
 */
export interface ScoreComponent {
  /** Human-readable label (e.g. "Goals scored", "Clean sheets", "Red cards"). */
  label: string;
  /** Raw count / aggregate value behind this component. */
  raw: number;
  /** Weight applied (from `ScoringConfig` or a derived multiplier). */
  weight: number;
  /** `raw * weight` — the points contribution from this component. */
  points: number;
}
