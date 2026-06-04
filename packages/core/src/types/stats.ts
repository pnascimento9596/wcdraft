// Per-player stats layer of the wcdraft data contract.
//
// BOX-SCORE TIER ONLY. Possession, xG, pass maps, heat maps, etc. are
// DEFERRED beyond MVP — keeping the stat surface narrow makes the sim simpler
// and the golden contract tighter.
//
// PlayerMatchStats is per (player, match). PlayerRunStats aggregates per
// player across the run and additionally carries the rating snapshot at draft
// time (so the player's report card can show "rated 82, ended with 4G/2A/1R").

/**
 * Per-player box-score for ONE match.
 *
 * Field semantics:
 *   - `pens_won` are penalty kicks AWARDED to the user side caused by this
 *     player being fouled (not by them scoring one).
 *   - `pens_scored` / `pens_missed` count IN-MATCH spot kicks only. Shootout
 *     pens NEVER appear here — they live on MatchResult.shootout.sequence.
 *   - `subbed_on` / `subbed_off` are independent booleans; a player who came
 *     on AND then went off again has both true (rare but possible).
 *   - `injured` is true iff an injury event for this player occurred in the
 *     match — does not necessarily mean the player left the field.
 */
export interface PlayerMatchStats {
  player_id: string;
  card_id: string;
  match_id: string;

  goals: number;
  assists: number;
  shots: number;
  shots_on_target: number;
  key_passes: number;

  fouls_committed: number;
  fouls_suffered: number;
  offsides: number;

  yellows: number;
  reds: number;
  saves: number;

  pens_won: number;
  pens_scored: number;
  pens_missed: number;

  minutes: number;
  subbed_on: boolean;
  subbed_off: boolean;
  injured: boolean;
}

/**
 * Per-match box-score totals aggregated across the run, with per-match detail
 * preserved for the UI's player report.
 *
 * `totals` excludes per-match-only flags (match_id, subbed_on, subbed_off,
 * injured) because aggregating them across matches would be meaningless.
 */
export interface PlayerRunStats {
  player_id: string;
  card_id: string;
  per_match: PlayerMatchStats[];
  /** Sum across `per_match`; per-match-only flags are dropped. */
  totals: Omit<PlayerMatchStats, "match_id" | "subbed_on" | "subbed_off" | "injured">;
  /**
   * Rating snapshot at draft time (the `Rating.overall` value). `null` allowed
   * because `Rating.overall` itself can be null when coverage is insufficient.
   */
  rating_at_draft: number | null;
}
