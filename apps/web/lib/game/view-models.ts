// Web-only presentation view-models for the game screens.
//
// These shapes are the boundary between the compact runtime data
// (@wcdraft/data) + core engine state (@wcdraft/core) and the React tree.
// Adapters in `./adapters.ts` build them; components consume them. No
// component reaches past these types into raw runtime/engine shapes.
//
// CARDINAL RULES embedded in the types:
//   - `overall` is `number | null` — `null` means UNKNOWN, render `—`,
//     never `0`.
//   - Manager rating is OMITTED in runtime data — `ManagerCardView` carries
//     `rating_available: false`. There are no placeholder pedigree /
//     experience numbers.
//   - Position is encoded by SHAPE in the UI (square / triangle / diamond /
//     circle). Provenance is encoded by HUE (cyan / periwinkle / orange /
//     gold / slate). The two are orthogonal — see I2 brief.

import type { Award, CardId, ManagerCardId, Position, SlotPosition } from "@wcdraft/core";

// ─── Rating view ─────────────────────────────────────────────────────────────

/**
 * Provenance tag — drives the hue + label badge on every player card.
 * `masked` is the Memory-mode blind: a display-only state produced ONLY by
 * `blindCardRatingView` (never by `provenanceBadgeKind`). It carries a
 * neutral hue so neither the legend gold nor the provenance tier leaks.
 */
export type RatingBadgeKind = "historical" | "projected" | "estimate" | "legend" | "masked";

/** Fold of `RuntimeRating` honest-state fields into UI-ready form. */
export interface CardRatingView {
  /** Display composite (0..100); null when coverage is insufficient. */
  overall: number | null;
  /**
   * Channels are always numeric in runtime data; `null` here means the value
   * is BLINDED for display (Memory mode, via `blindCardRatingView`) — render
   * `—`, never `0`. Classic mode never produces null channels.
   */
  attack: number | null;
  midfield: number | null;
  defense: number | null;
  goalkeeping: number | null;
  /** Honest-state coverage fraction in [0,1]. */
  coverage: number;
  /** Source of the rating signal. */
  provenance: "wc_performance" | "projected_career";
  /** Historical-only honest-state flag. */
  overall_basis?:
    | "measured_performance"
    | "baseline_anchor_estimate"
    | "career_stature_estimate";
  /**
   * Source-derived legend flag (MV2-7 seam, MV2-10 data), carried through
   * verbatim so the future memory mode can read it directly. `badge_kind`
   * already folds it into the gold legend styling; this is the raw signal.
   * Populated on every card as of the runtime-data-1.1.0 compact.
   */
  legend?: boolean;
  /** Folded display kind for the provenance/estimate/legend badge. */
  badge_kind: RatingBadgeKind;
  /** Human label for the provenance/estimate/legend badge. */
  badge_label: string;
}

// ─── Player candidate view ───────────────────────────────────────────────────

/** Era-aware key/value to render under the candidate name. */
export interface CandidateStatView {
  label: string;
  /** Rendered value; `null` means unknown → display as `—`. */
  value: number | string | null;
  title?: string;
}

/** A draftable PLAYER candidate, flattened for the UI. */
export interface PlayerCardView {
  kind: "player";
  card_id: CardId;
  player_id: string;
  tournament_id: number;
  year: number;
  name: string;
  full_name: string;
  nation_id: string;
  nation_name: string;
  nation_code: string;
  shirt_number: number | null;
  position_listed: Position | null;
  primary_position: Position;
  eligible_positions: Position[];
  club_label: string | null;
  /** Historical-era display: tournament apps. `undefined` for projected cards. */
  appearances?: number | null;
  /** Historical-era display: tournament goals. `undefined` for projected cards. */
  goals?: number | null;
  /** 2026-era display: career caps before the tournament. `undefined` historical. */
  caps?: number | null;
  /** 2026-era display: career international goals. `undefined` historical. */
  intl_goals?: number | null;
  awards?: Award[] | null;
  captain: boolean | null;
  rating: CardRatingView;
  /** Era-appropriate ordered stats for the candidate-card footer. */
  stats: CandidateStatView[];
}

// ─── Manager candidate view ──────────────────────────────────────────────────

/** A draftable MANAGER candidate, flattened for the UI. */
export interface ManagerCardView {
  kind: "manager";
  manager_card_id: ManagerCardId;
  manager_id: string;
  tournament_id: number;
  year: number;
  name: string;
  full_name: string;
  /** Authoritative managed nation at this tournament. */
  nation_id: string;
  nation_name: string;
  nation_code: string;
  /** Matches coached at this tournament; null when unknown. */
  matches: number | null;
  /** Final placement (1=champion, etc.); null when unknown. */
  final_placement: number | null;
  /**
   * Runtime data never publishes a manager rating. UI MUST display
   * "rating unavailable" — never invent pedigree/experience numbers.
   */
  rating_available: false;
  /**
   * Flavor-only manager traits derived at web runtime (ENGINE-V2 E-2).
   * Always exactly two entries. Display-only — NO mechanical effect on
   * Synergy, team strength, scoring, or any other simulation surface.
   * Curated for well-known managers; deterministically seeded from
   * `manager_id` for the rest.
   */
  traits: readonly ManagerTraitView[];
}

// ─── Manager flavor traits (ENGINE-V2 E-2 — display only) ────────────────────

/**
 * Closed taxonomy of original, generic-football-descriptive manager trait
 * identifiers. The set is intentionally NOT modelled on any commercial
 * football-game attribute schema. Labels are display-only flavor; they MUST NOT
 * be referenced anywhere in the simulation engine, scoring, or persisted
 * draft state.
 */
export type ManagerTraitId =
  | "adaptive_plan"
  | "attacking_license"
  | "belief_builder"
  | "compact_shape"
  | "continuity_builder"
  | "counter_tempo"
  | "defensive_platform"
  | "detail_planner"
  | "dressing_room_calm"
  | "emotional_spark"
  | "finals_calm"
  | "fluid_front_line"
  | "global_organiser"
  | "identity_builder"
  | "knockout_calm"
  | "positional_rotation"
  | "possession_patience"
  | "pressing_tone"
  | "quick_assimilation"
  | "quiet_authority"
  | "rotation_trust"
  | "set_piece_voice"
  | "shape_innovator"
  | "squad_balance"
  | "squad_evolution"
  | "steady_builder"
  | "structure_first"
  | "sweeper_view"
  | "systems_teacher"
  | "transition_patterns"
  | "underdog_order"
  | "wide_patterns"
  | "youth_trust";

/** Whether a trait was sourced from the curated map or the seeded fallback. */
export type ManagerTraitSource = "curated" | "derived";

/** Materialised manager trait for UI rendering. */
export interface ManagerTraitView {
  readonly id: ManagerTraitId;
  /** Human label shown in the UI (Title Case). */
  readonly label: string;
  readonly source: ManagerTraitSource;
}

// ─── Pitch slot view ─────────────────────────────────────────────────────────

/** Channel L / C / R inherited from the FormationTemplate (engine truth). */
export type FormationChannel = "L" | "C" | "R";

/** A starter or bench slot, flattened for the pitch + bench rendering. */
export interface PitchSlotView {
  slot_id: string;
  is_starter: boolean;
  slot_position: SlotPosition;
  /** Coarse line (GK/DF/MF/FW) — drives shape encoding. */
  line: Position;
  channel: FormationChannel;
  card: PlayerCardView | null;
  position_compatibility: number;
  warnings: string[];
}

// ─── Line strength view ──────────────────────────────────────────────────────

export interface LineStrengthView {
  line: Position;
  label: string;
  /** Number of filled starter slots in this line. */
  count: number;
  /** Average of the line-specific rating channel (0..100); 0 when empty. */
  value: number;
}

// ─── UI helpers ──────────────────────────────────────────────────────────────

export type CompatTier = "ideal" | "ok" | "stretch" | "misfit";

const TIER_LABELS: Record<CompatTier, string> = {
  ideal: "Natural fit",
  ok: "Plays here",
  stretch: "Out of position",
  misfit: "Wrong role",
};

export function compatTier(compat: number): CompatTier {
  if (compat >= 0.99) return "ideal";
  if (compat >= 0.7) return "ok";
  if (compat >= 0.4) return "stretch";
  return "misfit";
}

export function compatLabel(compat: number): string {
  return TIER_LABELS[compatTier(compat)];
}

/** Position → shape glyph. GK square, DF triangle, MF diamond, FW circle. */
export type PositionShape = "square" | "triangle" | "diamond" | "circle";

export function positionShape(position: Position): PositionShape {
  switch (position) {
    case "GK":
      return "square";
    case "DF":
      return "triangle";
    case "MF":
      return "diamond";
    case "FW":
      return "circle";
  }
}

/** Honest formatter: `null`/`undefined` → "—", number → integer string. */
export function formatNullableNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return String(value);
}

/** Honest formatter for the candidate stat value. */
export function formatStatValue(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return typeof value === "number" ? String(value) : value;
}

// ─── Provenance badge classification ─────────────────────────────────────────

interface BadgeInputs {
  overall: number | null;
  provenance: "wc_performance" | "projected_career";
  overall_basis?:
    | "measured_performance"
    | "baseline_anchor_estimate"
    | "career_stature_estimate";
  /**
   * Source-derived legend flag (MV2-7 seam, MV2-10 data). When defined it is
   * authoritative — an explicit `false` SUPPRESSES legend even for OVR≥96.
   * Absent → fall back to the OVR≥96 heuristic below. As of the
   * runtime-data-1.1.0 compact every rating carries the flag, so the fallback
   * only guards pre-1.1.0 data shapes (and keeps BadgeInputs permissive for
   * callers that fold non-rating inputs).
   */
  legend?: boolean;
}

/**
 * Order matters: legend > estimate > projected > historical.
 *   - LEGEND  : source-derived `legend` flag when present, else the historical
 *               OVR≥96 heuristic (precious gold; rare and earned)
 *   - ESTIMATE: historical card flagged baseline_anchor_estimate (orange,
 *               low-certainty warning hue)
 *   - PROJECTED: 2026 projected-career provenance (periwinkle)
 *   - HISTORICAL: verified WC-performance signal (cyan, the everyday)
 */
export function provenanceBadgeKind(r: BadgeInputs): RatingBadgeKind {
  if (r.legend ?? (r.overall !== null && r.overall >= 96)) return "legend";
  if (r.overall_basis === "baseline_anchor_estimate") return "estimate";
  if (r.provenance === "projected_career") return "projected";
  return "historical";
}

const BADGE_LABELS: Record<RatingBadgeKind, string> = {
  historical: "Historical",
  projected: "Projected",
  estimate: "Estimate",
  legend: "Legend",
  masked: "Hidden",
};

export function provenanceBadgeLabel(kind: RatingBadgeKind): string {
  return BADGE_LABELS[kind];
}

// ─── Memory-mode blind (display-only) ────────────────────────────────────────

/**
 * THE single blind seam for Memory (hidden) mode. Strips every rating SIGNAL
 * from an already-built `CardRatingView` while leaving identity intact:
 *
 *   BLINDED: overall, the four channels, the legend gold (via `badge_kind`,
 *   the #56 seam — never a re-derived OVR≥96 check), the provenance hue/label
 *   (it leaks rating tier), and `overall_basis`.
 *
 * Display-only by construction: this runs strictly on the view-model AFTER
 * the engine-facing data is resolved, so the sim always consumes the real
 * channels. Classic mode never calls this — its render path is untouched.
 */
export function blindCardRatingView(r: CardRatingView): CardRatingView {
  return {
    ...r,
    overall: null,
    attack: null,
    midfield: null,
    defense: null,
    goalkeeping: null,
    overall_basis: undefined,
    legend: undefined,
    badge_kind: "masked",
    badge_label: BADGE_LABELS.masked,
  };
}
