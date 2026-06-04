// UI MOCK position-compatibility — NOT the calibrated engine.
//
// The real `positionCompatibility` (api/compatibility.ts) is a typed stub that
// throws "not implemented" until WS-B calibrates the curve. For the WS-D screen
// scaffold we compute a stand-in feedback value from the CONTRACT DATA table
// `POSITION_COMPATIBILITY_FACTORS` (a frozen constant, not engine code), folding
// over a card's eligible coarse positions with `max` (best fit wins). This lets
// the draft screen show graduated per-slot feedback now; the number is replaced
// by the real engine output at WS-D-integration.

import {
  POSITION_COMPATIBILITY_FACTORS,
  slotPositionLine,
  type Position,
  type SlotPosition,
} from "@wcdraft/core";

/**
 * Graduated 0..1 compatibility of a card (its `eligible` coarse positions)
 * playing a `slot` (fine SlotPosition). Max-fold over the contract factor table.
 * Empty eligibility → 0 (honest-state: nothing to rate).
 */
export function mockPositionCompatibility(
  eligible: readonly Position[],
  slot: SlotPosition,
): number {
  if (eligible.length === 0) return 0;
  const slotLine = slotPositionLine(slot);
  let best = 0;
  for (const line of eligible) {
    const factor = POSITION_COMPATIBILITY_FACTORS[line][slotLine];
    if (factor > best) best = factor;
  }
  return best;
}

/** Qualitative bucket for a compatibility value, for badges / colour. */
export type CompatTier = "ideal" | "ok" | "stretch" | "misfit";

export function compatTier(compat: number): CompatTier {
  if (compat >= 0.99) return "ideal";
  if (compat >= 0.7) return "ok";
  if (compat >= 0.4) return "stretch";
  return "misfit";
}

const TIER_LABEL: Record<CompatTier, string> = {
  ideal: "Natural fit",
  ok: "Plays here",
  stretch: "Out of position",
  misfit: "Wrong role",
};

export function compatLabel(compat: number): string {
  return TIER_LABEL[compatTier(compat)];
}
