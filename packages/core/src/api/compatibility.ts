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
import { positionCompatibility as positionCompatibilityImpl } from "../engine/compatibility.js";

/**
 * Graduated 0..1 compatibility of `eligible` positions in a fine `SlotPosition`.
 * WS-B calibration: MAX-of-eligibles fold over `POSITION_COMPATIBILITY_FACTORS`.
 * Locked by `position-compatibility.golden.test.ts`.
 */
export const positionCompatibility: PositionCompatibilityFn = positionCompatibilityImpl;
