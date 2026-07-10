// Runtime data contracts published by `@wcdraft/data`.
//
// The compact bundles in `src/generated/` are emitted by the deterministic
// builder (`scripts/build-compact-data.mjs`) from the committed ETL output.
// At the runtime boundary, these are the types web / core consumers see —
// the upstream ETL JSON is NEVER imported by `apps/web` directly.
//
// Two shape rules drive every field below:
//
//   1. RUNTIME ID REWRITE — ETL emits `tournament_id` as the legacy string
//      `"WC-YYYY"`. Runtime cards carry the numeric `YYYY` everywhere, with
//      `card_id` / `manager_card_id` rebuilt via `buildCardId(player_id,
//      YYYY)` / `buildManagerCardId(manager_id, YYYY)`. The source strings
//      are preserved on every record as `source_tournament_id` /
//      `source_card_id` / `source_manager_card_id` for audit; they MUST NOT
//      be used by gameplay code.
//
//   2. HONEST STATE — `overall`, `appearances`, `goals`, `caps`,
//      `intl_goals`, `matches`, `final_placement` all stay `null` when the
//      upstream source did not record them. NEVER coerce to 0.
//
// `RuntimeRating` extends the core `Rating` with `overall_basis?` (historical
// ratings only — surfaces the baseline-anchor honest-state estimate flag) and
// `appearances_source?` (historical ratings only — RSSSF supplement vs.
// Fjelstul match-events provenance).

import type {
  CardId,
  ManagerCardId,
  Rating,
  Position,
  Award,
  SourceRef,
  GroupId,
  Slot,
  KnockoutOpponentRule,
} from "@wcdraft/core";

// ─── Schema version anchor ───────────────────────────────────────────────────
//
// `RuntimeDataManifest.schema_version` is the version of the RUNTIME-DATA
// contract (this file). It is independent from `dataset_version` (ETL output
// revision), `rating_version` (rating algorithm), `engine_version` (sim
// engine), and `ruleset_version` (scoring/scenario rules).
//
// Bumping this string is the contract-break signal that invalidates persisted
// `RunRecord`s and PWA caches.
// runtime-data-2.9.0 (spin-agency): player-pick replay changes from card-id
// picks to deterministic choose-from-3 choice indices.
// runtime-data-2.8.0 (merit-v4.6): manual override display pins remain exact,
// but their internal score/channel inputs are curve-inverted onto the natural
// display scale.
// runtime-data-2.7.0 (merit-v4.5): conservative recovery of 36 previously
// unresolved merit-v4.3 owner rows into the Career+Current pin path.
// runtime-data-2.6.0 (merit-v4.4): owner re-rate of the 85–90 CURRENT-basis band.
// The compact `basis_ratings.current` overall/channels move for the re-rated
// cards; the Career/default basis (top-level overall/channels) is unchanged.
// runtime-data-2.5.0 (merit-v4.3): owner-authored manual rating overrides can
// pin display OVERALL below the merit display floor while staying in [0, 99].
// runtime-data-2.4.0 (merit-v4.2): measured/projected ratings may occupy the
// wider [60, 99] display band after public factual context declustering; the
// baseline-anchor estimate band remains [66, 73].
// runtime-data-2.3.0 (merit-v4.1): schema-compatible season bump for expanded
// objective-achievement coverage, rating 6.1/5.1 anchors, and a new replay season.
// runtime-data-2.3.0 (merit-v4.1): schema-compatible data bump for the
// career-stature-4.1.0 / rating 6.1 family outputs.
// runtime-data-2.0.0 (merit-v3 V6): every compact rating now carries both
// basis ratings (`career` + `current`) and the runtime replay shape includes
// the draft-config axes introduced in runtime-data-1.2.0. The legacy `ratings`
// array remains the Career alias until the product toggle ships.
export const RUNTIME_DATA_SCHEMA_VERSION = "runtime-data-2.9.0" as const;
export type RuntimeDataSchemaVersion = typeof RUNTIME_DATA_SCHEMA_VERSION;

// ─── Source revisions + attribution ──────────────────────────────────────────

/**
 * Pinned identity of an upstream source, captured at ETL time. The runtime
 * carries this through verbatim so the UI can render attribution and so
 * the audit trail for any compact record is traceable to a snapshot.
 */
export interface RuntimeSourceRevision {
  /** Source family (e.g. "fjelstul", "wikipedia-2026-squads", "rsssf"). */
  source_id: string;
  /** Human-readable label for UI attribution. */
  label: string;
  /** License (typically "CC-BY-SA 4.0"). */
  license: string;
  /** License URL. */
  license_url: string;
  /** Pinned snapshot identifier — commit SHA, Wikipedia oldid, etc. */
  revision: string;
  /** Public source URL (repo, page URL). */
  url: string;
  /** ISO-8601 date when the snapshot was retrieved. */
  retrieved_date: string | null;
}

/**
 * Full attribution block — what the UI renders and what we redistribute under
 * CC-BY-SA 4.0. The `not_affiliated_disclaimer` is the explicit, prominent
 * disclosure required by the brief.
 */
export interface RuntimeAttribution {
  /** Long-form combined attribution paragraph. */
  combined_attribution: string;
  /** Per-source revision blocks. */
  sources: RuntimeSourceRevision[];
  /** License URL for the redistributed compact bundles (CC-BY-SA 4.0). */
  redistributed_license: string;
  /** Redistributed-license URL. */
  redistributed_license_url: string;
  /** Modification text — what wcdraft did to the upstream data. */
  modifications: string;
  /** Not-affiliated disclaimer. */
  not_affiliated_disclaimer: string;
}

// ─── Bundle hash/size record ─────────────────────────────────────────────────

/** Legacy fingerprint fields present since `runtime-data-2.9.0` was published. */
export interface RuntimeBundleFingerprintCore {
  /** Path relative to the manifest file (e.g. "draft-pool.compact.json"). */
  path: string;
  /** Compatibility alias for raw_sha256. */
  sha256: string;
  /** Raw byte length on disk. */
  bytes: number;
  /** Gzip-compressed byte length (level 9, smallest, deterministic). */
  bytes_gzip: number;
  /** Compatibility alias for compressed_bytes; exact, never bucketed. */
  bytes_brotli: number;
}

/**
 * Exact materialization metadata added after the first `runtime-data-2.9.0`
 * manifest was published. These fields are an all-or-none group on the wire.
 */
export interface RuntimeBundleMaterializationMetadata {
  /** Hex-encoded SHA-256 of the canonical raw JSON bytes. */
  raw_sha256: string;
  /** Hex-encoded SHA-256 of the canonical `${path}.br` bytes. */
  compressed_sha256: string;
  /** Exact byte length of the canonical `${path}.br` artifact. */
  compressed_bytes: number;
  /** Brotli implementation version that produced the canonical artifact. */
  brotli_impl_version: string;
  /** Fully explicit q11 materialization options. */
  options: {
    quality: 11;
    mode: "text";
    size_hint: number;
  };
}

/** Exact fingerprint emitted by current builders and required by build/copy gates. */
export interface MaterializedRuntimeBundleFingerprint
  extends RuntimeBundleFingerprintCore, RuntimeBundleMaterializationMetadata {}

/**
 * Fingerprint shape accepted from the already-published pre-materialization
 * manifest. Unknown materialization facts stay absent rather than fabricated.
 */
export interface LegacyRuntimeBundleFingerprint extends RuntimeBundleFingerprintCore {
  raw_sha256?: undefined;
  compressed_sha256?: undefined;
  compressed_bytes?: undefined;
  brotli_impl_version?: undefined;
  options?: undefined;
}

/**
 * Browser-visible bundle fingerprint. Current manifests carry the complete
 * materialization block; the original `runtime-data-2.9.0` payload carries
 * only the legacy core. Runtime parsing rejects every partial combination.
 */
export type RuntimeBundleFingerprint =
  | LegacyRuntimeBundleFingerprint
  | MaterializedRuntimeBundleFingerprint;

// ─── Reference score distribution ────────────────────────────────────────────

/**
 * Schema version of the shipped reference score-distribution artifact
 * (`score-distribution.compact.json`). Independent of the runtime-data schema:
 * this versions the TABLE SHAPE, while staleness relative to the engine/data
 * is governed by `ScoreDistribution.anchors`.
 */
export const SCORE_DISTRIBUTION_SCHEMA_VERSION = "score-distribution-1.0.0" as const;
export const DAILY_SEED_SALT_MAP_SCHEMA_VERSION = "daily-seed-salt-map-1.0.0" as const;
/**
 * Daily-v1 builder policy. Candidate 0 is unsalted; later candidates use
 * suffixes 2 through this inclusive upper bound. Runtime validation shares
 * this bound so historical local records cannot smuggle arbitrary suffixes
 * when their original rolling salt map is no longer available.
 */
export const DAILY_SEED_MAX_SALT_ATTEMPTS = 8 as const;

/**
 * Anchors stamped into the score-distribution artifact at generation time.
 * They must equal the current `RuntimeDataManifest` values (enforced by the
 * golden test in CI and re-checked against the run record's versions at
 * display time) so a shipped table can never be applied to a score it does
 * not describe.
 */
export interface ScoreDistributionAnchors {
  dataset_version: string;
  engine_version: string;
  rating_version_historical: string;
  rating_version_projected: string;
  ruleset_version: string;
  /** sha256 of the draft-pool bundle the ensemble drafted from. */
  draft_pool_sha256: string;
  /** sha256 of the 2026 scenario bundle the ensemble simulated against. */
  scenario_2026_sha256: string;
}

/**
 * Compact reference run-score distribution: nearest-rank percentile → score
 * breakpoints (`quantiles[p]` for p = 0..100, inclusive endpoints) over the
 * deterministic strategicAutoDraft ensemble pinned by the asym-realism golden.
 * This is a reference population of SIMULATED drafts on this engine — never
 * a population of human players. Display copy must keep that distinction.
 */
export interface ScoreDistribution {
  schema_version: typeof SCORE_DISTRIBUTION_SCHEMA_VERSION;
  _doc: string;
  anchors: ScoreDistributionAnchors;
  population: {
    policy: string;
    seed_prefix: string;
    runs: number;
    qualifying_runs: number;
    mean: number;
    median: number;
    p95: number;
    min: number;
    max: number;
  };
  /** 101 nondecreasing integer score breakpoints, q[0] = min … q[100] = max. */
  quantiles: number[];
}

// ─── Daily seed salt map ────────────────────────────────────────────────────

export type DailySeedSaltMapAnchors = ScoreDistributionAnchors;

export interface DailySeedVettingBand {
  easy_perfect_rate_gte: number;
  easy_qualifying_rate_gte: number;
  cruel_qualifying_rate_lte: number;
  cruel_median_score_lte: number;
  cruel_median_source: string;
}

export interface DailySeedVettingMetrics {
  date: string;
  salt: number;
  seed: string;
  sample_seed_prefix: string;
  selected: boolean;
  degenerate: boolean;
  reason: "normal" | "easy_perfect" | "easy_qualifying" | "cruel_qualifying" | "cruel_median";
  runs: number;
  perfect_runs: number;
  perfect_rate: number;
  qualifying_runs: number;
  qualifying_rate: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  exact_seed_score: number;
  exact_seed_qualified: boolean;
  exact_seed_perfect: boolean;
}

/**
 * Versioned, committed map for UTC Daily Draft seed salting. `salts` stores
 * only non-zero dates; absent means unsalted and resolves to the base
 * `wcdraft:daily:v1:<YYYY-MM-DD>` seed. A salt value of `2` resolves to
 * `wcdraft:daily:v1:<date>#2`.
 */
export interface DailySeedSaltMap {
  schema_version: typeof DAILY_SEED_SALT_MAP_SCHEMA_VERSION;
  _doc: string;
  anchors: DailySeedSaltMapAnchors;
  window: {
    start_date: string;
    days: number;
    timezone: "UTC";
  };
  policy: "greedyOverallAutoDraft";
  population: {
    runs_per_candidate: number;
    max_salt_attempts: number;
    sample_seed_suffix: string;
  };
  degeneracy_band: DailySeedVettingBand;
  /** date -> salt suffix; absent/default is 0 (unsalted). */
  salts: Record<string, number>;
  dates: DailySeedVettingMetrics[];
}

// ─── Rating wrapper ──────────────────────────────────────────────────────────

/**
 * Runtime rating record. Extends core `Rating` (sim-consumed) with the two
 * historical honest-state fields that 1930–2022 cards carry but 2026 cards
 * do not:
 *
 *  - `overall_basis` — `"measured_performance"` (default),
 *    `"baseline_anchor_estimate"` (386 historical cards where the score is
 *    estimated from an era anchor because tournament-card signals were too
 *    thin to compute directly), or `"career_stature_estimate"` (a card whose
 *    score is carried by the dominant career-stature path — MV2-4.1 basis
 *    tag). The UI surfaces an estimate as a coverage badge — never silently
 *    rendered as a measured number.
 *  - `appearances_source` — RSSSF supplement vs. Fjelstul match events; UI
 *    can disambiguate pre-1970 supplemented appearances vs. native counts.
 *
 * 2026 ratings (`provenance: "projected_career"`) carry neither field; both
 * are emitted as `undefined` so the JSON omits them. `legend` (below) is
 * carried by BOTH eras and is required as of runtime-data-2.0.0.
 */
export interface RuntimeBasisRating extends Rating {
  /** Historical only. UI badge for estimate-anchored ratings. */
  overall_basis?: "measured_performance" | "baseline_anchor_estimate" | "career_stature_estimate";
  /** Historical only. Provenance of the `appearances` count. */
  appearances_source?: string;
  /**
   * Source-derived "legend" flag (MV2-7 contract, MV2-10 data). Display/
   * honest-state only — NEVER a sim input, never crosses the `Rating` sim
   * boundary. REQUIRED as of runtime-data-2.0.0: the compact passthrough is
   * wired and every rating row (historical + 2026) carries the ETL-joined
   * flag, so it is the source of truth for the gold legend badge. An explicit
   * `false` SUPPRESSES legend styling even for an OVR≥96 card (the UI's
   * `legend ?? OVR≥96` fallback in `provenanceBadgeKind` now only guards
   * pre-1.1.0 data shapes).
   */
  legend: boolean;
  /**
   * Basis metadata emitted by merit-v3 ETL. Present on rows inside
   * `rating_by_card_id_by_basis`; omitted/ignored by legacy consumers that
   * read the Career alias from `ratings`.
   */
  basis_metadata?: {
    basis: "career" | "current";
    rating_version: string;
    score_0_100: number;
    [key: string]: unknown;
  };
}

export interface RuntimeRating extends RuntimeBasisRating {
  /**
   * Additional basis ratings for this card. The containing `RuntimeRating`
   * row is the Career basis compatibility alias; `basis_ratings.current`
   * carries the Current basis without duplicating the Career row.
   */
  basis_ratings: {
    current: RuntimeBasisRating;
  };
}

// ─── Player card ─────────────────────────────────────────────────────────────

/**
 * Compact runtime player card. Normalizes the schema differences between
 * historical (1930–2022) and 2026 cards into one shape that gameplay code
 * can consume without branching.
 *
 * Historical-only fields (`appearances`, `goals`, `awards`,
 * `appearances_source`) and projection-only fields (`club`, `group`,
 * `link_status`) are `?` — `undefined` is "not applicable for this era".
 * `caps`, `intl_goals`, and `club_nation_code` are present for 2026 rows and
 * for historical rows whose pinned squad-list facts resolve unambiguously.
 * `null` keeps the honest-state "unknown" meaning.
 *
 * `rating` is the per-card `RuntimeRating`; the builder fails loudly if a
 * draftable card is missing one.
 */
export interface RuntimePlayerCard {
  /** Branded runtime card ID — `buildCardId(player_id, YYYY)`. */
  card_id: CardId;
  /** Stable player ID. */
  player_id: string;
  /** Numeric YYYY tournament ID (e.g. 1998, 2026). */
  tournament_id: number;
  /** Representing nation FK at this tournament. */
  nation_id: string;
  /** Display name (short form). */
  common_name: string;
  /** Full given name. */
  full_name: string;
  /** Career-primary position from the underlying player record. */
  primary_position: Position;
  /** Per-card eligibility (may differ from career-wide eligibility). */
  eligible_positions: Position[];
  /** ISO-8601 birth date, or null when unknown. */
  birth_date: string | null;
  /** Listed position at the tournament; null when unknown. */
  position_listed: Position | null;
  /** Shirt number worn; null when unknown. */
  shirt_number: number | null;
  /** Club at the time of this tournament; null when unknown. */
  club_at_tournament: string | null;
  /**
   * Was this player the captain at this tournament? `null` when unknown
   * (common pre-1970, common in 2026 projection sources too).
   */
  captain: boolean | null;
  /** Honest-state coverage fraction in [0,1]. */
  coverage: number;

  // ── Historical-only signals ───────────────────────────────────────────────
  /** Match appearances; null when unknown (always null pre-1970 native). */
  appearances?: number | null;
  /** Goals at this tournament; null when unknown. */
  goals?: number | null;
  /** Tournament awards held by this card; `[]` confirmed-none, `null` unknown. */
  awards?: Award[] | null;
  /** Appearances-count provenance ("rsssf_supplement", "fjelstul_match_events", ...). */
  appearances_source?: string;

  // ── Squad-list career/context signals ─────────────────────────────────────
  /** International caps before the tournament; null when unknown. */
  caps?: number | null;
  /** International goals before the tournament; null when unknown. */
  intl_goals?: number | null;
  /** Three-letter country code of the club's nation; null when unknown. */
  club_nation_code?: string | null;

  // ── 2026-only signals ─────────────────────────────────────────────────────
  /** Club at squad publication; null when unknown. */
  club?: string | null;
  /** Wikipedia-letter group bucket (A..L); null when unknown. */
  group?: GroupId | null;
  /** Entity-link status ("linked", "unlinked", "ambiguous"); null when unknown. */
  link_status?: string | null;

  // ── Audit fields ──────────────────────────────────────────────────────────
  /** Original ETL `card_id` (e.g. "P-12345:WC-2026"). Audit only. */
  source_card_id: string;
  /** Original ETL `tournament_id` string (e.g. "WC-2026"). Audit only. */
  source_tournament_id: string;
  /** Per-card source citations. */
  sources: SourceRef[];
}

// ─── Manager card / tournament ───────────────────────────────────────────────

/**
 * Compact runtime manager. Identity is per-tournament, mirroring
 * `RuntimePlayerCard`. Manager rating is OMITTED unless WS-A-rating publishes
 * one — never fabricated; consumers must handle "rating unavailable".
 */
export interface RuntimeManagerCard {
  /** Branded runtime manager card ID — `buildManagerCardId(manager_id, YYYY)`. */
  manager_card_id: ManagerCardId;
  /** Stable manager ID. */
  manager_id: string;
  /** Numeric YYYY tournament ID. */
  tournament_id: number;
  /** AUTHORITATIVE managed nation for THIS tournament. */
  nation_id: string;
  /** Display name (short form). */
  common_name: string;
  /** Full given name. */
  full_name: string;
  /** Manager's OWN nationality (display / ER aid only). */
  own_nation_id: string;
  /** ISO-8601 birth date, or null when unknown. */
  birth_date: string | null;
  /** Matches coached at this tournament; null when unknown. */
  matches: number | null;
  /** Final placement (1 = champion, …); null when unknown. */
  final_placement: number | null;
  /** Original ETL `manager_card_id`. Audit only. */
  source_manager_card_id: string;
  /** Original ETL `tournament_id` string. Audit only. */
  source_tournament_id: string;
  /** Per-card source citations. */
  sources: SourceRef[];
}

/**
 * `RuntimeManagerTournament` is the per-tournament managerial record without
 * any rating wrapper — kept as a separate name so the UI can refer to the
 * draftable manager card and the underlying tournament context distinctly.
 * In practice they are the same compact row.
 */
export type RuntimeManagerTournament = RuntimeManagerCard;

// ─── Draft pool bundle ───────────────────────────────────────────────────────

/**
 * `DraftPoolBundle` — the full draftable pool 1930–2026.
 *
 * Lookup-by-id is the consumer's responsibility; arrays here are canonically
 * sorted (`card_id` lexicographic ascending for players; `manager_card_id`
 * lexicographic ascending for managers) so two builds emit byte-identical
 * JSON.
 */
export interface DraftPoolBundle {
  /** Schema-version anchor. */
  schema_version: RuntimeDataSchemaVersion;
  /** All draftable player cards, sorted by `card_id`. */
  player_cards: RuntimePlayerCard[];
  /** All draftable manager cards, sorted by `manager_card_id`. */
  manager_cards: RuntimeManagerCard[];
  /** Per-card ratings, sorted by `card_id`. */
  ratings: RuntimeRating[];
  /**
   * Convenience lookup table: `card_id` → `nation_id`. This is the data the
   * sim/synergy paths need without joining `player_cards`. Built once at
   * package-data time; keys sorted lexicographically.
   */
  nation_by_card_id: Record<string, string>;
  /**
   * Convenience lookup: `manager_card_id` → `nation_id`. Mirrors
   * `nation_by_card_id` for managers.
   */
  nation_by_manager_card_id: Record<string, string>;
  /**
   * Per-tournament summary: numeric YYYY → {name, year}. Lets the UI
   * label cards by tournament without holding the full Tournament rows.
   * Keys are stringified YYYY (JSON object semantics).
   */
  tournaments: Record<string, { year: number; name: string }>;
  /**
   * Canonical nation lookup: `nation_id` → display name + 3-letter code.
   * Sorted by key.
   */
  nations: Record<string, { canonical_name: string; code: string | null }>;
}

// ─── Scenario 2026 bundle ────────────────────────────────────────────────────

/**
 * `Scenario2026Bundle` — the real 2026 opponents and bracket metadata.
 * Teams + bracket are pulled through verbatim from the ETL output (with the
 * `WC-YYYY` → numeric rewrite applied to `squad_card_ids`); the
 * `team_display_names` map is the only derived field — it lets the results
 * adapter render opponent names without joining `nations`.
 */
export interface Scenario2026Bundle {
  schema_version: RuntimeDataSchemaVersion;
  /** Numeric 2026 tournament_id (always 2026). */
  tournament_id: number;
  /** Format-version anchor of the published 2026 bracket. */
  format_version: string;
  /** Group labels (A..L) → ordered `team_id[]`. */
  groups: Array<{ group_id: GroupId; team_ids: string[] }>;
  /** All 48 published knockout slots (R32 → F). */
  knockout_slots: Slot[];
  /** All 48 real 2026 teams; canonically sorted by `team_id`. */
  teams: Array<{
    team_id: string;
    nation_id: string;
    group: GroupId;
    group_slot: number;
    squad_card_ids: CardId[];
    aggregate_rating: {
      attack: number;
      midfield: number;
      defense: number;
      goalkeeping: number;
      coverage: number;
    };
    squad_status: "projected" | "locked" | "final";
    rating_version: string;
    sources: SourceRef[];
  }>;
  /** `team_id` → display name (from nations + nations_2026). */
  team_display_names: Record<string, string>;
  /**
   * Default knockout-opponent rule for the scoped scenario. The actual
   * `RunScenario` is built by `@wcdraft/core` (scenario builder lands in I3);
   * this is the bundle-default the builder seeds from.
   */
  default_knockout_opponent_rule: KnockoutOpponentRule;
}

// ─── Manifest ────────────────────────────────────────────────────────────────

/**
 * `RuntimeDataManifest` — top-level manifest published alongside the compact
 * bundles. Carries the five version anchors required for replay
 * determinism plus per-bundle fingerprints and full attribution.
 *
 * `dataset_version` reflects the ETL output revision (date-keyed string from
 * the build invocation), `rating_version_*` capture the two coexisting rating
 * algorithms (historical `wc-perf-x.y.z` + projected `proj-career-x.y.z`),
 * and `engine_version`/`ruleset_version` are stamped here so a stored
 * `RunRecord` can detect version-anchor mismatches and self-evict.
 */
export interface RuntimeDataManifest {
  schema_version: RuntimeDataSchemaVersion;
  /** Date-keyed dataset version (e.g. "2026-06-04"). */
  dataset_version: string;
  /** Rating version for historical cards (e.g. "wc-perf-1.1.0"). */
  rating_version_historical: string;
  /** Rating version for projected 2026 cards (e.g. "proj-career-1.0.0"). */
  rating_version_projected: string;
  /** Sim-engine version anchor; mirrored into persisted `RunRecord`. */
  engine_version: string;
  /** Scoring/scenario ruleset version. */
  ruleset_version: string;
  /** Per-bundle file fingerprints (paths relative to manifest). */
  bundles: {
    draft_pool: RuntimeBundleFingerprint;
    scenario_2026: RuntimeBundleFingerprint;
    /**
     * Fingerprint of the shipped reference score-distribution artifact.
     * OPTIONAL: absent on manifests built before the artifact existed and
     * while the artifact is mid-regeneration; consumers must degrade to
     * "standing unknown" (omit the line), never fabricate.
     */
    score_distribution?: RuntimeBundleFingerprint;
    /**
     * Fingerprint of the committed Daily Draft seed salt map. OPTIONAL only
     * for old manifests; current builds stamp it when anchors match.
     */
    daily_seed_salt_map?: RuntimeBundleFingerprint;
  };
  /** Row counts published for fast sanity-checks. */
  counts: {
    player_cards: number;
    manager_cards: number;
    ratings: number;
    teams: number;
    knockout_slots: number;
    /** Historical cards flagged `overall_basis === "baseline_anchor_estimate"` — 386 expected. */
    baseline_anchor_estimate: number;
    /** Cards flagged `overall_basis === "career_stature_estimate"` (MV2-4.1 basis tag). */
    career_stature_estimate: number;
    /** Ratings carrying `legend: true` (merit-v3 V6 census) — 295 expected. */
    legend: number;
    /** Basis-specific census locks for runtime-data-2.0.0. */
    rating_basis: {
      career: {
        ratings: number;
        baseline_anchor_estimate: number;
        career_stature_estimate: number;
      };
      current: {
        ratings: number;
        baseline_anchor_estimate: number;
        career_stature_estimate: number;
      };
    };
  };
  /** Full attribution block (UI surface). */
  attribution: RuntimeAttribution;
}
