// Tournament / opponents / scenario layer of the wcdraft data contract.
//
// The sim does NOT simulate the other 47 teams in 2026. A `RunScenario` is a
// SCOPED, deterministic path of REAL opponents the user XI plays — three group
// opponents (`group_opponent_team_ids`) and a knockout ladder selected by the
// `KnockoutOpponentRule`.

import type { CardId } from "./identity.js";
import type { Rating, TeamStrength } from "./rating.js";
import type { GroupId, KnockoutRound, SourceRef } from "./primitives.js";

/**
 * Canonical Tournament entity. `tournament_id` is a numeric PK (year-keyed in
 * practice but kept opaque here).
 */
export interface Tournament {
  tournament_id: number;
  /** Year of the tournament (e.g. 1954, 2026). */
  year: number;
  /** Host nation FKs (e.g. 2026 has three hosts: USA / Canada / Mexico). */
  host_nation_ids: string[];
  /** Champion nation FK; null for tournaments not yet completed (2026). */
  champion_nation_id: string | null;
  /** Format version anchor — bumped when the bracket shape / rules change. */
  format_version: string;
}

/**
 * A real 2026 national team — i.e. a sim OPPONENT. The 2026 user XI is drafted
 * across history; their opponents are real 2026 teams represented by this row.
 *
 * DETERMINISM INVARIANT (downstream): when the opponent-selection PRNG samples
 * from this set, the input pool MUST be canonically sorted by `team_id` before
 * the draw. The sort is the responsibility of the sampler, not this type.
 */
export interface Team2026 {
  team_id: string;
  /** FK -> Nation. */
  nation_id: string;
  /** Group bucket A..L. */
  group: GroupId;
  /**
   * Position within the group (1..N). Used together with `group` to identify
   * the seed slot in `Bracket2026`.
   */
  group_slot: number;
  /**
   * The team's 2026 cards (PlayerTournament.card_id FKs). May be projected or
   * final depending on `squad_status`. Branded `CardId[]` — every entry must
   * be a `buildCardId(player_id, tournament_id)` for the 2026 tournament.
   */
  squad_card_ids: CardId[];
  /**
   * Team-level aggregate strength, derived by the same engine that produces
   * per-card `Rating` rows. Drives the knockout opponent escalator.
   */
  aggregate_rating: TeamStrength;
  /**
   * Squad lifecycle marker —
   *   'projected' → squad still being inferred from form / past selections
   *   'locked'    → official roster published but tournament hasn't started
   *   'final'     → official roster + tournament started; no further changes
   */
  squad_status: "projected" | "locked" | "final";
  /** Rating-engine version anchor — must match `Rating.rating_version` it depends on. */
  rating_version: string;
  /** Source citations supporting the team record. */
  sources: SourceRef[];
}

/** Group block of the 2026 bracket; lists the four team_ids in the group. */
export interface Group {
  group_id: GroupId;
  team_ids: string[];
}

/**
 * A bracket slot — the seat into which a team feeds at a given knockout round.
 *
 * `source` is a discriminated union of how the slot is filled:
 *  - `group_position` → top-N of a group feeds this slot.
 *  - `match_winner`   → winner of an earlier match (`match_slot_id`) feeds this slot.
 *  - `best_third`     → one of the eight "best third-placed" teams feeds this slot.
 *    The qualifying group is one of `candidate_groups` (a fixed candidate set per
 *    seat in the published bracket) and is resolved at runtime once the eight
 *    qualifying thirds are known — so it cannot be a single `group_position`.
 *    Required by the real 2026 "top 2 + 8 best thirds" Round of 32.
 */
export type SlotSource =
  | { kind: "group_position"; group_id: GroupId; position: number }
  | { kind: "match_winner"; match_slot_id: string }
  | { kind: "best_third"; candidate_groups: GroupId[] };

export interface Slot {
  slot_id: string;
  round: KnockoutRound;
  source: SlotSource;
  /**
   * The match this seat belongs to (two seats share one `match_id`). Optional:
   * present on the ETL-emitted 2026 bracket so `match_winner` sources can point
   * at a match rather than an individual seat.
   */
  match_id?: string;
}

/** The 2026 bracket: 12 groups + the knockout ladder. */
export interface Bracket2026 {
  groups: Group[];
  knockout_slots: Slot[];
}

/**
 * Rule for selecting the knockout-stage opponents of the user XI.
 *
 * MVP shape — one variant: `escalating_strength_seeded`. The selector reads a
 * sub-seed (derived from the run seed via the `seed_suffix`) and draws from the
 * canonically-sorted pool of Team2026 opponents alive in each round, with the
 * picked opponent's strength rising round-by-round (R32 → F).
 *
 * DETERMINISM INVARIANT: any opponent pool MUST be sorted by `team_id` before
 * the draw; the selector NEVER calls Math.random / Date / crypto / performance.
 */
export type KnockoutOpponentRule = {
  kind: "escalating_strength_seeded";
  /** Knockout rounds in order, e.g. ['R32','R16','QF','SF','F']. */
  rounds: KnockoutRound[];
  /**
   * Sub-seed string mixed into the run seed for the OPPONENT-SELECTION substream
   * (distinct from draft / match-sim / event-gen / narrative substreams).
   */
  seed_suffix: string;
};

/**
 * A user run's scoped opponent path. SCOPED here means: the other 47 teams are
 * NOT simulated — only the eight matches on the user XI's path are.
 *
 * Replay anchors (`ruleset_version`, `scenario_seed`) feed into the broader
 * version anchor set carried by DraftState / RunResult.
 */
export interface RunScenario {
  scenario_id: string;
  /** Which 2026 group the user XI is slotted into for the group stage. */
  user_group_id: GroupId;
  /**
   * The three real Team2026 opponents the user faces in the group stage.
   * Length is always 3; canonically sorted by team_id.
   */
  group_opponent_team_ids: string[];
  /** Rule that produces the deterministic knockout opponent ladder. */
  knockout_opponent_rule: KnockoutOpponentRule;
  /** Scoring / scenario ruleset version anchor. */
  ruleset_version: string;
  /** STRING seed (no float64 seeds) — locks the scenario substream. */
  scenario_seed: string;
}

/**
 * Helper: a single-element Team2026 view from a Rating perspective, used by
 * the sim signature without leaking the full team record. Re-exported as a
 * convenience.
 */
export type Team2026RatingView = Pick<Team2026, "team_id" | "nation_id" | "aggregate_rating"> & {
  /** Per-card ratings for the 2026 squad — sim consumes these. */
  squad_ratings: Rating[];
};
