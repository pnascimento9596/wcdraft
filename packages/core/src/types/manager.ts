// Manager layer of the wcdraft data contract (WS-0c depth layer).
//
// THREE CANONICAL ENTITIES (mirroring the player layer):
//   Manager            — one row per HUMAN coach; STABLE manager_id across
//                         tournaments (the output of WS-A manager-resolution).
//   ManagerTournament  — the DRAFTABLE MANAGER CARD; identity =
//                         (manager_id, tournament_id). The nation MANAGED
//                         in this tournament may differ from the manager's
//                         own nationality (e.g. Parreira M-311 managed Brazil
//                         AND Saudi Arabia / Kuwait / South Africa / UAE
//                         across his six World Cups — one manager_id, many
//                         manager_card_ids).
//   ManagerRating      — per-card numeric rating (per-card so a manager's
//                         contribution depends on the tournament context).
//
// CARDINAL RULE: `Manager.nation_id` is the manager's OWN nationality (display
// + ER aid). The nation a manager MANAGES at a given tournament lives on the
// CARD (`ManagerTournament.nation_id`) — never derive managed nation from
// `Manager.nation_id`. This mirrors the Player vs PlayerTournament split.
//
// RATING SHAPE — HONEST: WS-B/WS-A-rating computes a composite from
// `pedigree` (results: titles, deep runs, knockout wins) and `experience`
// (tournament count, matches, longevity). We INTENTIONALLY do NOT publish a
// `tactics` dimension — no historical source measures it without invention.
// The two-dimension shape is the contract; the formula + weights are WS-B.

import type { SourceRef } from "./primitives.js";

// ─── MANAGER CARD ID BRAND + HELPERS ─────────────────────────────────────────
//
// `ManagerCardId` mirrors `CardId` from `identity.ts` — same composite-key
// shape, same branding pattern, parsed on the LAST colon so a future
// manager_id containing ':' parses correctly.
//
// IMPORTANT: ManagerCardId is a SEPARATE brand from CardId. A function that
// expects a player `CardId` must not accept a `ManagerCardId` (and vice
// versa) — the brand prevents the mix-up at compile time.

/**
 * Branded manager card ID. Runtime shape is always
 * `${manager_id}:${tournament_id}`; use `buildManagerCardId` to construct and
 * `parseManagerCardId` to destructure.
 */
export type ManagerCardId = string & { readonly __wcdraftManagerCardIdBrand: "ManagerCardId" };

/** Same separator as player CardId, kept private to the module. */
const MANAGER_CARD_ID_SEPARATOR = ":";

/**
 * Construct a `ManagerCardId` from its atomic parts.
 *
 * @throws RangeError if `manager_id` is empty/whitespace, or if
 *   `tournament_id` is not a positive safe integer.
 *
 * This is the ONLY supported constructor — never mint a `ManagerCardId` by
 * casting a raw string. Boundary schemas re-validate equality with this
 * helper, so a mismatched persisted manager_card_id fails parse.
 */
export function buildManagerCardId(manager_id: string, tournament_id: number): ManagerCardId {
  if (typeof manager_id !== "string" || manager_id.trim().length === 0) {
    throw new RangeError("buildManagerCardId requires a non-empty manager_id");
  }
  if (!Number.isSafeInteger(tournament_id) || tournament_id <= 0) {
    throw new RangeError(
      `buildManagerCardId requires a positive safe integer tournament_id, received: ${tournament_id}`,
    );
  }
  return `${manager_id}${MANAGER_CARD_ID_SEPARATOR}${tournament_id}` as ManagerCardId;
}

/**
 * Parse a `ManagerCardId` (or a candidate string) into its atomic parts.
 * Returns `null` for any input that does not match the canonical format with
 * a non-empty `manager_id` and a positive safe integer `tournament_id`.
 * Splits on the LAST colon so manager_ids that contain colons round-trip
 * cleanly.
 *
 * Non-throwing on purpose: keeps zod refinements simple (no try/catch).
 */
export function parseManagerCardId(
  manager_card_id: string | ManagerCardId,
): { manager_id: string; tournament_id: number } | null {
  if (typeof manager_card_id !== "string" || manager_card_id.length === 0) return null;
  const idx = manager_card_id.lastIndexOf(MANAGER_CARD_ID_SEPARATOR);
  if (idx <= 0 || idx >= manager_card_id.length - 1) return null;
  const manager_id = manager_card_id.slice(0, idx);
  const tournament_id_str = manager_card_id.slice(idx + 1);
  if (manager_id.trim().length === 0) return null;
  // Reject leading-zero or signed tournament strings — round-trip stable.
  if (!/^[1-9]\d*$/.test(tournament_id_str)) return null;
  const tournament_id = Number(tournament_id_str);
  if (!Number.isSafeInteger(tournament_id) || tournament_id <= 0) return null;
  return { manager_id, tournament_id };
}

// ─── MANAGER ─────────────────────────────────────────────────────────────────

/**
 * Canonical Manager entity. ONE row per human, regardless of how many
 * tournaments or nations they coached. `manager_id` is the output of WS-A's
 * manager-resolution pipeline and MUST be stable across tournament editions.
 *
 * The classic multi-nation manager is Carlos Alberto Parreira (manager_id
 * "M-311" in the current ETL output) — six World Cups across five different
 * national federations. ONE `manager_id`, many `manager_card_id`s. The golden
 * test in `manager-identity.golden.test.ts` asserts this invariant.
 */
export interface Manager {
  /** Stable canonical PK across tournaments. */
  manager_id: string;
  /** Full given name as recorded. */
  full_name: string;
  /**
   * Manager's OWN nationality (display + ER aid). NEVER the nation managed at
   * any given tournament — for that, read `ManagerTournament.nation_id`.
   * Non-nullable in the schema because recon explicitly confirms nationality
   * for every manager before a `Manager` row is emitted.
   */
  nation_id: string;
  /** ISO-8601 date (YYYY-MM-DD), or null when unknown. */
  birth_date: string | null;
  /** Source citations supporting the record. */
  sources: SourceRef[];
}

// ─── MANAGER TOURNAMENT (THE DRAFTABLE MANAGER CARD) ─────────────────────────

/**
 * ManagerTournament — the DRAFTABLE MANAGER CARD. Identity is
 * `(manager_id, tournament_id)`, surfaced as `manager_card_id` for gameplay
 * paths that want a single string key.
 *
 * GAMEPLAY INVARIANTS:
 *  - `nation_id` is AUTHORITATIVE for what NATION this manager was managing
 *    at this tournament. NEVER read managed-nation from the underlying
 *    `Manager.nation_id` (which is the manager's own nationality).
 *  - One (manager_id, tournament_id) pair per row; the same manager_id can
 *    appear in many ManagerTournament rows across years.
 *
 * HONEST STATE:
 *  - `matches` is `null` for tournaments where the source does not record a
 *    manager-level match count (older eras), and an integer otherwise.
 *  - `final_placement` is `null` when the manager's nation did not reach the
 *    knockout final stages or when placement is unknown; integer otherwise.
 *  - Both fields obey the project-wide honest-state rule (NEVER coerce to 0).
 */
export interface ManagerTournament {
  /**
   * Derived, stable composite key: `${manager_id}:${tournament_id}`. Computed
   * once at ETL time via `buildManagerCardId(manager_id, tournament_id)`;
   * treated as the gameplay key everywhere downstream. Branded
   * `ManagerCardId` — never assign a raw string.
   */
  manager_card_id: ManagerCardId;
  /** FK -> Manager. The same manager_id appears across multiple ManagerTournaments. */
  manager_id: string;
  /** FK -> Tournament. */
  tournament_id: number;
  /**
   * FK -> Nation. AUTHORITATIVE managed nation for THIS tournament. Never
   * derive managed nation from `Manager.nation_id` (which is the manager's
   * own nationality).
   */
  nation_id: string;
  /**
   * Matches the manager coached at this tournament; `null` when unknown.
   * NEVER coerce a missing match count to 0.
   */
  matches: number | null;
  /**
   * Final placement of the team managed at this tournament (1 = champion,
   * 2 = runner-up, etc.); `null` when unknown or did not finish in a placed
   * position.
   */
  final_placement: number | null;
  /** Source citations supporting the card record. */
  sources: SourceRef[];
}

// ─── MANAGER RATING ──────────────────────────────────────────────────────────

/**
 * Per-card manager rating. Identity is the owning manager card
 * (`manager_card_id`); `manager_id` and `tournament_id` are denormalized for
 * downstream joins.
 *
 * RATING SHAPE — HONEST:
 *  - `overall` is the DISPLAY-ONLY composite of the two dimensions; may be
 *    `null` when coverage is insufficient (honest-state rule applies).
 *  - `dimensions.pedigree` (0..100) — composite of results signals: titles,
 *    deep runs, knockout wins, win share. NOT a measured "trophy count".
 *  - `dimensions.experience` (0..100) — composite of longevity signals:
 *    tournament count, total matches, recency. NOT a measured "tactics".
 *  - We INTENTIONALLY publish only `pedigree` and `experience`. A "tactics"
 *    dimension would require fabrication and is excluded.
 *
 * The dimension values are placeholders here; WS-A-rating calibrates and
 * locks them via the manager-rating golden test in WS-B.
 */
export interface ManagerRating {
  /**
   * FK -> ManagerTournament. Branded `ManagerCardId` — must equal
   * `buildManagerCardId(manager_id, tournament_id)`. Schema refinement
   * enforces.
   */
  manager_card_id: ManagerCardId;
  /** Denormalized FK -> Manager. */
  manager_id: string;
  /** Denormalized FK -> Tournament. */
  tournament_id: number;
  /**
   * DISPLAY-ONLY composite. `null` when coverage is insufficient.
   *
   * HARD CONTRACT: the sim MUST NOT read this field. The
   * `managerBandModifier` fold in `engine/team-strength.ts` is driven by the
   * sim-legal `SynergyResult.manager_link` field, not by this display channel.
   * Re-introducing a `manager.overall` read here would silently couple sim
   * behavior to a display channel (curves, normalization, display rescaling all
   * flow through `overall`). Locked by `manager-modifier-decoupling.guard.test.ts`.
   */
  overall: number | null;
  /**
   * Honest two-dimension rating surface. Each in `[0, 100]`. Neither maps to
   * a "tactics" or "trophy count" — both are composites of factual signals
   * derived from `ManagerTournament` rows.
   */
  dimensions: {
    /** 0..100 composite of results signals (titles, deep runs, knockout wins). */
    pedigree: number;
    /** 0..100 composite of longevity signals (tournament count, matches, recency). */
    experience: number;
  };
  /**
   * Which factual signals contributed + their weights — same open-vocab
   * shape as `RatingComponent` for players (transparency aid).
   */
  components: Array<{ signal: string; value: number | null; weight: number }>;
  /** Honest-state coverage fraction in [0,1] for this rating. */
  coverage: number;
  /**
   * Denominator basis for `coverage` —
   *   'wc_signals'      → tournament-card signals (used for 1930..2022 cards)
   *   'career_signals'  → offline career-aggregate inputs (rare for managers
   *                        but reserved for parity with player rating)
   */
  coverage_basis: "wc_signals" | "career_signals";
  /**
   * Whether the rating was derived from real WC management signals or
   * projected from career aggregates (rare for managers; reserved for parity).
   */
  provenance: "wc_performance" | "projected_career";
  /** Rating-algorithm version anchor — one of the three replay anchors. */
  rating_version: string;
}
