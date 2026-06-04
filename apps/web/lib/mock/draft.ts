// ILLUSTRATIVE MOCK draft state for the WS-D draft / review screens.
//
// A 4-3-3 is LOCKED (formations lock at draft creation per the contract). The
// fixture seeds a draft already a few spins deep: four starters committed from
// earlier spins (lock-on-pick — committed, no rearrange), with the CURRENT spin
// rolling Brazil 1970. A short queue of further authored squads lets the demo
// walk the spin loop forward. No browser storage; all state is in-memory React.

import {
  FORMATION_TEMPLATES,
  slotPositionLine,
  type FormationTemplate,
  type SlotPosition,
} from "@wcdraft/core";
import { compatTier, mockPositionCompatibility } from "./compat";
import {
  ARGENTINA_1986,
  BRAZIL_1970,
  FRANCE_1998,
  findCard,
} from "./squads";
import type { PitchSlot, PlayerCard, SquadFixture } from "./types";

/** The locked formation for this draft. */
export const FORMATION: FormationTemplate = FORMATION_TEMPLATES["4-3-3"]!;

export const TOTAL_SPINS = 17;

/** Bench slot blueprint — coarse fallback roles (engine-owned in the contract). */
const BENCH_BLUEPRINT: ReadonlyArray<[slot_id: string, slot_position: SlotPosition]> = [
  ["bench.0", "GK"],
  ["bench.1", "CB"],
  ["bench.2", "CM"],
  ["bench.3", "ST"],
  ["bench.4", "LM"],
];

/** Build an empty PitchSlot from a fine slot position + channel. */
function emptySlot(
  slot_id: string,
  slot_position: SlotPosition,
  channel: "L" | "C" | "R",
  is_starter: boolean,
): PitchSlot {
  return {
    slot_id,
    is_starter,
    slot_position,
    line: slotPositionLine(slot_position),
    channel,
    card: null,
    position_compatibility: 0,
    warnings: [],
  };
}

/**
 * Place a card into a slot, computing graduated compatibility + soft warnings.
 * Pure — returns a new PitchSlot. Shared by the fixture seed and the live
 * draft screen so locked + in-flight placements use identical logic.
 */
export function placeCard(slot: PitchSlot, card: PlayerCard): PitchSlot {
  const compat = mockPositionCompatibility(card.eligible_positions, slot.slot_position);
  const warnings: string[] = [];
  const tier = compatTier(compat);
  if (slot.line === "GK" && !card.eligible_positions.includes("GK")) {
    warnings.push("Outfielder in goal — heavy sim penalty");
  } else if (tier === "misfit") {
    warnings.push("Wrong role for this slot");
  } else if (tier === "stretch") {
    warnings.push("Played out of position");
  }
  return { ...slot, card, position_compatibility: compat, warnings };
}

/** The 11 starter slots from the locked formation, in template order. */
export function starterSlots(): PitchSlot[] {
  return FORMATION.slots.map((s) => emptySlot(s.slot_id, s.slot_position, s.channel, true));
}

/** The 5 bench slots. */
export function benchSlots(): PitchSlot[] {
  return BENCH_BLUEPRINT.map(([id, pos]) => emptySlot(id, pos, "C", false));
}

/** Locked starters committed on earlier spins (player_id, year, slot_id). */
const LOCKED: ReadonlyArray<[player_id: string, year: number, slot_id: string]> = [
  ["ita-zoff", 1982, "4-3-3.GK"],
  ["esp-puyol", 2010, "4-3-3.LCB"],
  ["ned-cruyff", 1974, "4-3-3.LW"],
  ["bra02-ronaldinho", 2002, "4-3-3.RCM"],
];

/**
 * The draft's working squad with the four locked picks already placed.
 * Returns fresh arrays each call so the client screen can own mutable state.
 */
export function seededSquad(): { starters: PitchSlot[]; bench: PitchSlot[] } {
  const starters = starterSlots();
  for (const [player_id, year, slot_id] of LOCKED) {
    const idx = starters.findIndex((s) => s.slot_id === slot_id);
    if (idx >= 0) starters[idx] = placeCard(starters[idx]!, findCard(player_id, year));
  }
  return { starters, bench: benchSlots() };
}

/** slot_ids that arrived from earlier (immutable) spins — cannot be rearranged. */
export const LOCKED_SLOT_IDS: readonly string[] = LOCKED.map(([, , slot_id]) => slot_id);

/**
 * Ordered spin queue the demo can still play: the current spin (Brazil 1970)
 * plus a couple of further authored squads. Each is a unique (nation, year).
 * The first entry is the live spin; index in the round counter is offset by the
 * already-committed picks.
 */
export const SPIN_QUEUE: SquadFixture[] = [BRAZIL_1970, ARGENTINA_1986, FRANCE_1998];

/** 0-based index of the first queued spin within the 17 (4 already committed). */
export const FIRST_QUEUE_SPIN_INDEX = LOCKED.length;
