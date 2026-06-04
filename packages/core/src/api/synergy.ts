// Synergy — contract surface only (WS-0c).
//
// The signature is authoritative; the calibration (component weights +
// multiplier bounds) is the responsibility of WS-B and is locked once via the
// `synergy-determinism` golden test (and a follow-up `synergy-bounded`
// golden test that lands with the WS-B calibration). This file ships a typed
// `not implemented` runtime stub so every consumer can compile and wire
// integrations against the contract.

import type { ComputeSynergyFn } from "../types/synergy.js";

/**
 * Runtime stub for `computeSynergy`. WS-B replaces the body once the Synergy
 * formula and multiplier bounds are calibrated and locked by golden test.
 */
export const computeSynergy: ComputeSynergyFn = () => {
  throw new Error("computeSynergy is contract-only in WS-0c; the formula lands in WS-B.");
};
