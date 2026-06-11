// Draft configuration axes — DC-1 (draft-config season, plan
// `docs/plans/draft-config-2026-06-10.md` §A/§B).
//
// Three pre-draft config axes ride on top of the existing Classic / Memory
// visibility mode (`DraftState.mode`):
//
//   - `draft_flow`   — Squad First (today's flow: spin squad → pick entity →
//                      choose slot) or Position First (choose target slot →
//                      spin squad → fill that slot). State-machine semantics
//                      land in DC-3.
//   - `rating_basis` — Career (career-best / full-career stature — today's
//                      shipped ratings) or Current (at-that-World-Cup-year
//                      strength). The TOKEN field ships now so no second token
//                      evolution is ever needed, but the `current` VALUE is
//                      gated on MV2-12b: decode accepts both, encode emits
//                      `career` only, and replay refuses `current` honestly.
//   - `era_preset`   — preset year window over the spin pool. v1 is presets
//                      only (no free range slider); `2026-only` is explicitly
//                      invalid (zero manager cards — cannot complete a draft).
//
// DEFAULTS equal today's shipped behavior exactly: a player who configures
// nothing sees an unchanged spin pool, rating input, replay path and sim
// result (plan §G).

/** Draft flow axis. Default `squad_first` — today's shipped flow. */
export type DraftFlow = "squad_first" | "position_first";

/**
 * Rating basis axis. Default `career`. `current` is schema-valid (token
 * decode accepts it — single token evolution) but NOT materialized until the
 * MV2-12b basis season: encode never emits it and replay refuses it honestly.
 * Owner naming is pinned: never call `current` "Prime".
 */
export type RatingBasis = "career" | "current";

/** Era preset axis. Default `all_time` — the full 1930–2026 pool. */
export type EraPresetId = "all_time" | "post_2000" | "post_2010" | "modern";

/** Resolved year bounds for an era preset (inclusive). */
export interface EraPreset {
  id: EraPresetId;
  /** First tournament year included (inclusive). */
  min_year: number;
  /** Last tournament year included (inclusive). */
  max_year: number;
}

/**
 * The four legal v1 presets with their RESOLVED bounds (plan §B). Tokens carry
 * the resolved bounds alongside the id so a future label/bounds change cannot
 * silently reinterpret old tokens — decode rejects any token whose carried
 * bounds disagree with this table.
 */
export const ERA_PRESETS: Readonly<Record<EraPresetId, EraPreset>> = Object.freeze({
  all_time: Object.freeze({ id: "all_time", min_year: 1930, max_year: 2026 }),
  post_2000: Object.freeze({ id: "post_2000", min_year: 2002, max_year: 2026 }),
  post_2010: Object.freeze({ id: "post_2010", min_year: 2014, max_year: 2026 }),
  modern: Object.freeze({ id: "modern", min_year: 2018, max_year: 2026 }),
} as Record<EraPresetId, EraPreset>);

/** Canonical ordering for UI / iteration (broadest → narrowest). */
export const ERA_PRESET_IDS: readonly EraPresetId[] = Object.freeze([
  "all_time",
  "post_2000",
  "post_2010",
  "modern",
]);

export const DEFAULT_DRAFT_FLOW: DraftFlow = "squad_first";
export const DEFAULT_RATING_BASIS: RatingBasis = "career";
export const DEFAULT_ERA_PRESET: EraPresetId = "all_time";

/** The three config axes as one value (visibility mode `md` stays separate). */
export interface DraftConfig {
  draft_flow: DraftFlow;
  rating_basis: RatingBasis;
  era_preset: EraPresetId;
}

export const DEFAULT_DRAFT_CONFIG: Readonly<DraftConfig> = Object.freeze({
  draft_flow: DEFAULT_DRAFT_FLOW,
  rating_basis: DEFAULT_RATING_BASIS,
  era_preset: DEFAULT_ERA_PRESET,
});

export function isDraftFlow(x: unknown): x is DraftFlow {
  return x === "squad_first" || x === "position_first";
}

export function isRatingBasis(x: unknown): x is RatingBasis {
  return x === "career" || x === "current";
}

export function isEraPresetId(x: unknown): x is EraPresetId {
  return x === "all_time" || x === "post_2000" || x === "post_2010" || x === "modern";
}

/**
 * True iff the config is THE canonical competitive config (owner-ratified:
 * ranked submissions are canonical-config only in v1; the Classic / Memory
 * visibility lanes are a separate, pre-existing axis on the board).
 */
export function isCanonicalDraftConfig(config: DraftConfig): boolean {
  return (
    config.draft_flow === DEFAULT_DRAFT_FLOW &&
    config.rating_basis === DEFAULT_RATING_BASIS &&
    config.era_preset === DEFAULT_ERA_PRESET
  );
}
