import { describe, expect, it } from "vitest";

import {
  SUPPORTED_FORMATION_IDS,
  getFormationVisualSlots,
  type FormationVisualSlot,
} from "../formation-layout";
import { adjustPitchLayoutForRender, chipsCollide } from "../pitch-layout";

function pairs<T>(items: readonly T[]): Array<[T, T]> {
  const out: Array<[T, T]> = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      out.push([items[i]!, items[j]!]);
    }
  }
  return out;
}

describe("adjustPitchLayoutForRender", () => {
  it.each(SUPPORTED_FORMATION_IDS.map((fid) => [fid] as const))(
    "no two chips overlap after adjustment for %s",
    (fid) => {
      const canonical = getFormationVisualSlots(fid);
      const adjusted = adjustPitchLayoutForRender(canonical);

      // Every chip in every formation MUST be non-overlapping with every
      // other chip in the same formation at mobile chip dimensions.
      for (const [a, b] of pairs(adjusted)) {
        expect(
          chipsCollide(a, b),
          `${fid}: ${a.slot_id} overlaps ${b.slot_id} at (${a.x_pct}, ${a.y_pct}) / (${b.x_pct}, ${b.y_pct})`,
        ).toBe(false);
      }
    },
  );

  it("does not mutate the input array or its elements", () => {
    const canonical = getFormationVisualSlots("5-3-2");
    const snapshot = canonical.map((s) => ({ ...s }));
    const adjusted = adjustPitchLayoutForRender(canonical);

    // Inputs unchanged (clone-only semantics).
    expect(canonical).toEqual(snapshot);
    // Output is a different array of different objects.
    expect(adjusted).not.toBe(canonical);
    for (let i = 0; i < canonical.length; i++) {
      expect(adjusted[i]).not.toBe(canonical[i]);
    }
  });

  it("is deterministic — same input produces the same output", () => {
    for (const fid of SUPPORTED_FORMATION_IDS) {
      const a = adjustPitchLayoutForRender(getFormationVisualSlots(fid));
      const b = adjustPitchLayoutForRender(getFormationVisualSlots(fid));
      expect(a).toEqual(b);
    }
  });

  it("preserves identity fields (slot_id, position_line, visual_line, display_label)", () => {
    for (const fid of SUPPORTED_FORMATION_IDS) {
      const canonical = getFormationVisualSlots(fid);
      const adjusted = adjustPitchLayoutForRender(canonical);
      const byId = new Map<string, FormationVisualSlot>(adjusted.map((s) => [s.slot_id, s]));
      for (const c of canonical) {
        const a = byId.get(c.slot_id);
        expect(a, `${fid}: slot ${c.slot_id} missing after adjust`).toBeDefined();
        expect(a!.position_line).toBe(c.position_line);
        expect(a!.visual_line).toBe(c.visual_line);
        expect(a!.display_label).toBe(c.display_label);
      }
    }
  });

  it("keeps adjusted coords inside the pitch frame", () => {
    for (const fid of SUPPORTED_FORMATION_IDS) {
      const adjusted = adjustPitchLayoutForRender(getFormationVisualSlots(fid));
      for (const sl of adjusted) {
        // Chips must sit inside the inset frame (.pitchFrame inset:4%)
        // with at least their half-extents of breathing room.
        expect(sl.x_pct).toBeGreaterThanOrEqual(4);
        expect(sl.x_pct).toBeLessThanOrEqual(96);
        expect(sl.y_pct).toBeGreaterThanOrEqual(4);
        expect(sl.y_pct).toBeLessThanOrEqual(96);
      }
    }
  });

  it("preserves left/right mirror symmetry for canonical mirror pairs", () => {
    // 5-3-2 LCM/RCM share a canonical y (52) and mirror across x=50
    // (36/64). After adjustment they must remain mirrored and share a y.
    const adjusted = adjustPitchLayoutForRender(getFormationVisualSlots("5-3-2"));
    const lcm = adjusted.find((s) => s.display_label === "LCM");
    const rcm = adjusted.find((s) => s.display_label === "RCM");
    expect(lcm).toBeDefined();
    expect(rcm).toBeDefined();
    expect(lcm!.y_pct).toBeCloseTo(rcm!.y_pct, 6);
    expect(lcm!.x_pct + rcm!.x_pct).toBeCloseTo(100, 6);
  });

  it("leaves a slot unchanged when no neighbour competes for its space", () => {
    // 4-3-3 GK has no other chip within ~12% — it should not move.
    const canonical = getFormationVisualSlots("4-3-3");
    const adjusted = adjustPitchLayoutForRender(canonical);
    const gkBefore = canonical.find((s) => s.position_line === "GK")!;
    const gkAfter = adjusted.find((s) => s.position_line === "GK")!;
    expect(gkAfter.x_pct).toBeCloseTo(gkBefore.x_pct, 6);
    // Y might be slightly clamped if the 91 canonical sits at the frame
    // boundary; allow up to one full chip half-height of nudge.
    expect(Math.abs(gkAfter.y_pct - gkBefore.y_pct)).toBeLessThanOrEqual(6.5);
  });

  it("handles the empty input gracefully", () => {
    expect(adjustPitchLayoutForRender([])).toEqual([]);
  });
});
