import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DRAFT_POOL_BUNDLE, type RuntimeBasisRating, type RuntimeRating } from "@wcdraft/data";

import {
  provenanceBadgeKind,
  provenanceBadgeLabel,
  type RatingBadgeKind,
} from "@/lib/game/view-models";

/**
 * Provenance inventory — every rating signal that can reach the badge seam must
 * map to exactly one known HUE kind. Nothing may fall through to an implicit
 * grey/"unknown" by omission. `career_stature_estimate` rides the estimate
 * (orange) hue per provenance=HUE.
 */

const ALL_BADGE_KINDS = [
  "historical",
  "projected",
  "estimate",
  "legend",
  "masked",
] as const satisfies readonly RatingBadgeKind[];

const PROVENANCES = ["wc_performance", "projected_career"] as const;
const BASES = [
  undefined,
  "measured_performance",
  "baseline_anchor_estimate",
  "career_stature_estimate",
] as const;

const tokensCss = readFileSync(new URL("../../../app/ds/tokens.css", import.meta.url), "utf8");

describe("provenance inventory — exhaustive badge routing", () => {
  it("every RatingBadgeKind has a non-empty stable label (no unknown/grey hole)", () => {
    for (const kind of ALL_BADGE_KINDS) {
      const label = provenanceBadgeLabel(kind);
      expect(label.trim().length).toBeGreaterThan(0);
      expect(label.toLowerCase()).not.toMatch(/unknown|grey|gray|—|-/);
    }
  });

  it("every provenance × overall_basis combination maps to a known badge kind", () => {
    const seen = new Set<RatingBadgeKind>();
    for (const provenance of PROVENANCES) {
      for (const overall_basis of BASES) {
        for (const legend of [undefined, true, false] as const) {
          for (const overall of [null, 70, 98] as const) {
            const kind = provenanceBadgeKind({
              overall,
              provenance,
              overall_basis,
              legend,
            });
            expect(ALL_BADGE_KINDS).toContain(kind);
            seen.add(kind);
            // Estimate bases always win the orange estimate hue.
            if (
              overall_basis === "baseline_anchor_estimate" ||
              overall_basis === "career_stature_estimate"
            ) {
              expect(kind).toBe("estimate");
            }
          }
        }
      }
    }
    // Core hues (except masked, which is Memory-only) are reachable from the seam.
    expect(seen.has("historical")).toBe(true);
    expect(seen.has("projected")).toBe(true);
    expect(seen.has("estimate")).toBe(true);
    expect(seen.has("legend")).toBe(true);
  });

  it("every compact career_stature_estimate card surfaces as estimate (orange HUE)", () => {
    const rows: Array<RuntimeRating | RuntimeBasisRating> = [
      ...DRAFT_POOL_BUNDLE.ratings,
      ...DRAFT_POOL_BUNDLE.ratings.map((r) => r.basis_ratings.current),
    ];
    const stature = rows.filter((r) => r.overall_basis === "career_stature_estimate");
    // Compact carries hundreds of career-stature estimates on career basis.
    expect(stature.length).toBeGreaterThan(100);

    for (const rating of stature) {
      const kind = provenanceBadgeKind({
        overall: rating.overall,
        provenance: rating.provenance,
        overall_basis: rating.overall_basis,
        legend: rating.legend,
      });
      expect(kind).toBe("estimate");
      expect(provenanceBadgeLabel(kind)).toBe("Estimate");
    }
  });

  it("estimate HUE matches the locked provenance palette (orange, not grey)", () => {
    // Dark + light estimate tokens from tokens.css — the locked orange warning hue.
    expect(tokensCss).toMatch(/--prov-estimate:\s*#f0913f/i);
    expect(tokensCss).toMatch(/--prov-estimate:\s*#93450c/i);
    // Grey/unknown must not be aliased as estimate.
    expect(tokensCss).toMatch(/--prov-unknown:\s*#717c75/i);
    expect(tokensCss).not.toMatch(/--prov-estimate:\s*#717c75/i);
    expect(tokensCss).not.toMatch(/--prov-estimate:\s*#566158/i);
  });
});
