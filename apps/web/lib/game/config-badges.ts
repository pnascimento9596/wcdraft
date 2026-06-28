import {
  DEFAULT_DRAFT_CONFIG,
  type DraftConfig,
  type DraftFlow,
  type DraftState,
  type EraPresetId,
  type RatingBasis,
} from "@wcdraft/core";

import type { RunRecordV1 } from "./run-record";
import { decodeRunToken, encodeRunToken, tokenDraftConfig, type RunTokenBody } from "./run-token";

export type ConfigBadgeAxis = "era_preset" | "draft_flow" | "rating_basis";

export interface ConfigBadge {
  axis: ConfigBadgeAxis;
  label: string;
}

const ERA_LABEL: Record<EraPresetId, string> = {
  all_time: "All-time",
  post_2000: "2002-2026",
  post_2010: "2014-2026",
  modern: "2018-2026",
};

const FLOW_LABEL: Record<DraftFlow, string> = {
  squad_first: "Squad First",
  position_first: "Position First",
};

const BASIS_LABEL: Record<RatingBasis, string> = {
  career: "Career",
  current: "Current",
};

export function configBadgesFromDraftConfig(config: DraftConfig): ConfigBadge[] {
  const badges: ConfigBadge[] = [];
  if (config.era_preset !== DEFAULT_DRAFT_CONFIG.era_preset) {
    badges.push({ axis: "era_preset", label: ERA_LABEL[config.era_preset] });
  }
  if (config.draft_flow !== DEFAULT_DRAFT_CONFIG.draft_flow) {
    badges.push({ axis: "draft_flow", label: FLOW_LABEL[config.draft_flow] });
  }
  if (config.rating_basis !== DEFAULT_DRAFT_CONFIG.rating_basis) {
    badges.push({ axis: "rating_basis", label: BASIS_LABEL[config.rating_basis] });
  }
  return badges;
}

export function configBadgesFromToken(token: RunTokenBody): ConfigBadge[] {
  const { draft_flow, rating_basis, era_preset } = tokenDraftConfig(token);
  return configBadgesFromDraftConfig({ draft_flow, rating_basis, era_preset });
}

export function configBadgesFromReplayToken(runValue: string | null): ConfigBadge[] {
  if (!runValue) return [];
  const decoded = decodeRunToken(runValue);
  return decoded ? configBadgesFromToken(decoded) : [];
}

export function configBadgesFromRecordToken(record: RunRecordV1): ConfigBadge[] {
  try {
    const decoded = decodeRunToken(encodeRunToken(record));
    return decoded ? configBadgesFromToken(decoded) : [];
  } catch {
    return [];
  }
}

export function draftTargetLabel(draft: DraftState, target: string): string {
  if (target === "manager") return "manager slot";
  const slot = draft.squad.find((s) => s.slot_id === target);
  if (!slot) return target;
  const line = slot.is_starter ? "XI" : "Bench";
  return `${slot.slot_position} ${line}`;
}

export function lockBarIdleCopy({
  lockedTargetLabel,
  showReviewCta,
}: {
  lockedTargetLabel: string | null;
  showReviewCta: boolean;
}): string {
  if (showReviewCta) return "Draft complete — review your squad and prep for the run.";
  if (lockedTargetLabel)
    return `Locked target: ${lockedTargetLabel}. Select a player for this slot.`;
  return "Select a player and a slot, or pick the manager.";
}
