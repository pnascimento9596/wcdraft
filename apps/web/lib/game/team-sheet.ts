import {
  FORMATION_TEMPLATES,
  positionCompatibility,
  slotPositionLine,
  type CardId,
  type DraftState,
  type Position,
  type SquadSlot,
} from "@wcdraft/core";

import type { GameData } from "./data";
import type { RunRecordV1 } from "./run-record";

export const TEAM_SHEET_PLAYER_COUNT = 16 as const;
export const TEAM_SHEET_STARTER_COUNT = 11 as const;

/** Card ids in canonical destination order: formation XI, then bench.0..4. */
export type TeamSheetArrangement = readonly string[];

export type TeamSheetErrorCode =
  | "WRONG_COUNT"
  | "DUPLICATE_PLAYER"
  | "UNKNOWN_PLAYER"
  | "SLOT_BENCH_OVERLAP";

export class TeamSheetError extends Error {
  constructor(
    readonly code: TeamSheetErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TeamSheetError";
  }
}

/** Stable destination order shared by persistence, tokens, simulation and views. */
export function canonicalTeamSheetSlots(draft: DraftState): readonly SquadSlot[] {
  const formation = FORMATION_TEMPLATES[draft.formation_id];
  if (!formation) throw new TeamSheetError("UNKNOWN_PLAYER", "unknown formation");
  const byId = new Map(draft.squad.map((slot) => [slot.slot_id, slot]));
  const starters = formation.slots.map((slot) => {
    const found = byId.get(slot.slot_id);
    if (!found || !found.is_starter) {
      throw new TeamSheetError(
        "SLOT_BENCH_OVERLAP",
        `draft is missing canonical starter destination ${slot.slot_id}`,
      );
    }
    return found;
  });
  const bench = [...draft.squad.filter((slot) => !slot.is_starter)].sort((left, right) =>
    left.slot_id.localeCompare(right.slot_id, "en", { numeric: true }),
  );
  if (starters.length !== TEAM_SHEET_STARTER_COUNT || bench.length !== 5) {
    throw new TeamSheetError(
      "WRONG_COUNT",
      `team sheet requires 11 starter and 5 bench destinations, got ${starters.length} and ${bench.length}`,
    );
  }
  return [...starters, ...bench];
}

export function asDraftedTeamSheet(draft: DraftState): TeamSheetArrangement {
  const cards = canonicalTeamSheetSlots(draft).map((slot) => slot.card_id);
  if (cards.some((cardId) => cardId === null)) {
    throw new TeamSheetError("WRONG_COUNT", "team sheet requires 16 drafted player cards");
  }
  return cards as string[];
}

/**
 * The sole legality boundary. Position compatibility is intentionally absent:
 * it remains a graduated strength/fit penalty and can never block confirm.
 */
export function verifyTeamSheetArrangement(
  draft: DraftState,
  arrangement?: TeamSheetArrangement,
): TeamSheetArrangement {
  const drafted = asDraftedTeamSheet(draft);
  const candidate = arrangement === undefined ? drafted : [...arrangement];
  if (candidate.length !== TEAM_SHEET_PLAYER_COUNT) {
    throw new TeamSheetError(
      "WRONG_COUNT",
      `team sheet must contain exactly 16 players, got ${candidate.length}`,
    );
  }
  const firstDestination = new Map<string, number>();
  for (let destination = 0; destination < candidate.length; destination += 1) {
    const cardId = candidate[destination]!;
    const first = firstDestination.get(cardId);
    if (first !== undefined) {
      const crossesStarterBench =
        first < TEAM_SHEET_STARTER_COUNT !== destination < TEAM_SHEET_STARTER_COUNT;
      throw new TeamSheetError(
        crossesStarterBench ? "SLOT_BENCH_OVERLAP" : "DUPLICATE_PLAYER",
        crossesStarterBench
          ? "the same player occupies a starter and bench destination"
          : "team sheet contains a duplicate player card",
      );
    }
    firstDestination.set(cardId, destination);
  }
  const draftedSet = new Set(drafted);
  const unknown = candidate.find((cardId) => !draftedSet.has(cardId));
  if (unknown !== undefined) {
    throw new TeamSheetError("UNKNOWN_PLAYER", `team sheet references undrafted card ${unknown}`);
  }
  return candidate;
}

/** Compact token form: canonical destination -> as-drafted card index. */
export function encodeTeamSheetArrangement(
  draft: DraftState,
  arrangement?: TeamSheetArrangement,
): number[] | undefined {
  const drafted = asDraftedTeamSheet(draft);
  const verified = verifyTeamSheetArrangement(draft, arrangement);
  if (verified.every((cardId, index) => cardId === drafted[index])) return undefined;
  const indexByCard = new Map(drafted.map((cardId, index) => [cardId, index]));
  return verified.map((cardId) => indexByCard.get(cardId)!);
}

export function decodeTeamSheetArrangement(
  draft: DraftState,
  encoded?: readonly number[],
): TeamSheetArrangement {
  const drafted = asDraftedTeamSheet(draft);
  if (encoded === undefined) return drafted;
  if (encoded.length !== TEAM_SHEET_PLAYER_COUNT) {
    throw new TeamSheetError("WRONG_COUNT", `encoded team sheet has ${encoded.length} entries`);
  }
  const cards = encoded.map((index) => drafted[index]);
  if (cards.some((cardId) => cardId === undefined)) {
    throw new TeamSheetError("UNKNOWN_PLAYER", "encoded team sheet references an unknown card");
  }
  return verifyTeamSheetArrangement(draft, cards as string[]);
}

/**
 * Project a verified sheet for simulation/display only. Pick history and its
 * original assigned-slot evidence remain immutable on the persisted draft.
 */
export function materializeTeamSheetDraft(
  gameData: GameData,
  draft: DraftState,
  arrangement?: TeamSheetArrangement,
): DraftState {
  const verified = verifyTeamSheetArrangement(draft, arrangement);
  const destinations = canonicalTeamSheetSlots(draft);
  const sourceByCard = new Map(
    draft.squad.flatMap((slot) => (slot.card_id === null ? [] : [[slot.card_id, slot] as const])),
  );
  const squad = destinations.map((destination, index) => {
    const cardId = verified[index]!;
    const source = sourceByCard.get(cardId as CardId);
    const card = gameData.indexes.playerByCardId.get(cardId as CardId);
    if (!source || !card) {
      throw new TeamSheetError("UNKNOWN_PLAYER", `team sheet references unknown card ${cardId}`);
    }
    const eligible = card.eligible_positions as readonly Position[];
    const compatibility = destination.is_starter
      ? positionCompatibility(eligible, destination.slot_position)
      : 1;
    return {
      ...destination,
      card_id: source.card_id as CardId,
      player_id: source.player_id,
      tournament_id: source.tournament_id,
      position_compatibility: compatibility,
      validation_warnings: destination.is_starter
        ? fitWarnings(destination.slot_position, eligible, compatibility)
        : [],
    } satisfies SquadSlot;
  });
  return { ...draft, squad };
}

/**
 * The single ephemeral projection seam for record consumers.
 *
 * `record.draft` remains the immutable legal-pick authority used by token
 * encoding and persistence. Simulation and every presentation surface call
 * this helper so an arranged score can never be paired with the as-drafted
 * XI/bench.
 */
export function projectTeamSheetDraft(
  gameData: GameData,
  record: Pick<RunRecordV1, "draft" | "arrangement">,
): DraftState {
  return record.arrangement === undefined
    ? record.draft
    : materializeTeamSheetDraft(gameData, record.draft, record.arrangement);
}

function fitWarnings(
  slotPosition: SquadSlot["slot_position"],
  eligible: readonly Position[],
  compatibility: number,
): string[] {
  if (compatibility >= 1) return [];
  const eligibleLabel = eligible.join("/");
  if (slotPositionLine(slotPosition) === "GK" && !eligible.includes("GK")) {
    return [
      `Severe fit: ${eligibleLabel} in goal · ${Math.round(compatibility * 100)}% fit strength (allowed)`,
    ];
  }
  return [
    `${eligibleLabel} in ${slotPosition} · ${Math.round(compatibility * 100)}% fit strength (allowed)`,
  ];
}
