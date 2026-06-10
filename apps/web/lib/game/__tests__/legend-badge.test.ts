import { describe, expect, it } from "vitest";

import {
  provenanceBadgeKind,
  provenanceBadgeLabel,
} from "@/lib/game/view-models";

// MV2-7 — source-derived legend flag, optional + fallback.
//
// The legend badge USED to be a pure OVR≥96 heuristic. MV2-7 swaps the source
// of truth to the compact's `legend` flag WHEN PRESENT, falling back to the
// OVR≥96 heuristic when ABSENT. Both paths are locked here.
//
// Truth table for `provenanceBadgeKind` (the single badge seam — adapters,
// candidate-card, and review-screen all read its `badge_kind`):
//
//   legend     overall   → badge_kind
//   undefined  ≥96       → "legend"   (fallback heuristic, unchanged)
//   undefined  <96       → not legend (fallback heuristic, unchanged)
//   true       <96       → "legend"   (flag promotes below the old threshold)
//   true       null      → "legend"   (flag promotes even with unknown OVR)
//   false      ≥96       → not legend (flag SUPPRESSES the old heuristic)

const WC = "wc_performance" as const;

describe("MV2-7 legend badge — flag-with-fallback", () => {
  describe("FALLBACK path (legend absent → OVR≥96 heuristic, the current compact)", () => {
    it("OVR≥96 with no legend flag → legend (heuristic preserved)", () => {
      expect(provenanceBadgeKind({ overall: 96, provenance: WC })).toBe("legend");
      expect(provenanceBadgeKind({ overall: 99, provenance: WC })).toBe("legend");
    });

    it("OVR<96 with no legend flag → NOT legend (heuristic preserved)", () => {
      expect(provenanceBadgeKind({ overall: 95, provenance: WC })).toBe("historical");
      expect(provenanceBadgeKind({ overall: 80, provenance: WC })).toBe("historical");
    });

    it("null OVR with no legend flag → NOT legend (null is never ≥96)", () => {
      expect(provenanceBadgeKind({ overall: null, provenance: WC })).toBe("historical");
    });

    it("explicit undefined legend behaves exactly like absent", () => {
      expect(
        provenanceBadgeKind({ overall: 97, provenance: WC, legend: undefined }),
      ).toBe("legend");
      expect(
        provenanceBadgeKind({ overall: 90, provenance: WC, legend: undefined }),
      ).toBe("historical");
    });
  });

  describe("FLAG path (legend present → source of truth, overrides heuristic)", () => {
    it("legend:true promotes a sub-96 card to legend", () => {
      expect(provenanceBadgeKind({ overall: 88, provenance: WC, legend: true })).toBe(
        "legend",
      );
    });

    it("legend:true promotes even when OVR is unknown (null)", () => {
      expect(
        provenanceBadgeKind({ overall: null, provenance: WC, legend: true }),
      ).toBe("legend");
    });

    it("legend:false SUPPRESSES legend for an OVR≥96 card (flag beats heuristic)", () => {
      // Without the flag this card would be "legend" (OVR 98). With an explicit
      // false it is not — the source-derived flag is authoritative.
      expect(provenanceBadgeKind({ overall: 98, provenance: WC, legend: false })).toBe(
        "historical",
      );
    });

    it("legend:false on a projected card falls through to its real badge, not legend", () => {
      expect(
        provenanceBadgeKind({
          overall: 97,
          provenance: "projected_career",
          legend: false,
        }),
      ).toBe("projected");
    });
  });

  describe("ordering preserved (legend outranks estimate / projected / historical)", () => {
    it("legend flag wins over an estimate basis", () => {
      expect(
        provenanceBadgeKind({
          overall: 70,
          provenance: WC,
          overall_basis: "baseline_anchor_estimate",
          legend: true,
        }),
      ).toBe("legend");
    });

    it("estimate basis still surfaces when legend is absent and OVR<96", () => {
      expect(
        provenanceBadgeKind({
          overall: 70,
          provenance: WC,
          overall_basis: "baseline_anchor_estimate",
        }),
      ).toBe("estimate");
    });
  });

  it("legend badge label is stable", () => {
    expect(provenanceBadgeLabel("legend")).toBe("Legend");
  });
});
