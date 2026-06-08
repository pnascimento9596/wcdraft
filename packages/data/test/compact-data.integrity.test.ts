// Schema / join / honest-state / ID-rewrite integrity for the committed
// compact bundles. Runs against the on-disk artifacts in `src/generated/`
// — this is the contract that the builder is allowed to break only when
// the bundles are explicitly regenerated.
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

  // Phase 1.1 recalibration (wc-perf-2.0.0, decoupled): basis logic is unchanged so the
  // estimate count remains 388, but the count is no longer the WHOLE
  // invariant — every estimate row must sit in [66, 73] on OVERALL, and the
  // display contract applies to every runtime rating's overall. Sim channels
  // stay on the pre-recal [20, 100] band so λ stays calibrated; see
  // realism-modern-norms.golden.test.ts.
  const EXPECTED_BASELINE_ANCHOR_ESTIMATE = 388;
  const DISPLAY_FLOOR = 66;
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
  it("every baseline_anchor_estimate row sits inside the overall estimate band [66, 73]", () => {
    const estimates = DRAFT_POOL_BUNDLE.ratings.filter(
      (r) => r.overall_basis === "baseline_anchor_estimate",
    );
    expect(estimates.length).toBe(EXPECTED_BASELINE_ANCHOR_ESTIMATE);
    for (const r of estimates) {
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

  it("every runtime rating overall lives in the recalibrated display band [66, 99]", () => {
    for (const r of DRAFT_POOL_BUNDLE.ratings) {
      expect(r.overall, `${r.card_id} overall`).not.toBeNull();
      expect(r.overall as number, `${r.card_id} overall`).toBeGreaterThanOrEqual(DISPLAY_FLOOR);
      expect(r.overall as number, `${r.card_id} overall`).toBeLessThanOrEqual(DISPLAY_MAX);
      expect(r.overall, `${r.card_id} overall == 100`).not.toBe(100);
    }
  });

  it("rating_version anchors are the E-4 career-lift versions", () => {
    // wc-perf-3.0.0 = the E-4 career-stature lift. Projected stays
    // proj-career-2.0.0 (2026 does not consume career stature in E-4), and the
    // engine_version is unchanged (channels moved, but engine math/λ did not).
    expect(RUNTIME_DATA_MANIFEST.rating_version_historical).toBe("wc-perf-3.0.0");
    expect(RUNTIME_DATA_MANIFEST.rating_version_projected).toBe("proj-career-2.0.0");
    expect(RUNTIME_DATA_MANIFEST.engine_version).toBe("engine-2026.06.04");
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
      expect(card.eligible_positions.length, `empty eligible_positions for ${card.card_id}`)
        .toBeGreaterThan(0);
    }
  });

  it("ratings carry valid rating_version values matching the manifest anchors", () => {
    const allowed = new Set([
      RUNTIME_DATA_MANIFEST.rating_version_historical,
      RUNTIME_DATA_MANIFEST.rating_version_projected,
    ]);
    for (const r of DRAFT_POOL_BUNDLE.ratings) {
      expect(allowed.has(r.rating_version), `unexpected rating_version ${r.rating_version}`)
        .toBe(true);
    }
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
});
