// WS-B CALIBRATION CONSTANTS — the single home for every tunable number in the
// sim + scoring engine.
//
// ─────────────────────────────────────────────────────────────────────────────
// CALIBRATION: tune vs historical WC scoreline distributions.
// ─────────────────────────────────────────────────────────────────────────────
// E-3a (engine-v2) — FAITHFULNESS + REALISM landing:
//   The λ map is now a four-channel form driven by the user XI's ATTACK,
//   GOALKEEPING + DEFENSE (opponent side, weighted into a single defensive
//   resistance), and MIDFIELD (a bounded control modulator) plus the
//   bounded Synergy multiplier that already lives upstream on
//   `TeamStrength`. The chance budget is raised so Binomial(n, λ/n) is
//   genuinely Poisson-like at WC scale and the per-chance MAX_GOAL_PROB
//   cap stops binding for realistic λ. The fitted tuple
//     {SPREAD, w_def, w_gk, γ_mid, BASE, MIN, MAX, n}
//   was found by a deterministic seeded coordinate search (D6) over the
//   era-weighted draft-reachable squad population, subject to the D4
//   faithfulness assertions passing. See SIM_CALIBRATION.md for the landing
//   report (norms hit, search seed, candidate scores).
//
// ENGINE_VERSION POLICY (E-3a):
//   Historically a change to any constant in this file moves a golden
//   `RunResult` byte and therefore REQUIRES an `engine_version` bump
//   (matching the discipline the RNG sequence and rating algorithm
//   already follow). E-3a INTENTIONALLY DEFERS that bump to the season
//   merge — the constants change AND the impacted goldens (sim /
//   simulate-match / e2e / group-stage / top-scorer) are re-locked on the
//   `engine-v2-e3a-lambda-calibration` branch, but `engine_version`
//   remains `engine-2026.06.04` (pinned by
//   `packages/data/test/compact-data.integrity.test.ts`). This is the
//   ONLY sanctioned exception; it is locked to the engine-v2 chain.
//
// DETERMINISM NOTE: the engine deliberately avoids transcendental math
// (exp/log/pow with fractional exponents) so a given seed yields byte-identical
// output on every platform/engine. λ is a clamped LINEAR map and goal counts
// are drawn as a BINOMIAL over a fixed chance budget (rational arithmetic only)
// — never a Knuth-Poisson sampler (which needs exp(-λ)).

import type { ScoringConfig } from "../types/scoring.js";
import type { TeamStrength } from "../types/rating.js";

// ─── λ (EXPECTED GOALS) MAP — E-3a four-channel form ──────────────────────────
//
// Conceptual form (defResist + control_for + λ_for is implemented in
// `lambdaForFour` below):
//
//   defResist_against = clamp_int( w_def·defenseAgainst + w_gk·goalkeepingAgainst )
//                                  // single 0..100 defensive-resistance number
//                                  // — opponent's GK channel suppresses your λ
//                                  // through the same surface as the defense
//                                  // channel. No opaque "no GK" penalty: a
//                                  // weak GK channel ALREADY concedes more
//                                  // through this map (D3: GK stays emergent).
//
//   control_for       = clamp( 1 + γ_mid·(midfieldFor − midfieldAgainst)/100,
//                              CONTROL_BAND_LO, CONTROL_BAND_HI )
//                                  // bounded multiplicative modulator (±15%):
//                                  // midfield amplifies attack, never replaces.
//
//   λ_for = clamp( BASE + SPREAD·(attackFor − defResist_against)/100, MIN, MAX )
//             · control_for
//
// w_def + w_gk MUST sum to 1.0 — this keeps `defResist` on the same 0..100
// scale as the old single-channel `defense` term so BASE / SPREAD / MIN / MAX
// remain interpretable on the compressed display band [66, 99].
//
// SYNERGY does NOT enter the λ map directly — it is already folded into the
// four channels via `aggregateUserXiStrength(starters, synergy, manager)`
// (bounded multiplier, see SYNERGY.MULTIPLIER_BAND). Synergy thus AMPLIFIES
// each of the four legible drivers; it does not bypass them.
export const LAMBDA = Object.freeze({
  /**
   * Baseline goals for an evenly-matched team (attack == opp defResist).
   * E-3a D6 fit landed BASE=0.85: under the new n=50 Poisson-like budget
   * the per-team scoreline is much less noisy than under n=14, so a lower
   * BASE keeps mean goals/match near the 2.54 modern-WC norm.
   */
  BASE: 0.85,
  /** Sensitivity to the (attack − defResist) edge, per 100 channel points. */
  SPREAD: 4.0,
  /**
   * Floor — even a hopeless attack still threatens occasionally. Raised to
   * 0.75 by the D6 fit so weak underdogs still produce credible goals/game
   * and KO-stage ET/SO rates land near the modern-WC norms.
   */
  MIN: 0.75,
  /** Ceiling — keeps blowouts bounded and the binomial well-defined. */
  MAX: 3.4,
  /** Weight on opponent DEFENSE channel inside `defResist` (D6 fit: 0.65). */
  W_DEF: 0.65,
  /** Weight on opponent GOALKEEPING channel inside `defResist`. Must satisfy W_DEF + W_GK === 1. */
  W_GK: 0.35,
  /**
   * Sensitivity of `control_for` to the midfield delta (per 100 channel
   * points). D6 fit landed γ_mid=0.45 — the legibility-via-midfield
   * channel is now near the upper end of its bounded band.
   */
  GAMMA_MID: 0.45,
  /** Lower bound of the midfield `control_for` multiplier — keeps midfield from REPLACING talent. */
  CONTROL_BAND_LO: 0.85,
  /** Upper bound of the midfield `control_for` multiplier. */
  CONTROL_BAND_HI: 1.15,
  /** Fraction of a regulation λ that applies across a 30-minute extra time. */
  ET_FRACTION: 30 / 90,
});

// ─── CHANCE BUDGET (binomial goal model) ──────────────────────────────────────
//
// Each team gets a fixed budget of "chances" per phase. Each chance is one
// seeded Bernoulli trial: with probability p_goal = λ / chances it is a goal.
// Goals ~ Binomial(chances, λ/chances) → mean = λ. As `chances` grows the
// binomial converges to Poisson (with the same mean), restoring genuinely
// Poisson-like scoreline dispersion at WC scale — without ever evaluating
// `exp(-λ)` (which would break cross-platform determinism).
//
// E-3a: the chance budget was raised from 14 (E-2 era) to a value chosen so
// p_goal = λ / chances stays comfortably below MAX_GOAL_PROB across the full
// fitted λ range [MIN, MAX]. The cap is now an effectively-unreachable
// guard rather than a binding ceiling — see SIM_CALIBRATION.md.
export const CHANCES = Object.freeze({
  /** Chances per team across 90' regulation (raised in E-3a from 14). */
  REGULATION: 50,
  /** Chances per team across 30' extra time. Scales with REGULATION * ET_FRACTION (rounded). */
  EXTRA_TIME: 17,
  /** Hard cap on per-chance goal probability — at REGULATION=50 and MAX=3.4, λ/n=0.068 ≪ 0.6, so the cap is a guard only. */
  MAX_GOAL_PROB: 0.6,
});

// ─── PER-CHANCE OUTCOME SPLIT (conditioned on a chance occurring, non-goal) ────
//
// After the goal test fails, the remaining probability mass splits into a
// saved shot (on target), an off-target shot, a foul, an offside, or open
// play (no shot — which logs a key pass for box-score colour). Values are
// the conditional shares of the NON-goal mass.
//
// E-3a re-normalization: shares were rescaled so per-team-per-match EVENT
// counts remain realistic now that the chance budget is ~3.6× larger.
// Targets (per side, regulation, evenly-matched, n=50, E[goals]≈1.25):
//   shots on target  ≈ 4.9   (SAVED  · 48.75)
//   shots off target ≈ 6.8   (OFF    · 48.75)
//   fouls            ≈ 10.7  (FOUL   · 48.75)
//   offsides         ≈ 1.95  (OFFSIDE· 48.75)
//   remainder ~50% is open-play key-pass colour (box-score honest, not noise).
export const CHANCE_OUTCOME = Object.freeze({
  /** Share of non-goal chances that are shots on target (→ save event). */
  SAVED_SHARE: 0.10,
  /** Share of non-goal chances that are off-target shots. */
  OFF_TARGET_SHARE: 0.14,
  /** Share of non-goal chances that surface a foul. */
  FOUL_SHARE: 0.22,
  /** Share of non-goal chances that surface an offside. */
  OFFSIDE_SHARE: 0.04,
  /** Remaining mass (~0.50) is uneventful open play (a key pass is logged for colour). */
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

// ─── λ FOUR-CHANNEL HELPERS (E-3a) ────────────────────────────────────────────
//
// Kept in calibration.ts (alongside the constants they consume) so any future
// re-tune touches a single file. `match.ts` calls `lambdaForFour(forCh, againstCh)`
// to obtain the expected-goals rate for a side.

/**
 * Single-number defensive resistance for the SIDE BEING ATTACKED. Folds the
 * opponent's DEFENSE and GOALKEEPING channels with `LAMBDA.W_DEF` /
 * `LAMBDA.W_GK` (W_DEF + W_GK === 1 by contract). Clamped + rounded to the
 * 0..100 channel domain so callers can read it as a sibling of the four raw
 * channels without surprise.
 *
 * Honest-state (D3): the GK channel is folded HERE — a weak GK channel
 * lowers `defResist` and naturally raises the attacker's λ. There is no
 * separate "missing GK" penalty inside the engine.
 */
export function defensiveResistance(against: TeamStrength): number {
  const L = activeLambda();
  const raw = L.W_DEF * against.defense + L.W_GK * against.goalkeeping;
  return toChannelInt(raw);
}

/**
 * Midfield `control_for` modulator. ∈ [CONTROL_BAND_LO, CONTROL_BAND_HI]. A
 * midfield-dominant side gets a small λ uplift; a midfield-shaded side a
 * small λ cut. Bounded so midfield AMPLIFIES, never replaces, the
 * attack/defense edge.
 */
export function midfieldControl(forSide: TeamStrength, against: TeamStrength): number {
  const L = activeLambda();
  const raw = 1 + (L.GAMMA_MID * (forSide.midfield - against.midfield)) / 100;
  return clamp(raw, L.CONTROL_BAND_LO, L.CONTROL_BAND_HI);
}

/**
 * E-3a λ map. Replaces the legacy `λ = clamp(BASE + SPREAD·(att - def)/100, MIN, MAX)`
 * with a four-channel form: opponent DEFENSE + GOALKEEPING fold into
 * `defResist`, MIDFIELD modulates as a bounded multiplier, ATTACK drives the
 * primary edge. The bounded multipliers + the inner clamp keep each channel
 * AMPLIFYING — never replacing — talent.
 */
export function lambdaForFour(forSide: TeamStrength, against: TeamStrength): number {
  const L = activeLambda();
  const defResist = defensiveResistance(against);
  const base = clamp(
    L.BASE + (L.SPREAD * (forSide.attack - defResist)) / 100,
    L.MIN,
    L.MAX,
  );
  return base * midfieldControl(forSide, against);
}


// ─── D6 CALIBRATION FIT OVERRIDE — OFFLINE TOOL ONLY ──────────────────────────
//
// The two getters below return the ACTIVE λ + chance constants. Production
// engine code calls these (not the raw `LAMBDA`/`CHANCES` exports) so the D6
// fit script (`scripts/fit-calibration.ts`) can swap a candidate tuple in for
// the duration of a realism ensemble.
//
// SAFETY:
//   - Default state (no override): `activeLambda() === LAMBDA` and
//     `activeChances() === CHANCES` — byte-identical to the frozen exports,
//     so production runs and goldens never see overridden values.
//   - `__UNSAFE_setCalibrationOverride` is the only mutator. Its name makes
//     it grep-visible and an ESLint guard could be added to forbid it
//     outside `scripts/fit-calibration.ts` (deferred).
//   - The fit script ALWAYS pairs a `setOverride` with a `clearOverride`
//     so a single Node process never leaks an overridden state across
//     evaluations.

export interface CalibrationOverride {
  LAMBDA?: Partial<typeof LAMBDA>;
  CHANCES?: Partial<typeof CHANCES>;
}

let __activeLambda: typeof LAMBDA = LAMBDA;
let __activeChances: typeof CHANCES = CHANCES;

/** Return the currently-active λ constants. Equals `LAMBDA` unless the D6 fit has set an override. */
export function activeLambda(): typeof LAMBDA {
  return __activeLambda;
}

/** Return the currently-active chance budget. Equals `CHANCES` unless the D6 fit has set an override. */
export function activeChances(): typeof CHANCES {
  return __activeChances;
}

/**
 * D6 FIT ONLY. Swap λ + CHANCES constants for the next ensemble. Production
 * code MUST NOT call this. Always paired with `__UNSAFE_clearCalibrationOverride`.
 */
export function __UNSAFE_setCalibrationOverride(o: CalibrationOverride): void {
  __activeLambda = Object.freeze({ ...LAMBDA, ...(o.LAMBDA ?? {}) }) as typeof LAMBDA;
  __activeChances = Object.freeze({ ...CHANCES, ...(o.CHANCES ?? {}) }) as typeof CHANCES;
}

/** D6 FIT ONLY. Restore production-default constants. */
export function __UNSAFE_clearCalibrationOverride(): void {
  __activeLambda = LAMBDA;
  __activeChances = CHANCES;
}
