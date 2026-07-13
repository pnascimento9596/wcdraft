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
// ENGINE_VERSION POLICY (E-3a → resolved at the season merge):
//   Historically a change to any constant in this file moves a golden
//   `RunResult` byte and therefore REQUIRES an `engine_version` bump
//   (matching the discipline the RNG sequence and rating algorithm
//   already follow). E-3a INTENTIONALLY DEFERRED that bump to the season
//   merge — the constants changed AND the impacted sim goldens (sim /
//   simulate-match / e2e / group-stage / top-scorer) were re-locked on the
//   engine-v2 chain, while `engine_version` stayed `engine-2026.06.04`.
//   The engine-v2 season merge resolved that deferred-bump ledger
//   (E-2 / E-1b / E-3a / E-3b / E-4) into one atomic stamp bump. That bump
//   was a STAMP change only — sim logic was byte-identical, so the pure-sim
//   goldens (sim / rng / draft) did NOT move; only stamp-carrying payloads
//   (e2e-real-run, run-record, compact manifest, asym-realism) re-locked.
//
//   merit-v4.3: λ refit after the owner-authored manual override distribution
//   moved the 2026 channel pool. The fit lowers BASE/SPREAD, raises MIN, and
//   trims group-phase dispersion while keeping the KO factor and KO dispersion.
//   Runtime stamp: `engine-2026.06.15-merit-v4.3`.
//
//   merit-v4.4: NO λ change. The owner re-rate moves the CURRENT basis only; the
//   realism gate and strategic-pick canary sim the default/Career basis, whose
//   channel distribution is untouched. λ is carried over verbatim (refitting here
//   would be re-locking calibration to a distribution that did not move). Runtime
//   stamp bumps to `engine-2026.06.16-merit-v4.4` (stamp-only carry-over).
//
//   merit-v4.5: λ refit after the recovered v4.3 honest misses moved the
//   default/Career display and channel distribution. The deterministic fitter
//   kept the merit-v4.3 λ tuple and only trimmed group-phase dispersion
//   GROUP_OUTER_PROB 0.04 -> 0.02. Runtime stamp:
//   `engine-2026.06.17-merit-v4.5`.
//
//   merit-v4.6: λ refit after manual override channels were restored to the
//   curve-inverted internal scale instead of the owner-facing display scale.
//   The fitter restores the lower λ floor, raises BASE/GAMMA_MID, and widens
//   group-phase dispersion so the corrected channel pool lands in the modern
//   WC scoreline bands before the realism re-lock. Runtime stamp:
//   `engine-2026.06.28-merit-v4.6`.
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
   * merit-v4.6 REFIT: BASE=1.10 after curve-inverting manual override internals
   * back onto the natural channel scale; the lower override channels otherwise
   * made the merit-v4.5 tuple under-shoot mean goals.
   */
  BASE: 1.1,
  /**
   * Sensitivity to the (attack − defResist) edge, per 100 channel points.
   * E-3a lifted SPREAD 4.0 -> 6.5 to unlock the `margin >= 4 ~= 4.9%` tight
   * band. merit-v4.3 lands at 5.5 after owner pins lowered much of the pool
   * but preserved enough channel separation to keep high-margin results in band.
   */
  SPREAD: 5.5,
  /**
   * Floor — even a hopeless attack still threatens occasionally. merit-v4.3
   * raised MIN to 0.80 for the owner-pin channel pool; merit-v4.6 restores
   * MIN=0.30 after the curve-inverted override channels re-balance the pool.
   */
  MIN: 0.3,
  /** Ceiling — keeps blowouts bounded and the binomial well-defined. */
  MAX: 3.4,
  /**
   * Weight on opponent DEFENSE channel inside `defResist`. E-3a REFIT
   * landed W_DEF=0.70: a slightly higher defense weight keeps elite
   * defensive XIs legible while leaving GK with a meaningful (W_GK=0.30)
   * channel of its own.
   */
  W_DEF: 0.7,
  /** Weight on opponent GOALKEEPING channel inside `defResist`. Must satisfy W_DEF + W_GK === 1. */
  W_GK: 0.3,
  /**
   * Sensitivity of `control_for` to the midfield delta (per 100 channel
   * points). E-3a raised gamma_mid to 0.50; MV2-11b raised it to 0.60;
   * merit-v3 V7 landed at 0.80 on the extended grid; merit-v4.1 landed at
   * 1.00 after the projected objective-record display move; merit-v4.2 and
   * merit-v4.3 land at 0.70 after the later channel-pool moves; merit-v4.6
   * returns to 1.00 after override-heavy midfields moved down to the natural
   * internal scale. The bounded multiplier (CONTROL_BAND_LO/HI) is unchanged
   * so midfield STILL amplifies, never replaces, the attack/defense edge.
   */
  GAMMA_MID: 1,
  /** Lower bound of the midfield `control_for` multiplier — keeps midfield from REPLACING talent. */
  CONTROL_BAND_LO: 0.85,
  /** Upper bound of the midfield `control_for` multiplier. */
  CONTROL_BAND_HI: 1.15,
  /** Fraction of a regulation λ that applies across a 30-minute extra time. */
  ET_FRACTION: 30 / 90,
  /**
   * Multiplicative λ factor applied to BOTH sides during KNOCKOUT regulation
   * (phase === "knockout"). Models the documented modern-WC phenomenon that
   * knockout matches are more tactical / cagier than group matches: real WC
   * 1998–2022 shows knockout regulation goals/match running ~10–15% below
   * the group rate (with the gap soaking into the KO-tied + ET + shootout
   * tail).
   *
   * In the symmetric coherent-XI sweep, `group_draw` and `KO → ET` would
   * otherwise measure the IDENTICAL statistic (matches tied after 90′) on
   * the same population, so the 24.7% group-draw norm and the 33% KO → ET
   * norm cannot BOTH be hit without a phase-dependent driver. This factor
   * is that driver — fitted (D6) jointly with the four-channel λ + the
   * match-level dispersion so all five modern-era norms land inside the
   * D5-tight bands simultaneously.
   *
   * Bound: must be in (0, 1]. A value of 1.0 disables the phase split
   * (engine reverts to the pre-refit single-phase λ for everything). The
   * ET phase inherits the factor via `lambdaUser * ET_FRACTION` — extra
   * time is already cagier by virtue of `ET_FRACTION = 30/90`. E-3a REFIT
   * D6 landed 0.85; MV2-11b landed 0.82 — after the BASE/SPREAD lift this
   * re-centers mean goals (2.544 vs 2.564) and the shootout rate inside
   * their bands, with KO regulation running ~18% below group goals (still
   * inside the documented modern-WC 10–20% gap).
   */
  KO_LAMBDA_FACTOR: 0.82,
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

// ─── MATCH-LEVEL λ DISPERSION (E-3a refit, D1 path) ──────────────────────────
//
// PROBLEM. A pure two-independent-Poisson scoreline model is Pareto-limited
// in TWO ways relative to the modern-era WC norms measured on the symmetric
// coherent-XI sweep:
//
//   (a) At the modern-era WC mean (2.54 goals/match, λ_per_side ≈ 1.27),
//       the maximum tie rate is ≈ 24.6%. The modern-era KO-tied-after-
//       regulation norm is 33% and the shootout rate 21.4%. No grid search
//       over the four-channel λ + chance budget can clear both
//       `mean_goals ≈ 2.54` AND `KO → ET ≈ 33%` in pure Poisson — they live
//       on opposite faces of the Pareto frontier.
//   (b) `group_draw` and `KO → ET` measure the SAME statistic (matches
//       tied after 90′) on the same population, so the modern-era norms
//       (24.7% group, 33% KO) cannot BOTH be hit without a PHASE-DEPENDENT
//       driver. Real WC has different rates because the populations differ
//       (group matches include weak vs strong; KO matches are between
//       qualifying teams) — the symmetric sweep cannot capture that.
//
// FIX (D1 — parity-dependent variance, phase-aware dispersion).
// Each match draws ONE deterministic ε ∈ {1−A, 1, 1+A} (a discrete 3-point
// distribution, mean exactly 1, integer/rational arithmetic only) from
// `structRng` BEFORE any chance is generated. The phase selects its tuple:
// KO uses (OUTER_PROB, A), while group uses (GROUP_OUTER_PROB, GROUP_A).
// Both sides' λ are scaled together by ε — preserving the favourite ordering —
// to lift the KO-tied / shootout tail and the group high-margin tail onto the
// modern-era norms:
//
//   ε = 1 − A  with probability  OUTER_PROB    → "cagey KO" (more 0-0, 1-1, more ties)
//   ε = 1      with probability  1 − 2·OUTER_PROB
//   ε = 1 + A  with probability  OUTER_PROB    → "open KO"  (more 3-3, 4-4, more ties)
//
// E[ε] = 1 → mean goals within each phase is preserved (the
// `LAMBDA.KO_LAMBDA_FACTOR` constant does the KO goal-rate reduction);
// Var[ε] = 2·outer·A² is the dispersion engine. Group dispersion is deliberately
// milder than KO dispersion so it lifts `margin >= 4` without pushing
// `group_draw` outside the D5-tight band.
//
// DETERMINISM. ε is drawn via a single `structRng.next()` call EVEN IN
// GROUP MATCHES (the gate uses the value but always consumes the draw), so
// the rng sequence is invariant to the phase split. No transcendental math
// anywhere. The discrete distribution is encoded as rational thresholds.
// Cross-platform byte-identical output preserved.
//
// HONEST-STATE. ε is a match-level "style" multiplier (cagey vs open) — the
// per-side aggregate λ ordering (favourite still favoured) is preserved by
// applying the SAME ε to both sides. No channel becomes opaquely advantaged.
//
// FAITHFULNESS. Bounded multiplier (ε ∈ [1−A, 1+A]) by construction means a
// cagey KO match cannot invert the favourite/underdog ordering and an open
// KO match cannot manufacture a blowout from nothing. The bound is the
// "amplifies, never replaces" guarantee for the dispersion mechanism.
export const LAMBDA_DISP = Object.freeze({
  /**
   * KO-phase mass on EACH outer point of the discrete ε distribution (so the
   * centre mass is `1 − 2·OUTER_PROB`). Must satisfy `2·OUTER_PROB ≤ 1`. Set
   * to 0 to disable KO dispersion (ε ≡ 1 in KO — pure Poisson scoring there).
   * E-3a REFIT D6: OUTER_PROB=0.20 → 40% of KO matches are "non-neutral"
   * (cagey OR open), 60% stay at neutral λ.
   */
  OUTER_PROB: 0.2,
  /**
   * KO-phase half-width: ε ∈ {1 − A, 1, 1 + A}. Must satisfy `A < 1`. The
   * KO dispersion magnitude is Var[ε] = 2·OUTER_PROB·A² — E-3a REFIT D6
   * landed A=0.75 to lift KO → ET and shootout rates onto the modern-era
   * norms (33% / 21.4%).
   */
  A: 0.75,
  /**
   * GROUP-phase outer mass. Same shape as `OUTER_PROB` but applied to group
   * matches. merit-v4.6 REFIT: GROUP_OUTER_PROB=0.14 (still below KO's 0.20)
   * — group_draw must stay inside the D5-tight band [22.88%, 26.52%], so the
   * group dispersion is only frequent enough to lift `margin >= 4` into
   * [4.12%, 5.70%] without inflating group_draw past 26.5%.
   * Set to 0 to disable group dispersion.
   */
  GROUP_OUTER_PROB: 0.14,
  /**
   * GROUP-phase half-width. merit-v4.3 REFIT: GROUP_A=0.40 — lower than the
   * default to drive the high-margin tail (~4.7% margin≥4) while the
   * sparse OUTER_PROB keeps the group_draw rate inside the tight band.
   * Group phase doesn't need the KO-tied lift, only the asymmetric-
   * scoreline tail boost.
   */
  GROUP_A: 0.4,
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
  SAVED_SHARE: 0.1,
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
  /** S2/S3 calibration seam: probability of one pre-match availability event. */
  AVAILABILITY_EVENT_PROB: 0.09,
  /**
   * Probability a given injury ends the player's tournament (persists across
   * the run). Lowered for the engine-season attrition pass because persistent
   * tournament attrition only applies to the user's squad path; opponents are
   * regenerated per fixture rather than tracked as a full tournament roster.
   */
  TOURNAMENT_ENDING_PROB: 0.12,
  /** Conditional probability that a minor event is a knock rather than a suspension. */
  MINOR_KNOCK_PROB: 0.65,
  /** Conditional probability that a minor event lasts two matches instead of one. */
  MINOR_TWO_MATCH_PROB: 0.35,
  /** Hard per-run cap for minor availability events. */
  MAX_MINOR_EVENTS_PER_RUN: 3,
  /** Extra all-channel penalty per unfilled formation slot. S3 owns the final value. */
  SHORT_HANDED_STRENGTH_MULTIPLIER: 0.92,
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
  /** Positive manager-link bonus band: modifier ∈ [1.0, 1 + BAND]; manager_link 0 -> 1.0. */
  BAND: 0.1,
});

/**
 * S2 per-match tactical channel. S3 owns the final WIDTH calibration; S2
 * intentionally starts at a conservative one-percent maximum so the new
 * channel is reachable and measurable without pre-empting the combined
 * manager-sensitivity calibration.
 */
export const MANAGER_TACTICAL = Object.freeze({
  /** Canonical persisted internal tiers are +0, +1, and +2. */
  MAX_BAND: 2,
  /** Maximum multiplicative uplift at MAX_BAND. S3 is the sole tuning owner. */
  WIDTH: 0.01,
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
  const base = clamp(L.BASE + (L.SPREAD * (forSide.attack - defResist)) / 100, L.MIN, L.MAX);
  return base * midfieldControl(forSide, against);
}

/**
 * Per-match λ dispersion multiplier ε ∈ {1−A, 1, 1+A} drawn from a discrete
 * 3-point symmetric distribution (mean 1 exactly). Consumes EXACTLY ONE
 * `rng.next()` call so the rng sequence is invariant to phase / config.
 *
 * The per-phase (OUTER_PROB, A) tuple is picked by `phase`:
 *   - "knockout" → `LAMBDA_DISP.OUTER_PROB`, `LAMBDA_DISP.A` (strong dispersion
 *     to lift KO → ET / shootout onto the modern-era norms).
 *   - else (group) → `LAMBDA_DISP.GROUP_OUTER_PROB`, `LAMBDA_DISP.GROUP_A`
 *     (mild dispersion — only enough to lift `margin ≥ 4` into band; the
 *     group_draw rate must stay inside the D5-tight band).
 *
 * Mean(ε)=1 preserves goals/match by construction; Var(ε)=2·OUTER_PROB·A²
 * is the dispersion magnitude. Applied to BOTH sides' λ → match-level
 * "style" knob (cagey vs open), legibility preserved.
 *
 * Determinism (D-INV): single rational comparison against `rng.next()`.
 * No transcendental math. Byte-identical output across platforms.
 *
 * Disabled-state contract (D-OFF): when the phase-relevant outer mass is 0
 * the function STILL consumes its `rng.next()` call (so the on/off
 * transition is a single, audited rng-sequence shift carried by the
 * engine_version bump). The returned ε is exactly `1` in that case.
 */
export function lambdaDispersionMultiplier(
  rng: { next: () => number },
  phase: "group" | "knockout",
): number {
  const D = activeLambdaDisp();
  const roll = rng.next();
  const outer = phase === "knockout" ? D.OUTER_PROB : D.GROUP_OUTER_PROB;
  const a = phase === "knockout" ? D.A : D.GROUP_A;
  if (outer <= 0) return 1;
  if (roll < outer) return 1 - a;
  if (roll < 2 * outer) return 1 + a;
  return 1;
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
  LAMBDA_DISP?: Partial<typeof LAMBDA_DISP>;
}

let __activeLambda: typeof LAMBDA = LAMBDA;
let __activeChances: typeof CHANCES = CHANCES;
let __activeLambdaDisp: typeof LAMBDA_DISP = LAMBDA_DISP;

/** Return the currently-active λ constants. Equals `LAMBDA` unless the D6 fit has set an override. */
export function activeLambda(): typeof LAMBDA {
  return __activeLambda;
}

/** Return the currently-active chance budget. Equals `CHANCES` unless the D6 fit has set an override. */
export function activeChances(): typeof CHANCES {
  return __activeChances;
}

/** Return the currently-active λ dispersion params. Equals `LAMBDA_DISP` unless the D6 fit has set an override. */
export function activeLambdaDisp(): typeof LAMBDA_DISP {
  return __activeLambdaDisp;
}

/**
 * D6 FIT ONLY. Swap λ + CHANCES + LAMBDA_DISP constants for the next
 * ensemble. Production code MUST NOT call this. Always paired with
 * `__UNSAFE_clearCalibrationOverride`.
 */
export function __UNSAFE_setCalibrationOverride(o: CalibrationOverride): void {
  __activeLambda = Object.freeze({ ...LAMBDA, ...(o.LAMBDA ?? {}) }) as typeof LAMBDA;
  __activeChances = Object.freeze({ ...CHANCES, ...(o.CHANCES ?? {}) }) as typeof CHANCES;
  __activeLambdaDisp = Object.freeze({
    ...LAMBDA_DISP,
    ...(o.LAMBDA_DISP ?? {}),
  }) as typeof LAMBDA_DISP;
}

/** D6 FIT ONLY. Restore production-default constants. */
export function __UNSAFE_clearCalibrationOverride(): void {
  __activeLambda = LAMBDA;
  __activeChances = CHANCES;
  __activeLambdaDisp = LAMBDA_DISP;
}
