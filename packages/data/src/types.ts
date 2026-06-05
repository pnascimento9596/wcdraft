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
// ratings only — surfaces the 388-card honest-state estimate flag) and
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
export const RUNTIME_DATA_SCHEMA_VERSION = "runtime-data-1.0.0" as const;
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

/**
 * Verifiable fingerprint of an emitted bundle file. The builder stamps these
 * into `RuntimeDataManifest.bundles`; the integrity test asserts the on-disk
 * files match.
 */
export interface RuntimeBundleFingerprint {
  /** Path relative to the manifest file (e.g. "draft-pool.compact.json"). */
  path: string;
  /** Hex-encoded sha256 of the file bytes. */
  sha256: string;
  /** Raw byte length on disk. */
  bytes: number;
  /** Gzip-compressed byte length (level 9, smallest, deterministic). */
  bytes_gzip: number;
  /** Brotli-compressed byte length (quality 11, smallest, deterministic). */
  bytes_brotli: number;
}

// ─── Rating wrapper ──────────────────────────────────────────────────────────

/**
 * Runtime rating record. Extends core `Rating` (sim-consumed) with the two
 * historical honest-state fields that 1930–2022 cards carry but 2026 cards
 * do not:
 *
 *  - `overall_basis` — `"measured_performance"` (default) vs.
 *    `"baseline_anchor_estimate"` (388 historical cards where the score is
 *    estimated from an era anchor because tournament-card signals were too
 *    thin to compute directly). The UI surfaces the estimate as a coverage
 *    badge — never silently rendered as a measured number.
 *  - `appearances_source` — RSSSF supplement vs. Fjelstul match events; UI
 *    can disambiguate pre-1970 supplemented appearances vs. native counts.
 *
 * 2026 ratings (`provenance: "projected_career"`) carry neither field; both
 * are emitted as `undefined` so the JSON omits them.
 */
export interface RuntimeRating extends Rating {
  /** Historical only. UI badge for the 388 estimate-anchored ratings. */
  overall_basis?: "measured_performance" | "baseline_anchor_estimate";
  /** Historical only. Provenance of the `appearances` count. */
  appearances_source?: string;
}

// ─── Player card ─────────────────────────────────────────────────────────────

/**
 * Compact runtime player card. Normalizes the schema differences between
 * historical (1930–2022) and 2026 cards into one shape that gameplay code
 * can consume without branching.
 *
 * Historical-only fields (`appearances`, `goals`, `awards`,
 * `appearances_source`) and 2026-only fields (`caps`, `intl_goals`, `club`,
 * `club_nation_code`, `group`, `link_status`) are both `?` — `undefined` is
 * "not applicable for this era". `null` keeps the honest-state "unknown"
 * meaning.
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

  // ── 2026-only signals ─────────────────────────────────────────────────────
  /** International caps before the tournament; null when unknown. */
  caps?: number | null;
  /** International goals before the tournament; null when unknown. */
  intl_goals?: number | null;
  /** Club at squad publication; null when unknown. */
  club?: string | null;
  /** Three-letter country code of the club's nation; null when unknown. */
  club_nation_code?: string | null;
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
  };
  /** Row counts published for fast sanity-checks. */
  counts: {
    player_cards: number;
    manager_cards: number;
    ratings: number;
    teams: number;
    knockout_slots: number;
    /** Historical cards flagged `overall_basis === "baseline_anchor_estimate"` — 388 expected. */
    baseline_anchor_estimate: number;
  };
  /** Full attribution block (UI surface). */
  attribution: RuntimeAttribution;
}
