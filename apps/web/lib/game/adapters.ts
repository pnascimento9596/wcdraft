// Adapter joins from compact runtime data + core engine state to UI
// view-models. ALL joins live here so the components stay dumb.
//
// HONEST STATE: every missing record throws `MissingRecordError`. Never
// substitute a placeholder; the screens render a recovery panel instead.

import type {
  CardId,
  DraftState,
  FormationTemplate,
  ManagerCardId,
  ManagerTournament,
  Position,
  Spin,
  SquadSlot,
} from "@wcdraft/core";
import { FORMATION_TEMPLATES, slotPositionLine } from "@wcdraft/core";
import type {
  RuntimeManagerCard,
  RuntimePlayerCard,
  RuntimeRating,
} from "@wcdraft/data";

import { MissingRecordError } from "./errors";
import type { GameDataIndexes } from "./data";
import type {
  CandidateStatView,
  CardRatingView,
  FormationChannel,
  LineStrengthView,
  ManagerCardView,
  PitchSlotView,
  PlayerCardView,
} from "./view-models";
import { provenanceBadgeKind, provenanceBadgeLabel } from "./view-models";
import { managerTraitsFor } from "./manager-traits";

// ─── Tournament / nation lookups ─────────────────────────────────────────────

function nationOrThrow(idx: GameDataIndexes, nation_id: string) {
  const nation = idx.nationById.get(nation_id);
  if (!nation) throw new MissingRecordError("nation", nation_id);
  return nation;
}

function tournamentYearOrThrow(idx: GameDataIndexes, tournament_id: number): number {
  const t = idx.tournamentById.get(tournament_id);
  if (!t) throw new MissingRecordError("tournament", String(tournament_id));
  return t.year;
}

// ─── Rating lookup ───────────────────────────────────────────────────────────

export function ratingFor(idx: GameDataIndexes, card_id: CardId | string): RuntimeRating {
  const r = idx.ratingByCardId.get(card_id);
  if (!r) throw new MissingRecordError("rating", String(card_id));
  return r;
}

function ratingView(r: RuntimeRating): CardRatingView {
  const badge_kind = provenanceBadgeKind({
    overall: r.overall,
    provenance: r.provenance,
    overall_basis: r.overall_basis,
  });
  return {
    overall: r.overall,
    attack: r.attack,
    midfield: r.midfield,
    defense: r.defense,
    goalkeeping: r.goalkeeping,
    coverage: r.coverage,
    provenance: r.provenance,
    overall_basis: r.overall_basis,
    badge_kind,
    badge_label: provenanceBadgeLabel(badge_kind),
  };
}

// ─── Player card lookup + view ───────────────────────────────────────────────

function playerOrThrow(
  idx: GameDataIndexes,
  card_id: CardId | string,
): RuntimePlayerCard {
  const c = idx.playerByCardId.get(card_id);
  if (!c) throw new MissingRecordError("player_card", String(card_id));
  return c;
}

function pickPrimaryPosition(c: RuntimePlayerCard): Position {
  return c.primary_position ?? c.eligible_positions[0] ?? "MF";
}

function clubLabel(c: RuntimePlayerCard): string | null {
  if (c.club_at_tournament !== undefined && c.club_at_tournament !== null) {
    return c.club_at_tournament;
  }
  if (c.club !== undefined && c.club !== null) return c.club;
  return null;
}

function buildStats(c: RuntimePlayerCard): CandidateStatView[] {
  // Historical card: appearances / goals are the era-appropriate signals.
  // 2026 card: caps / intl_goals are the projected signals.
  const out: CandidateStatView[] = [];
  if (c.appearances !== undefined) {
    out.push({ label: "Apps", value: c.appearances, title: "Tournament appearances" });
  }
  if (c.goals !== undefined) {
    out.push({ label: "Goals", value: c.goals, title: "Tournament goals" });
  }
  if (c.caps !== undefined) {
    out.push({ label: "Caps", value: c.caps, title: "Career international caps" });
  }
  if (c.intl_goals !== undefined) {
    out.push({ label: "Int'l", value: c.intl_goals, title: "Career international goals" });
  }
  return out;
}

function nationCode(
  nation_id: string,
  nation: { code: string | null },
): string {
  return nation.code ?? nation_id.toUpperCase();
}

export function playerCardView(
  idx: GameDataIndexes,
  card_id: CardId | string,
): PlayerCardView {
  const c = playerOrThrow(idx, card_id);
  const nation = nationOrThrow(idx, c.nation_id);
  const year = tournamentYearOrThrow(idx, c.tournament_id);
  const r = ratingFor(idx, c.card_id);
  return {
    kind: "player",
    card_id: c.card_id,
    player_id: c.player_id,
    tournament_id: c.tournament_id,
    year,
    name: c.common_name && c.common_name.trim().length > 0 ? c.common_name : c.full_name,
    full_name: c.full_name,
    nation_id: c.nation_id,
    nation_name: nation.canonical_name,
    nation_code: nationCode(c.nation_id, nation),
    shirt_number: c.shirt_number,
    position_listed: c.position_listed,
    primary_position: pickPrimaryPosition(c),
    eligible_positions: c.eligible_positions,
    club_label: clubLabel(c),
    appearances: c.appearances,
    goals: c.goals,
    caps: c.caps,
    intl_goals: c.intl_goals,
    awards: c.awards,
    captain: c.captain,
    rating: ratingView(r),
    stats: buildStats(c),
  };
}

// ─── Manager card lookup + view ──────────────────────────────────────────────

function managerOrThrow(
  idx: GameDataIndexes,
  manager_card_id: ManagerCardId | string,
): RuntimeManagerCard {
  const m = idx.managerByCardId.get(manager_card_id);
  if (!m) throw new MissingRecordError("manager_card", String(manager_card_id));
  return m;
}

export function managerCardView(
  idx: GameDataIndexes,
  manager_card_id: ManagerCardId | string,
): ManagerCardView {
  const m = managerOrThrow(idx, manager_card_id);
  const nation = nationOrThrow(idx, m.nation_id);
  const year = tournamentYearOrThrow(idx, m.tournament_id);
  return {
    kind: "manager",
    manager_card_id: m.manager_card_id,
    manager_id: m.manager_id,
    tournament_id: m.tournament_id,
    year,
    name: m.common_name && m.common_name.trim().length > 0 ? m.common_name : m.full_name,
    full_name: m.full_name,
    nation_id: m.nation_id,
    nation_name: nation.canonical_name,
    nation_code: nationCode(m.nation_id, nation),
    matches: m.matches,
    final_placement: m.final_placement,
    rating_available: false,
    traits: managerTraitsFor({
      manager_id: m.manager_id,
      full_name: m.full_name,
      common_name: m.common_name,
    }),
  };
}

/** Build the engine-shaped `ManagerTournament` needed by `computeSynergy`. */
export function managerTournamentFor(
  idx: GameDataIndexes,
  manager_card_id: ManagerCardId | string,
): ManagerTournament {
  const m = managerOrThrow(idx, manager_card_id);
  return {
    manager_card_id: m.manager_card_id,
    manager_id: m.manager_id,
    tournament_id: m.tournament_id,
    nation_id: m.nation_id,
    matches: m.matches,
    final_placement: m.final_placement,
    sources: m.sources,
  };
}

// ─── Pitch slot view ─────────────────────────────────────────────────────────

function slotChannelForStarter(
  formation: FormationTemplate,
  slot_id: string,
): FormationChannel {
  const fs = formation.slots.find((s) => s.slot_id === slot_id);
  if (!fs) {
    throw new MissingRecordError(
      "slot",
      slot_id,
      `not in formation "${formation.formation_id}"`,
    );
  }
  return fs.channel;
}

export function pitchSlotView(
  idx: GameDataIndexes,
  formation: FormationTemplate,
  slot: SquadSlot,
): PitchSlotView {
  const card = slot.card_id ? playerCardView(idx, slot.card_id) : null;
  return {
    slot_id: slot.slot_id,
    is_starter: slot.is_starter,
    slot_position: slot.slot_position,
    line: slotPositionLine(slot.slot_position),
    channel: slot.is_starter ? slotChannelForStarter(formation, slot.slot_id) : "C",
    card,
    position_compatibility: slot.position_compatibility,
    warnings: slot.validation_warnings,
  };
}

export interface PitchSlotViews {
  starters: PitchSlotView[];
  bench: PitchSlotView[];
}

export function pitchSlotViews(idx: GameDataIndexes, draft: DraftState): PitchSlotViews {
  const formation = FORMATION_TEMPLATES[draft.formation_id];
  if (!formation) {
    throw new MissingRecordError("formation", draft.formation_id);
  }
  const starters: PitchSlotView[] = [];
  const bench: PitchSlotView[] = [];
  for (const slot of draft.squad) {
    const view = pitchSlotView(idx, formation, slot);
    if (slot.is_starter) starters.push(view);
    else bench.push(view);
  }
  return { starters, bench };
}

// ─── Candidate views for a spin ──────────────────────────────────────────────

export interface DraftCandidateViews {
  spin: Spin | null;
  players: PlayerCardView[];
  manager: ManagerCardView | null;
}

export function draftCandidateViews(
  idx: GameDataIndexes,
  draft: DraftState,
  spin: Spin | null,
): DraftCandidateViews {
  if (!spin) return { spin: null, players: [], manager: null };
  const drafted = new Set(draft.deduped_player_ids);
  const players = spin.rolled_card_ids
    .map((id) => playerCardView(idx, id))
    .filter((v) => !drafted.has(v.player_id));
  const manager = spin.rolled_manager_card_id
    ? managerCardView(idx, spin.rolled_manager_card_id)
    : null;
  return { spin, players, manager };
}

// ─── Aggregate rating views (review + line strength) ─────────────────────────

const LINE_LABELS: Record<Position, string> = {
  GK: "Goalkeeper",
  DF: "Defence",
  MF: "Midfield",
  FW: "Attack",
};

const LINES_ORDER: Position[] = ["GK", "DF", "MF", "FW"];

/**
 * Use the line-specific rating CHANNEL (gk/def/mid/att) for line strength,
 * not the (often null) `overall`. This gives a stable numeric even when
 * some cards have honest-null OVR.
 */
export function lineStrengthViews(
  idx: GameDataIndexes,
  draft: DraftState,
): LineStrengthView[] {
  const formation = FORMATION_TEMPLATES[draft.formation_id];
  if (!formation) throw new MissingRecordError("formation", draft.formation_id);
  const buckets: Record<Position, number[]> = { GK: [], DF: [], MF: [], FW: [] };
  for (const slot of draft.squad) {
    if (!slot.is_starter || !slot.card_id) continue;
    const r = ratingFor(idx, slot.card_id);
    const line = slotPositionLine(slot.slot_position);
    const channel =
      line === "GK"
        ? r.goalkeeping
        : line === "DF"
          ? r.defense
          : line === "MF"
            ? r.midfield
            : r.attack;
    buckets[line].push(channel);
  }
  return LINES_ORDER.filter((line) => buckets[line].length > 0).map((line) => {
    const xs = buckets[line];
    const value = Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
    return { line, label: LINE_LABELS[line], count: xs.length, value };
  });
}

/** Average of non-null `overall` across filled STARTERS; null if none known. */
export function squadAverageOverall(
  idx: GameDataIndexes,
  draft: DraftState,
): number | null {
  let sum = 0;
  let count = 0;
  for (const slot of draft.squad) {
    if (!slot.is_starter || !slot.card_id) continue;
    const r = ratingFor(idx, slot.card_id);
    if (r.overall === null) continue;
    sum += r.overall;
    count += 1;
  }
  if (count === 0) return null;
  return Math.round(sum / count);
}
