// WS-B box-score reducer — derives PlayerMatchStats / PlayerRunStats purely
// from `MatchResult.events` + `MatchResult.lineup`. The mapping is the contract
// documented on `types/stats.ts`; this file is the single canonical reducer so
// a derived stat can never drift from the underlying atomic event stream.

import type { CardId } from "../types/identity.js";
import type { MatchEvent, MatchResult } from "../types/sim.js";
import type { PlayerMatchStats, PlayerRunStats } from "../types/stats.js";

/** Count box-score fields for one user player in one match. */
function statsForPlayerInMatch(
  match: MatchResult,
  player_id: string,
  card_id: CardId,
  tournament_id: number,
  minutes: number,
): PlayerMatchStats {
  let goals = 0;
  let assists = 0;
  let shots = 0;
  let shots_on_target = 0;
  let key_passes = 0;
  let fouls_committed = 0;
  let fouls_suffered = 0;
  let offsides = 0;
  let yellows = 0;
  let reds = 0;
  let saves = 0;
  let pens_won = 0;
  let pens_scored = 0;
  let pens_missed = 0;
  let subbed_on = false;
  let subbed_off = false;
  let injured = false;

  for (const e of match.events as MatchEvent[]) {
    switch (e.type) {
      case "goal":
        if (e.scorer_player_id === player_id) {
          goals++;
          shots++;
          shots_on_target++;
        }
        if (e.assist_player_id === player_id) assists++;
        break;
      case "pen_scored":
        if (e.taker_player_id === player_id) {
          goals++;
          shots++;
          shots_on_target++;
          pens_scored++;
        }
        break;
      case "pen_missed":
        if (e.taker_player_id === player_id) {
          shots++;
          if (e.on_target) shots_on_target++;
          pens_missed++;
        }
        break;
      case "shot_on":
        if (e.player_id === player_id) {
          shots++;
          shots_on_target++;
        }
        break;
      case "shot_off":
        if (e.player_id === player_id) shots++;
        break;
      case "key_pass":
        if (e.player_id === player_id) key_passes++;
        break;
      case "foul":
        if (e.committed_by_player_id === player_id) fouls_committed++;
        if (e.suffered_by_player_id === player_id) fouls_suffered++;
        break;
      case "offside":
        if (e.player_id === player_id) offsides++;
        break;
      case "yellow":
        if (e.player_id === player_id) yellows++;
        break;
      case "red":
        if (e.player_id === player_id) reds++;
        break;
      case "save":
        if (e.keeper_player_id === player_id) saves++;
        break;
      case "pen_won":
        if (e.won_by_player_id === player_id) pens_won++;
        break;
      case "injury":
        if (e.player_id === player_id) injured = true;
        break;
      case "sub":
        if (e.in_player_id === player_id) subbed_on = true;
        if (e.out_player_id === player_id) subbed_off = true;
        break;
      // own_goal + shootout_kick never contribute to a counting box score.
      case "own_goal":
      case "shootout_kick":
        break;
      default:
        break;
    }
  }

  return {
    player_id,
    card_id,
    tournament_id,
    match_id: match.match_id,
    goals,
    assists,
    shots,
    shots_on_target,
    key_passes,
    fouls_committed,
    fouls_suffered,
    offsides,
    yellows,
    reds,
    saves,
    pens_won,
    pens_scored,
    pens_missed,
    minutes,
    subbed_on,
    subbed_off,
    injured,
  };
}

const TOTAL_FIELDS = [
  "goals",
  "assists",
  "shots",
  "shots_on_target",
  "key_passes",
  "fouls_committed",
  "fouls_suffered",
  "offsides",
  "yellows",
  "reds",
  "saves",
  "pens_won",
  "pens_scored",
  "pens_missed",
  "minutes",
] as const;

/**
 * Derive the per-player run report cards for the USER side, replaying every
 * match's events + lineup. Players appear once, with one `per_match` entry per
 * match they were in the user lineup (tournament-ending-injured players have
 * no entry in later matches).
 *
 * @param matches            the user's match path (in order).
 * @param ratingOverallOf    card_id → Rating.overall (or null) for the draft
 *                           snapshot. Missing card → null (honest-state).
 */
export function deriveUserPlayerRunStats(
  matches: readonly MatchResult[],
  ratingOverallOf: (card_id: CardId) => number | null,
): PlayerRunStats[] {
  // Stable insertion order keyed by card_id.
  const byCard = new Map<string, PlayerRunStats>();

  for (const match of matches) {
    for (const entry of match.lineup) {
      if (entry.side !== "user") continue;
      const key = entry.card_id as string;
      const pms = statsForPlayerInMatch(
        match,
        entry.player_id,
        entry.card_id,
        entry.tournament_id,
        entry.minutes,
      );
      let agg = byCard.get(key);
      if (!agg) {
        agg = {
          player_id: entry.player_id,
          card_id: entry.card_id,
          tournament_id: entry.tournament_id,
          per_match: [],
          totals: {
            goals: 0,
            assists: 0,
            shots: 0,
            shots_on_target: 0,
            key_passes: 0,
            fouls_committed: 0,
            fouls_suffered: 0,
            offsides: 0,
            yellows: 0,
            reds: 0,
            saves: 0,
            pens_won: 0,
            pens_scored: 0,
            pens_missed: 0,
            minutes: 0,
          },
          rating_at_draft: ratingOverallOf(entry.card_id),
        };
        byCard.set(key, agg);
      }
      agg.per_match.push(pms);
      const pmsRec = pms as unknown as Record<string, number>;
      const totalsRec = agg.totals as unknown as Record<string, number>;
      for (const f of TOTAL_FIELDS) {
        totalsRec[f] = (totalsRec[f] ?? 0) + (pmsRec[f] ?? 0);
      }
    }
  }

  return [...byCard.values()];
}
