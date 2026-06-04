import { describe, it, expect } from "vitest";

import {
  FORMATION_IDS,
  FORMATION_TEMPLATES,
  deriveFormationAdjacency,
  slotPositionLine,
} from "./types/formation.js";

// GOLDEN INVARIANT (WS-0c depth-layer contract):
//   Each FormationTemplate.adjacency is materialised AT MODULE LOAD from the
//   adjacency rule (`deriveFormationAdjacency`). The drift guard is a
//   HAND-WRITTEN expected edge set per MVP formation (`EXPECTED_ADJACENCY`
//   below): the shipped adjacency MUST deep-equal it. This is a real drift
//   lock — a change to a template's slots/channels OR to the adjacency rule
//   that moves any edge breaks the literal comparison.
//
//   (An earlier version re-derived adjacency with `deriveFormationAdjacency`
//   and compared it to the template's OWN derived edges — that only proved the
//   derivation is deterministic, NOT that the materialised edges are correct.
//   The literal fixtures replace that self-referential check.)
//
// HOW THE FIXTURES WERE BUILT: each edge set was enumerated by hand from the
// rule (same-line horizontal neighbours + consecutive-line vertical neighbours
// in the same/adjacent channel), canonicalised so `a < b`, and sorted
// lexicographically — the same canonical form the schema's drift guard and the
// `slots` layout produce. The structural assertions below (endpoints resolve,
// canonicalised/sorted/de-duplicated, every edge satisfies the rule) guard the
// shape; the literal `EXPECTED_ADJACENCY` pins the exact edges.

// Hand-written expected adjacency edge set for each of the six MVP formations.
// Canonical form: each edge `[a, b]` has `a < b`; the array is sorted
// lexicographically by (a, then b). This is the source-of-truth fixture the
// shipped/derived adjacency is asserted against.
const EXPECTED_ADJACENCY: Readonly<Record<string, ReadonlyArray<readonly [string, string]>>> = {
  "4-3-3": [
    ["4-3-3.CDM", "4-3-3.LB"],
    ["4-3-3.CDM", "4-3-3.LCB"],
    ["4-3-3.CDM", "4-3-3.LCM"],
    ["4-3-3.CDM", "4-3-3.LW"],
    ["4-3-3.CDM", "4-3-3.RB"],
    ["4-3-3.CDM", "4-3-3.RCB"],
    ["4-3-3.CDM", "4-3-3.RCM"],
    ["4-3-3.CDM", "4-3-3.RW"],
    ["4-3-3.CDM", "4-3-3.ST"],
    ["4-3-3.GK", "4-3-3.LB"],
    ["4-3-3.GK", "4-3-3.LCB"],
    ["4-3-3.GK", "4-3-3.RB"],
    ["4-3-3.GK", "4-3-3.RCB"],
    ["4-3-3.LB", "4-3-3.LCB"],
    ["4-3-3.LB", "4-3-3.LCM"],
    ["4-3-3.LB", "4-3-3.RCM"],
    ["4-3-3.LCB", "4-3-3.LCM"],
    ["4-3-3.LCB", "4-3-3.RCB"],
    ["4-3-3.LCB", "4-3-3.RCM"],
    ["4-3-3.LCM", "4-3-3.LW"],
    ["4-3-3.LCM", "4-3-3.RB"],
    ["4-3-3.LCM", "4-3-3.RCB"],
    ["4-3-3.LCM", "4-3-3.RCM"],
    ["4-3-3.LCM", "4-3-3.RW"],
    ["4-3-3.LCM", "4-3-3.ST"],
    ["4-3-3.LW", "4-3-3.RCM"],
    ["4-3-3.LW", "4-3-3.ST"],
    ["4-3-3.RB", "4-3-3.RCB"],
    ["4-3-3.RB", "4-3-3.RCM"],
    ["4-3-3.RCB", "4-3-3.RCM"],
    ["4-3-3.RCM", "4-3-3.RW"],
    ["4-3-3.RCM", "4-3-3.ST"],
    ["4-3-3.RW", "4-3-3.ST"],
  ],
  "4-4-2": [
    ["4-4-2.GK", "4-4-2.LB"],
    ["4-4-2.GK", "4-4-2.LCB"],
    ["4-4-2.GK", "4-4-2.RB"],
    ["4-4-2.GK", "4-4-2.RCB"],
    ["4-4-2.LB", "4-4-2.LCB"],
    ["4-4-2.LB", "4-4-2.LCM"],
    ["4-4-2.LB", "4-4-2.LM"],
    ["4-4-2.LB", "4-4-2.RCM"],
    ["4-4-2.LCB", "4-4-2.LCM"],
    ["4-4-2.LCB", "4-4-2.LM"],
    ["4-4-2.LCB", "4-4-2.RCB"],
    ["4-4-2.LCB", "4-4-2.RCM"],
    ["4-4-2.LCB", "4-4-2.RM"],
    ["4-4-2.LCM", "4-4-2.LF"],
    ["4-4-2.LCM", "4-4-2.LM"],
    ["4-4-2.LCM", "4-4-2.RB"],
    ["4-4-2.LCM", "4-4-2.RCB"],
    ["4-4-2.LCM", "4-4-2.RCM"],
    ["4-4-2.LCM", "4-4-2.RF"],
    ["4-4-2.LF", "4-4-2.LM"],
    ["4-4-2.LF", "4-4-2.RCM"],
    ["4-4-2.LF", "4-4-2.RF"],
    ["4-4-2.LF", "4-4-2.RM"],
    ["4-4-2.LM", "4-4-2.RCB"],
    ["4-4-2.LM", "4-4-2.RF"],
    ["4-4-2.RB", "4-4-2.RCB"],
    ["4-4-2.RB", "4-4-2.RCM"],
    ["4-4-2.RB", "4-4-2.RM"],
    ["4-4-2.RCB", "4-4-2.RCM"],
    ["4-4-2.RCB", "4-4-2.RM"],
    ["4-4-2.RCM", "4-4-2.RF"],
    ["4-4-2.RCM", "4-4-2.RM"],
    ["4-4-2.RF", "4-4-2.RM"],
  ],
  "4-2-3-1": [
    ["4-2-3-1.CAM", "4-2-3-1.LB"],
    ["4-2-3-1.CAM", "4-2-3-1.LCB"],
    ["4-2-3-1.CAM", "4-2-3-1.LDM"],
    ["4-2-3-1.CAM", "4-2-3-1.RAM"],
    ["4-2-3-1.CAM", "4-2-3-1.RB"],
    ["4-2-3-1.CAM", "4-2-3-1.RCB"],
    ["4-2-3-1.CAM", "4-2-3-1.RDM"],
    ["4-2-3-1.CAM", "4-2-3-1.ST"],
    ["4-2-3-1.GK", "4-2-3-1.LB"],
    ["4-2-3-1.GK", "4-2-3-1.LCB"],
    ["4-2-3-1.GK", "4-2-3-1.RB"],
    ["4-2-3-1.GK", "4-2-3-1.RCB"],
    ["4-2-3-1.LAM", "4-2-3-1.LB"],
    ["4-2-3-1.LAM", "4-2-3-1.LCB"],
    ["4-2-3-1.LAM", "4-2-3-1.LDM"],
    ["4-2-3-1.LAM", "4-2-3-1.RCB"],
    ["4-2-3-1.LAM", "4-2-3-1.ST"],
    ["4-2-3-1.LB", "4-2-3-1.LCB"],
    ["4-2-3-1.LB", "4-2-3-1.LDM"],
    ["4-2-3-1.LB", "4-2-3-1.RDM"],
    ["4-2-3-1.LCB", "4-2-3-1.LDM"],
    ["4-2-3-1.LCB", "4-2-3-1.RAM"],
    ["4-2-3-1.LCB", "4-2-3-1.RCB"],
    ["4-2-3-1.LCB", "4-2-3-1.RDM"],
    ["4-2-3-1.LDM", "4-2-3-1.RB"],
    ["4-2-3-1.LDM", "4-2-3-1.RCB"],
    ["4-2-3-1.LDM", "4-2-3-1.RDM"],
    ["4-2-3-1.LDM", "4-2-3-1.ST"],
    ["4-2-3-1.RAM", "4-2-3-1.RB"],
    ["4-2-3-1.RAM", "4-2-3-1.RCB"],
    ["4-2-3-1.RAM", "4-2-3-1.ST"],
    ["4-2-3-1.RB", "4-2-3-1.RCB"],
    ["4-2-3-1.RB", "4-2-3-1.RDM"],
    ["4-2-3-1.RCB", "4-2-3-1.RDM"],
    ["4-2-3-1.RDM", "4-2-3-1.ST"],
  ],
  "3-5-2": [
    ["3-5-2.CB", "3-5-2.CM"],
    ["3-5-2.CB", "3-5-2.GK"],
    ["3-5-2.CB", "3-5-2.LCB"],
    ["3-5-2.CB", "3-5-2.LCM"],
    ["3-5-2.CB", "3-5-2.RCB"],
    ["3-5-2.CB", "3-5-2.RCM"],
    ["3-5-2.CM", "3-5-2.LCB"],
    ["3-5-2.CM", "3-5-2.LCM"],
    ["3-5-2.CM", "3-5-2.LF"],
    ["3-5-2.CM", "3-5-2.LWB"],
    ["3-5-2.CM", "3-5-2.RCB"],
    ["3-5-2.CM", "3-5-2.RCM"],
    ["3-5-2.CM", "3-5-2.RF"],
    ["3-5-2.CM", "3-5-2.RWB"],
    ["3-5-2.GK", "3-5-2.LCB"],
    ["3-5-2.GK", "3-5-2.LWB"],
    ["3-5-2.GK", "3-5-2.RCB"],
    ["3-5-2.GK", "3-5-2.RWB"],
    ["3-5-2.LCB", "3-5-2.LCM"],
    ["3-5-2.LCB", "3-5-2.LWB"],
    ["3-5-2.LCB", "3-5-2.RCB"],
    ["3-5-2.LCB", "3-5-2.RCM"],
    ["3-5-2.LCM", "3-5-2.LF"],
    ["3-5-2.LCM", "3-5-2.LWB"],
    ["3-5-2.LCM", "3-5-2.RCB"],
    ["3-5-2.LCM", "3-5-2.RCM"],
    ["3-5-2.LCM", "3-5-2.RF"],
    ["3-5-2.LCM", "3-5-2.RWB"],
    ["3-5-2.LF", "3-5-2.RCM"],
    ["3-5-2.LF", "3-5-2.RF"],
    ["3-5-2.LWB", "3-5-2.RCM"],
    ["3-5-2.RCB", "3-5-2.RCM"],
    ["3-5-2.RCB", "3-5-2.RWB"],
    ["3-5-2.RCM", "3-5-2.RF"],
    ["3-5-2.RCM", "3-5-2.RWB"],
  ],
  "3-4-3": [
    ["3-4-3.CB", "3-4-3.GK"],
    ["3-4-3.CB", "3-4-3.LCB"],
    ["3-4-3.CB", "3-4-3.LCM"],
    ["3-4-3.CB", "3-4-3.RCB"],
    ["3-4-3.CB", "3-4-3.RCM"],
    ["3-4-3.GK", "3-4-3.LCB"],
    ["3-4-3.GK", "3-4-3.LWB"],
    ["3-4-3.GK", "3-4-3.RCB"],
    ["3-4-3.GK", "3-4-3.RWB"],
    ["3-4-3.LCB", "3-4-3.LCM"],
    ["3-4-3.LCB", "3-4-3.LWB"],
    ["3-4-3.LCB", "3-4-3.RCB"],
    ["3-4-3.LCB", "3-4-3.RCM"],
    ["3-4-3.LCM", "3-4-3.LW"],
    ["3-4-3.LCM", "3-4-3.LWB"],
    ["3-4-3.LCM", "3-4-3.RCB"],
    ["3-4-3.LCM", "3-4-3.RCM"],
    ["3-4-3.LCM", "3-4-3.RW"],
    ["3-4-3.LCM", "3-4-3.RWB"],
    ["3-4-3.LCM", "3-4-3.ST"],
    ["3-4-3.LW", "3-4-3.RCM"],
    ["3-4-3.LW", "3-4-3.ST"],
    ["3-4-3.LWB", "3-4-3.RCM"],
    ["3-4-3.RCB", "3-4-3.RCM"],
    ["3-4-3.RCB", "3-4-3.RWB"],
    ["3-4-3.RCM", "3-4-3.RW"],
    ["3-4-3.RCM", "3-4-3.RWB"],
    ["3-4-3.RCM", "3-4-3.ST"],
    ["3-4-3.RW", "3-4-3.ST"],
  ],
  "5-3-2": [
    ["5-3-2.CB", "5-3-2.CM"],
    ["5-3-2.CB", "5-3-2.GK"],
    ["5-3-2.CB", "5-3-2.LCB"],
    ["5-3-2.CB", "5-3-2.LCM"],
    ["5-3-2.CB", "5-3-2.RCB"],
    ["5-3-2.CB", "5-3-2.RCM"],
    ["5-3-2.CM", "5-3-2.LCB"],
    ["5-3-2.CM", "5-3-2.LCM"],
    ["5-3-2.CM", "5-3-2.LF"],
    ["5-3-2.CM", "5-3-2.LWB"],
    ["5-3-2.CM", "5-3-2.RCB"],
    ["5-3-2.CM", "5-3-2.RCM"],
    ["5-3-2.CM", "5-3-2.RF"],
    ["5-3-2.CM", "5-3-2.RWB"],
    ["5-3-2.GK", "5-3-2.LCB"],
    ["5-3-2.GK", "5-3-2.LWB"],
    ["5-3-2.GK", "5-3-2.RCB"],
    ["5-3-2.GK", "5-3-2.RWB"],
    ["5-3-2.LCB", "5-3-2.LCM"],
    ["5-3-2.LCB", "5-3-2.LWB"],
    ["5-3-2.LCB", "5-3-2.RCB"],
    ["5-3-2.LCB", "5-3-2.RCM"],
    ["5-3-2.LCM", "5-3-2.LF"],
    ["5-3-2.LCM", "5-3-2.LWB"],
    ["5-3-2.LCM", "5-3-2.RCB"],
    ["5-3-2.LCM", "5-3-2.RCM"],
    ["5-3-2.LCM", "5-3-2.RF"],
    ["5-3-2.LCM", "5-3-2.RWB"],
    ["5-3-2.LF", "5-3-2.RCM"],
    ["5-3-2.LF", "5-3-2.RF"],
    ["5-3-2.LWB", "5-3-2.RCM"],
    ["5-3-2.RCB", "5-3-2.RCM"],
    ["5-3-2.RCB", "5-3-2.RWB"],
    ["5-3-2.RCM", "5-3-2.RF"],
    ["5-3-2.RCM", "5-3-2.RWB"],
  ],
};

describe("formation-adjacency — shipped templates match hand-written expected edge sets", () => {
  it("EXPECTED_ADJACENCY covers exactly the six MVP formation ids", () => {
    expect(Object.keys(EXPECTED_ADJACENCY).sort()).toEqual([...FORMATION_IDS].sort());
  });

  for (const fid of FORMATION_IDS) {
    const tpl = FORMATION_TEMPLATES[fid]!;
    const expected = EXPECTED_ADJACENCY[fid]!;

    it(`${fid}: shipped adjacency deep-equals the hand-written expected edge set`, () => {
      // Real drift lock: the materialised (rule-derived) adjacency must equal
      // the literal fixture. Changing a template's slots/channels OR the rule
      // such that any edge moves breaks this.
      expect(tpl.adjacency).toEqual(expected);
    });

    it(`${fid}: re-deriving from slots also equals the expected edge set`, () => {
      // Closes the loop rule → derive → fixture, independent of the cached
      // `tpl.adjacency` value.
      expect(deriveFormationAdjacency(tpl.slots)).toEqual(expected);
    });

    it(`${fid}: every adjacency endpoint is a real slot_id`, () => {
      const ids = new Set(tpl.slots.map((s) => s.slot_id));
      for (const [a, b] of tpl.adjacency) {
        expect(ids.has(a)).toBe(true);
        expect(ids.has(b)).toBe(true);
      }
    });

    it(`${fid}: edge list is canonicalised (a<b), de-duplicated, sorted ascending`, () => {
      const seen = new Set<string>();
      for (let i = 0; i < tpl.adjacency.length; i++) {
        const [a, b] = tpl.adjacency[i]!;
        expect(a).not.toBe(b); // no self-edges
        expect(a < b).toBe(true); // canonicalised
        const key = `${a} ${b}`;
        expect(seen.has(key)).toBe(false); // de-duplicated
        seen.add(key);
        if (i > 0) {
          const [pa, pb] = tpl.adjacency[i - 1]!;
          expect(`${pa} ${pb}` < key).toBe(true); // sorted ascending
        }
      }
    });

    it(`${fid}: 11 starter slots`, () => {
      expect(tpl.slots.length).toBe(11);
    });
  }

  it("4-3-3 worked example: spec-listed links all appear in the shipped adjacency", () => {
    // Worked example from the WS-0c task spec for 4-3-3:
    //   GK · LB LCB RCB RB · CDM LCM RCM · LW ST RW
    // Expected links from the rule:
    //   LCB–RCB, LB–LCB, RB–RCB, LCB–CDM, RCB–CDM, CDM–LCM, CDM–RCM,
    //   LCM–RCM, LCM–LW, RCM–RW, CDM–ST, LW–ST, RW–ST.
    const tpl = FORMATION_TEMPLATES["4-3-3"]!;
    const expected: ReadonlyArray<readonly [string, string]> = [
      ["4-3-3.LCB", "4-3-3.RCB"],
      ["4-3-3.LB", "4-3-3.LCB"],
      ["4-3-3.RB", "4-3-3.RCB"],
      ["4-3-3.CDM", "4-3-3.LCB"],
      ["4-3-3.CDM", "4-3-3.RCB"],
      ["4-3-3.CDM", "4-3-3.LCM"],
      ["4-3-3.CDM", "4-3-3.RCM"],
      ["4-3-3.LCM", "4-3-3.RCM"],
      ["4-3-3.LCM", "4-3-3.LW"],
      ["4-3-3.RCM", "4-3-3.RW"],
      ["4-3-3.CDM", "4-3-3.ST"],
      ["4-3-3.LW", "4-3-3.ST"],
      ["4-3-3.RW", "4-3-3.ST"],
    ];
    const shipped = new Set(tpl.adjacency.map(([a, b]) => `${a} ${b}`));
    for (const [a, b] of expected) {
      const key = a < b ? `${a} ${b}` : `${b} ${a}`;
      expect(shipped.has(key)).toBe(true);
    }
  });

  it("every adjacency edge satisfies the rule: same line OR consecutive-lines + same/adjacent channel", () => {
    const CHANNEL_ADJACENT: Record<"L" | "C" | "R", ReadonlySet<"L" | "C" | "R">> = {
      L: new Set(["L", "C"] as const),
      C: new Set(["L", "C", "R"] as const),
      R: new Set(["R", "C"] as const),
    };
    const LINE_ORDER: Record<string, number> = { GK: 0, DF: 1, MF: 2, FW: 3 };
    for (const fid of FORMATION_IDS) {
      const tpl = FORMATION_TEMPLATES[fid]!;
      const slotById = new Map(tpl.slots.map((s) => [s.slot_id, s]));
      for (const [a, b] of tpl.adjacency) {
        const sa = slotById.get(a)!;
        const sb = slotById.get(b)!;
        const la = slotPositionLine(sa.slot_position);
        const lb = slotPositionLine(sb.slot_position);
        const sameLine = la === lb;
        const consecutive = Math.abs(LINE_ORDER[la]! - LINE_ORDER[lb]!) === 1;
        const channelOk = CHANNEL_ADJACENT[sa.channel].has(sb.channel);
        const ruleOk = sameLine || (consecutive && channelOk);
        expect(ruleOk).toBe(true);
      }
    }
  });
});
