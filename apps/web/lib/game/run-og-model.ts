import type { DraftState, Position } from "@wcdraft/core";

import { configBadgesFromToken, type ConfigBadge } from "./config-badges";
import type { GameData } from "./data";
import { getFormationVisualSlots } from "./formation-layout";
import { adjustPitchLayoutForRender } from "./pitch-layout";
import { positionShape, type PositionShape } from "./view-models";
import {
  reconstructDraftFromToken,
  runTokenOgSummary,
  type RunTokenOgSummary,
  type RunTokenV2Body,
} from "./run-token";
import {
  formationName,
  managerLine,
  topStars,
  type ShareManager,
  type ShareStar,
} from "./share-adapters";
import { formatRunOgResult } from "./run-og-metadata";

export interface RunOgLineupSlot {
  slot_id: string;
  slot_label: string;
  position: Position;
  shape: PositionShape;
  x_pct: number;
  y_pct: number;
  name: string;
  nation_code: string;
}

export interface RunOgModel {
  team_name: string;
  mode_label: "Classic" | "Memory";
  formation_name: string;
  result_label: string;
  record: string;
  summary: RunTokenOgSummary;
  badges: ConfigBadge[];
  lineup: RunOgLineupSlot[];
  stars: ShareStar[];
  manager: ShareManager | null;
}

export function buildRunOgModel(gameData: GameData, token: RunTokenV2Body): RunOgModel | null {
  const summary = runTokenOgSummary(token);
  if (!summary) return null;
  const draft = reconstructDraftFromToken(token, gameData);
  const lineup = buildLineup(gameData, draft);
  return {
    team_name: draft.team_name,
    mode_label: draft.mode === "hidden" ? "Memory" : "Classic",
    formation_name: formationName(draft),
    result_label: formatRunOgResult(summary),
    record: `${summary.w}-${summary.l}`,
    summary,
    badges: configBadgesFromToken(token),
    lineup,
    stars: topStars(gameData, draft, 3),
    manager: managerLine(gameData, draft),
  };
}

function buildLineup(gameData: GameData, draft: DraftState): RunOgLineupSlot[] {
  const visualSlots = adjustPitchLayoutForRender(getFormationVisualSlots(draft.formation_id));
  return visualSlots.map((visual) => {
    const squadSlot = draft.squad.find((slot) => slot.slot_id === visual.slot_id);
    if (!squadSlot || !squadSlot.is_starter || squadSlot.card_id === null) {
      throw new Error(`run OG lineup: missing starter for slot ${visual.slot_id}`);
    }
    const cardId = squadSlot.card_id as string;
    const card = gameData.indexes.playerByCardId.get(cardId);
    if (!card) throw new Error(`run OG lineup: missing player card ${cardId}`);
    const nation = gameData.indexes.nationById.get(card.nation_id);
    return {
      slot_id: visual.slot_id,
      slot_label: visual.display_label,
      position: visual.position_line,
      shape: positionShape(visual.position_line),
      x_pct: visual.x_pct,
      y_pct: visual.y_pct,
      name:
        gameData.indexes.displayNameByCardId.get(card.card_id) ??
        (card.common_name && card.common_name.trim().length > 0
          ? card.common_name
          : card.full_name),
      nation_code: nation?.code ?? card.nation_id.toUpperCase(),
    };
  });
}
