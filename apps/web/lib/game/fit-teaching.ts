import {
  isBlindDraftMode,
  positionCompatibility,
  projectSlotContribution,
  type DraftMode,
  type Position,
  type SlotPosition,
} from "@wcdraft/core";

import type { PlayerCardView } from "./view-models";

const STARTING_XI_SIZE = 11;

const LINE_DISPLAY_LABEL: Readonly<Record<Position, string>> = {
  GK: "GK",
  DF: "DEF",
  MF: "MID",
  FW: "ATT",
};

const LINE_ACCESSIBLE_LABEL: Readonly<Record<Position, string>> = {
  GK: "goalkeeping",
  DF: "defensive",
  MF: "midfield",
  FW: "attacking",
};

export type FitTeachingTier = "natural" | "reduced" | "severe";

export interface FitTeachingImpact {
  /** Fixed-XI pre-Synergy display value, in tenths of a 0..100 line point. */
  display_delta_tenths: number;
  display_delta_label: string;
  line: Position;
  line_label: string;
  slot_position: SlotPosition;
  fit_tier: FitTeachingTier;
  fit_copy: "reduced fit" | "severe fit penalty" | null;
  position_copy: string | null;
  basis: "career" | "current";
  accessible_label: string;
}

export interface FitTeachingSlot {
  slot_id: string;
  slot_position: SlotPosition;
  is_starter: boolean;
}

/**
 * S5 is intentionally opt-in by named visible-information modes. Daily uses
 * Classic rules today, but remains explicit here so a future Daily wrapper
 * cannot accidentally lose the teaching seam. Blind modes always fail closed.
 */
export function shouldShowFitTeaching(mode: DraftMode, daily: boolean): boolean {
  if (isBlindDraftMode(mode)) return false;
  return daily || mode === "classic" || mode === "open";
}

/**
 * The same candidate-specific default-slot policy used by DraftBoard locking:
 * prefer a vacant starter while any remain, then choose maximum canonical fit.
 * Stable input order is the tie-break, preserving the existing lock behavior.
 */
export function bestOpenSlotForCandidate(
  card: Pick<PlayerCardView, "eligible_positions">,
  openSlots: readonly FitTeachingSlot[],
): string | null {
  const starterOpens = openSlots.filter((slot) => slot.is_starter);
  const pool = starterOpens.length > 0 ? starterOpens : openSlots;
  let best: { id: string; compatibility: number } | null = null;
  for (const slot of pool) {
    const compatibility = positionCompatibility(card.eligible_positions, slot.slot_position);
    if (!best || compatibility > best.compatibility) {
      best = { id: slot.slot_id, compatibility };
    }
  }
  return best?.id ?? null;
}

/**
 * Resolve the honest per-candidate teaching context. A manual slot choice for
 * the selected card wins; otherwise position-first uses its locked target;
 * squad-first candidates retain their own default-lock context.
 */
export function resolveFitTeachingSlot(
  card: Pick<PlayerCardView, "card_id" | "eligible_positions">,
  slots: readonly FitTeachingSlot[],
  openSlots: readonly FitTeachingSlot[],
  context: {
    selected_card_id: string | null;
    selected_slot_id: string | null;
    locked_target_id: string | null;
  },
): FitTeachingSlot | null {
  const selectedSlotId =
    context.selected_card_id === card.card_id ? context.selected_slot_id : null;
  const slotId =
    selectedSlotId ?? context.locked_target_id ?? bestOpenSlotForCandidate(card, openSlots);
  return slotId ? (slots.find((slot) => slot.slot_id === slotId) ?? null) : null;
}

function basisResolvedRating(card: PlayerCardView) {
  const { attack, midfield, defense, goalkeeping } = card.rating;
  if (attack === null || midfield === null || defense === null || goalkeeping === null) {
    return null;
  }
  return { attack, midfield, defense, goalkeeping };
}

/**
 * Name the exact eligibility that wins the engine's max-compatibility fold.
 * Strict `>` preserves existing eligibility order as the deterministic tie
 * break. If the engine projection ever stops agreeing with this canonical
 * singleton probe, fail closed by omitting the single-source arrow.
 */
function projectionSourcePosition(
  eligiblePositions: readonly Position[],
  slotPosition: SlotPosition,
  projectedCompatibility: number,
): Position | null {
  let source: Position | null = null;
  let bestCompatibility = -1;
  for (const position of eligiblePositions) {
    const compatibility = positionCompatibility([position], slotPosition);
    if (compatibility > bestCompatibility) {
      source = position;
      bestCompatibility = compatibility;
    }
  }
  return bestCompatibility === projectedCompatibility ? source : null;
}

/**
 * Minimal display mapper around the authoritative engine projection.
 *
 * The engine's `weighted_channel` is deliberately not returned. Dividing it
 * by the fixed XI size yields this card's exact pre-Synergy contribution to
 * the target 0..100 team line. The UI rounds only that display-scale value to
 * one decimal; comparisons therefore treat equal rounded values as honest
 * ties rather than claiming false precision.
 */
export function projectFitTeachingImpact(
  card: PlayerCardView,
  slotPosition: SlotPosition,
): FitTeachingImpact | null {
  const rating = basisResolvedRating(card);
  if (!rating) return null;

  const projection = projectSlotContribution({
    rating,
    eligible_positions: card.eligible_positions,
    slot_position: slotPosition,
  });
  const displayDeltaTenths = Math.round((projection.weighted_channel * 10) / STARTING_XI_SIZE);
  const displayDeltaLabel = `+${(displayDeltaTenths / 10).toFixed(1)}`;
  const offNatural = projection.compatibility !== 1;
  const fitTier: FitTeachingTier = !offNatural
    ? "natural"
    : projection.compatibility >= 0.75
      ? "reduced"
      : "severe";
  const fitCopy =
    fitTier === "natural" ? null : fitTier === "reduced" ? "reduced fit" : "severe fit penalty";
  const sourcePosition = offNatural
    ? projectionSourcePosition(card.eligible_positions, slotPosition, projection.compatibility)
    : null;
  const positionCopy = sourcePosition ? `${sourcePosition} → ${slotPosition}` : null;
  const basisLabel = card.rating.basis === "current" ? "Current" : "Career";
  const fitSentence =
    fitCopy === null
      ? " Natural fit."
      : positionCopy
        ? ` ${positionCopy}, ${fitCopy}.`
        : ` ${fitCopy}.`;

  return {
    display_delta_tenths: displayDeltaTenths,
    display_delta_label: displayDeltaLabel,
    line: projection.line,
    line_label: LINE_DISPLAY_LABEL[projection.line],
    slot_position: slotPosition,
    fit_tier: fitTier,
    fit_copy: fitCopy,
    position_copy: positionCopy,
    basis: card.rating.basis,
    accessible_label: `${basisLabel} projection for ${slotPosition}: ${LINE_ACCESSIBLE_LABEL[projection.line]} line ${displayDeltaLabel} before Synergy.${fitSentence}`,
  };
}

export function fitTeachingImpactForMode(input: {
  mode: DraftMode;
  daily: boolean;
  card: PlayerCardView;
  slot_position: SlotPosition;
}): FitTeachingImpact | null {
  if (!shouldShowFitTeaching(input.mode, input.daily)) return null;
  return projectFitTeachingImpact(input.card, input.slot_position);
}
