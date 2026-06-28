import type { DraftState, Position } from "@wcdraft/core";

import { playerCardView } from "./adapters";
import { configBadgesFromToken, type ConfigBadge } from "./config-badges";
import type { GameData } from "./data";
import { getFormationVisualSlots } from "./formation-layout";
import { adjustPitchLayoutForRender } from "./pitch-layout";
import { positionShape, type PositionShape } from "./view-models";
import {
  reconstructDraftFromToken,
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
  narrative: string;
  summary: RunTokenOgSummary;
  badges: ConfigBadge[];
  lineup: RunOgLineupSlot[];
  stars: ShareStar[];
  manager: ShareManager | null;
}

const TEAM_NAME_MAX = 80;

export function buildRunOgModelFromTrustedSummary(
  gameData: GameData,
  token: RunTokenV2Body,
  summary: RunTokenOgSummary,
): RunOgModel {
  const draft = reconstructDraftFromToken(token, gameData);
  return buildRunOgModelFromTrustedDraft(gameData, token, draft, summary);
}

export function buildRunOgModelFromTrustedDraft(
  gameData: GameData,
  token: RunTokenV2Body,
  draft: DraftState,
  summary: RunTokenOgSummary,
  narrative?: string | null,
): RunOgModel {
  const lineup = buildLineup(gameData, draft);
  return {
    team_name: boundedText(draft.team_name, "Your XI", TEAM_NAME_MAX),
    mode_label: draft.mode === "hidden" ? "Memory" : "Classic",
    formation_name: formationName(draft),
    result_label: formatRunOgResult(summary),
    record: `${summary.w}-${summary.l}`,
    narrative: boundedText(narrative ?? "", formatRunOgResult(summary), 150),
    summary,
    badges: configBadgesFromToken(token),
    lineup,
    stars: topStars(gameData, draft, 3),
    manager: managerLine(gameData, draft),
  };
}

function boundedText(value: string, fallback: string, max: number): string {
  const cleaned = value.replace(/\s+/gu, " ").trim();
  const source = cleaned.length > 0 ? cleaned : fallback;
  if (source.length <= max) return source;
  const suffix = "...";
  return `${source.slice(0, Math.max(0, max - suffix.length)).trimEnd()}${suffix}`;
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
    const view = playerCardView(gameData.indexes, cardId, { basis: draft.rating_basis });
    return {
      slot_id: visual.slot_id,
      slot_label: visual.display_label,
      position: visual.position_line,
      shape: positionShape(visual.position_line),
      x_pct: visual.x_pct,
      y_pct: visual.y_pct,
      name: view.name,
      nation_code: view.nation_code,
    };
  });
}
