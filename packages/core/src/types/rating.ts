// Rating layer of the wcdraft data contract.
//
// CARDINAL RULE FOR THE SIM ENGINE: it consumes ONLY the four numeric channels
// `attack`, `midfield`, `defense`, `goalkeeping`. The `overall` field is for
// DISPLAY in the UI and stat lines; the sim must never read it.
//
// PROJECTED VS PERFORMED ratings are disambiguated by `provenance`:
//   - 'wc_performance'    — derived from actual tournament-card signals.
//   - 'projected_career'  — used for the 2026 tournament where no perf signals
//                            exist yet (career-aggregate inputs computed offline
//                            in ETL; the runtime contract still only sees a
//                            per-card Rating).
//
// COVERAGE BASIS: `coverage_basis` disambiguates the denominator behind
// `coverage` — career-signal coverage and wc-signal coverage are NOT the same
// number even when the numerator (signals present) looks similar.
//
// NO career-aggregate rating entity is defined here on purpose. Career inputs
// live offline in ETL; the runtime contract is per-card Rating only.

/**
 * One factual signal that contributed to a Rating, with its applied weight.
 * The set is intentionally open (free-form `signal` string) so WS-A can publish
 * new component slugs without bumping the type contract.
 */
export interface RatingComponent {
  /** Slug identifying the signal (e.g. "goals_per_90", "minutes_share"). */
  signal: string;
  /** Raw numeric value for the signal, or null when the signal was absent. */
  value: number | null;
  /** Weight applied to this signal in [0, ∞). */
  weight: number;
}

/**
 * Per-card Rating. Identity is the owning card (`card_id`); `player_id` and
 * `tournament_id` are denormalized for downstream joins.
 *
 * `overall` is DISPLAY-ONLY and may be `null` when coverage is insufficient —
 * the honest-state rule applies: NEVER coerce a missing overall to 0.
 *
 * `rating_version` is bumped whenever the rating algorithm changes and is one
 * of the three version anchors required for replay / leaderboard determinism.
 */
export interface Rating {
  /** FK -> PlayerTournament. */
  card_id: string;
  /** Denormalized FK -> Player. */
  player_id: string;
  /** Denormalized FK -> Tournament. */
  tournament_id: number;

  /**
   * DISPLAY-ONLY composite. `null` when coverage is insufficient to rate.
   * The sim engine MUST NOT read this field.
   */
  overall: number | null;

  // ─── SIM-CONSUMED CHANNELS ─────────────────────────────────────────────────
  // These four 0..100 numbers are the ONLY signals the sim consumes from a card.
  // They must always be present (no null) — if coverage is too low to compute
  // them, the card itself should not be issued to the draft pool.
  /** 0..100 attacking strength. */
  attack: number;
  /** 0..100 midfield strength. */
  midfield: number;
  /** 0..100 defensive strength. */
  defense: number;
  /** 0..100 goalkeeping strength. */
  goalkeeping: number;
  // ───────────────────────────────────────────────────────────────────────────

  /** Which factual signals contributed + their weights (transparency aid). */
  components: RatingComponent[];
  /** Honest-state coverage fraction in [0,1] for this rating. */
  coverage: number;
  /**
   * Denominator basis for `coverage` —
   *   'wc_signals'      → tournament-card signals (used for 1930..2022 cards)
   *   'career_signals'  → offline career-aggregate inputs (used for 2026 projections)
   */
  coverage_basis: "wc_signals" | "career_signals";
  /**
   * Whether the rating was derived from real WC performance signals or projected
   * from career aggregates (2026).
   */
  provenance: "wc_performance" | "projected_career";
  /** Rating-algorithm version anchor — one of the three replay anchors. */
  rating_version: string;
}

/**
 * Aggregate strength of a team (USER XI or a Team2026 opponent), computed by
 * the same engine that produces per-card Ratings. Coverage is averaged or
 * minimumed (engine choice; locked once by WS-B golden fixtures).
 */
export interface TeamStrength {
  attack: number;
  midfield: number;
  defense: number;
  goalkeeping: number;
  /** Honest-state coverage in [0,1]. */
  coverage: number;
}
