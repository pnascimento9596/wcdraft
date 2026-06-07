// WS-B CALIBRATION CONSTANTS — the single home for every tunable number in the
// sim + scoring engine.
//
// ─────────────────────────────────────────────────────────────────────────────
// CALIBRATION: tune vs historical WC scoreline distributions.
// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 rating recalibration (wc-perf-2.0.0 / proj-career-2.0.0) landed
// the DECOUPLED path: the rating display curve drives `overall` ONLY; the
// four sim channels stay on the pre-recal [FLOOR_CHANNEL, 100] band and λ
// is BYTE-IDENTICAL to origin/main (no engine tuning). All constants in this file
// match origin/main; the sim is byte-identical to main and engine_version
// stays at `engine-2026.06.04` (verified by sim-golden.json: 0 diff). All
// constants below (chance budget, incidents, injuries, shootout band,
// scoring, synergy, manager modifier) remain pre-Phase-1 first-cut values
// and are flagged for separate tuning.
//
// These constants are LOCKED by golden fixtures: any change here changes a
// golden RunResult byte and therefore REQUIRES an `engine_version` bump (the
// same discipline the RNG sequence and the rating algorithm already follow).
//
// DETERMINISM NOTE: the engine deliberately avoids transcendental math
// (exp/log/pow with fractional exponents) so a given seed yields byte-identical
// output on every platform/engine. λ is a clamped LINEAR map and goal counts
// are drawn as a BINOMIAL over a fixed chance budget (rational arithmetic only)
// — never a Knuth-Poisson sampler (which needs exp(-λ)).

import type { ScoringConfig } from "../types/scoring.js";

// ─── λ (EXPECTED GOALS) MAP ───────────────────────────────────────────────────
// λ_for = clamp(BASE + SPREAD * (attackFor - defenseAgainst)/100, MIN, MAX).
// Phase 1 (decoupled path, plan §3.2 fallback): the rating-engine display
// curve is applied to `overall` ONLY; the four sim channels (attack,
// midfield, defense, goalkeeping) stay on the pre-recal [FLOOR_CHANNEL, 100]
// band, so λ stays calibrated to the engine's full attack-minus-defense
// range. These constants match origin/main byte-for-byte and are validated
// against the 1998-2022 modern-era WC norms (computed from pinned upstream
// f41e9437) by `packages/data/test/realism-modern-norms.golden.test.ts`,
// which pins the symmetric coherent-XI sweep + per-metric Δ bands.
export const LAMBDA = Object.freeze({
  /** Baseline goals for an evenly-matched team (attack == opp defense). */
  BASE: 1.3,
  /** Sensitivity to the attack-minus-defense edge across the full 0..100 span. */
  SPREAD: 1.7,
  /** Floor — even a hopeless attack still threatens occasionally. */
  MIN: 0.25,
  /** Ceiling — keeps blowouts bounded and the binomial well-defined. */
  MAX: 3.6,
  /** Fraction of a regulation λ that applies across a 30-minute extra time. */
  ET_FRACTION: 30 / 90,
});

// ─── CHANCE BUDGET (binomial goal model) ──────────────────────────────────────
// Each team gets a fixed budget of "chances" per phase. Each chance is one
// seeded Bernoulli trial: with probability p_goal = λ / chances it is a goal.
// Goals ~ Binomial(chances, λ/chances) → mean = λ, transcendental-free.
export const CHANCES = Object.freeze({
  /** Chances per team across 90' regulation. */
  REGULATION: 14,
  /** Chances per team across 30' extra time. */
  EXTRA_TIME: 5,
  /** Hard cap on per-chance goal probability (keeps any single chance < a coin-flip). */
  MAX_GOAL_PROB: 0.6,
});

// ─── PER-CHANCE OUTCOME SPLIT (conditioned on a chance occurring, non-goal) ────
// After the goal test fails, the remaining probability mass splits into a
// saved shot (on target), an off-target shot, or open play (no shot — which may
// surface a foul / offside / key pass). Values are the conditional shares of
// the NON-goal mass.
export const CHANCE_OUTCOME = Object.freeze({
  /** Share of non-goal chances that are shots on target (→ save event). */
  SAVED_SHARE: 0.26,
  /** Share of non-goal chances that are off-target shots. */
  OFF_TARGET_SHARE: 0.22,
  /** Share of non-goal chances that surface a foul. */
  FOUL_SHARE: 0.16,
  /** Share of non-goal chances that surface an offside. */
  OFFSIDE_SHARE: 0.08,
  /** Remaining mass is uneventful open play (a key pass is logged for colour). */
});

// ─── PENALTIES, ASSISTS, CARDS ────────────────────────────────────────────────
export const INCIDENT = Object.freeze({
  /** Probability a goal-chance is instead won as a penalty (then converted/missed). */
  PEN_FROM_CHANCE_PROB: 0.06,
  /** Conversion probability of an in-match penalty. */
  PEN_CONVERT_PROB: 0.76,
  /** Probability a converted open-play goal carries a logged assister. */
  ASSIST_PROB: 0.62,
  /** Probability a foul escalates to a yellow card. */
  YELLOW_FROM_FOUL_PROB: 0.22,
  /** Probability a yellow is instead a straight red (rare). */
  RED_FROM_CARD_PROB: 0.05,
});

// ─── INJURIES / SUBSTITUTIONS / FORFEIT ───────────────────────────────────────
export const INJURY = Object.freeze({
  /** Probability of a FIRST injury event in a match. */
  PRIMARY_INJURY_PROB: 0.5,
  /** Probability of a SECOND injury event in the same match (0..2 injuries/match). */
  SECOND_INJURY_PROB: 0.2,
  /** Probability a given injury ends the player's tournament (persists across the run). */
  TOURNAMENT_ENDING_PROB: 0.34,
  /** Probability a tactical substitution is made in a match (in addition to injury subs). */
  TACTICAL_SUB_PROB: 0.7,
  /**
   * Fieldable floor: if fewer than this many user players remain available for
   * a match (after persistent tournament-ending injuries), the user FORFEITS
   * the remaining matches. Mirrors the IFAB 7-a-side abandonment threshold.
   */
  FIELDABLE_FLOOR: 7,
  /** Scoreline credited to the opponent on a forfeit (a 0–3 walkover). */
  FORFEIT_OPP_GOALS: 3,
});

// ─── KNOCKOUT TIE RESOLUTION ───────────────────────────────────────────────────
export const SHOOTOUT = Object.freeze({
  /** Best-of-five then sudden death; kicks alternate user/opp. */
  REGULATION_KICKS_PER_SIDE: 5,
  /** Hard cap on sudden-death rounds (prevents an unbounded loop on a pathological seed). */
  MAX_SUDDEN_DEATH_ROUNDS: 20,
  /**
   * Base conversion probability for a shootout kick. The taker's side strength
   * nudges this only within a DELIBERATE VARIANCE FLOOR band so favourites can
   * still lose a shootout (see SHOOTOUT_CONVERT_BAND).
   */
  BASE_CONVERT_PROB: 0.75,
  /**
   * Variance floor: the per-kick conversion probability is confined to
   * [BASE - BAND, BASE + BAND] regardless of how lopsided the teams are, so a
   * superstar XI never has a certain shootout. THIS IS THE "favourites can
   * still lose" guarantee.
   */
  CONVERT_BAND: 0.1,
});

/** Minutes-of-play markers used when stamping lineup minutes per phase. */
export const MINUTES = Object.freeze({
  REGULATION: 90,
  WITH_EXTRA_TIME: 120,
  /** A player subbed/injured mid-match gets a deterministic partial minute count. */
  SUB_ON_DEFAULT: 30,
  SUB_OFF_DEFAULT: 60,
});

// ─── DEFAULT (CALIBRATED) SCORING CONFIG ──────────────────────────────────────
// CALIBRATION: tune vs historical scorelines. Integer weights keep
// `points = raw * weight` exact (no float drift) so the score-sum invariant on
// `RunResultSchema` holds byte-for-byte.
//
// Round-progression multipliers escalate through the knockout ladder so a deep
// run dominates the score (the group stage is worth comparatively little).
export const DEFAULT_SCORING_CONFIG: ScoringConfig = Object.freeze({
  goal_points: 3,
  goal_difference_weight: 1,
  clean_sheet_bonus: 4,
  round_progression_multipliers: Object.freeze({
    G1: 1,
    G2: 1,
    G3: 1,
    R32: 2,
    R16: 3,
    QF: 5,
    SF: 8,
    F: 13,
  }),
  undefeated_bonus: 10,
  conceded_penalty: -1,
  yellow_penalty: -1,
  red_penalty: -4,
  foul_penalty: 0,
  offside_penalty: 0,
  missed_pen_penalty: -2,
}) as ScoringConfig;

// ─── SYNERGY / TEAM-STRENGTH FOLD ─────────────────────────────────────────────
// CALIBRATION: tune vs historical scorelines.
//
// BOUNDED-MULTIPLIER INVARIANT: the Synergy multiplier and the manager modifier
// are each confined to a narrow band around 1.0 so a high-Synergy weak XI can
// never out-aggregate a low-Synergy superstar XI (Synergy AMPLIFIES talent, it
// does not REPLACE it). The bands below are the lock.
export const SYNERGY = Object.freeze({
  /** Weight of the nation-cluster component in `overall` (0..100). */
  CLUSTER_WEIGHT: 0.45,
  /** Weight of the linked-pair component in `overall`. */
  LINK_WEIGHT: 0.4,
  /** Weight of the manager-link component in `overall`. */
  MANAGER_WEIGHT: 0.15,
  /** Multiplier band half-width: multiplier ∈ [1 - BAND, 1 + BAND]. */
  MULTIPLIER_BAND: 0.12,
  /**
   * Minimum fraction of the XI that must share the manager's nation for a full
   * manager_link of 1.0 (linear below this).
   */
  MANAGER_LINK_FULL_AT: 0.6,
});

export const MANAGER_MODIFIER = Object.freeze({
  /** Modifier band half-width: modifier ∈ [1 - BAND, 1 + BAND]; null manager → 1.0. */
  BAND: 0.1,
  /** Manager rating pivot — a manager rated this is neutral (modifier 1.0). */
  PIVOT: 50,
});

/** Clamp a number into an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Clamp then round to an integer in [0, 100] — the rating-channel domain. */
export function toChannelInt(value: number): number {
  return Math.round(clamp(value, 0, 100));
}
