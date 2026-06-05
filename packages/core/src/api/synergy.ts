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
 * `ComputeSynergyFn` contract is 4-arg: `(squad, formation, manager,
 * nationByCardId?)`. The optional `nationByCardId` lookup threads the per-card
 * nation map (`SquadSlot` carries no `nation_id`); when omitted, no clusters /
 * links can form (see `ComputeSynergyFn` for the honest-state semantics).
 */
export const computeSynergy: ComputeSynergyFn = computeSynergyImpl;
