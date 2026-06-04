// WS-B implementation of `positionCompatibility` — the graduated compatibility
// of a card (`eligible: Position[]`) playing a fine `SlotPosition`.
//
// CALIBRATION: tune vs historical scorelines. The factor TABLE
// (`POSITION_COMPATIBILITY_FACTORS`) and the FOLD chosen here are the WS-B
// calibration, locked by `position-compatibility.golden.test.ts`.
//
// FOLD CHOICE: MAX-of-eligibles. A card eligible at several positions plays the
// slot at its BEST-matching eligibility (a DF/MF utility man in a CB slot is a
// natural CB, not penalised for also being a midfielder). This is the WS-B
// candidate named in the golden scaffold and is locked here.

import { POSITION_COMPATIBILITY_FACTORS, slotPositionLine } from "../types/formation.js";
import type { PositionCompatibilityFn } from "../types/formation.js";

/**
 * Graduated 0..1 compatibility of `eligible` positions covering `slot`.
 *
 * @throws RangeError when `eligible` is empty — an unplaceable card is an
 *   honest error, never a soft 0 (a soft 0 would silently look like a legal
 *   placement with zero contribution).
 */
export const positionCompatibility: PositionCompatibilityFn = (eligible, slot) => {
  if (eligible.length === 0) {
    throw new RangeError("positionCompatibility requires a non-empty eligible-positions array");
  }
  const slotLine = slotPositionLine(slot);
  let best = 0;
  for (const e of eligible) {
    const factor = POSITION_COMPATIBILITY_FACTORS[e][slotLine];
    if (factor > best) best = factor;
  }
  return best;
};
