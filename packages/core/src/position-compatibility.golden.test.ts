import { describe, it, expect } from "vitest";

import {
  POSITION_COMPATIBILITY_FACTORS,
  slotPositionLine,
  SLOT_POSITIONS,
} from "./types/formation.js";
import type { SlotPosition } from "./types/formation.js";
import type { Position } from "./types/primitives.js";
import { positionCompatibility } from "./engine/compatibility.js";

// GOLDEN INVARIANT (WS-0c depth-layer contract; calibration WS-B):
//   The POSITION_COMPATIBILITY_FACTORS table is the contract-time placeholder
//   for the graduated compatibility curve. The TABLE VALUES are placeholder
//   (CALIBRATION: WS-B), but the TABLE SHAPE — which coarse line pairings
//   exist, which side of GK↔outfield gets the severe penalty, and how
//   intra-line moves behave — is part of THIS contract.
//
// Two halves to this scaffold:
//   (a) ACTIVE — the factor TABLE itself satisfies the documented shape.
//       This test runs today against POSITION_COMPATIBILITY_FACTORS. WS-B
//       changing the numeric values is allowed; reshaping the surface (e.g.
//       splitting GK↔outfield asymmetry, adding a 5th coarse line) is not.
//   (b) SKIPPED — the FULL curve + fold applied by `positionCompatibility(
//       eligible[], slot)` over the table. The curve is calibrated in WS-B
//       and locked there; the test is scaffolded here so the harness exists.

describe("position-compatibility — factor TABLE shape (active)", () => {
  const LINES: readonly Position[] = ["GK", "DF", "MF", "FW"];

  it("every (Position, Position) cell is a finite number in [0, 1]", () => {
    for (const a of LINES) {
      for (const b of LINES) {
        const v = POSITION_COMPATIBILITY_FACTORS[a][b];
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("same-line cells are exactly 1.0 (intra-line moves are free)", () => {
    for (const line of LINES) {
      expect(POSITION_COMPATIBILITY_FACTORS[line][line]).toBe(1.0);
    }
  });

  it("GK ↔ outfield is the severe penalty (≤ 0.2 on both directions)", () => {
    for (const line of LINES) {
      if (line === "GK") continue;
      expect(POSITION_COMPATIBILITY_FACTORS.GK[line]).toBeLessThanOrEqual(0.2);
      expect(POSITION_COMPATIBILITY_FACTORS[line].GK).toBeLessThanOrEqual(0.2);
    }
  });

  it("one-line-off outfield moves (DF↔MF, MF↔FW) are softer than two-off (DF↔FW)", () => {
    const oneOff = Math.min(
      POSITION_COMPATIBILITY_FACTORS.DF.MF,
      POSITION_COMPATIBILITY_FACTORS.MF.DF,
      POSITION_COMPATIBILITY_FACTORS.MF.FW,
      POSITION_COMPATIBILITY_FACTORS.FW.MF,
    );
    const twoOff = Math.max(
      POSITION_COMPATIBILITY_FACTORS.DF.FW,
      POSITION_COMPATIBILITY_FACTORS.FW.DF,
    );
    expect(oneOff).toBeGreaterThan(twoOff);
  });

  it("outfield↔outfield symmetry — DF↔MF, MF↔FW, DF↔FW are mirror-equal", () => {
    expect(POSITION_COMPATIBILITY_FACTORS.DF.MF).toBe(POSITION_COMPATIBILITY_FACTORS.MF.DF);
    expect(POSITION_COMPATIBILITY_FACTORS.MF.FW).toBe(POSITION_COMPATIBILITY_FACTORS.FW.MF);
    expect(POSITION_COMPATIBILITY_FACTORS.DF.FW).toBe(POSITION_COMPATIBILITY_FACTORS.FW.DF);
  });

  it("slotPositionLine() is total and surjective onto {GK, DF, MF, FW}", () => {
    const linesSeen = new Set<Position>();
    for (const sp of SLOT_POSITIONS) {
      const line = slotPositionLine(sp as SlotPosition);
      expect(LINES.includes(line)).toBe(true);
      linesSeen.add(line);
    }
    expect([...linesSeen].sort()).toEqual([...LINES].sort());
  });
});

describe("position-compatibility — full curve + fold (WS-B calibration: MAX-of-eligibles)", () => {
  it("intra-line eligibility yields 1.0", () => {
    expect(positionCompatibility(["DF"], "CB")).toBe(1.0);
    expect(positionCompatibility(["DF"], "LCB")).toBe(1.0);
    expect(positionCompatibility(["MF"], "CDM")).toBe(1.0);
    expect(positionCompatibility(["GK"], "GK")).toBe(1.0);
  });

  it("one-line-off eligibility yields the one-off factor", () => {
    expect(positionCompatibility(["MF"], "CB")).toBe(POSITION_COMPATIBILITY_FACTORS.MF.DF);
    expect(positionCompatibility(["FW"], "CDM")).toBe(POSITION_COMPATIBILITY_FACTORS.FW.MF);
  });

  it("two-line-off eligibility yields the two-off factor", () => {
    expect(positionCompatibility(["DF"], "ST")).toBe(POSITION_COMPATIBILITY_FACTORS.DF.FW);
  });

  it("GK ↔ outfield mismatches yield the severe factor", () => {
    expect(positionCompatibility(["DF"], "GK")).toBe(POSITION_COMPATIBILITY_FACTORS.DF.GK);
    expect(positionCompatibility(["GK"], "CB")).toBe(POSITION_COMPATIBILITY_FACTORS.GK.DF);
  });

  it("multi-eligible cards fold via MAX-of-eligibles", () => {
    // ['DF','MF'] in an 'ST' (FW) slot → max(FACTORS.DF.FW, FACTORS.MF.FW).
    const expected = Math.max(
      POSITION_COMPATIBILITY_FACTORS.DF.FW,
      POSITION_COMPATIBILITY_FACTORS.MF.FW,
    );
    expect(positionCompatibility(["DF", "MF"], "ST")).toBe(expected);
    // A perfect-match eligible dominates the fold.
    expect(positionCompatibility(["DF", "FW"], "ST")).toBe(1.0);
  });

  it("output is always a finite number in [0, 1]", () => {
    for (const sp of SLOT_POSITIONS) {
      for (const e of ["GK", "DF", "MF", "FW"] as const) {
        const v = positionCompatibility([e], sp as SlotPosition);
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("empty eligible[] throws RangeError (not a soft 0)", () => {
    expect(() => positionCompatibility([], "GK")).toThrow(RangeError);
  });
});
