// Tests for the formation-layout adapter (ws-squad/formations-polish).
//
// These guard:
//   1. SUPPORTED_FORMATION_IDS is the same set core ships templates for.
//   2. JSON row order matches core slot order BY INDEX (the contract that
//      `getFormationVisualSlots` relies on for identity).
//   3. Coordinates are finite + in [0, 100].
//   4. `position_line` is derived from CORE (so a 3-5-2 wing-back is a DF
//      shape on the mini-pitch even though the JSON places it in the mid band).
//   5. Unsupported formation ids — the RED tripwire ids — throw, not return
//      a coarse fallback.
//
// The unsupported list intentionally NAMES the five Red-class ids the
// ws-squad/formations-polish dispatch was asked to ship. If a future Red PR
// adds them to core + the JSON, REMOVE them from this list — don't widen
// the test silently.

import { describe, expect, it } from "vitest";
import { FORMATION_TEMPLATES, slotPositionLine } from "@wcdraft/core";
import {
  getFormationVisualSlots,
  isSupportedFormationId,
  SUPPORTED_FORMATION_IDS,
  SUPPORTED_FORMATION_OPTIONS,
} from "@/lib/game/formation-layout";

const UNSUPPORTED_FORMATION_IDS = [
  "4-1-2-1-2",
  "4-4-1-1",
  "4-5-1",
  "3-4-2-1",
  "5-4-1",
] as const;

describe("formation-layout — SUPPORTED_FORMATION_IDS", () => {
  it("exposes exactly the six core-supported ids in the documented order", () => {
    expect([...SUPPORTED_FORMATION_IDS]).toEqual([
      "4-3-3",
      "4-2-3-1",
      "4-4-2",
      "3-5-2",
      "3-4-3",
      "5-3-2",
    ]);
  });

  it("pairs each supported id with a non-empty description", () => {
    expect(SUPPORTED_FORMATION_OPTIONS).toHaveLength(SUPPORTED_FORMATION_IDS.length);
    for (const opt of SUPPORTED_FORMATION_OPTIONS) {
      expect(SUPPORTED_FORMATION_IDS).toContain(opt.formation_id);
      expect(opt.blurb.length).toBeGreaterThan(0);
    }
  });

  it("supported set equals the core FORMATION_TEMPLATES key set", () => {
    const coreIds = Object.keys(FORMATION_TEMPLATES).sort();
    const supported = [...SUPPORTED_FORMATION_IDS].sort();
    expect(supported).toEqual(coreIds);
  });

  it("guards the RED tripwire — unsupported ids do not pass the type guard", () => {
    for (const id of UNSUPPORTED_FORMATION_IDS) {
      expect(isSupportedFormationId(id)).toBe(false);
    }
  });
});

describe("formation-layout — getFormationVisualSlots", () => {
  it.each([...SUPPORTED_FORMATION_IDS])(
    "%s has 11 rows aligned 1:1 with the core template by slot_id",
    (fid) => {
      const template = FORMATION_TEMPLATES[fid]!;
      const visual = getFormationVisualSlots(fid);

      expect(visual).toHaveLength(11);
      expect(visual).toHaveLength(template.slots.length);

      visual.forEach((v, i) => {
        expect(v.slot_id).toBe(template.slots[i]!.slot_id);
      });
    },
  );

  it.each([...SUPPORTED_FORMATION_IDS])(
    "%s coordinates are finite numbers in [0, 100]",
    (fid) => {
      for (const v of getFormationVisualSlots(fid)) {
        expect(Number.isFinite(v.x_pct)).toBe(true);
        expect(Number.isFinite(v.y_pct)).toBe(true);
        expect(v.x_pct).toBeGreaterThanOrEqual(0);
        expect(v.x_pct).toBeLessThanOrEqual(100);
        expect(v.y_pct).toBeGreaterThanOrEqual(0);
        expect(v.y_pct).toBeLessThanOrEqual(100);
      }
    },
  );

  it.each([...SUPPORTED_FORMATION_IDS])(
    "%s position_line is derived from CORE slot_position (not the JSON visual band)",
    (fid) => {
      const template = FORMATION_TEMPLATES[fid]!;
      const visual = getFormationVisualSlots(fid);
      visual.forEach((v, i) => {
        const expectedLine = slotPositionLine(template.slots[i]!.slot_position);
        expect(v.position_line).toBe(expectedLine);
      });
    },
  );

  it("3-5-2 wing-backs are DF shape even though the JSON places them in the midfield band", () => {
    const visual = getFormationVisualSlots("3-5-2");
    const lwb = visual.find((v) => v.slot_id === "3-5-2.LWB")!;
    const rwb = visual.find((v) => v.slot_id === "3-5-2.RWB")!;
    expect(lwb.position_line).toBe("DF");
    expect(rwb.position_line).toBe("DF");
    expect(lwb.visual_line).toBe("mid");
    expect(rwb.visual_line).toBe("mid");
  });

  it("3-4-3 wing-backs are DF shape (JSON visual band 'mid')", () => {
    const visual = getFormationVisualSlots("3-4-3");
    const lwb = visual.find((v) => v.slot_id === "3-4-3.LWB")!;
    const rwb = visual.find((v) => v.slot_id === "3-4-3.RWB")!;
    expect(lwb.position_line).toBe("DF");
    expect(rwb.position_line).toBe("DF");
  });

  it.each([...UNSUPPORTED_FORMATION_IDS])(
    "RED tripwire — unsupported id %s throws, never silently falls back",
    (fid) => {
      expect(() => getFormationVisualSlots(fid)).toThrow(/not one of the supported formations/);
    },
  );

  it("returns a cached array on repeated calls (identity stable)", () => {
    const a = getFormationVisualSlots("4-3-3");
    const b = getFormationVisualSlots("4-3-3");
    expect(a).toBe(b);
  });
});
