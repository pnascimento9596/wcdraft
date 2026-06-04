// Synergy — contract surface only (WS-0c).
//
// The signature is authoritative; the calibration (component weights +
// multiplier bounds) is the responsibility of WS-B and is locked once via the
// `synergy-determinism` golden test (and a follow-up `synergy-bounded`
// golden test that lands with the WS-B calibration). This file ships a typed
// `not implemented` runtime stub so every consumer can compile and wire
// integrations against the contract.

import type { ComputeSynergyFn } from "../types/synergy.js";
import { computeSynergy as computeSynergyImpl } from "../engine/synergy.js";

/**
 * WS-B Synergy formula (engine body in `../engine/synergy.ts`). The public
 * binding is narrowed to the 3-arg `ComputeSynergyFn` contract; the engine
 * function additionally accepts an optional `nationByCardId` lookup (see the
 * engine contract-gap note) used internally by `runTournament`.
 */
export const computeSynergy: ComputeSynergyFn = computeSynergyImpl;
