// Sim output layer of the wcdraft data contract.
//
// RICH ATOMIC EVENTS — `MatchResult.events` carries one row per ATOMIC happening
// (goal, shot, foul, sub, etc.) and EVERY downstream summary (top scorer, clean
// sheets, narrative facts, per-player box-scores) is DERIVED from these events
// + the per-match `lineup`. Summaries are NEVER independently stored to disk
// at the trust boundary — events + lineup are the source of truth.
//
// This separation matters for the determinism contract: deriving a value (top
// scorer, narrative villain, player minutes) from the atomic stream makes it
// impossible for a summary to drift from the underlying events when the engine
// is replayed.

import type { CardId } from "./identity.js";
import type { MatchPeriod, MatchPhase, MatchRound, Position } from "./primitives.js";

/**
 * Fields common to every `MatchEvent` variant. Each variant adds typed
 * variant-specific fields below. There is intentionally NO broad nullable
 * `player_id` / `detail` / `score_after` / `counts_for_top_scorer` on the
 * common shape — derived state is computed from the typed variants, not stored.
 */
interface MatchEventCommon {
  event_id: string;
  /**
   * 1..120 inside its `period`. Re-uses the natural football minute count per
   * period; pair with `period` to disambiguate (89' in ET2 vs. 89' in 2H).
   * Shootout-kick events use `minute: 0` (their order is on `index`).
   */
  minute: number;
  period: MatchPeriod;
  /** Which side this event applies to. */
  side: "user" | "opp";
}

/** Open-play (or assisted) goal. `side` is the scoring team. */
export interface GoalEvent extends MatchEventCommon {
  type: "goal";
  /** Scorer (FK -> Player.player_id). */
  scorer_card_id: CardId;
  scorer_player_id: string;
  /** Assister card, or null when unassisted. */
  assist_card_id: CardId | null;
  assist_player_id: string | null;
  /** Score IMMEDIATELY AFTER this goal applies, for narrative derivation. */
  score_after: { user: number; opp: number };
}

/**
 * Own goal. `side` is the side that BENEFITED (the goal goes onto their tally);
 * `beneficiary_side` mirrors `side` and is restated for narrative clarity. The
 * scorer is the player on the OTHER side.
 */
export interface OwnGoalEvent extends MatchEventCommon {
  type: "own_goal";
  scorer_card_id: CardId;
  scorer_player_id: string;
  /** Which side received the goal (== `side`). */
  beneficiary_side: "user" | "opp";
  score_after: { user: number; opp: number };
}

/** In-match penalty scored. Shootout pens use `shootout_kick`, never this. */
export interface PenScoredEvent extends MatchEventCommon {
  type: "pen_scored";
  taker_card_id: CardId;
  taker_player_id: string;
  score_after: { user: number; opp: number };
}

/** In-match penalty missed (on or off target / saved). Shootout never uses this. */
export interface PenMissedEvent extends MatchEventCommon {
  type: "pen_missed";
  taker_card_id: CardId;
  taker_player_id: string;
  /** True iff the shot was on target (saved); false iff wide / over. */
  on_target: boolean;
  /** Keeper who saved the kick, if on_target; null when off target. */
  saved_by_card_id: CardId | null;
  saved_by_player_id: string | null;
}

/** Penalty won (player on `side` was fouled in the box). */
export interface PenWonEvent extends MatchEventCommon {
  type: "pen_won";
  won_by_card_id: CardId;
  won_by_player_id: string;
  /** Fouling opponent, or null when unattributable. */
  conceded_by_card_id: CardId | null;
  conceded_by_player_id: string | null;
}

export interface ShotOnEvent extends MatchEventCommon {
  type: "shot_on";
  card_id: CardId;
  player_id: string;
}

export interface ShotOffEvent extends MatchEventCommon {
  type: "shot_off";
  card_id: CardId;
  player_id: string;
}

/** In-match save (NEVER shootout — those are encoded on `shootout_kick.scored`). */
export interface SaveEvent extends MatchEventCommon {
  type: "save";
  keeper_card_id: CardId;
  keeper_player_id: string;
  /** Optional back-reference to the shot event saved (null when not attributable). */
  shot_event_id: string | null;
}

export interface KeyPassEvent extends MatchEventCommon {
  type: "key_pass";
  card_id: CardId;
  player_id: string;
  /** Optional back-reference to the event the pass set up (e.g. a shot/goal). */
  for_event_id: string | null;
}

export interface FoulEvent extends MatchEventCommon {
  type: "foul";
  committed_by_card_id: CardId;
  committed_by_player_id: string;
  suffered_by_card_id: CardId;
  suffered_by_player_id: string;
}

export interface OffsideEvent extends MatchEventCommon {
  type: "offside";
  card_id: CardId;
  player_id: string;
}

export interface YellowEvent extends MatchEventCommon {
  type: "yellow";
  card_id: CardId;
  player_id: string;
}

export interface RedEvent extends MatchEventCommon {
  type: "red";
  card_id: CardId;
  player_id: string;
}

/**
 * Injury event. `tournament_ending` true removes the player from this user's
 * remaining run lineups (the squad available across the run can change).
 */
export interface InjuryEvent extends MatchEventCommon {
  type: "injury";
  card_id: CardId;
  player_id: string;
  tournament_ending: boolean;
}

export interface SubEvent extends MatchEventCommon {
  type: "sub";
  in_card_id: CardId;
  in_player_id: string;
  out_card_id: CardId;
  out_player_id: string;
  reason: "tactical" | "injury";
}

/**
 * One shootout kick — replaces the old `shootout_score`/`shootout_miss`/
 * `shootout_save` taxonomy. Shootout kicks NEVER count for top scorer and
 * NEVER contribute to player box-score goals/pens.
 *
 * `period` is always "shootout"; `minute` is `0` (ordering is on `index`).
 * `card_id`/`player_id` may both be null if the kick was unattributable.
 */
export interface ShootoutKickEvent extends MatchEventCommon {
  type: "shootout_kick";
  period: "shootout";
  minute: 0;
  index: number;
  taker_card_id: CardId | null;
  taker_player_id: string | null;
  scored: boolean;
}

/**
 * Atomic in-match event. Discriminated by `type`. Top-scorer eligibility and
 * every per-player box-score number is derivable from the typed variants —
 * no derived flags are stored on the event itself.
 */
export type MatchEvent =
  | GoalEvent
  | OwnGoalEvent
  | PenScoredEvent
  | PenMissedEvent
  | PenWonEvent
  | ShotOnEvent
  | ShotOffEvent
  | SaveEvent
  | KeyPassEvent
  | FoulEvent
  | OffsideEvent
  | YellowEvent
  | RedEvent
  | InjuryEvent
  | SubEvent
  | ShootoutKickEvent;

/** Discriminator union of every `MatchEvent.type` literal. */
export type MatchEventType = MatchEvent["type"];

/**
 * Compact projection of a `ShootoutKickEvent` carried on
 * `MatchResult.shootout.sequence`. The schema layer enforces that
 * `shootout.sequence` exactly matches the projected `shootout_kick` events,
 * so the compact form never drifts from the event stream.
 */
export interface ShootoutKick {
  index: number;
  side: "user" | "opp";
  taker_card_id: CardId | null;
  taker_player_id: string | null;
  scored: boolean;
}

/**
 * One entry in `MatchResult.lineup` — the XI/bench available for THIS match.
 * The lineup ROSTER changes across the run as tournament-ending injuries
 * remove players from later matches, so the per-match lineup is the
 * canonical source for participation + minutes.
 *
 * `card_id` MUST equal `buildCardId(player_id, tournament_id)` — schema
 * refinement enforces this at the trust boundary.
 */
export interface MatchLineupEntry {
  side: "user" | "opp";
  card_id: CardId;
  player_id: string;
  tournament_id: number;
  /** Squad slot id this player occupied in THIS match. */
  slot_id: string;
  /** Position the player was deployed at in this match. */
  position: Position;
  /** True for the 11 starters; false for bench. */
  started: boolean;
  /**
   * Minutes played in this match (regulation + ET, excluding shootout kicks).
   * 0..130 by schema. THE atomic source for `PlayerMatchStats.minutes` and
   * the top-scorer tiebreak.
   */
  minutes: number;
}

/**
 * The result of one of the eight matches on the user's path through a scenario.
 *
 * REGULATION vs. ET vs. SHOOTOUT (enforced by schema superRefine):
 *   - `user_goals` / `opp_goals` are REGULATION (90 minutes) only.
 *   - `user_goals_et` / `opp_goals_et` are non-null IFF ET was played
 *     (knockout + level after 90).
 *   - `shootout` is non-null IFF knockout AND ET was played AND the match
 *     remained level after ET.
 *   - Shootout goals NEVER affect `user_goals`, `opp_goals`, ET goals,
 *     `PlayerMatchStats.goals`, or top-scorer counts.
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
   * `sequence` is a compact projection of the underlying `shootout_kick`
   * events and the schema enforces exact agreement.
   */
  shootout: {
    user: number;
    opp: number;
    sequence: ShootoutKick[];
  } | null;

  /** Sporting result including shootout resolution. Knockout `outcome` can never be 'D'. */
  outcome: "W" | "D" | "L";
  /** True for both regulation/ET wins and shootout wins. */
  counts_as_run_win: boolean;
  /** True iff this match advanced the user into the next round. */
  advanced: boolean;

  /**
   * The XI/bench available for THIS match. May differ from earlier matches in
   * the run if a previous match had a `tournament_ending` injury. The atomic
   * source for `PlayerMatchStats.minutes`/`subbed_*`/`injured` and for the
   * top-scorer minutes tiebreak.
   */
  lineup: MatchLineupEntry[];

  /** Atomic event log; source of truth for all derived summaries. */
  events: MatchEvent[];
}
