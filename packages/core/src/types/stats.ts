// Per-player stats layer of the wcdraft data contract.
//
// BOX-SCORE TIER ONLY. Possession, xG, pass maps, heat maps, etc. are
// DEFERRED beyond MVP — keeping the stat surface narrow makes the sim simpler
// and the golden contract tighter.
//
// PlayerMatchStats is per (player, match). PlayerRunStats aggregates per
// player across the run and additionally carries the rating snapshot at draft
// time (so the player's report card can show "rated 82, ended with 4G/2A/1R").

import type { CardId } from "./identity.js";

/**
 * Per-player box-score for ONE match.
 *
 * ATOMIC DERIVATION SOURCES — every field below MUST be derivable from
 * `MatchResult.events` (typed discriminated union) and `MatchResult.lineup`
 * for the same `(player_id, tournament_id)`. The mapping is the contract:
 *
 *   - goals            ← count of `goal` (where scorer is this player)
 *                         + `pen_scored` (taker is this player)
 *                         events. Excludes `own_goal` and `shootout_kick`.
 *   - assists          ← count of `goal.assist_card_id`/`assist_player_id`
 *                         matching this player.
 *   - shots            ← count of `goal` + `pen_scored` + `pen_missed`
 *                         + `shot_on` + `shot_off` events for this player.
 *   - shots_on_target  ← count of `goal` + `pen_scored` + `shot_on` +
 *                         `pen_missed.on_target === true` for this player.
 *   - key_passes       ← count of `key_pass` events for this player.
 *   - fouls_committed  ← count of `foul.committed_by_*` matching this player.
 *   - fouls_suffered   ← count of `foul.suffered_by_*` matching this player.
 *   - offsides         ← count of `offside` events for this player.
 *   - yellows          ← count of `yellow` events for this player.
 *   - reds             ← count of `red` events for this player.
 *   - saves            ← count of in-match `save` events for this keeper
 *                         (excludes shootout kicks — those live on
 *                          `shootout_kick.scored === false`).
 *   - pens_won         ← count of `pen_won` events where this player was the
 *                         fouled / `won_by_*` player.
 *   - pens_scored      ← count of `pen_scored` events (taker == this player).
 *                         In-match only; never shootout.
 *   - pens_missed      ← count of `pen_missed` events (taker == this player).
 *                         In-match only; never shootout.
 *   - minutes          ← the matching `MatchLineupEntry.minutes` for this
 *                         player on this match (NEVER from
 *                         `PlayerTournament` — that source field doesn't
 *                         exist in Fjelstul). Schema requires a lineup entry.
 *   - subbed_on        ← true iff any `sub.in_*` event references this
 *                         player on the matching side.
 *   - subbed_off       ← true iff any `sub.out_*` event references this
 *                         player on the matching side.
 *   - injured          ← true iff any `injury` event references this player.
 *
 * `card_id` MUST equal `buildCardId(player_id, tournament_id)` — schema
 * refinement enforces this at the trust boundary.
 */
export interface PlayerMatchStats {
  player_id: string;
  card_id: CardId;
  tournament_id: number;
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
 * injured) AND excludes the identity fields (player_id, card_id,
 * tournament_id) — the IDs live on the outer `PlayerRunStats`, not inside the
 * aggregate. Aggregating identity fields across matches would be meaningless.
 */
export interface PlayerRunStats {
  player_id: string;
  card_id: CardId;
  tournament_id: number;
  per_match: PlayerMatchStats[];
  /** Sum across `per_match`; identity fields and per-match-only flags are dropped. */
  totals: Omit<
    PlayerMatchStats,
    "player_id" | "card_id" | "tournament_id" | "match_id" | "subbed_on" | "subbed_off" | "injured"
  >;
  /**
   * Rating snapshot at draft time (the `Rating.overall` value). `null` allowed
   * because `Rating.overall` itself can be null when coverage is insufficient.
   */
  rating_at_draft: number | null;
}
