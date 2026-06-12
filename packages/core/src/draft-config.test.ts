// DC-1 — draft configuration axes: preset table sanity, canonical-config
// predicate, and createDraft config recording. All three axes are now
// implemented (squad_first/position_first, career/current, era presets), so the
// only remaining createDraft gate is the DC-2 era-stamp coherence check (the
// recorded preset must match the catalog it was built from). The former
// "current basis not implemented" gate is gone — both bases are live.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_DRAFT_CONFIG,
  ERA_PRESETS,
  ERA_PRESET_IDS,
  isCanonicalDraftConfig,
  isDraftFlow,
  isEraPresetId,
  isRatingBasis,
} from "./types/draft-config.js";
import {
  _testEraMassSplit,
  _testTotalCatalogWeight,
  autoDraft,
  buildDraftCatalog,
  createDraft,
  filterDraftDataset,
} from "./draft.js";
import { buildDraftFixture } from "./draft.fixture.js";

const FIXTURE = buildDraftFixture();
const PARAMS = {
  ...FIXTURE.params,
  run_id: "run.config.1",
  parent_seed: "wcdraft:draft-config:v1:1",
} as const;

describe("ERA_PRESETS table (plan §B bounds)", () => {
  it("carries exactly the four legalized v1 presets with their resolved bounds", () => {
    expect(ERA_PRESET_IDS).toEqual(["all_time", "post_2000", "post_2010", "modern"]);
    expect(ERA_PRESETS.all_time).toEqual({ id: "all_time", min_year: 1930, max_year: 2026 });
    expect(ERA_PRESETS.post_2000).toEqual({ id: "post_2000", min_year: 2002, max_year: 2026 });
    expect(ERA_PRESETS.post_2010).toEqual({ id: "post_2010", min_year: 2014, max_year: 2026 });
    expect(ERA_PRESETS.modern).toEqual({ id: "modern", min_year: 2018, max_year: 2026 });
  });

  it("is deep-frozen (presets are engine constants, not data)", () => {
    expect(Object.isFrozen(ERA_PRESETS)).toBe(true);
    expect(Object.isFrozen(ERA_PRESETS.modern)).toBe(true);
  });
});

describe("config type guards", () => {
  it("accept exactly the legal axis values", () => {
    expect(isDraftFlow("squad_first")).toBe(true);
    expect(isDraftFlow("position_first")).toBe(true);
    expect(isDraftFlow("Position First")).toBe(false);
    expect(isRatingBasis("career")).toBe(true);
    expect(isRatingBasis("current")).toBe(true);
    expect(isRatingBasis("prime")).toBe(false);
    expect(isEraPresetId("all_time")).toBe(true);
    expect(isEraPresetId("modern")).toBe(true);
    expect(isEraPresetId("2026_only")).toBe(false);
  });
});

describe("isCanonicalDraftConfig", () => {
  it("is true only for squad_first + career + all_time", () => {
    expect(isCanonicalDraftConfig(DEFAULT_DRAFT_CONFIG)).toBe(true);
    expect(isCanonicalDraftConfig({ ...DEFAULT_DRAFT_CONFIG, draft_flow: "position_first" })).toBe(
      false,
    );
    expect(isCanonicalDraftConfig({ ...DEFAULT_DRAFT_CONFIG, rating_basis: "current" })).toBe(
      false,
    );
    expect(isCanonicalDraftConfig({ ...DEFAULT_DRAFT_CONFIG, era_preset: "modern" })).toBe(false);
  });
});

describe("createDraft DC-1 config recording + honesty gates", () => {
  const catalog = buildDraftCatalog(FIXTURE.dataset);

  it("records the default config explicitly on the DraftState", () => {
    const draft = createDraft(catalog, { ...PARAMS });
    expect(draft.draft_flow).toBe("squad_first");
    expect(draft.rating_basis).toBe("career");
    expect(draft.era_preset).toBe("all_time");
  });

  it("default-config createDraft is unchanged by the config fields (same spins)", () => {
    const implicit = createDraft(catalog, { ...PARAMS });
    const explicit = createDraft(catalog, {
      ...PARAMS,
      draft_flow: "squad_first",
      rating_basis: "career",
      era_preset: "all_time",
    });
    expect(JSON.stringify(explicit)).toBe(JSON.stringify(implicit));
  });

  it("records rating_basis 'current' (selected-basis lane — both bases live)", () => {
    const draft = createDraft(catalog, { ...PARAMS, rating_basis: "current" });
    expect(draft.rating_basis).toBe("current");
    // Spins/draws are basis-independent (the basis only re-rates the squad
    // downstream), so a current-basis draft has the same spin structure as the
    // default — the byte-equal proof would differ only in the recorded basis.
    const career = createDraft(catalog, { ...PARAMS, rating_basis: "career" });
    expect({ ...draft, rating_basis: "career" }).toEqual(career);
  });

  it("refuses an era_preset that does not match the catalog's era stamp (DC-2 coherence)", () => {
    expect(() => createDraft(catalog, { ...PARAMS, era_preset: "modern" })).toThrow(
      /does not match the catalog's era stamp/,
    );
  });
});

// ─── DC-2 — era-filtered catalogs (plan §B sampling rule) ────────────────────

describe("filterDraftDataset (DC-2)", () => {
  // Fixture years: 1934, 1962, 1990 (rare) / 2002, 2014, 2026 (modern) —
  // tournament_ids 1..6 (see draft.fixture.ts TOURNAMENT_META).
  const ds = FIXTURE.dataset;

  it("all_time passes every tournament through (identity in content terms)", () => {
    const filtered = filterDraftDataset(ds, "all_time");
    expect(filtered.players.length).toBe(ds.players.length);
    expect(filtered.managers.length).toBe(ds.managers.length);
    expect(filtered.tournaments.length).toBe(ds.tournaments.length);
  });

  it("modern (2018–2026) keeps only the 2026 fixture tournament", () => {
    const filtered = filterDraftDataset(ds, "modern");
    const years = new Set(filtered.tournaments.map((t) => t.year));
    expect([...years]).toEqual([2026]);
    expect(filtered.players.every((c) => c.tournament_id === 6)).toBe(true);
    expect(filtered.managers.every((m) => m.tournament_id === 6)).toBe(true);
    expect(filtered.players.length).toBeGreaterThan(0);
  });

  it("post_2000 (2002–2026) drops every rare-year tournament", () => {
    const filtered = filterDraftDataset(ds, "post_2000");
    expect(filtered.tournaments.map((t) => t.year).sort()).toEqual([2002, 2014, 2026]);
  });
});

describe("buildDraftCatalog era stamping + mass recomputation (DC-2)", () => {
  const ds = FIXTURE.dataset;

  it("default build is stamped all_time and content-identical to an explicit all_time build", () => {
    const implicit = buildDraftCatalog(ds);
    const explicit = buildDraftCatalog(ds, "all_time");
    expect(implicit.era).toEqual({ id: "all_time", min_year: 1930, max_year: 2026 });
    expect(implicit.hasRareEra).toBe(true);
    // Deep content equality (Map serializes empty — compare pairs + weights).
    expect(JSON.stringify(explicit.pairs)).toBe(JSON.stringify(implicit.pairs));
    expect(explicit.cumulativeWeights).toEqual(implicit.cumulativeWeights);
  });

  it("all_time keeps the 0.10 / 0.90 era mass split", () => {
    const catalog = buildDraftCatalog(ds, "all_time");
    const { rare, modern } = _testEraMassSplit(catalog);
    expect(rare).toBeCloseTo(0.1, 10);
    expect(modern).toBeCloseTo(0.9, 10);
  });

  it("an all-modern preset collapses to 0 / 1 era mass — no phantom rare class", () => {
    for (const preset of ["post_2000", "post_2010", "modern"] as const) {
      const catalog = buildDraftCatalog(ds, preset);
      expect(catalog.era.id).toBe(preset);
      expect(catalog.hasRareEra).toBe(false);
      const { rare, modern } = _testEraMassSplit(catalog);
      expect(rare).toBe(0);
      expect(modern).toBeCloseTo(1, 10);
      expect(catalog.pairs.every((p) => !p.rare)).toBe(true);
    }
  });

  it("total catalog weight stays ≈1.0 inside every preset", () => {
    for (const preset of ["all_time", "post_2000", "post_2010", "modern"] as const) {
      expect(_testTotalCatalogWeight(buildDraftCatalog(ds, preset))).toBeCloseTo(1, 10);
    }
  });

  it("createDraft accepts a matching preset/catalog pair and records the preset", () => {
    const catalog = buildDraftCatalog(ds, "modern");
    const draft = createDraft(catalog, { ...PARAMS, era_preset: "modern" });
    expect(draft.era_preset).toBe("modern");
    // Every drawn spin must come from the bounded pool.
    expect(draft.spins.every((s) => s.tournament_id === 6 && !s.rare)).toBe(true);
  });

  it("era-bounded autoDraft completes deterministically (run-twice identity)", () => {
    const a = autoDraft({ ...PARAMS, era_preset: "modern", dataset: ds });
    const b = autoDraft({ ...PARAMS, era_preset: "modern", dataset: ds });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.era_preset).toBe("modern");
    expect(a.status).toBe("ready");
  });
});
