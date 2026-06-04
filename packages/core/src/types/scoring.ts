// Scoring layer of the wcdraft data contract.
//
// SHAPES ONLY. The weights below are PLACEHOLDERS — real values are calibrated
// in WS-B and LOCKED via golden fixtures (the same way the RNG sequence is
// locked in `rng-golden.json`). The CONTRACT here is only:
//   - the field set on `ScoringConfig`,
//   - the per-round multiplier map shape, and
//   - the breakdown component shape returned by `computeScore`.
//
// DETERMINISM CONTRACT: a fixed (DraftState, RunScenario, seed, version
// anchors) → identical RunResult INCLUDING score + breakdown. Therefore
// `ScoringConfig` is fully part of `engine_version`; changing any weight is
// a major engine-version bump.

import type { MatchRound } from "./primitives.js";

/**
 * Tournament-wide scoring weights. Calibration happens in WS-B; the values
 * shipped here are PLACEHOLDERS to lock the shape only — DO NOT use these
 * defaults as if they were tuned weights.
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

// ─── PLACEHOLDER DEFAULT CONFIG ───────────────────────────────────────────────
// TODO(WS-B): replace with calibrated weights and lock via a scoring-golden
// fixture (same pattern as `rng-golden.json`). The placeholder values exist so
// downstream code can typecheck against `ScoringConfig` without an undefined.
// The numbers below are NOT tuned and MUST NOT be relied upon for game balance.
export const PLACEHOLDER_SCORING_CONFIG: ScoringConfig = {
  goal_points: 0,
  goal_difference_weight: 0,
  clean_sheet_bonus: 0,
  round_progression_multipliers: {
    G1: 0,
    G2: 0,
    G3: 0,
    R32: 0,
    R16: 0,
    QF: 0,
    SF: 0,
    F: 0,
  },
  undefeated_bonus: 0,
  conceded_penalty: 0,
  yellow_penalty: 0,
  red_penalty: 0,
  foul_penalty: 0,
  offside_penalty: 0,
  missed_pen_penalty: 0,
};
