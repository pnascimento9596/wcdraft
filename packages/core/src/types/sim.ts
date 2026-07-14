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
import type { ManagerRating, ManagerTournament } from "./manager.js";
import type { MatchPeriod, MatchPhase, MatchRound, Position } from "./primitives.js";
import type { Rating, TeamStrength } from "./rating.js";
import type { SynergyResult } from "./synergy.js";
import type { ScoringConfig } from "./scoring.js";
import type { Bracket2026, Team2026 } from "./tournament.js";

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

/** A seeded pre-match absence. This event always reflects the XI used mechanically. */
export interface AvailabilityEvent extends MatchEventCommon {
  type: "availability";
  minute: 0;
  period: "1H";
  card_id: CardId;
  player_id: string;
  slot_id: string;
  position: Position;
  reason: "knock" | "suspension" | "tournament_injury";
  /** One or two for minor events; null means the player is out for the tournament. */
  duration_matches: 1 | 2 | null;
  replacement_card_id: CardId | null;
  replacement_player_id: string | null;
  short_handed: boolean;
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
  | AvailabilityEvent
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

  /**
   * Pre-match probability that the user's side wins this fixture, derived
   * from the already-computed expected-goals lambdas. Group matches count
   * regulation wins only; knockout matches include the fair draw-resolution
   * share for a level match.
   */
  pre_match_win_probability: number;

  /** Persisted engine facts consumed by the factual recap; UI must not re-derive these. */
  team_facts?: MatchTeamFacts;

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

export interface AvailabilityFact {
  card_id: CardId;
  player_id: string;
  slot_id: string;
  position: Position;
  reason: "knock" | "suspension" | "tournament_injury";
  duration_matches: 1 | 2 | null;
}

export interface BenchActivationFact {
  out_card_id: CardId;
  out_player_id: string;
  in_card_id: CardId;
  in_player_id: string;
  slot_id: string;
  line: Position;
  fit: number;
  internal_score: number;
  /** S3 calibration factor applied only after canonical replacement selection. */
  replacement_contribution_multiplier: number;
  /** Effective incoming slot contribution after the calibration factor. */
  replacement_score: number;
  outgoing_score: number;
  line_contribution_delta: number;
}

export type ManagerTacticalBand = 0 | 1 | 2 | 3;
export type ManagerPresenceBand = 0 | 1;
export type ManagerLinkBand = 0 | 1 | 2;

export interface MatchTeamFacts {
  base_strength: TeamStrength;
  active_strength: TeamStrength;
  /** Drafted-manager presence, persisted rather than inferred by recap consumers. */
  manager_present: boolean;
  /** Internal competent-manager presence contribution. Production currently resolves all managers to +1. */
  manager_presence_band: ManagerPresenceBand;
  /** Preserved S2 +0/+1/+2 contribution: round(clamp(manager_link) * 2). */
  manager_link_band: ManagerLinkBand;
  /** Bounded sum of manager_presence_band + the preserved S2 +0/+1/+2 link tier. */
  manager_tactical_band: ManagerTacticalBand;
  /** Bounded multiplier corresponding exactly to manager_tactical_band. */
  manager_tactical_multiplier: number;
  /** Continuous factual projection of active strength under the tactical multiplier. */
  post_tactical_strength: TeamStrength;
  /** Whether post_tactical_strength mechanically fed the match outcome. */
  tactical_applied_to_outcome: boolean;
  base_synergy: SynergyResult;
  active_synergy: SynergyResult;
  unavailable: AvailabilityFact[];
  bench_activations: BenchActivationFact[];
  short_handed_slot_ids: string[];
}

// ─── SimWorld ─────────────────────────────────────────────────────────────────
//
// Resolved sim inputs the public `(draft, scenario, seed)` signature does NOT
// thread on its own — `DraftState.squad` carries card_ids but no per-card
// Rating, `RunScenario` carries only opponent team_id strings, etc. The engine
// (and the public `RunTournamentFn`) consume these resolved maps as a REQUIRED
// 4th argument so the type signature itself is honest about the dependency.
// Real wiring of these maps is the data-package + web-integration lane.

/** Resolved inputs the engine needs in addition to (draft, scenario, seed). */
export interface SimWorld {
  /** card_id → Rating for every card in the user squad (all 16). */
  ratings: Readonly<Record<string, Rating>>;
  /** Authoritative per-card eligibility. Missing rows fail closed for bench replacement. */
  eligiblePositionsByCardId?: Readonly<Record<string, readonly Position[]>>;
  /** team_id → Team2026 for every opponent reachable in the scenario. */
  opponents: Readonly<Record<string, Team2026>>;
  /** manager_card_id → ManagerRating, when a manager was drafted. */
  managerRatings?: Readonly<Record<string, ManagerRating>>;
  /** manager_card_id → ManagerTournament, for the Synergy manager link. */
  managerTournaments?: Readonly<Record<string, ManagerTournament>>;
  /** card_id → nation_id, for Synergy nation clustering. */
  nationByCardId?: Readonly<Record<string, string>>;
  /**
   * tournament_id -> calendar year. Tournament ids are catalog keys and must
   * not be interpreted as years by simulation or narrative logic.
   */
  tournamentYears?: Readonly<Record<string, number>>;
  /** Calibrated scoring config; defaults to DEFAULT_SCORING_CONFIG. */
  scoringConfig?: ScoringConfig;
  /**
   * Real 2026 bracket metadata. Optional today; consumed by the
   * bracket-constrained R32 opponent selection pass (later work item) — the
   * field is reserved here so downstream items don't re-touch the SimWorld
   * type. The current engine ignores this field.
   */
  bracket?: Bracket2026;
}
