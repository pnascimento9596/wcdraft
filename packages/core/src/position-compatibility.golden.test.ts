import { describe, it, expect } from "vitest";

import {
  POSITION_COMPATIBILITY_FACTORS,
  slotPositionLine,
  SLOT_POSITIONS,
} from "./types/formation.js";
import type { SlotPosition } from "./types/formation.js";
import type { Position } from "./types/primitives.js";

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

describe.skip("position-compatibility — full curve + fold (WS-B)", () => {
  it.skip("intra-line eligibility yields 1.0 (e.g. eligible=['DF'] in a 'CB' slot)", () => {
    // FIXTURE TODO (WS-B):
    //   - positionCompatibility(['DF'], 'CB') === 1.0
    //   - positionCompatibility(['DF'], 'LCB') === 1.0
    //   - positionCompatibility(['MF'], 'CDM') === 1.0
  });

  it.skip("one-line-off eligibility yields the one-off factor (e.g. eligible=['MF'] in 'CB')", () => {
    // FIXTURE TODO (WS-B):
    //   - positionCompatibility(['MF'], 'CB') === FACTORS.MF.DF (≈ 0.75 placeholder)
    //   - positionCompatibility(['FW'], 'CDM') === FACTORS.FW.MF (≈ 0.75 placeholder)
  });

  it.skip("two-line-off eligibility yields the two-off factor (e.g. eligible=['DF'] in 'ST')", () => {
    // FIXTURE TODO (WS-B):
    //   - positionCompatibility(['DF'], 'ST') === FACTORS.DF.FW (≈ 0.45 placeholder)
  });

  it.skip("GK ↔ outfield mismatches yield the severe factor (outfielder in GK, GK outfield)", () => {
    // FIXTURE TODO (WS-B):
    //   - positionCompatibility(['DF'], 'GK') === FACTORS.DF.GK (≈ 0.15 placeholder)
    //   - positionCompatibility(['GK'], 'CB') === FACTORS.GK.DF (≈ 0.15 placeholder)
  });

  it.skip("multi-eligible cards fold via the calibrated fold (max-of-eligibles is the WS-B candidate)", () => {
    // FIXTURE TODO (WS-B):
    //   - positionCompatibility(['DF','MF'], 'ST') equals the calibrated fold
    //     of [FACTORS.DF.FW, FACTORS.MF.FW]. WS-B chooses (and locks) the fold.
  });

  it.skip("empty eligible[] throws RangeError (not a soft 0)", () => {
    // FIXTURE TODO (WS-B):
    //   - expect(() => positionCompatibility([], 'GK')).toThrow(RangeError)
  });
});
