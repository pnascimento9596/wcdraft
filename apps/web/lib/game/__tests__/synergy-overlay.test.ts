// Locks the UX-COMPACT synergy-overlay contract:
//   - empty squad (no filled slots) → ZERO segments
//   - filled but no shared nation → ZERO segments
//   - only `linked: true` pairs whose BOTH endpoints are in the filled
//     set become segments
//   - segments carry the visual coords from the formation layout

import { describe, expect, it } from "vitest";

import { buildSynergySegments } from "../synergy-overlay";
import type { FormationVisualSlot } from "../formation-layout";
import type { LinkedPair } from "@wcdraft/core";

const slot = (id: string, x: number, y: number): FormationVisualSlot => ({
  slot_id: id,
  display_label: id,
  visual_line: "mid",
  position_line: "MF",
  x_pct: x,
  y_pct: y,
});

const visualBySlot = new Map<string, FormationVisualSlot>([
  ["a", slot("a", 10, 10)],
  ["b", slot("b", 90, 10)],
  ["c", slot("c", 50, 90)],
]);

describe("buildSynergySegments", () => {
  it("returns no segments when there are no filled slots (empty squad)", () => {
    const pairs: LinkedPair[] = [
      // Even a stray `linked: true` from upstream contract drift must NOT
      // render when nobody is on the pitch.
      { slot_id_a: "a", slot_id_b: "b", linked: true, nation_id: "BRA" },
      { slot_id_a: "a", slot_id_b: "c", linked: false, nation_id: null },
      { slot_id_a: "b", slot_id_b: "c", linked: false, nation_id: null },
    ];
    expect(buildSynergySegments(pairs, visualBySlot, new Set())).toEqual([]);
  });

  it("returns no segments when filled slots share no nation", () => {
    // Two filled slots but different nations → `linked: false` everywhere
    // → no segments.
    const pairs: LinkedPair[] = [
      { slot_id_a: "a", slot_id_b: "b", linked: false, nation_id: null },
      { slot_id_a: "a", slot_id_b: "c", linked: false, nation_id: null },
      { slot_id_a: "b", slot_id_b: "c", linked: false, nation_id: null },
    ];
    expect(
      buildSynergySegments(pairs, visualBySlot, new Set(["a", "b"])),
    ).toEqual([]);
  });

  it("emits one segment per linked pair with both endpoints filled", () => {
    const pairs: LinkedPair[] = [
      // linked + both filled → keep
      { slot_id_a: "a", slot_id_b: "b", linked: true, nation_id: "BRA" },
      // linked but partner not filled → drop (defensive)
      { slot_id_a: "a", slot_id_b: "c", linked: true, nation_id: "BRA" },
      // not linked → drop
      { slot_id_a: "b", slot_id_b: "c", linked: false, nation_id: null },
    ];
    const segs = buildSynergySegments(pairs, visualBySlot, new Set(["a", "b"]));
    expect(segs).toEqual([
      { key: "a|b", x1: 10, y1: 10, x2: 90, y2: 10, nation_id: "BRA" },
    ]);
  });

  it("drops pairs whose visual slot is missing (formation drift defence)", () => {
    const pairs: LinkedPair[] = [
      { slot_id_a: "a", slot_id_b: "ghost", linked: true, nation_id: "BRA" },
      { slot_id_a: "a", slot_id_b: "b", linked: true, nation_id: "BRA" },
    ];
    const segs = buildSynergySegments(
      pairs,
      visualBySlot,
      new Set(["a", "b", "ghost"]),
    );
    expect(segs.map((s) => s.key)).toEqual(["a|b"]);
  });

  it("returns no segments when given a null/empty pairs list", () => {
    expect(buildSynergySegments(null, visualBySlot, new Set())).toEqual([]);
    expect(buildSynergySegments(undefined, visualBySlot, new Set())).toEqual([]);
    expect(buildSynergySegments([], visualBySlot, new Set())).toEqual([]);
  });
});
