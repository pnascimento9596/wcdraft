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
//
// SCOPE: men's tournaments 1930–2022 (22 tournaments) + 2026.
// Fjelstul CSVs cover WC-1930 through WC-2022; 2026 cards are projected.

import type { Award, Position, SourceRef } from "./primitives.js";

// ─── CARD ID BRAND + HELPERS ─────────────────────────────────────────────────
//
// `CardId` is a BRANDED string. At runtime it is exactly the documented
// composite `${player_id}:${tournament_id}` — but the TypeScript brand prevents
// accidentally passing a raw `player_id`, `nation_id`, or other arbitrary
// string into a card slot. Every record that carries `card_id` MUST receive a
// value produced by `buildCardId(player_id, tournament_id)`. Boundary zod
// schemas (`CardIdSchema` + per-record refinements) re-validate this at the
// trust boundary so persisted/network data cannot drift.

/**
 * Branded card ID. Runtime shape is always `${player_id}:${tournament_id}`;
 * use `buildCardId` to construct and `parseCardId` to destructure.
 *
 * The brand is a tag-only structural marker — TypeScript prevents
 * implicit assignment from a raw `string`, but the runtime value is the
 * plain `${player_id}:${tournament_id}` composite.
 */
export type CardId = string & { readonly __wcdraftCardIdBrand: "CardId" };

/**
 * The canonical card-id format is `<player_id>:<tournament_id>`. We parse on
 * the LAST colon so a future player_id containing ':' parses correctly.
 */
const CARD_ID_SEPARATOR = ":";

/**
 * Construct a `CardId` from its atomic parts. The format matches the
 * documented composite key: `${player_id}:${tournament_id}`.
 *
 * @throws RangeError if `player_id` is empty/whitespace or contains a
 *   trailing colon, or if `tournament_id` is not a positive safe integer.
 *
 * This is the ONLY supported constructor — never mint a `CardId` by casting
 * a raw string. Boundary schemas re-validate equality with this helper, so a
 * mismatched persisted card_id fails parse.
 */
export function buildCardId(player_id: string, tournament_id: number): CardId {
  if (typeof player_id !== "string" || player_id.trim().length === 0) {
    throw new RangeError("buildCardId requires a non-empty player_id");
  }
  if (!Number.isSafeInteger(tournament_id) || tournament_id <= 0) {
    throw new RangeError(
      `buildCardId requires a positive safe integer tournament_id, received: ${tournament_id}`,
    );
  }
  return `${player_id}${CARD_ID_SEPARATOR}${tournament_id}` as CardId;
}

/**
 * Parse a `CardId` (or a candidate string) into its atomic parts. Returns
 * `null` for any input that does not match the canonical format with a
 * non-empty `player_id` and a positive safe integer `tournament_id`. Splits
 * on the LAST colon so player_ids that contain colons round-trip cleanly.
 *
 * Non-throwing on purpose: keeps zod refinements simple (no try/catch).
 */
export function parseCardId(
  card_id: string | CardId,
): { player_id: string; tournament_id: number } | null {
  if (typeof card_id !== "string" || card_id.length === 0) return null;
  const idx = card_id.lastIndexOf(CARD_ID_SEPARATOR);
  if (idx <= 0 || idx >= card_id.length - 1) return null;
  const player_id = card_id.slice(0, idx);
  const tournament_id_str = card_id.slice(idx + 1);
  if (player_id.trim().length === 0) return null;
  // Reject leading-zero or signed tournament strings so the parse is
  // round-trip-stable: buildCardId(parseCardId(x)) === x.
  if (!/^[1-9]\d*$/.test(tournament_id_str)) return null;
  const tournament_id = Number(tournament_id_str);
  if (!Number.isSafeInteger(tournament_id) || tournament_id <= 0) return null;
  return { player_id, tournament_id };
}

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
 *
 * SOURCE-DATA NOTE: Fjelstul has NO `assists` and NO `minutes` at ANY era —
 * do NOT re-add either field to this SOURCE type. Match-level `minutes` and
 * `assists` come from sim OUTPUT (`PlayerMatchStats` / `MatchEvent`), which
 * are derivable from `MatchResult.lineup` + atomic event types.
 */
export interface PlayerTournament {
  /**
   * Derived, stable composite key: `${player_id}:${tournament_id}`. Computed
   * once at ETL time via `buildCardId(player_id, tournament_id)`; treated as
   * the gameplay key everywhere downstream. Branded `CardId` — never assign
   * a raw string.
   */
  card_id: CardId;
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
  /**
   * Match appearances. Fjelstul tracks match-level appearances ONLY from 1970
   * onward; null pre-1970 or otherwise unknown. NEVER coerce to 0.
   * (Squad selection is recorded 1930+; appearance counts are 1970+.)
   */
  appearances: number | null;
  /** Goals scored. null when unknown. */
  goals: number | null;
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
