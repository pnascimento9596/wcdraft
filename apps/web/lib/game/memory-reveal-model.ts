import type { DraftState, Position } from "@wcdraft/core";

import { lineStrengthViews, pitchSlotViews, squadAverageOverall } from "./adapters";
import type { GameData } from "./data";
import type { PitchSlotView, PositionShape, RatingBadgeKind } from "./view-models";
import { positionShape } from "./view-models";

export interface MemoryRevealLineView {
  readonly line: Position;
  readonly label: string;
  readonly count: number;
  readonly before_value: number | null;
  readonly after_value: number | null;
}

export interface MemoryRevealStarterView {
  readonly slot_id: string;
  readonly slot_label: string;
  readonly shape: PositionShape;
  readonly badge_kind: RatingBadgeKind;
  readonly name: string;
  readonly nation_code: string;
  readonly before_overall: number | null;
  readonly after_overall: number | null;
}

export interface MemoryRevealView {
  readonly starters: PitchSlotView[];
  readonly bench: PitchSlotView[];
  readonly lineRatings: MemoryRevealLineView[];
  readonly squadAverageBefore: number | null;
  readonly squadAverageAfter: number | null;
  readonly revealStarters: MemoryRevealStarterView[];
  readonly topReveals: MemoryRevealStarterView[];
}

export function buildMemoryRevealView(gameData: GameData, draft: DraftState): MemoryRevealView {
  const basis = draft.rating_basis;
  const open = pitchSlotViews(gameData.indexes, draft, { basis });
  const blind = pitchSlotViews(gameData.indexes, draft, { blindRatings: true, basis });
  const openLines = lineStrengthViews(gameData.indexes, draft, { basis });
  const blindLines = lineStrengthViews(gameData.indexes, draft, { blindRatings: true, basis });
  const blindLineByLine = new Map(blindLines.map((line) => [line.line, line]));
  const blindStarterBySlot = new Map(blind.starters.map((slot) => [slot.slot_id, slot]));

  const revealStarters = open.starters.map((slot): MemoryRevealStarterView => {
    const blindSlot = blindStarterBySlot.get(slot.slot_id);
    return {
      slot_id: slot.slot_id,
      slot_label: String(slot.slot_position),
      shape: positionShape(slot.line),
      badge_kind: slot.card?.rating.badge_kind ?? "masked",
      name: slot.card?.name ?? "Open",
      nation_code: slot.card?.nation_code ?? "—",
      before_overall: blindSlot?.card?.rating.overall ?? null,
      after_overall: slot.card?.rating.overall ?? null,
    };
  });

  const topReveals = [...revealStarters]
    .sort((a, b) => {
      const ao = a.after_overall ?? -1;
      const bo = b.after_overall ?? -1;
      if (bo !== ao) return bo - ao;
      return a.slot_id.localeCompare(b.slot_id);
    })
    .slice(0, 3);

  return {
    starters: open.starters,
    bench: open.bench,
    lineRatings: openLines.map((line) => {
      const before = blindLineByLine.get(line.line);
      return {
        line: line.line,
        label: line.label,
        count: line.count,
        before_value: before?.value ?? null,
        after_value: line.value,
      };
    }),
    squadAverageBefore: squadAverageOverall(gameData.indexes, draft, {
      blindRatings: true,
      basis,
    }),
    squadAverageAfter: squadAverageOverall(gameData.indexes, draft, { basis }),
    revealStarters,
    topReveals,
  };
}
