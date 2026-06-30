import type { DraftFlow, EraPresetId, RatingBasis } from "@wcdraft/core";
import type { LeaderboardChallengeKind } from "../game/daily";
import { ERA_PRESET_LABELS } from "../game/era-labels";

export type BoardLane = "casual" | "ranked";
export type BoardDraftMode = "classic" | "hidden";
export type BoardDraftOrder = DraftFlow;
export type BoardEra = EraPresetId;
export type BoardRatingBasis = RatingBasis;

export interface BoardConfigFilter {
  readonly challenge: LeaderboardChallengeKind;
  readonly challengeDate?: string | null;
  readonly lane: BoardLane;
  readonly draftMode: BoardDraftMode;
  readonly draftOrder: BoardDraftOrder;
  readonly era: BoardEra;
  readonly ratingBasis: BoardRatingBasis;
}

export const DEFAULT_BOARD_FILTER: BoardConfigFilter = Object.freeze({
  challenge: "season",
  challengeDate: null,
  lane: "ranked",
  draftMode: "classic",
  draftOrder: "squad_first",
  era: "all_time",
  ratingBasis: "career",
});

export const DEFAULT_DAILY_BOARD_FILTER: BoardConfigFilter = Object.freeze({
  challenge: "daily",
  challengeDate: null,
  lane: "casual",
  draftMode: "classic",
  draftOrder: "squad_first",
  era: "all_time",
  ratingBasis: "career",
});

export const BOARD_LANES: readonly { key: BoardLane; label: string }[] = Object.freeze([
  { key: "casual", label: "Casual" },
  { key: "ranked", label: "Ranked" },
]);

export const BOARD_DRAFT_MODES: readonly { key: BoardDraftMode; label: string }[] = Object.freeze([
  { key: "classic", label: "Sighted Classic" },
  { key: "hidden", label: "Blind Memory" },
]);

export const BOARD_DRAFT_ORDERS: readonly { key: BoardDraftOrder; label: string }[] = Object.freeze(
  [
    { key: "squad_first", label: "Squad First" },
    { key: "position_first", label: "Position First" },
  ],
);

export const BOARD_ERAS: readonly { key: BoardEra; label: string }[] = Object.freeze([
  { key: "all_time", label: ERA_PRESET_LABELS.all_time },
  { key: "post_2000", label: ERA_PRESET_LABELS.post_2000 },
  { key: "post_2010", label: ERA_PRESET_LABELS.post_2010 },
  { key: "modern", label: ERA_PRESET_LABELS.modern },
]);

export const BOARD_RATING_BASES: readonly {
  key: BoardRatingBasis;
  label: string;
}[] = Object.freeze([
  { key: "career", label: "Career" },
  { key: "current", label: "Current" },
]);

export function isBoardLane(value: unknown): value is BoardLane {
  return value === "casual" || value === "ranked";
}

export function isBoardDraftMode(value: unknown): value is BoardDraftMode {
  return value === "classic" || value === "hidden";
}

export function isBoardDraftOrder(value: unknown): value is BoardDraftOrder {
  return value === "squad_first" || value === "position_first";
}

export function isBoardEra(value: unknown): value is BoardEra {
  return (
    value === "all_time" || value === "post_2000" || value === "post_2010" || value === "modern"
  );
}

export function isBoardRatingBasis(value: unknown): value is BoardRatingBasis {
  return value === "career" || value === "current";
}

export function configLabel(filter: Omit<BoardConfigFilter, "lane">): string {
  return [
    labelFor(BOARD_DRAFT_MODES, filter.draftMode),
    labelFor(BOARD_DRAFT_ORDERS, filter.draftOrder),
    labelFor(BOARD_RATING_BASES, filter.ratingBasis),
    labelFor(BOARD_ERAS, filter.era),
  ].join(" / ");
}

export function draftModeLaneLabel(mode: BoardDraftMode): string {
  return mode === "hidden" ? "Blind Memory" : "Sighted Classic";
}

function labelFor<T extends string>(items: readonly { key: T; label: string }[], key: T): string {
  return items.find((item) => item.key === key)?.label ?? key;
}
