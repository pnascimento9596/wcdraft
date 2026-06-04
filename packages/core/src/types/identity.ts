// Identity layer of the wcdraft data contract.
//
// THREE CANONICAL ENTITIES:
//   Nation              — controlled vocabulary; kills free-text nation strings.
//   Player              — one row per HUMAN; STABLE player_id across tournaments
//                          (the output of entity resolution).
//   PlayerTournament    — the DRAFTABLE CARD; identity = (player_id, tournament_id).
//
// CARDINAL RULE: `Player.heritage_nation_id` is ER / display only and is NEVER
// the nation a player represents in a given tournament. The representing nation
// lives on the CARD (`PlayerTournament.nation_id`) — players can and do switch
// nations between tournaments (e.g. Puskás HUN'54 / ESP'62, di Stéfano across
// federations). Field-level comments below restate this so downstream code
// never confuses the two.

import type { Award, Position, SourceRef } from "./primitives.js";

/**
 * Canonical Nation entity. The set of nations is small, slow-changing, and
 * authoritative — every nation reference in the system FKs to `nation_id`.
 *
 * Historical-successor mapping (Yugoslavia → Serbia/Montenegro/etc., USSR →
 * CIS → Russia, Czechoslovakia → Czechia/Slovakia, FRG / GDR → Germany) is
 * deliberately DEFERRED beyond MVP. Each historical entity gets its own
 * `nation_id` and the aliases array is for display / ER aid only.
 */
export interface Nation {
  /** Canonical primary key. Stable, lowercase, e.g. "ger", "frg", "esp". */
  nation_id: string;
  /** Display name (current-era preferred form, e.g. "Germany", "Hungary"). */
  canonical_name: string;
  /**
   * Display aliases and historical names — assists fuzzy matching and ER.
   * Example: nation_id "frg" → aliases ["West Germany", "FRG", "BR Deutschland"].
   * NOT used to merge historical-successor nations; see note above.
   */
  aliases: string[];
}

/**
 * Canonical Player entity. ONE row per human, regardless of how many tournaments
 * they appeared in or which nations they represented.
 *
 * `player_id` is the output of WS-A's entity-resolution pipeline and MUST be
 * stable across tournament editions, because dedup
 * (`DraftState.deduped_player_ids`, `Spin.excluded_player_ids`) is keyed on it.
 */
export interface Player {
  /** Stable canonical PK across tournaments. */
  player_id: string;
  /** Full given name as recorded. */
  full_name: string;
  /** Short / commonly-used form ("Pelé", "Cruyff", "Maradona"). */
  common_name: string;
  /** Primary career position. */
  primary_position: Position;
  /**
   * All positions the player could legitimately play across their career.
   * Per-tournament eligibility is NOT this field — see
   * `PlayerTournament.eligible_positions`, which may differ for a given card.
   */
  eligible_positions: Position[];
  /** ISO-8601 date (YYYY-MM-DD), or null when unknown. */
  birth_date: string | null;
  /**
   * Heritage / ancestral nation FK — used for ENTITY RESOLUTION and DISPLAY only.
   * THIS IS NOT THE NATION THE PLAYER REPRESENTS AT ANY GIVEN TOURNAMENT.
   * The representing nation per tournament lives on `PlayerTournament.nation_id`.
   */
  heritage_nation_id: string | null;
  /** Source citations supporting the record. */
  sources: SourceRef[];
}

/**
 * PlayerTournament — the DRAFTABLE CARD. Identity is `(player_id, tournament_id)`,
 * surfaced as `card_id` for gameplay paths that want a single string key.
 *
 * GAMEPLAY INVARIANTS:
 *  - `nation_id` is AUTHORITATIVE for what nation this card represents in the
 *    sim and the draft. NEVER read nation from the underlying Player.
 *  - `eligible_positions` is PER-CARD and may differ from the Player's
 *    career-wide eligibility (e.g. a striker converted to a wide-mid for one
 *    tournament).
 */
export interface PlayerTournament {
  /**
   * Derived, stable composite key: `${player_id}:${tournament_id}`. Computed
   * once at ETL time; treated as the gameplay key everywhere downstream.
   */
  card_id: string;
  /** FK -> Player. The same player_id appears across multiple PlayerTournaments. */
  player_id: string;
  /** FK -> Tournament. */
  tournament_id: number;
  /**
   * FK -> Nation. AUTHORITATIVE representing nation for THIS tournament.
   * Never derive playing nation from `Player.heritage_nation_id`.
   */
  nation_id: string;
  /** Shirt number worn at this tournament; null when unknown. */
  shirt_number: number | null;
  /** Position the team listed the player at; null when unknown. */
  position_listed: Position | null;
  /** Per-card eligibility (may differ from `Player.eligible_positions`). */
  eligible_positions: Position[];
  /** Club at the time of this tournament; null when unknown. */
  club_at_tournament: string | null;
  /** Match appearances. null when unknown — NEVER coerce to 0. */
  appearances: number | null;
  /** Minutes played. null when unknown. */
  minutes: number | null;
  /** Goals scored. null when unknown. */
  goals: number | null;
  /**
   * Assists. Usually NULL pre-1990 because the stat wasn't tracked — keep null
   * rather than zero so coverage and rating models can see the gap.
   */
  assists: number | null;
  /**
   * Tournament awards held by this card.
   *   - `[]` = confirmed none after research.
   *   - `null` = unknown / not yet researched.
   */
  awards: Award[] | null;
  /**
   * Was this player the captain at this tournament? `null` when unknown
   * (common for older tournaments).
   */
  captain: boolean | null;
  /**
   * Honest-state coverage fraction in [0,1] — what fraction of the intended
   * tournament-card signals are present. Drives downstream rating coverage and
   * the rating provenance choice.
   */
  coverage: number;
  /** Source citations supporting the card record. */
  sources: SourceRef[];
}
