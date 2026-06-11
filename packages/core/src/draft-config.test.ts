// DC-1 — draft configuration axes: preset table sanity, canonical-config
// predicate, and the createDraft honesty gates (config this build does not
// implement is REFUSED, never recorded-but-ignored).
//
// NOTE: the two "not implemented" gates below are intentionally temporary —
// DC-2 replaces the era gate with a catalog era-stamp cross-check and DC-3
// implements position_first. Those units update these tests in the same
// change that lands the behavior.

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
import { buildDraftCatalog, createDraft } from "./draft.js";
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
    expect(
      isCanonicalDraftConfig({ ...DEFAULT_DRAFT_CONFIG, draft_flow: "position_first" }),
    ).toBe(false);
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

  it("refuses rating_basis 'current' (gated on MV2-12b; no fake fallback)", () => {
    expect(() => createDraft(catalog, { ...PARAMS, rating_basis: "current" })).toThrow(
      /rating_basis "current" is not available/,
    );
  });
});
