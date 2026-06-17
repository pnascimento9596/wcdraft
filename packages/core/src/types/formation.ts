// Formation / slot-position layer of the wcdraft data contract (WS-0c depth layer).
//
// WHY A FINE VOCABULARY EXISTS: the coarse `Position = 'GK'|'DF'|'MF'|'FW'`
// from `primitives.ts` is the AUTHORITATIVE per-CARD position spine (it is what
// historical sources actually record about a human player at a tournament).
// `SlotPosition` is OUR DESIGN — the fine layout vocabulary the formation
// templates use to describe specific roles (LCB vs RCB, CDM vs CAM, etc.).
// SlotPosition NEVER appears on a player/card; it is a property of a *slot* in
// a `FormationTemplate`. We do not, and must not, claim that a 1954 source row
// listed Puskás as "SS" — sources don't carry that resolution.
//
// CARDINAL RULE: per-CARD eligibility stays coarse `Position[]`. Compatibility
// between a card and a slot is GRADUATED (0..1) via `positionCompatibility`,
// not a hard yes/no flag. This is intentional: out-of-position placement
// remains a SOFT penalty (sim drag), never a draft blocker.
//
// SCOPE OF THIS FILE: types + factor table + signature + the six MVP
// FormationTemplates materialized as data, including their adjacency edge
// lists. NO algorithms — `positionCompatibility` lives as a typed stub in
// `api/compatibility.ts` and is calibrated in WS-B.

import type { Position } from "./primitives.js";

// ─── SLOT POSITION (fine vocabulary; our design, NOT a player claim) ─────────

/**
 * Fine-grained slot vocabulary used by FormationTemplates. Order is grouped by
 * line (GK · DF · MF · FW) and roughly left → centre → right within each line
 * so a reviewer can scan for missing roles.
 *
 *  - GK
 *  - DF:  LB, RB, LCB, CB, RCB, LWB, RWB, SW
 *  - MF:  CDM, DM, LCM, CM, RCM, LM, RM, CAM, AM
 *  - FW:  LW, RW, LF, CF, RF, ST, SS
 *
 * `LB`/`RB` are fullbacks; `LWB`/`RWB` are wing-backs (typical of 3-at-the-back
 * shapes). `SW` is the sweeper / libero — kept in the vocabulary because the
 * older shapes referenced in MVP scoring will want it later; the six MVP
 * templates in this file do NOT use it (sweeper systems land WS-B+).
 * `CDM` vs `DM` and `CAM` vs `AM` distinguish single vs double pivots / 10s.
 */
export type SlotPosition =
  | "GK"
  | "LB"
  | "RB"
  | "LCB"
  | "CB"
  | "RCB"
  | "LWB"
  | "RWB"
  | "SW"
  | "CDM"
  | "DM"
  | "LCM"
  | "CM"
  | "RCM"
  | "LM"
  | "RM"
  | "CAM"
  | "AM"
  | "LW"
  | "RW"
  | "LF"
  | "CF"
  | "RF"
  | "ST"
  | "SS";

/** Ordered enumeration for zod / iteration. Source of truth for the union above. */
export const SLOT_POSITIONS: readonly SlotPosition[] = [
  "GK",
  "LB",
  "RB",
  "LCB",
  "CB",
  "RCB",
  "LWB",
  "RWB",
  "SW",
  "CDM",
  "DM",
  "LCM",
  "CM",
  "RCM",
  "LM",
  "RM",
  "CAM",
  "AM",
  "LW",
  "RW",
  "LF",
  "CF",
  "RF",
  "ST",
  "SS",
] as const;

/**
 * Coarse-line projection of a fine `SlotPosition`. Deterministic, total.
 * The mapping is:
 *
 *   GK                              → GK
 *   LB RB LCB CB RCB LWB RWB SW     → DF
 *   CDM DM LCM CM RCM LM RM CAM AM  → MF
 *   LW RW LF CF RF ST SS            → FW
 */
export function slotPositionLine(sp: SlotPosition): Position {
  switch (sp) {
    case "GK":
      return "GK";
    case "LB":
    case "RB":
    case "LCB":
    case "CB":
    case "RCB":
    case "LWB":
    case "RWB":
    case "SW":
      return "DF";
    case "CDM":
    case "DM":
    case "LCM":
    case "CM":
    case "RCM":
    case "LM":
    case "RM":
    case "CAM":
    case "AM":
      return "MF";
    case "LW":
    case "RW":
    case "LF":
    case "CF":
    case "RF":
    case "ST":
    case "SS":
      return "FW";
    default: {
      // Exhaustiveness gate — if a new SlotPosition is added to the union
      // without extending this switch, TS will flag here.
      const _exhaustive: never = sp;
      throw new RangeError(`slotPositionLine: unhandled SlotPosition ${String(_exhaustive)}`);
    }
  }
}

// ─── POSITION COMPATIBILITY (graduated, coarse-only) ─────────────────────────

/**
 * Placeholder graduated compatibility factor table.
 *
 * CALIBRATION: WS-B — these numbers are the contract-time placeholder values
 * declared by the WS-0c task spec; WS-B locks the final calibration via a
 * golden test. The shape of the surface (which (line-of-eligible, line-of-slot)
 * pairs exist, and which side is "off") is part of THIS contract and must NOT
 * change without bumping the rating-version anchor.
 *
 * Semantics: `factor(eligibleLine, slotLine)` returns the per-line factor the
 * implementation will fold across `eligible_positions` to produce a final 0..1.
 * The exact fold function (max, mean, etc.) is itself part of WS-B calibration
 * and is documented at the implementation site in `api/compatibility.ts`.
 *
 *  - Same line (incl. intra-line moves like LCB↔CB)      = 1.00
 *  - One line off (DF↔MF, MF↔FW)                         ≈ 0.75
 *  - Two lines off (DF↔FW)                               ≈ 0.45
 *  - GK ↔ outfield (asymmetric: GK side OR outfield side
 *    of the pairing, used for either an outfielder in GK
 *    or a GK in an outfield slot)                        ≈ 0.15
 *
 * No "NaN" / missing cells: every (Position, Position) pair is covered.
 */
export const POSITION_COMPATIBILITY_FACTORS: Readonly<
  Record<Position, Readonly<Record<Position, number>>>
> = Object.freeze({
  GK: Object.freeze({ GK: 1.0, DF: 0.15, MF: 0.15, FW: 0.15 }),
  DF: Object.freeze({ GK: 0.15, DF: 1.0, MF: 0.75, FW: 0.45 }),
  MF: Object.freeze({ GK: 0.15, DF: 0.75, MF: 1.0, FW: 0.75 }),
  FW: Object.freeze({ GK: 0.15, DF: 0.45, MF: 0.75, FW: 1.0 }),
});

/**
 * Graduated compatibility of a card (`eligible: Position[]`) playing a given
 * slot (`slot: SlotPosition`). Output is in `[0, 1]`. Implementation lives in
 * `api/compatibility.ts` as a typed stub; the curve / fold is calibrated in
 * WS-B and locked via the `position-compatibility` golden test.
 */
export type PositionCompatibilityFn = (
  eligible: readonly Position[],
  slot: SlotPosition,
) => number;

// ─── FORMATION TEMPLATE (locked before spin 1) ──────────────────────────────

/**
 * Field channel — left, centre, right. Used both as a labeling aid in the UI
 * and (more importantly) as the adjacency rule's notion of "same / adjacent
 * channel". Adjacency: L↔C and C↔R are adjacent; L↔R are NOT adjacent.
 */
export type FormationChannel = "L" | "C" | "R";

/**
 * One slot within a FormationTemplate's starting 11. Slot ids are STABLE within
 * a template and form the foreign key carried by `SquadSlot.slot_id` for the
 * starter half of the squad.
 */
export interface FormationSlot {
  /** Stable within a template, e.g. "4-3-3.LCB". */
  slot_id: string;
  /** Fine position role for this slot. */
  slot_position: SlotPosition;
  /** Channel bucket for the adjacency rule. */
  channel: FormationChannel;
}

/**
 * Pre-validated formation template. The set of templates is small,
 * authoritative, and immutable once published (changes bump the engine version
 * anchor). The `adjacency` edge list is REDUNDANT with the rule — it is
 * materialized here so consumers (Synergy, UI, sim) don't each re-derive it,
 * AND so the boundary schema can re-derive and assert equality (drift guard).
 *
 * ADJACENCY RULE (OUR design for Synergy-link linking):
 *   Two starter slots link iff (a) horizontally neighboring in the same LINE
 *   (GK/DF/MF/FW, via `slotPositionLine`), OR (b) vertically neighboring
 *   across CONSECUTIVE lines AND in the SAME or ADJACENT channel.
 *
 * "Horizontally neighboring in the same line" is defined as: when the slots in
 * a line are sorted L → C → R (and within a tier secondarily by the order
 * declared in `slots`), adjacent pairs in that ordering link. So a back four
 * (LB, LCB, RCB, RB) links LB–LCB, LCB–RCB, RCB–RB — but NOT LB–RB.
 *
 * Symmetric, no self-edges, each pair canonicalised so `[a, b]` has `a < b`
 * lexicographically. The schema re-derives and asserts equality.
 */
export interface FormationTemplate {
  /** Stable formation id, e.g. "4-3-3". */
  formation_id: string;
  /** Display name (currently identical to formation_id; surfaced for UI). */
  name: string;
  /** Always 11 starter slots; bench slots are NOT part of the template. */
  slots: FormationSlot[];
  /**
   * Adjacency edge list materialised from the rule above. Each edge is
   * `[slot_id_a, slot_id_b]` with `slot_id_a < slot_id_b` lexicographically;
   * the array itself is sorted lexicographically. Stable across versions.
   */
  adjacency: ReadonlyArray<readonly [string, string]>;
}

// ─── ADJACENCY DERIVATION HELPER ─────────────────────────────────────────────

/**
 * The channels adjacent to a given channel — used to materialise the vertical
 * step of the adjacency rule. L↔C, C↔L+R, R↔C.
 */
const CHANNEL_ADJACENT: Readonly<Record<FormationChannel, readonly FormationChannel[]>> = {
  L: ["L", "C"],
  C: ["L", "C", "R"],
  R: ["R", "C"],
};

/** Stable channel order for "horizontally neighboring in the same line". */
const CHANNEL_ORDER: Readonly<Record<FormationChannel, number>> = { L: 0, C: 1, R: 2 };

/** Stable line order (GK below DF below MF below FW from the goal forward). */
const LINE_ORDER: Readonly<Record<Position, number>> = { GK: 0, DF: 1, MF: 2, FW: 3 };

/**
 * Pure helper: derive the adjacency edge list for a starting-11 slot layout
 * from the rule. Exposed for the formation-adjacency golden test (so the test
 * can reconstruct the expected edge list from the layout and deep-equal
 * against `template.adjacency`). NOT exported from the package barrel — keep
 * the public surface narrow.
 */
export function deriveFormationAdjacency(
  slots: readonly FormationSlot[],
): ReadonlyArray<readonly [string, string]> {
  // Group by line, in declared order within each line.
  const byLine = new Map<Position, FormationSlot[]>();
  for (const slot of slots) {
    const line = slotPositionLine(slot.slot_position);
    let arr = byLine.get(line);
    if (!arr) {
      arr = [];
      byLine.set(line, arr);
    }
    arr.push(slot);
  }
  // Sort each line by (channel L/C/R, declared order). The "declared order"
  // tiebreaker keeps e.g. LCM/RCM stable within the same channel='C' bucket.
  const declaredOrder = new Map<string, number>();
  for (let i = 0; i < slots.length; i++) declaredOrder.set(slots[i]!.slot_id, i);
  for (const [, arr] of byLine) {
    arr.sort((a, b) => {
      const dc = CHANNEL_ORDER[a.channel] - CHANNEL_ORDER[b.channel];
      if (dc !== 0) return dc;
      return (declaredOrder.get(a.slot_id) ?? 0) - (declaredOrder.get(b.slot_id) ?? 0);
    });
  }
  const edges = new Set<string>();
  const pushEdge = (a: string, b: string): void => {
    if (a === b) return;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    edges.add(`${lo} ${hi}`);
  };
  // (a) "Horizontally neighboring within the same line" — two sub-rules so
  // the spec's 4-3-3 worked example (which lists CDM-LCM, CDM-RCM AND
  // LCM-RCM as a triangle within the same channel) is satisfied while the
  // back-four worked example (LB-LCB, LCB-RCB, RCB-RB — but NOT LB-RB or
  // LB-RCB) is also satisfied:
  //   (a1) All-pairs WITHIN the same CHANNEL (the centre-line triangle).
  //   (a2) Sort-adjacent boundary pairs that span DIFFERENT channels
  //        (the L↔C / C↔R wing-to-centre links).
  for (const [, arr] of byLine) {
    // (a1) — same-channel pairwise.
    const byChannel = new Map<FormationChannel, FormationSlot[]>();
    for (const s of arr) {
      let g = byChannel.get(s.channel);
      if (!g) {
        g = [];
        byChannel.set(s.channel, g);
      }
      g.push(s);
    }
    for (const [, group] of byChannel) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          pushEdge(group[i]!.slot_id, group[j]!.slot_id);
        }
      }
    }
    // (a2) — sort-adjacent boundary across channels (skip same-channel
    // transitions: (a1) already covered them).
    for (let i = 1; i < arr.length; i++) {
      if (arr[i - 1]!.channel !== arr[i]!.channel) {
        pushEdge(arr[i - 1]!.slot_id, arr[i]!.slot_id);
      }
    }
  }
  // (b) Vertically neighboring across CONSECUTIVE lines, SAME or ADJACENT channel.
  const linesPresent = [...byLine.keys()].sort((a, b) => LINE_ORDER[a] - LINE_ORDER[b]);
  for (let li = 1; li < linesPresent.length; li++) {
    const above = linesPresent[li - 1]!;
    const below = linesPresent[li]!;
    // CONSECUTIVE-line gate: GK adjoins DF, DF adjoins MF, MF adjoins FW.
    // If a line is missing (e.g. a 3-MF-no-DF shape, which doesn't exist in
    // MVP), the next-present line is skipped here on purpose — the rule talks
    // about CONSECUTIVE lines, not "next present" line.
    if (LINE_ORDER[below] - LINE_ORDER[above] !== 1) continue;
    const aboveSlots = byLine.get(above)!;
    const belowSlots = byLine.get(below)!;
    for (const a of aboveSlots) {
      const allowed = new Set<FormationChannel>(CHANNEL_ADJACENT[a.channel]);
      for (const b of belowSlots) {
        if (allowed.has(b.channel)) pushEdge(a.slot_id, b.slot_id);
      }
    }
  }
  return [...edges]
    .map((k) => k.split(" ") as [string, string])
    .sort((p, q) => (p[0] === q[0] ? p[1].localeCompare(q[1]) : p[0].localeCompare(q[0])));
}

// ─── MVP FORMATION TEMPLATES ────────────────────────────────────────────────
//
// Six locked starter-11 layouts. Adjacency is materialised via
// `deriveFormationAdjacency` so the lists in the template literal are
// AUTHORITATIVE (re-derived once at module load) and the schema's drift guard
// has something to assert against.
//
// Naming convention: `slot_id` is `<formation_id>.<role>`, e.g. `4-3-3.LCB`,
// so two formations using the same role still have distinct ids and a
// FormationSlot.slot_id is globally unique within the registry.

function makeTemplate(
  formation_id: string,
  layout: ReadonlyArray<readonly [string, SlotPosition, FormationChannel]>,
): FormationTemplate {
  const slots: FormationSlot[] = layout.map(([role, slot_position, channel]) => ({
    slot_id: `${formation_id}.${role}`,
    slot_position,
    channel,
  }));
  if (slots.length !== 11) {
    throw new RangeError(
      `FormationTemplate ${formation_id}: expected 11 starter slots, got ${slots.length}`,
    );
  }
  return {
    formation_id,
    name: formation_id,
    slots,
    adjacency: deriveFormationAdjacency(slots),
  };
}

// 4-3-3 — flat back four, single pivot + two box-to-boxes, wide front three.
const FORMATION_4_3_3 = makeTemplate("4-3-3", [
  ["GK", "GK", "C"],
  ["LB", "LB", "L"],
  ["LCB", "LCB", "C"],
  ["RCB", "RCB", "C"],
  ["RB", "RB", "R"],
  ["CDM", "CDM", "C"],
  ["LCM", "LCM", "C"],
  ["RCM", "RCM", "C"],
  ["LW", "LW", "L"],
  ["ST", "ST", "C"],
  ["RW", "RW", "R"],
]);

// 4-4-2 — flat back four, flat midfield four (LM/LCM/RCM/RM), strike pair.
const FORMATION_4_4_2 = makeTemplate("4-4-2", [
  ["GK", "GK", "C"],
  ["LB", "LB", "L"],
  ["LCB", "LCB", "C"],
  ["RCB", "RCB", "C"],
  ["RB", "RB", "R"],
  ["LM", "LM", "L"],
  ["LCM", "LCM", "C"],
  ["RCM", "RCM", "C"],
  ["RM", "RM", "R"],
  ["LF", "LF", "C"],
  ["RF", "RF", "C"],
]);

// 4-2-3-1 — back four, double pivot, attacking-mid trident, lone striker.
const FORMATION_4_2_3_1 = makeTemplate("4-2-3-1", [
  ["GK", "GK", "C"],
  ["LB", "LB", "L"],
  ["LCB", "LCB", "C"],
  ["RCB", "RCB", "C"],
  ["RB", "RB", "R"],
  ["LDM", "DM", "C"],
  ["RDM", "DM", "C"],
  ["LAM", "AM", "L"],
  ["CAM", "CAM", "C"],
  ["RAM", "AM", "R"],
  ["ST", "ST", "C"],
]);

// 3-5-2 — back three, wing-backs as part of the midfield five, strike pair.
const FORMATION_3_5_2 = makeTemplate("3-5-2", [
  ["GK", "GK", "C"],
  ["LCB", "LCB", "C"],
  ["CB", "CB", "C"],
  ["RCB", "RCB", "C"],
  ["LWB", "LWB", "L"],
  ["LCM", "LCM", "C"],
  ["CM", "CM", "C"],
  ["RCM", "RCM", "C"],
  ["RWB", "RWB", "R"],
  ["LF", "LF", "C"],
  ["RF", "RF", "C"],
]);

// 3-4-3 — back three, midfield four with wing-backs, wide front three.
const FORMATION_3_4_3 = makeTemplate("3-4-3", [
  ["GK", "GK", "C"],
  ["LCB", "LCB", "C"],
  ["CB", "CB", "C"],
  ["RCB", "RCB", "C"],
  ["LWB", "LWB", "L"],
  ["LCM", "LCM", "C"],
  ["RCM", "RCM", "C"],
  ["RWB", "RWB", "R"],
  ["LW", "LW", "L"],
  ["ST", "ST", "C"],
  ["RW", "RW", "R"],
]);

// 5-3-2 — back five (wing-backs sitting deep), midfield three, strike pair.
const FORMATION_5_3_2 = makeTemplate("5-3-2", [
  ["GK", "GK", "C"],
  ["LWB", "LWB", "L"],
  ["LCB", "LCB", "C"],
  ["CB", "CB", "C"],
  ["RCB", "RCB", "C"],
  ["RWB", "RWB", "R"],
  ["LCM", "LCM", "C"],
  ["CM", "CM", "C"],
  ["RCM", "RCM", "C"],
  ["LF", "LF", "C"],
  ["RF", "RF", "C"],
]);

// 4-1-4-1 — flat back four, single holding pivot, flat midfield four, lone
// striker. The "1" pivot (CDM) and the "4" band (LM/LCM/RCM/RM) both project to
// the MF line, exactly as the 4-2-3-1 double pivot does.
const FORMATION_4_1_4_1 = makeTemplate("4-1-4-1", [
  ["GK", "GK", "C"],
  ["LB", "LB", "L"],
  ["LCB", "LCB", "C"],
  ["RCB", "RCB", "C"],
  ["RB", "RB", "R"],
  ["CDM", "CDM", "C"],
  ["LM", "LM", "L"],
  ["LCM", "LCM", "C"],
  ["RCM", "RCM", "C"],
  ["RM", "RM", "R"],
  ["ST", "ST", "C"],
]);

// 3-4-2-1 — back three, flat midfield four, two attacking mids behind a lone
// striker. The midfield four (LM/LCM/RCM/RM) and the two 10s (LAM/RAM, role AM)
// all project to the MF line; only the striker sits in FW.
const FORMATION_3_4_2_1 = makeTemplate("3-4-2-1", [
  ["GK", "GK", "C"],
  ["LCB", "LCB", "C"],
  ["CB", "CB", "C"],
  ["RCB", "RCB", "C"],
  ["LM", "LM", "L"],
  ["LCM", "LCM", "C"],
  ["RCM", "RCM", "C"],
  ["RM", "RM", "R"],
  ["LAM", "AM", "L"],
  ["RAM", "AM", "R"],
  ["ST", "ST", "C"],
]);

/**
 * Registry of all locked FormationTemplates, keyed by `formation_id`.
 * Frozen so a downstream consumer cannot mutate it; the schema for
 * `DraftState.formation_id` references this registry to reject unknown ids.
 */
export const FORMATION_TEMPLATES: Readonly<Record<string, FormationTemplate>> = Object.freeze({
  "4-3-3": FORMATION_4_3_3,
  "4-4-2": FORMATION_4_4_2,
  "4-2-3-1": FORMATION_4_2_3_1,
  "4-1-4-1": FORMATION_4_1_4_1,
  "3-5-2": FORMATION_3_5_2,
  "3-4-3": FORMATION_3_4_3,
  "3-4-2-1": FORMATION_3_4_2_1,
  "5-3-2": FORMATION_5_3_2,
});

/** Convenience: ordered list of formation ids — sorted lexicographically. */
export const FORMATION_IDS: readonly string[] = Object.freeze(
  Object.keys(FORMATION_TEMPLATES).sort(),
);
