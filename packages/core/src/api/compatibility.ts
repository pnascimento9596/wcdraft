// Position-compatibility function — contract surface only (WS-0c).
//
// The signature is authoritative; the calibration (curve + fold) is the
// responsibility of WS-B and is locked once via the `position-compatibility`
// golden test. This file ships a typed `not implemented` runtime stub so that
// every consumer can compile and wire integrations against the contract.
//
// CONTRACT:
//   - Pure function of `(eligible, slot)` — no I/O, no PRNG, no globals.
//   - Output is a finite number in [0, 1].
//   - Throws RangeError on impossible inputs (empty `eligible`).
//   - The factor TABLE that drives the curve is the named const
//     `POSITION_COMPATIBILITY_FACTORS` in `types/formation.ts` — the values
//     there are PLACEHOLDER until WS-B calibration locks them.

import type { PositionCompatibilityFn } from "../types/formation.js";

/**
 * Runtime stub for `positionCompatibility`. WS-B replaces the body once the
 * factor curve and fold are calibrated and locked by golden test.
 */
export const positionCompatibility: PositionCompatibilityFn = () => {
  throw new Error(
    "positionCompatibility is contract-only in WS-0c; the calibration lands in WS-B.",
  );
};
