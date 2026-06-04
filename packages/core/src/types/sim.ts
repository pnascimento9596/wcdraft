// Sim output layer of the wcdraft data contract.
//
// RICH ATOMIC EVENTS — `MatchResult.events` carries one row per ATOMIC happening
// (goal, shot, foul, sub, etc.) and EVERY downstream summary (top scorer, clean
// sheets, narrative facts) is DERIVED from these events. Summaries are NEVER
// independently stored to disk — the events are the source of truth.
//
// This separation matters for the determinism contract: deriving a value (top
// scorer, narrative villain) from events makes it impossible for a summary to
// drift from the underlying events when the engine is replayed.

import type { MatchPeriod, MatchPhase, MatchRound } from "./primitives.js";

/**
 * Atomic in-match event.
 *
 * `counts_for_top_scorer` is set HERE at event time so the resolver
 * (`resolveTopScorer`) never has to re-derive the rule from `type`. Goals from
 * open play and converted penalties → true; own goals and shootout kicks → false.
 *
 * `score_after` is set on goal-type events (goal / own_goal / pen_scored) so
 * downstream narrative derivation can identify equalizers, late winners, etc.
 * from the events alone.
 *
 * `detail` is STRUCTURED string content only (e.g. a sub event uses the
 * format `"{in_card_id}<->{out_card_id}"`). NEVER FREE-FORM PROSE — narrative
 * text is the responsibility of the narrative layer.
 */
export interface MatchEvent {
  event_id: string;
  /**
   * 1..120 inside its `period`. Re-uses the natural football minute count per
   * period; pair with `period` to disambiguate (89' in ET2 vs. 89' in 2H).
   */
  minute: number;
  period: MatchPeriod;
  /** Which side this event applies to. */
  side: "user" | "opp";
  /** Discrete event taxonomy. */
  type:
    | "goal"
    | "own_goal"
    | "pen_scored"
    | "pen_missed"
    | "assist"
    | "shot_on"
    | "shot_off"
    | "save"
    | "shootout_score"
    | "shootout_miss"
    | "shootout_save"
    | "foul"
    | "offside"
    | "yellow"
    | "red"
    | "injury"
    | "sub";
  /**
   * Player on `side` who triggered the event (scorer, fouler, saved keeper).
   * Null for events not attributable to a single player.
   */
  player_id: string | null;
  /** Assister player_id for goal events; null otherwise. */
  assist_player_id: string | null;
  /**
   * Snapshot of the score immediately AFTER this event applies. Set on
   * goal-type events (goal / own_goal / pen_scored) and null otherwise. The
   * narrative layer reads this to identify equalizers / late winners.
   */
  score_after: { user: number; opp: number } | null;
  /**
   * True iff this event should count toward the top-scorer derivation. Set
   * at event-creation time so `resolveTopScorer` never re-applies the rule:
   *   - goal, pen_scored (in match)  → true
   *   - own_goal                     → false (scorer of an OG never wins TS)
   *   - shootout_score               → false (shootout pens never win TS)
   *   - everything else              → false
   */
  counts_for_top_scorer: boolean;
  /**
   * STRUCTURED detail string only. Examples:
   *   - sub event:  `"{in_card_id}<->{out_card_id}"`
   *   - injury:     `"{severity}"`
   *   - pen events: `"{spot}"`
   * NEVER free-form prose.
   */
  detail: string | null;
}

/**
 * A single shootout kick. Ordering is by `index` ascending.
 * NEVER contributes to top-scorer counting (see `MatchEvent.counts_for_top_scorer`).
 */
export interface ShootoutKick {
  index: number;
  side: "user" | "opp";
  /** Taker; null if the kick was somehow attributed to no player. */
  player_id: string | null;
  scored: boolean;
}

/**
 * The result of one of the eight matches on the user's path through a scenario.
 *
 * REGULATION vs. ET vs. SHOOTOUT:
 *   - `user_goals` / `opp_goals` are REGULATION (90 minutes) only.
 *   - `user_goals_et` / `opp_goals_et` are non-null IFF ET was played
 *     (knockout + level after 90).
 *   - `shootout` is non-null IFF the match remained level after ET.
 *
 * `outcome` is the SPORTING result, including shootout resolution.
 * `counts_as_run_win` is true for both regulation/ET wins AND shootout wins —
 * shootouts count as run wins. `advanced` mirrors the bracket effect.
 */
export interface MatchResult {
  match_id: string;
  /** 0..7 ordering within the run. */
  match_index: number;
  round: MatchRound;
  phase: MatchPhase;
  opponent_team_id: string;

  /** Regulation (90') goals. */
  user_goals: number;
  /** Regulation (90') goals against. */
  opp_goals: number;

  /** Goals scored in ET; null unless ET was played. */
  user_goals_et: number | null;
  /** Goals conceded in ET; null unless ET was played. */
  opp_goals_et: number | null;

  /**
   * Shootout payload — non-null IFF the match was knockout AND tied after ET.
   * The sequence array preserves kick order for narrative derivation.
   */
  shootout: {
    user: number;
    opp: number;
    sequence: ShootoutKick[];
  } | null;

  /** Sporting result including shootout resolution. */
  outcome: "W" | "D" | "L";
  /** True for both regulation/ET wins and shootout wins. */
  counts_as_run_win: boolean;
  /** True iff this match advanced the user into the next round. */
  advanced: boolean;

  /** Atomic event log; source of truth for all derived summaries. */
  events: MatchEvent[];
}
