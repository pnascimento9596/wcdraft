import { describe, it, expect } from "vitest";

import {
  FORMATION_IDS,
  FORMATION_TEMPLATES,
  deriveFormationAdjacency,
  slotPositionLine,
} from "./types/formation.js";

// GOLDEN INVARIANT (WS-0c depth-layer contract):
//   Each FormationTemplate.adjacency is materialised AT MODULE LOAD from the
//   adjacency rule (`deriveFormationAdjacency`). The drift guard: re-deriving
//   adjacency from the same `slots` MUST yield a deep-equal edge list. The
//   schema enforces this for any external FormationTemplate that crosses a
//   trust boundary; this test asserts it for the SHIPPED MVP templates so the
//   registry is locked.
//
// Two halves to this scaffold:
//   (a) ACTIVE — re-derived adjacency equals shipped adjacency for each MVP
//       template. Edge list is well-formed (canonicalised, sorted, no
//       duplicates / self-edges, endpoints resolve). Plus a hand-curated
//       worked example for 4-3-3 from the task spec.
//   (b) SKIPPED — the FULL "every MVP formation's expected edge set per the
//       rule" worked-example table for the other five formations. Filling
//       that table is a small but non-trivial exercise; the rule + the
//       deep-equal re-derivation already lock the data, so the worked
//       examples are an extra reviewability aid rather than a coverage gap.

describe("formation-adjacency — all MVP templates re-derive equal to their shipped adjacency (active)", () => {
  for (const fid of FORMATION_IDS) {
    const tpl = FORMATION_TEMPLATES[fid]!;
    it(`${fid}: re-derived edge list deep-equals the shipped adjacency`, () => {
      const reDerived = deriveFormationAdjacency(tpl.slots);
      expect(reDerived).toEqual(tpl.adjacency);
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

describe.skip("formation-adjacency — worked-example tables for the other five MVP formations (WS-B+ reviewability aid)", () => {
  it.skip("4-4-2 expected edge set", () => {
    // FIXTURE TODO: enumerate the expected edges from the rule and assert.
  });
  it.skip("4-2-3-1 expected edge set", () => {
    // FIXTURE TODO.
  });
  it.skip("3-5-2 expected edge set", () => {
    // FIXTURE TODO.
  });
  it.skip("3-4-3 expected edge set", () => {
    // FIXTURE TODO.
  });
  it.skip("5-3-2 expected edge set", () => {
    // FIXTURE TODO.
  });
});
