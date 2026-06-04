// UI view-models for the WS-D game screens.
//
// These are PRESENTATION shapes — denormalized bundles the screens render. They
// are assembled FROM the @wcdraft/core data-contract types (PlayerTournament,
// Rating, Manager, ManagerTournament, ManagerRating, …) so the UI is wired to
// the real contract spine, but flattened so a component doesn't have to join
// four entities on every render.
//
// EVERYTHING under lib/mock is ILLUSTRATIVE MOCK DATA for the screen scaffold.
// No packages/core engine (sim / scoring / synergy / compatibility) is called —
// the small mock helpers in compat.ts / synergy.ts are clearly-labelled UI
// stand-ins, not the calibrated engine that lands in WS-B.

import type {
  Award,
  CardId,
  ManagerCardId,
  Position,
  SlotPosition,
} from "@wcdraft/core";

/** Flattened, display-ready rating for a player card (the four sim channels + display overall). */
export interface CardRating {
  /** Display composite (0..100); null when coverage is insufficient. */
  overall: number | null;
  attack: number;
  midfield: number;
  defense: number;
  goalkeeping: number;
  /** Honest-state coverage fraction [0,1]. */
  coverage: number;
}

/**
 * A draftable PLAYER candidate, flattened for the UI. Combines
 * Player (display) + PlayerTournament (card facts) + Rating (numbers).
 */
export interface PlayerCard {
  card_id: CardId;
  player_id: string;
  tournament_id: number;
  /** Tournament year, denormalized for the card header. */
  year: number;
  /** Short / commonly-used name (e.g. "Pelé"). */
  name: string;
  full_name: string;
  /** Representing nation at this tournament. */
  nation_id: string;
  nation_name: string;
  shirt_number: number | null;
  /** Position the team listed the player at; null when unknown. */
  position_listed: Position | null;
  /** Per-card eligible coarse positions. */
  eligible_positions: Position[];
  club_at_tournament: string | null;
  /** Match appearances; null pre-1970 / unknown (honest-state). */
  appearances: number | null;
  /** Goals scored; null when unknown. */
  goals: number | null;
  awards: Award[] | null;
  captain: boolean | null;
  rating: CardRating;
}

/** A draftable MANAGER (coach) candidate, flattened for the UI. */
export interface ManagerCard {
  manager_card_id: ManagerCardId;
  manager_id: string;
  tournament_id: number;
  year: number;
  name: string;
  /** Nation MANAGED at this tournament (authoritative — never the coach's own nationality). */
  nation_id: string;
  nation_name: string;
  matches: number | null;
  final_placement: number | null;
  rating: {
    overall: number | null;
    pedigree: number;
    experience: number;
  };
}

/**
 * One rolled (team, World Cup year) squad — the candidate pool a single spin
 * surfaces: the squad's players PLUS that team-year's coach.
 */
export interface SquadFixture {
  tournament_id: number;
  year: number;
  nation_id: string;
  nation_name: string;
  /** Display label, e.g. "Brazil · 1970". */
  label: string;
  players: PlayerCard[];
  /** That team-year's coach, offered as a selectable manager. May be null. */
  coach: ManagerCard | null;
}

/** A starter or bench slot in the working XI, flattened for the pitch panel. */
export interface PitchSlot {
  /** FormationSlot.slot_id (starters) or bench.<n> (bench). */
  slot_id: string;
  is_starter: boolean;
  slot_position: SlotPosition;
  /** Coarse line label for grouping (GK/DF/MF/FW). */
  line: Position;
  /** Field channel for layout (L/C/R). */
  channel: "L" | "C" | "R";
  /** The placed card, or null when vacant. */
  card: PlayerCard | null;
  /** 0..1 graduated compatibility of the placed card with this slot (UI mock). */
  position_compatibility: number;
  /** Soft warnings for the placed card (out-of-position, GK in outfield, …). */
  warnings: string[];
}
