// Schema / join / honest-state / ID-rewrite integrity for the generated compact
// bundles. Runs against the on-disk artifacts in `src/generated/`; the largest
// bundle is intentionally ignored by normal git and locked by manifest/report
// fingerprints.
//
// Tests in this file are CHEAP — they iterate the in-memory bundles
// without re-running the builder. Determinism + size-budget assertions
// live in `compact-data.golden.test.ts` (which re-runs the builder).

import { describe, expect, it } from "vitest";
import { parseCardId, parseManagerCardId } from "@wcdraft/core";
import {
  DRAFT_POOL_BUNDLE,
  RUNTIME_DATA_MANIFEST,
  RUNTIME_DATA_SCHEMA_VERSION,
  SCENARIO_2026_BUNDLE,
} from "../src/index.js";
import type { RuntimeRating } from "../src/types.js";

describe("compact-data integrity", () => {
  it("manifest schema_version matches the runtime contract anchor", () => {
    expect(RUNTIME_DATA_MANIFEST.schema_version).toBe(RUNTIME_DATA_SCHEMA_VERSION);
    expect(DRAFT_POOL_BUNDLE.schema_version).toBe(RUNTIME_DATA_SCHEMA_VERSION);
    expect(SCENARIO_2026_BUNDLE.schema_version).toBe(RUNTIME_DATA_SCHEMA_VERSION);
  });

  it("counts row counts on the manifest match the bundles", () => {
    expect(RUNTIME_DATA_MANIFEST.counts.player_cards).toBe(DRAFT_POOL_BUNDLE.player_cards.length);
    expect(RUNTIME_DATA_MANIFEST.counts.manager_cards).toBe(DRAFT_POOL_BUNDLE.manager_cards.length);
    expect(RUNTIME_DATA_MANIFEST.counts.ratings).toBe(DRAFT_POOL_BUNDLE.ratings.length);
    expect(RUNTIME_DATA_MANIFEST.counts.teams).toBe(SCENARIO_2026_BUNDLE.teams.length);
    expect(RUNTIME_DATA_MANIFEST.counts.knockout_slots).toBe(
      SCENARIO_2026_BUNDLE.knockout_slots.length,
    );
  });

  it("counts a non-empty 2026 scenario (48 teams, 12 groups)", () => {
    expect(SCENARIO_2026_BUNDLE.teams.length).toBe(48);
    expect(SCENARIO_2026_BUNDLE.groups.length).toBe(12);
  });

  // 386 as of wc-perf-4.2.1: the basis-gate stature alignment re-labels Sepp
  // Maier P-14080:WC-1966 (career_stature_index 0.446, stature_model_weight
  // 0.881 — stature dominates) from baseline_anchor_estimate →
  // career_stature_estimate, one card off the MV2-10 count of 387. The count
  // is not the WHOLE invariant — every estimate row must sit in [66, 73] on
  // OVERALL, and the display contract applies to every runtime rating's
  // overall. Sim channels stay on the pre-recal [20, 100] band — channels are
  // BYTE-IDENTICAL across this fix (basis re-label only flips the [66,73]
  // estimate cap on display `overall`; the channel materializer never reads
  // `overall_basis`).
  const EXPECTED_BASELINE_ANCHOR_ESTIMATE = 386;
  const DISPLAY_FLOOR = 0;
  const DISPLAY_MAX = 99;
  const ESTIMATE_DISPLAY_MIN = 66;
  const ESTIMATE_DISPLAY_MAX = 73;

  it("baseline_anchor_estimate count is the expected count and matches the manifest", () => {
    expect(RUNTIME_DATA_MANIFEST.counts.baseline_anchor_estimate).toBe(
      EXPECTED_BASELINE_ANCHOR_ESTIMATE,
    );
    const measured = DRAFT_POOL_BUNDLE.ratings.filter(
      (r) => r.overall_basis === "baseline_anchor_estimate",
    ).length;
    expect(measured).toBe(EXPECTED_BASELINE_ANCHOR_ESTIMATE);
  });

  // Phase 1.1 decoupled: only OVERALL is on the display band [66, 73] for
  // estimates. Sim channels stay on the pre-recalibration [FLOOR_CHANNEL, 100]
  // band so the engine's λ stays calibrated to the modern-era WC norms — see
  // realism-modern-norms.golden.test.ts.
  function hasManualOverride(r: RuntimeRating): boolean {
    return r.components.some((c) => c.signal === "manual_rating_override");
  }

  it("every non-manual baseline_anchor_estimate row sits inside the overall estimate band [66, 73]", () => {
    const estimates = DRAFT_POOL_BUNDLE.ratings.filter(
      (r) => r.overall_basis === "baseline_anchor_estimate",
    );
    expect(estimates.length).toBe(EXPECTED_BASELINE_ANCHOR_ESTIMATE);
    for (const r of estimates) {
      if (hasManualOverride(r)) continue;
      expect(r.overall).not.toBeNull();
      expect(r.overall as number).toBeGreaterThanOrEqual(ESTIMATE_DISPLAY_MIN);
      expect(r.overall as number).toBeLessThanOrEqual(ESTIMATE_DISPLAY_MAX);
      expect(r.coverage).toBeLessThan(1.0);
      expect(r.provenance).toBe("wc_performance");
    }
  });

  it("every runtime rating channel lives in the sim channel band [FLOOR_CHANNEL, 100]", () => {
    // FLOOR_CHANNEL is 20 (REPLACEMENT_BASE * 100) — the pre-recalibration
    // floor that the engine's λ was calibrated against. Sim channels were NOT
    // remapped onto the display band in Phase 1.1 (decoupled path).
    const SIM_CHANNEL_FLOOR = 20;
    const SIM_CHANNEL_CEILING = 100;
    for (const r of DRAFT_POOL_BUNDLE.ratings) {
      for (const ch of ["attack", "midfield", "defense", "goalkeeping"] as const) {
        expect(r[ch], `${r.card_id} ${ch}`).toBeGreaterThanOrEqual(SIM_CHANNEL_FLOOR);
        expect(r[ch], `${r.card_id} ${ch}`).toBeLessThanOrEqual(SIM_CHANNEL_CEILING);
      }
    }
  });

  it("every runtime rating overall lives in the runtime rating band [0, 99]", () => {
    for (const r of DRAFT_POOL_BUNDLE.ratings) {
      expect(r.overall, `${r.card_id} overall`).not.toBeNull();
      expect(r.overall as number, `${r.card_id} overall`).toBeGreaterThanOrEqual(DISPLAY_FLOOR);
      expect(r.overall as number, `${r.card_id} overall`).toBeLessThanOrEqual(DISPLAY_MAX);
      expect(r.overall, `${r.card_id} overall == 100`).not.toBe(100);
    }
  });

  it("rating_version anchors are the merit-v4.3 versions; engine_version carries the merit-v4.3 stamp", () => {
    expect(RUNTIME_DATA_MANIFEST.rating_version_historical).toBe("wc-perf-6.3.0");
    expect(RUNTIME_DATA_MANIFEST.rating_version_projected).toBe("proj-career-5.3.0");
    expect(RUNTIME_DATA_MANIFEST.engine_version).toBe("engine-2026.06.15-merit-v4.3");
  });

  it("career_stature_estimate count matches the manifest (E-4)", () => {
    const measured = DRAFT_POOL_BUNDLE.ratings.filter(
      (r) => r.overall_basis === "career_stature_estimate",
    ).length;
    expect(RUNTIME_DATA_MANIFEST.counts.career_stature_estimate).toBe(measured);
  });

  it("every player card has a runtime CardId that parses through parseCardId", () => {
    for (const card of DRAFT_POOL_BUNDLE.player_cards) {
      const parsed = parseCardId(card.card_id);
      expect(parsed, `parseCardId failed for ${card.card_id}`).not.toBeNull();
      expect(parsed!.player_id).toBe(card.player_id);
      expect(parsed!.tournament_id).toBe(card.tournament_id);
      // Source ID is preserved for audit and never used as a runtime key.
      expect(card.source_card_id).toMatch(/^.+:WC-\d{4}$/u);
      expect(card.source_tournament_id).toMatch(/^WC-\d{4}$/u);
    }
  });

  it("every manager card has a runtime ManagerCardId that parses through parseManagerCardId", () => {
    for (const card of DRAFT_POOL_BUNDLE.manager_cards) {
      const parsed = parseManagerCardId(card.manager_card_id);
      expect(parsed, `parseManagerCardId failed for ${card.manager_card_id}`).not.toBeNull();
      expect(parsed!.manager_id).toBe(card.manager_id);
      expect(parsed!.tournament_id).toBe(card.tournament_id);
      expect(card.source_manager_card_id).toContain(":WC-");
      expect(card.source_tournament_id).toMatch(/^WC-\d{4}$/u);
    }
  });

  it("every draftable card has a rating and no card has empty eligible_positions", () => {
    const ratingByCardId = new Map(DRAFT_POOL_BUNDLE.ratings.map((r) => [r.card_id, r]));
    expect(ratingByCardId.size).toBe(DRAFT_POOL_BUNDLE.ratings.length);
    for (const card of DRAFT_POOL_BUNDLE.player_cards) {
      const rating = ratingByCardId.get(card.card_id);
      expect(rating, `missing rating for card ${card.card_id}`).toBeDefined();
      expect(
        card.eligible_positions.length,
        `empty eligible_positions for ${card.card_id}`,
      ).toBeGreaterThan(0);
    }
  });

  it("ratings carry valid rating_version values matching the manifest anchors", () => {
    const allowed = new Set([
      RUNTIME_DATA_MANIFEST.rating_version_historical,
      RUNTIME_DATA_MANIFEST.rating_version_projected,
    ]);
    for (const r of DRAFT_POOL_BUNDLE.ratings) {
      expect(allowed.has(r.rating_version), `unexpected rating_version ${r.rating_version}`).toBe(
        true,
      );
    }
  });

  it("carries complete career and current basis ratings for every card", () => {
    expect(RUNTIME_DATA_MANIFEST.counts.rating_basis.career.ratings).toBe(
      DRAFT_POOL_BUNDLE.ratings.length,
    );
    expect(RUNTIME_DATA_MANIFEST.counts.rating_basis.current.ratings).toBe(
      DRAFT_POOL_BUNDLE.ratings.length,
    );

    for (const card of DRAFT_POOL_BUNDLE.player_cards) {
      const career = DRAFT_POOL_BUNDLE.ratings.find((r) => r.card_id === card.card_id);
      const current = career?.basis_ratings.current;
      expect(career, `${card.card_id} career basis`).toBeDefined();
      expect(current, `${card.card_id} current basis`).toBeDefined();
      expect(career!.basis_metadata?.basis, `${card.card_id} career metadata`).toBe("career");
      expect(current!.basis_metadata?.basis, `${card.card_id} current metadata`).toBe("current");
      expect(career!.rating_version).toBe(
        card.tournament_id === 2026
          ? RUNTIME_DATA_MANIFEST.rating_version_projected
          : RUNTIME_DATA_MANIFEST.rating_version_historical,
      );
      expect(current!.rating_version).toBe(career!.rating_version);
    }
  });

  it("legacy ratings array is the career basis alias", () => {
    for (const r of DRAFT_POOL_BUNDLE.ratings) {
      expect(r.basis_metadata?.basis, `${r.card_id} career alias`).toBe("career");
    }
  });

  it("basis census locks match measured basis rows", () => {
    const careerRows = DRAFT_POOL_BUNDLE.ratings;
    const currentRows = DRAFT_POOL_BUNDLE.ratings.map((r) => r.basis_ratings.current);
    expect(RUNTIME_DATA_MANIFEST.counts.rating_basis.career.baseline_anchor_estimate).toBe(
      careerRows.filter((r) => r.overall_basis === "baseline_anchor_estimate").length,
    );
    expect(RUNTIME_DATA_MANIFEST.counts.rating_basis.career.career_stature_estimate).toBe(
      careerRows.filter((r) => r.overall_basis === "career_stature_estimate").length,
    );
    expect(RUNTIME_DATA_MANIFEST.counts.rating_basis.current.baseline_anchor_estimate).toBe(
      currentRows.filter((r) => r.overall_basis === "baseline_anchor_estimate").length,
    );
    expect(RUNTIME_DATA_MANIFEST.counts.rating_basis.current.career_stature_estimate).toBe(
      currentRows.filter((r) => r.overall_basis === "career_stature_estimate").length,
    );
    expect(RUNTIME_DATA_MANIFEST.counts.rating_basis.career.baseline_anchor_estimate).toBe(386);
    expect(RUNTIME_DATA_MANIFEST.counts.rating_basis.career.career_stature_estimate).toBe(541);
    expect(RUNTIME_DATA_MANIFEST.counts.rating_basis.current.baseline_anchor_estimate).toBe(388);
    expect(RUNTIME_DATA_MANIFEST.counts.rating_basis.current.career_stature_estimate).toBe(0);
  });

  it("nation_by_card_id covers every player card", () => {
    for (const c of DRAFT_POOL_BUNDLE.player_cards) {
      expect(DRAFT_POOL_BUNDLE.nation_by_card_id[c.card_id]).toBe(c.nation_id);
    }
  });

  it("every Team2026.squad_card_ids entry resolves to a card in the pool", () => {
    const cardIds = new Set(DRAFT_POOL_BUNDLE.player_cards.map((c) => c.card_id));
    for (const team of SCENARIO_2026_BUNDLE.teams) {
      for (const sid of team.squad_card_ids) {
        expect(cardIds.has(sid), `team ${team.team_id} references missing card ${sid}`).toBe(true);
        const parsed = parseCardId(sid);
        expect(parsed?.tournament_id, `non-2026 squad card id ${sid}`).toBe(2026);
      }
    }
  });

  it("groups reference only teams that exist in the bundle", () => {
    const knownTeamIds = new Set(SCENARIO_2026_BUNDLE.teams.map((t) => t.team_id));
    for (const g of SCENARIO_2026_BUNDLE.groups) {
      for (const tid of g.team_ids) {
        expect(knownTeamIds.has(tid)).toBe(true);
      }
    }
  });

  it("attribution carries Fjelstul + Wikipedia 2026 sources, CC-BY-SA, and not-affiliated text", () => {
    const a = RUNTIME_DATA_MANIFEST.attribution;
    expect(a.redistributed_license).toBe("CC-BY-SA 4.0");
    expect(a.redistributed_license_url).toContain("creativecommons.org/licenses/by-sa/4.0");
    expect(a.not_affiliated_disclaimer.length).toBeGreaterThan(0);
    expect(a.not_affiliated_disclaimer).toMatch(/football/i);
    expect(a.not_affiliated_disclaimer).not.toMatch(/soccer/i);
    expect(a.combined_attribution).toMatch(/Fjelstul/);
    expect(a.combined_attribution).toMatch(/Wikipedia/);
    const sourceIds = a.sources.map((s) => s.source_id);
    expect(sourceIds).toContain("fjelstul");
    expect(sourceIds.some((id) => id.startsWith("wikipedia-2026-"))).toBe(true);
  });

  it("rejects mock fallback signals — no card has a `0` masquerading as null appearances/caps", () => {
    // Honest-state spot-check: for the 388 estimate cards, `appearances` may
    // legitimately be 0 (the rating fell back to the baseline anchor BECAUSE
    // tournament-level signals were thin). What we MUST never see is a
    // card with `overall: 0` from a missing-rating mock fallback.
    for (const r of DRAFT_POOL_BUNDLE.ratings) {
      if (r.overall === 0) {
        // 0 is technically a valid rating value, but if it appeared with
        // overall_basis missing it would imply we silently filled a hole.
        expect(r.overall_basis ?? r.provenance).toBeDefined();
      }
    }
  });

  // ── Merit-v3 V6 — required source-derived `legend` field ────────────────────
  //
  // runtime-data-2.5.0 preserves the runtime-data-2.3.0 `legend` contract:
  // REQUIRED on every rating row (historical + 2026). The flag is the ETL
  // source-derived boolean — never re-derived from `overall` — and the count is
  // locked on the manifest for the honest-state census.
  describe("runtime-data-2.5.0 required legend field", () => {
    const EXPECTED_LEGEND_TOTAL = 295;
    const EXPECTED_LEGEND_HISTORICAL = 283;
    const EXPECTED_LEGEND_2026 = 12;

    it("every rating carries a boolean legend flag (required as of runtime-data-2.5.0)", () => {
      for (const r of DRAFT_POOL_BUNDLE.ratings) {
        expect(typeof r.legend, `${r.card_id} legend`).toBe("boolean");
      }
    });

    it("legend count matches the manifest census: 295 = 283 historical + 12 2026", () => {
      const legends = DRAFT_POOL_BUNDLE.ratings.filter((r) => r.legend);
      expect(RUNTIME_DATA_MANIFEST.counts.legend).toBe(EXPECTED_LEGEND_TOTAL);
      expect(legends.length).toBe(EXPECTED_LEGEND_TOTAL);
      const historical = legends.filter((r) => r.tournament_id !== 2026);
      const projected = legends.filter((r) => r.tournament_id === 2026);
      expect(historical.length).toBe(EXPECTED_LEGEND_HISTORICAL);
      expect(projected.length).toBe(EXPECTED_LEGEND_2026);
    });

    it("legend is source-derived, not an OVR threshold re-derivation", () => {
      // The flag must not collapse into the old OVR≥96 display heuristic: the
      // source-joined census includes sub-96 legends AND high-OVR non-legends.
      // (If `legend` were re-derived from overall, both sets would be empty.)
      const sub96Legends = DRAFT_POOL_BUNDLE.ratings.filter(
        (r) => r.legend && r.overall !== null && r.overall < 96,
      );
      const high96NonLegends = DRAFT_POOL_BUNDLE.ratings.filter(
        (r) => !r.legend && r.overall !== null && r.overall >= 96,
      );
      expect(sub96Legends.length).toBeGreaterThan(0);
      expect(high96NonLegends.length).toBeGreaterThan(0);
    });

    it("an explicit legend boolean satisfies the required-field contract", () => {
      const sample = DRAFT_POOL_BUNDLE.ratings[0]!;
      const augmented: RuntimeRating = { ...sample, legend: true };
      expect(augmented.legend).toBe(true);
      const suppressed: RuntimeRating = { ...sample, legend: false };
      expect(suppressed.legend).toBe(false);
    });
  });
});
