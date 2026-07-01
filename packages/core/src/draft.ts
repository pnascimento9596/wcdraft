// ENGINE-V2 E-1 — the deterministic 17-spin DRAFT state machine, era-weighted
// + with-replacement + rare exposure.
//
// This is the runtime that fills the WS-0c draft contract declared in
// `types/draft.ts` + `schemas/draft.ts`. It is PURE and DETERMINISTIC: the only
// entropy is the seeded RNG (`createRng` over the `"draft"` substream sub-seed
// from `deriveSubseed`). No Date / Math.random / crypto anywhere — the
// determinism lint guard enforces this across `packages/core/src`.
//
// ─── THE 17 SPINS (ENGINE-V2 E-1) ────────────────────────────────────────────
//   - Each spin is an INDEPENDENT, ERA-WEIGHTED, WITH-REPLACEMENT weighted
//     draw over ALL (tournament_id, nation_id) pairs in the catalog. The same
//     (T, N) MAY be drawn on more than one spin; the old WS-0c pair-once rule
//     is gone.
//   - ERA WEIGHTING is a YEAR-level allocation, then UNIFORM-within-year over
//     the pairs of that year:
//       - rare years (year < `RARE_YEAR_CUTOFF` = 1998) receive a flat
//         `RARE_ERA_MASS` (10%) of total per-spin probability;
//       - modern years (year >= 1998) receive `MODERN_ERA_MASS` (90%), with
//         a per-year recency factor scaling from 1.0 at 1998 to 1.5 at 2026
//         (clamped outside that range);
//       - within an era, year mass is split proportionally to the year factor;
//       - within a year, pair mass is split uniformly across the year's pairs.
//     The weights are an engine constant (function of year), NOT a data input.
//   - DEPLETED-SQUAD ADVANCE: if the weighted starting pair has no un-picked
//     player left AND no selectable coach (manager already drafted, or no
//     coach on that pair), the engine deterministically advances through the
//     canonical (T, N) pool order until a selectable pair is reached. The
//     emitted Spin.draw_probability accounts for the swept-past weight.
//   - GLOBAL player_id dedup remains the hard guarantee: a player picked on
//     one spin is filtered out of every later spin's roster (even if the
//     same (T, N) repeats).
//   - The spin lands on a (tournament, nation) pair, then presents up to three
//     deterministic player choices from that squad (with every already-picked
//     player_id filtered out GLOBALLY) AND that team-year's coach as candidates.
//     The user takes exactly ONE entity.
//   - PLAYER pick → assigned to a formation SquadSlot; `position_compatibility`
//     is computed via `positionCompatibility(eligible_positions, slot_position)`
//     and stored on the slot.
//   - MANAGER pick → goes to the dedicated `DraftState.manager_card_id` slot,
//     NEVER a SquadSlot. ≤1 manager across the run; once taken, no later spin
//     offers a coach.
//   - Net for a complete draft: 16 player picks (11 starters + 5 bench) + 1
//     manager = 17.
//
// ─── LOCK-ON-PICK ────────────────────────────────────────────────────────────
//   Each pick + assignment is committed IMMUTABLE the moment it is confirmed.
//   Picks happen in spin order (the active spin is always the lowest-index
//   pending spin). A resolved spin object and its occupied SquadSlot are
//   deep-FROZEN and carried by reference into every later state — so they
//   physically cannot change. Transitions are append-only and never mutate a
//   resolved spin; only later PENDING spins are regenerated (their global
//   dedup / coach-availability changes as picks accumulate, and their drawn
//   (T, N) may advance to a non-depleted pair).
//
// ─── DETERMINISM (ENGINE-V2 E-1) ─────────────────────────────────────────────
//   `rebuildSpins(catalog, draft_seed, spins)` replays exactly ONE
//   `rng.next()` per spin index in order; picked spins consume the draw to
//   preserve RNG alignment but pass through unchanged by reference, while
//   pending spins regenerate their entry/candidates from the replayed `u`
//   value, the current global picked-player set, and the manager-drafted
//   flag. Same `(catalog, draft_seed, resolved-pick-sequence)` → byte-identical
//   17-spin sequence on every platform.
//
// ─── SOFT RULES ──────────────────────────────────────────────────────────────
//   no-GK and out-of-position are SOFT (low `position_compatibility` + a
//   `validation_warnings` entry + a later sim penalty) — NEVER a draft blocker.
//   The only HARD gate for `status = 'ready'` is 11 starters assigned.
//
// SCOPE: the draft engine consumes a narrow candidate view of the ingested
// `PlayerTournament` / `ManagerTournament` cards (`DraftPlayerCard` /
// `DraftManagerCard`) PLUS a `DraftTournament` view ({tournament_id, year})
// for era weighting. Real wiring maps those canonical records 1:1 onto these
// views; golden development runs against a synthetic fixture squad set so
// this lane does not block on data wiring (see `draft.fixture.ts`).

import { canonicalSortBy, createRng, deriveSubseed } from "./rng.js";
import { positionCompatibility } from "./api/compatibility.js";
import { buildCardId, parseCardId } from "./types/identity.js";
import { buildManagerCardId } from "./types/manager.js";
import { FORMATION_TEMPLATES, slotPositionLine } from "./types/formation.js";
import { DraftStateSchema } from "./schemas/draft.js";
import type { CardId } from "./types/identity.js";
import type { ManagerCardId } from "./types/manager.js";
import type { SlotPosition } from "./types/formation.js";
import type { Position } from "./types/primitives.js";
import type { DraftMode, DraftState, Spin, SquadSlot, SquadValidation } from "./types/draft.js";
import {
  DEFAULT_DRAFT_FLOW,
  DEFAULT_ERA_PRESET,
  DEFAULT_RATING_BASIS,
  ERA_PRESETS,
} from "./types/draft-config.js";
import type { DraftFlow, EraPreset, EraPresetId, RatingBasis } from "./types/draft-config.js";

// ─── CANDIDATE INPUT VIEWS ───────────────────────────────────────────────────

/**
 * The narrow per-card view the draft engine needs from a `PlayerTournament`.
 * `PlayerTournament` is structurally assignable to this — the engine reads
 * nothing else, and rebuilds `card_id` from `(player_id, tournament_id)` itself
 * so it never has to trust a denormalized id.
 */
export interface DraftPlayerCard {
  player_id: string;
  tournament_id: number;
  nation_id: string;
  /** Per-card coarse eligibility; MUST be non-empty (drives `positionCompatibility`). */
  eligible_positions: readonly Position[];
  /**
   * Optional quality projection used only to spread choose-from-3 offers across
   * rating tiers. Missing/null stays honest and falls back to canonical order.
   */
  choice_overall?: number | null;
}

/**
 * The narrow per-card view the draft engine needs from a `ManagerTournament`
 * (the draftable coach for a given (tournament, nation)).
 */
export interface DraftManagerCard {
  manager_id: string;
  tournament_id: number;
  nation_id: string;
}

/**
 * The narrow per-tournament view the draft engine needs for ENGINE-V2 E-1 era
 * weighting. The engine MUST NOT infer year from `tournament_id`; real
 * tournament_ids happen to be the source catalog's ids, not years.
 */
export interface DraftTournament {
  tournament_id: number;
  /** Calendar year the tournament was played. Positive integer. */
  year: number;
}

/** The candidate source for a draft: player cards + coach cards + tournaments. */
export interface DraftDataset {
  players: readonly DraftPlayerCard[];
  managers: readonly DraftManagerCard[];
  /** Required ENGINE-V2 E-1: must cover every tournament_id referenced by `players`. */
  tournaments: readonly DraftTournament[];
}

/**
 * Non-dataset parameters for a draft. `parent_seed` is the master RUN seed; the
 * engine derives the draft substream seed via `deriveSubseed(parent_seed,
 * "draft")` and stores it as `DraftState.draft_seed`.
 */
export interface CreateDraftParams {
  run_id: string;
  parent_seed: string;
  formation_id: string;
  mode?: DraftMode;
  team_name?: string;
  dataset_version: string;
  rating_version: string;
  engine_version: string;
  /**
   * DC-1 config axes. Omitted fields default to today's shipped behavior
   * (`squad_first` / `career` / `all_time`). All axis values are now
   * implemented: `position_first` (DC-3), era-filtered catalogs (DC-2), and
   * the `current` rating basis (selected-basis lane) — the latter re-rates the
   * user squad from `basis_ratings.current` at sim build time (display + sim,
   * see web `buildSimWorldInputs` / adapters). `createDraft` records the config
   * it is given; the value is validated by `DraftStateSchema`.
   */
  draft_flow?: DraftFlow;
  rating_basis?: RatingBasis;
  era_preset?: EraPresetId;
}

// ─── ERA WEIGHTING CONSTANTS (ENGINE-V2 E-1) ─────────────────────────────────
//
// These are engine constants (not data) — golden-tested via the draft fixture
// + the dedicated era-weighting tests in draft.golden.test.ts. Bumping any of
// these is an intentional engine change that re-locks the draft golden.

/** Tournaments STRICTLY before this year are `rare` (pre-1998 era). */
export const RARE_YEAR_CUTOFF = 1998;
/**
 * Aggregate per-spin probability allocated to rare (pre-1998) years.
 *
 * ENGINE-V2 E-1b (Paulo's product call): lowered from 0.15 to 0.10 so the
 * reachable squad pool tilts more modern (>= 90% from 1998..2026). The
 * recency factor, year-level mass split, and uniform-within-year structure
 * are unchanged.
 */
export const RARE_ERA_MASS = 0.1;
/** Aggregate per-spin probability allocated to modern (>= 1998) years. */
export const MODERN_ERA_MASS = 0.9;
/** Modern recency factor lower anchor — 1998 receives factor 1.0. */
const MODERN_RECENCY_START_YEAR = 1998;
/** Modern recency factor upper anchor — 2026 receives factor `1 + MODERN_RECENCY_BONUS`. */
const MODERN_RECENCY_END_YEAR = 2026;
/** Modern recency factor span; 2026 receives `1 + 0.5 = 1.5` × the 1998 weight. */
const MODERN_RECENCY_BONUS = 0.5;

/**
 * Round a probability to 12 fractional digits via `Number(p.toFixed(12))` so
 * `JSON.stringify` produces a stable byte sequence across platforms (golden
 * stability) without losing meaningful precision.
 */
function roundProbability(p: number): number {
  return Number(p.toFixed(12));
}

/**
 * The recency factor for a modern year. 1.0 at `MODERN_RECENCY_START_YEAR`,
 * linearly scaling to `1 + MODERN_RECENCY_BONUS` at `MODERN_RECENCY_END_YEAR`,
 * clamped outside the range. Pure function of `year`.
 */
function modernYearFactor(year: number): number {
  const span = MODERN_RECENCY_END_YEAR - MODERN_RECENCY_START_YEAR;
  const t = Math.max(0, Math.min(1, (year - MODERN_RECENCY_START_YEAR) / span));
  return 1 + MODERN_RECENCY_BONUS * t;
}

// ─── CATALOG (indexed, canonically ordered candidate source) ─────────────────

/** One (tournament, nation) squad bucket — roster canonically sorted by card_id. */
interface TnEntry {
  tournament_id: number;
  nation_id: string;
  /** Tournament year — drives era weighting + `Spin.rare`. */
  year: number;
  /** True iff `year < RARE_YEAR_CUTOFF`. Cached on the entry for sampling speed. */
  rare: boolean;
  roster: readonly DraftPlayerCard[];
  coach: DraftManagerCard | null;
  /**
   * Per-pair base draw weight from the ENGINE-V2 E-1 era-weighting formula.
   * Sums to ≈ 1.0 across the catalog's `pairs` (modulo float rounding).
   */
  base_draw_weight: number;
}

/**
 * The indexed candidate source. Built once via `buildDraftCatalog` and threaded
 * (unchanged) through every transition — it is the immutable catalog, distinct
 * from the mutable-by-copy `DraftState`.
 */
export interface DraftCatalog {
  /** Canonically sorted by (tournament_id, nation_id) — the draw pool. */
  readonly pairs: readonly TnEntry[];
  readonly byPair: ReadonlyMap<string, TnEntry>;
  /**
   * Cached cumulative `base_draw_weight` over `pairs` for O(log n) weighted
   * start selection. `cumulativeWeights[i]` is the running sum INCLUDING
   * `pairs[i].base_draw_weight`. The last element equals the total weight.
   */
  readonly cumulativeWeights: readonly number[];
  /** True iff at least one entry has a non-null `coach`. */
  readonly hasAnyCoach: boolean;
  /**
   * DC-2 — the era preset this catalog was built under. `createDraft`
   * cross-checks `params.era_preset` against this stamp so a draft can never
   * record a preset its catalog did not enforce.
   */
  readonly era: EraPreset;
  /**
   * DC-2 — true iff the configured pool carries non-zero rare (pre-1998)
   * mass. Drives honest era copy in the UI: an all-modern preset has no
   * "rare 10%" class and must not pretend otherwise.
   */
  readonly hasRareEra: boolean;
}

const SPIN_COUNT = 17;
const BENCH_COUNT = 5;
export const MAX_PLAYER_CHOICES_PER_SPIN = 3;
const CHOICE_SPREAD_BUCKETS = 8;

/**
 * Bench slot layout (engine-owned; the schema does NOT cross-validate bench
 * positions against a formation template). One backup per line plus midfield
 * depth — broad roles, stable ids `bench.0..bench.4`.
 */
const BENCH_LAYOUT: readonly SlotPosition[] = ["GK", "CB", "CM", "CM", "ST"];

function pairKey(tournament_id: number, nation_id: string): string {
  // Separator is "|" — nation_id is an alphanumeric short code (never
  // contains "|"), so a numeric tournament_id + "|" + nation_id cannot
  // collide across pairs. (Earlier revisions used a U+0000 escape; that
  // attracted bugs whenever a tool stripped the source-level escape and
  // left a literal NUL byte in this file.)
  return `${tournament_id}|${nation_id}`;
}

/**
 * DC-2 — restrict a dataset to the tournaments inside an era preset's year
 * bounds (inclusive). Pure and deterministic: players, managers, and
 * tournament metadata outside the window are dropped together; everything
 * inside passes through BY REFERENCE in original order (so an `all_time`
 * filter over real data is an identity in content terms).
 *
 * Year resolution uses the dataset's own tournament metadata; a player or
 * manager card referencing a tournament with NO metadata is a hard failure
 * downstream in `buildDraftCatalog` (unchanged honest-mismatch behavior) —
 * this function drops nothing it cannot date, it keeps the card and lets the
 * catalog builder surface the metadata gap loudly.
 */
export function filterDraftDataset(dataset: DraftDataset, era_preset: EraPresetId): DraftDataset {
  const preset = ERA_PRESETS[era_preset];
  const inBounds = new Set<number>();
  const tournaments = dataset.tournaments.filter((t) => {
    const keep = t.year >= preset.min_year && t.year <= preset.max_year;
    if (keep) inBounds.add(t.tournament_id);
    return keep;
  });
  const known = new Set(dataset.tournaments.map((t) => t.tournament_id));
  const players = dataset.players.filter(
    (c) => inBounds.has(c.tournament_id) || !known.has(c.tournament_id),
  );
  const managers = dataset.managers.filter(
    (m) => inBounds.has(m.tournament_id) || !known.has(m.tournament_id),
  );
  return { players, managers, tournaments };
}

/**
 * Index a dataset into the canonical draw catalog. Players are grouped by
 * (tournament, nation) and each roster is canonically sorted by `card_id`
 * BEFORE any draw. Coaches attach to their matching (tournament, nation) bucket;
 * a coach with no player squad in the dataset is ignored (no squad to spin on).
 *
 * ENGINE-V2 E-1: tournament metadata is REQUIRED for every tournament_id that
 * appears in `players` — used to attach the `year`/`rare` flag to each entry
 * and to compute the era-weighted `base_draw_weight`. Missing or conflicting
 * tournament metadata is a hard failure here (not a silent zero/default).
 *
 * DC-2: an optional era preset bounds the pool. The dataset is filtered to
 * the preset's year window FIRST, then era weights are recomputed inside the
 * filtered catalog by the unchanged ENGINE-V2 E-1 algorithm — a window with
 * no rare years collapses to 100% modern mass (and vice versa) via the
 * existing single-era branch, so an all-modern preset has NO phantom rare
 * class. The default (`all_time`) spans every shipped year, making the
 * filter an identity and the catalog byte-equal to the unfiltered build.
 */
export function buildDraftCatalog(
  dataset: DraftDataset,
  era_preset: EraPresetId = DEFAULT_ERA_PRESET,
): DraftCatalog {
  dataset = filterDraftDataset(dataset, era_preset);
  // Tournament-year index — honest mismatch instead of silent defaults.
  const yearByTournament = new Map<number, number>();
  for (const t of dataset.tournaments) {
    const prior = yearByTournament.get(t.tournament_id);
    if (prior !== undefined && prior !== t.year) {
      throw new RangeError(
        `buildDraftCatalog: conflicting year metadata for tournament_id ${t.tournament_id} (${prior} vs ${t.year})`,
      );
    }
    if (!Number.isSafeInteger(t.year) || t.year <= 0) {
      throw new RangeError(
        `buildDraftCatalog: tournament_id ${t.tournament_id} has invalid year ${t.year}`,
      );
    }
    yearByTournament.set(t.tournament_id, t.year);
  }

  // Group players by (tournament, nation).
  const rosterGroups = new Map<string, DraftPlayerCard[]>();
  for (const card of dataset.players) {
    const key = pairKey(card.tournament_id, card.nation_id);
    let group = rosterGroups.get(key);
    if (!group) {
      group = [];
      rosterGroups.set(key, group);
    }
    group.push(card);
  }

  // Group coaches by (tournament, nation); if a bucket has more than one coach
  // (data anomaly), pick deterministically by lexicographically-least manager_id
  // so the catalog is stable regardless of input order.
  const coachGroups = new Map<string, DraftManagerCard[]>();
  for (const coach of dataset.managers) {
    const key = pairKey(coach.tournament_id, coach.nation_id);
    let group = coachGroups.get(key);
    if (!group) {
      group = [];
      coachGroups.set(key, group);
    }
    group.push(coach);
  }

  // Build entries (year-less + weight-less first; we attach weights in a
  // second pass once we know the year groups).
  interface PartialEntry {
    tournament_id: number;
    nation_id: string;
    year: number;
    rare: boolean;
    roster: readonly DraftPlayerCard[];
    coach: DraftManagerCard | null;
  }
  const partials = new Map<string, PartialEntry>();
  for (const [key, group] of rosterGroups) {
    const first = group[0]!;
    const year = yearByTournament.get(first.tournament_id);
    if (year === undefined) {
      throw new RangeError(
        `buildDraftCatalog: missing tournament metadata for tournament_id ${first.tournament_id} (referenced by ${group.length} player card(s) in nation ${first.nation_id})`,
      );
    }
    const roster = canonicalSortBy(group, (c) => [buildCardId(c.player_id, c.tournament_id)]);
    const coaches = coachGroups.get(key);
    let coach: DraftManagerCard | null = null;
    if (coaches && coaches.length > 0) {
      coach = canonicalSortBy(coaches, (c) => [c.manager_id])[0]!;
    }
    partials.set(key, {
      tournament_id: first.tournament_id,
      nation_id: first.nation_id,
      year,
      rare: year < RARE_YEAR_CUTOFF,
      roster,
      coach,
    });
  }

  // ENGINE-V2 E-1 ERA WEIGHTING — year-level mass split, then uniform within
  // a year. Pair count per year does NOT inflate the year's exposure (the
  // 2026 48-team expansion would otherwise swamp the recency curve).

  const pairsByYear = new Map<number, PartialEntry[]>();
  for (const p of partials.values()) {
    let group = pairsByYear.get(p.year);
    if (!group) {
      group = [];
      pairsByYear.set(p.year, group);
    }
    group.push(p);
  }

  const rareYears: number[] = [];
  const modernYears: number[] = [];
  for (const y of pairsByYear.keys()) {
    if (y < RARE_YEAR_CUTOFF) rareYears.push(y);
    else modernYears.push(y);
  }

  // Era masses — collapse to the single-era case so a fixture/catalog with
  // only one era still sums to 1.0 (the absent era contributes nothing).
  const hasRare = rareYears.length > 0;
  const hasModern = modernYears.length > 0;
  let rareEraMass: number;
  let modernEraMass: number;
  if (hasRare && hasModern) {
    rareEraMass = RARE_ERA_MASS;
    modernEraMass = MODERN_ERA_MASS;
  } else if (hasRare) {
    rareEraMass = 1;
    modernEraMass = 0;
  } else if (hasModern) {
    rareEraMass = 0;
    modernEraMass = 1;
  } else {
    rareEraMass = 0;
    modernEraMass = 0;
  }

  // Compute year-factor sums per era for normalization.
  const rareFactorSum = rareYears.length; // flat — rare era is uniform across rare years.
  let modernFactorSum = 0;
  for (const y of modernYears) {
    modernFactorSum += modernYearFactor(y);
  }

  // Allocate year mass, then split uniformly within a year.
  const yearMass = new Map<number, number>();
  for (const y of rareYears) {
    const yMass = rareFactorSum > 0 ? rareEraMass * (1 / rareFactorSum) : 0;
    yearMass.set(y, yMass);
  }
  for (const y of modernYears) {
    const factor = modernYearFactor(y);
    const yMass = modernFactorSum > 0 ? modernEraMass * (factor / modernFactorSum) : 0;
    yearMass.set(y, yMass);
  }

  const byPair = new Map<string, TnEntry>();
  for (const [key, p] of partials) {
    const yPairs = pairsByYear.get(p.year)!;
    const massForYear = yearMass.get(p.year) ?? 0;
    const perPair = yPairs.length > 0 ? massForYear / yPairs.length : 0;
    byPair.set(key, {
      tournament_id: p.tournament_id,
      nation_id: p.nation_id,
      year: p.year,
      rare: p.rare,
      roster: p.roster,
      coach: p.coach,
      base_draw_weight: perPair,
    });
  }

  const pairs = canonicalSortBy([...byPair.values()], (e) => [e.tournament_id, e.nation_id]);
  if (pairs.length === 0) {
    throw new RangeError(
      `buildDraftCatalog: dataset has no (tournament, nation) player buckets inside era preset "${era_preset}"`,
    );
  }
  const cumulativeWeights: number[] = [];
  let running = 0;
  let hasAnyCoach = false;
  for (const e of pairs) {
    running += e.base_draw_weight;
    cumulativeWeights.push(running);
    if (e.coach !== null) hasAnyCoach = true;
  }
  // Defensive: if every year had zero mass (no years registered for any pair),
  // sampling would divide by zero. This should be impossible given the
  // missing-metadata throw above, but bail honestly if it ever happens.
  if (running <= 0) {
    throw new RangeError(
      "buildDraftCatalog: total base_draw_weight is zero — every pair's tournament year resolved to zero mass",
    );
  }
  return {
    pairs,
    byPair,
    cumulativeWeights,
    hasAnyCoach,
    era: ERA_PRESETS[era_preset],
    hasRareEra: hasRare,
  };
}

// ─── IMMUTABILITY HELPERS (lock-on-pick) ─────────────────────────────────────

function freezeSpin(spin: Spin): Spin {
  Object.freeze(spin.rolled_card_ids);
  if (spin.rolled_manager_card_ids) Object.freeze(spin.rolled_manager_card_ids);
  Object.freeze(spin.excluded_player_ids);
  return Object.freeze(spin);
}

function freezeSlot(slot: SquadSlot): SquadSlot {
  Object.freeze(slot.validation_warnings);
  return Object.freeze(slot);
}

// ─── WEIGHTED DRAW + DEPLETION ADVANCE (ENGINE-V2 E-1) ───────────────────────

/**
 * True if `entry` can still source AT LEAST ONE pickable thing on a spin
 * with the given prior-pick context: an un-picked player OR a coach (only
 * when no manager has been drafted yet).
 */
function isEntrySelectable(
  entry: TnEntry,
  excluded: ReadonlySet<string>,
  managerPicked: boolean,
): boolean {
  if (!managerPicked && entry.coach !== null) return true;
  for (const card of entry.roster) {
    if (!excluded.has(card.player_id)) return true;
  }
  return false;
}

function openDraftCardRank(card: DraftPlayerCard): number {
  const overall = choiceOverall(card);
  return overall ?? -1;
}

function compareOpenDraftCards(a: DraftPlayerCard, b: DraftPlayerCard): number {
  const ao = openDraftCardRank(a);
  const bo = openDraftCardRank(b);
  if (ao !== bo) return bo - ao;
  return compareCardId(cardIdFor(a), cardIdFor(b));
}

function openDraftPlayerCards(
  catalog: DraftCatalog,
  nation_id: string,
  excluded: ReadonlySet<string>,
): DraftPlayerCard[] {
  const bestByPlayer = new Map<string, DraftPlayerCard>();
  for (const entry of catalog.pairs) {
    if (entry.nation_id !== nation_id) continue;
    for (const card of entry.roster) {
      if (excluded.has(card.player_id)) continue;
      const prior = bestByPlayer.get(card.player_id);
      if (!prior || compareOpenDraftCards(card, prior) < 0) {
        bestByPlayer.set(card.player_id, card);
      }
    }
  }
  return [...bestByPlayer.values()].sort(compareOpenDraftCards);
}

function openDraftPlayerChoices(
  catalog: DraftCatalog,
  nation_id: string,
  priorPlayerPicks: readonly string[],
): CardId[] {
  return openDraftPlayerCards(catalog, nation_id, new Set(priorPlayerPicks)).map((card) =>
    cardIdFor(card),
  );
}

function openDraftManagerChoices(
  catalog: DraftCatalog,
  nation_id: string,
  managerPicked: boolean,
): ManagerCardId[] {
  if (managerPicked) return [];
  const ids: ManagerCardId[] = [];
  const seen = new Set<string>();
  for (const entry of catalog.pairs) {
    if (entry.nation_id !== nation_id || entry.coach === null) continue;
    const id = buildManagerCardId(entry.coach.manager_id, entry.coach.tournament_id);
    if (seen.has(id)) continue;
    ids.push(id);
    seen.add(id);
  }
  return ids.sort(compareCardId);
}

function isOpenEntrySelectable(
  catalog: DraftCatalog,
  entry: TnEntry,
  excluded: ReadonlySet<string>,
  managerPicked: boolean,
): boolean {
  if (openDraftPlayerCards(catalog, entry.nation_id, excluded).length > 0) return true;
  return openDraftManagerChoices(catalog, entry.nation_id, managerPicked).length > 0;
}

/**
 * Find the canonical-order index of the weighted start pair for a `u ∈ [0, 1)`
 * draw. Uses binary search over `cumulativeWeights` so a fixture with hundreds
 * of pairs costs O(log n) per spin.
 */
function weightedStartIndex(catalog: DraftCatalog, u: number): number {
  const total = catalog.cumulativeWeights[catalog.cumulativeWeights.length - 1]!;
  // Map `u` into the cumulative-weight space; clamp the inclusive-upper edge
  // (`u === 1` is unreachable from `rng.next()` but defended for safety).
  const target = Math.min(u * total, total * (1 - 1e-15));
  let lo = 0;
  let hi = catalog.cumulativeWeights.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (catalog.cumulativeWeights[mid]! <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Result of a single weighted-draw + deterministic-advance step for one spin.
 * The `draw_probability` is the SUM of `base_draw_weight` from the emitted
 * entry plus every contiguous depleted entry the advance scanned past to
 * reach it (the engine deterministically advances in canonical order, so the
 * scan-back walk computes the exact emission probability under the given
 * pick context).
 */
interface WeightedDrawResult {
  entry: TnEntry;
  draw_probability: number;
}

/**
 * Draw the (T, N) entry for a single spin from one `rng.next()` worth of
 * entropy. The starting index is the weighted-start under the catalog's
 * static weights; if that entry is depleted under the current pick context,
 * the engine deterministically advances `(idx + 1) % pairs.length` until a
 * selectable entry is reached. Emission probability is summed back over the
 * contiguous depleted run that led to the emitted index.
 *
 * @throws RangeError if NO entry in the whole catalog is selectable under
 *   the given pick context (a fully depleted draft pool — the schema /
 *   surrounding state should prevent this from being reachable in normal
 *   play; surfacing honestly is preferable to looping forever).
 */
function drawSpinEntry(
  catalog: DraftCatalog,
  u: number,
  excluded: ReadonlySet<string>,
  managerPicked: boolean,
  mode: DraftMode,
): WeightedDrawResult {
  const startIdx = weightedStartIndex(catalog, u);
  const n = catalog.pairs.length;

  // Scan forward (canonical order, wrap) for the first selectable entry.
  let idx = startIdx;
  let scanned = 0;
  const selectable = (entry: TnEntry) =>
    mode === "open"
      ? isOpenEntrySelectable(catalog, entry, excluded, managerPicked)
      : isEntrySelectable(entry, excluded, managerPicked);
  while (!selectable(catalog.pairs[idx]!)) {
    idx = (idx + 1) % n;
    scanned++;
    if (scanned >= n) {
      throw new RangeError(
        "draft pool is fully depleted: no (tournament, nation) pair offers a selectable player or coach under the current pick context",
      );
    }
  }
  const emitted = catalog.pairs[idx]!;

  // Compute draw_probability by walking BACK from the emitted index across the
  // contiguous depleted entries the advance would have scanned past. Includes
  // the emitted entry's own weight. Stop the walk when we hit a selectable
  // entry or wrap fully back to `idx`.
  let probability = emitted.base_draw_weight;
  let walk = (idx - 1 + n) % n;
  let safetySteps = 0;
  while (walk !== idx && safetySteps < n) {
    const w = catalog.pairs[walk]!;
    if (selectable(w)) break;
    probability += w.base_draw_weight;
    walk = (walk - 1 + n) % n;
    safetySteps++;
  }

  return { entry: emitted, draw_probability: roundProbability(probability) };
}

// ─── SPIN ROLLING ────────────────────────────────────────────────────────────

interface ChoiceCandidate {
  card: DraftPlayerCard;
  card_id: CardId;
  tier: number;
  position_bucket: Position;
}

function cardIdFor(card: DraftPlayerCard): CardId {
  return buildCardId(card.player_id, card.tournament_id);
}

function compareCardId(a: CardId | string, b: CardId | string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function choiceOverall(card: DraftPlayerCard): number | null {
  return typeof card.choice_overall === "number" && Number.isFinite(card.choice_overall)
    ? card.choice_overall
    : null;
}

function primaryPosition(card: DraftPlayerCard): Position {
  return card.eligible_positions[0] ?? "MF";
}

function shuffled<T>(items: readonly T[], rngSeed: string): T[] {
  const rng = createRng(rngSeed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = rng.int(i + 1);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

function rankedChoiceCandidates(cards: readonly DraftPlayerCard[]): ChoiceCandidate[] {
  const ranked = [...cards].sort((a, b) => {
    const ao = choiceOverall(a);
    const bo = choiceOverall(b);
    if (ao !== null && bo !== null && ao !== bo) return bo - ao;
    if (ao !== null && bo === null) return -1;
    if (ao === null && bo !== null) return 1;
    return compareCardId(cardIdFor(a), cardIdFor(b));
  });
  const candidates = ranked.map((card, rank) => ({
    card,
    card_id: cardIdFor(card),
    // U5: preserve one top/middle/lower tradeoff, but draw the lower option
    // from the upper spread instead of the full bottom third. This softens
    // the weakest forced choice without changing ratings or catalog weights.
    tier: Math.floor((rank * CHOICE_SPREAD_BUCKETS) / ranked.length),
    position_bucket: primaryPosition(card),
  }));
  return candidates.filter((candidate) => candidate.tier < MAX_PLAYER_CHOICES_PER_SPIN);
}

function selectDiverseChoice(
  pool: readonly ChoiceCandidate[],
  selected: readonly ChoiceCandidate[],
  rngSeed: string,
): ChoiceCandidate {
  const selectedPositions = new Set(selected.map((c) => c.position_bucket));
  const selectedTiers = new Set(selected.map((c) => c.tier));
  let bestScore = Number.NEGATIVE_INFINITY;
  const best: ChoiceCandidate[] = [];
  for (const candidate of pool) {
    let score = 0;
    if (!selectedPositions.has(candidate.position_bucket)) score += 4;
    if (!selectedTiers.has(candidate.tier)) score += 3;
    const overall = choiceOverall(candidate.card);
    if (overall !== null) score += overall / 1000;
    if (score > bestScore) {
      bestScore = score;
      best.length = 0;
      best.push(candidate);
    } else if (score === bestScore) {
      best.push(candidate);
    }
  }
  return createRng(rngSeed).pick(canonicalSortBy(best, (c) => [c.card_id]));
}

function selectPlayerChoices(
  entry: TnEntry,
  index: number,
  priorPlayerPicks: readonly string[],
  draft_seed: string,
): CardId[] {
  const excluded = new Set(priorPlayerPicks);
  const legal = entry.roster.filter((card) => !excluded.has(card.player_id));
  if (legal.length <= MAX_PLAYER_CHOICES_PER_SPIN) {
    const seed = deriveSubseed(
      draft_seed,
      "draft",
      `choices:${index}:${entry.tournament_id}:${entry.nation_id}:${priorPlayerPicks.join(",")}:small`,
    );
    return shuffled(
      canonicalSortBy(
        legal.map((card) => cardIdFor(card)),
        (card_id) => [card_id],
      ),
      seed,
    );
  }

  const choiceSeed = deriveSubseed(
    draft_seed,
    "draft",
    `choices:${index}:${entry.tournament_id}:${entry.nation_id}:${priorPlayerPicks.join(",")}`,
  );
  const candidates = rankedChoiceCandidates(legal);
  const selected: ChoiceCandidate[] = [];
  const selectedIds = new Set<string>();

  for (const tier of shuffled([0, 1, 2], `${choiceSeed}:tiers`)) {
    const pool = candidates.filter((c) => c.tier === tier && !selectedIds.has(c.card_id));
    if (pool.length === 0) continue;
    const picked = selectDiverseChoice(pool, selected, `${choiceSeed}:tier:${tier}`);
    selected.push(picked);
    selectedIds.add(picked.card_id);
  }

  while (selected.length < MAX_PLAYER_CHOICES_PER_SPIN) {
    const pool = candidates.filter((c) => !selectedIds.has(c.card_id));
    if (pool.length === 0) break;
    const picked = selectDiverseChoice(pool, selected, `${choiceSeed}:fill:${selected.length}`);
    selected.push(picked);
    selectedIds.add(picked.card_id);
  }

  return shuffled(
    selected.map((c) => c.card_id),
    `${choiceSeed}:order`,
  );
}

/**
 * Build a fresh PENDING spin object from a drawn `TnEntry` and the current
 * pick context. The player choices are filtered by the GLOBAL picked-player
 * set and materialized as up to three deterministic options; the coach is
 * exposed iff no manager has been drafted yet.
 */
function rollPendingSpinFromEntry(
  catalog: DraftCatalog,
  entry: TnEntry,
  index: number,
  priorPlayerPicks: readonly string[],
  managerPicked: boolean,
  draw_probability: number,
  draft_seed: string,
  mode: DraftMode,
  /**
   * DC-3 — the committed position-first target, or null under squad_first.
   * Exposure follows the target: a `"manager"` target offers ONLY the coach;
   * a slot target offers ONLY players (the sampling itself is target-blind —
   * same (T, N) draw either way; presentation/assignment differ).
   */
  target_slot_id: string | null = null,
): Spin {
  const rolled_card_ids: CardId[] =
    target_slot_id === "manager"
      ? []
      : mode === "open"
        ? openDraftPlayerChoices(catalog, entry.nation_id, priorPlayerPicks)
        : selectPlayerChoices(entry, index, priorPlayerPicks, draft_seed);
  const offerCoach = target_slot_id === null ? !managerPicked : target_slot_id === "manager";
  const rolled_manager_card_id: ManagerCardId | null =
    mode !== "open" && offerCoach && entry.coach
      ? buildManagerCardId(entry.coach.manager_id, entry.coach.tournament_id)
      : null;
  const rolled_manager_card_ids =
    mode === "open" && offerCoach
      ? openDraftManagerChoices(catalog, entry.nation_id, managerPicked)
      : undefined;
  return {
    index,
    tournament_id: entry.tournament_id,
    nation_id: entry.nation_id,
    rare: entry.rare,
    draw_probability,
    rolled_card_ids,
    excluded_player_ids: [...priorPlayerPicks],
    rolled_manager_card_id,
    ...(rolled_manager_card_ids === undefined ? {} : { rolled_manager_card_ids }),
    // picked_kind is meaningful only once status === 'picked'; the contract's
    // convention is a no-op 'player' default on a fresh pending spin.
    picked_kind: "player",
    picked_card_id: null,
    picked_player_id: null,
    assigned_slot_id: null,
    picked_manager_card_id: null,
    target_slot_id,
    status: "pending",
  };
}

/** DC-3 — unmaterialized position-first placeholder (no draw happened). */
function buildAwaitingSpin(index: number): Spin {
  return {
    index,
    tournament_id: 0,
    nation_id: "",
    rare: false,
    draw_probability: 0,
    rolled_card_ids: [],
    excluded_player_ids: [],
    rolled_manager_card_id: null,
    picked_kind: "player",
    picked_card_id: null,
    picked_player_id: null,
    assigned_slot_id: null,
    picked_manager_card_id: null,
    target_slot_id: null,
    status: "awaiting_slot",
  };
}

/**
 * DC-3 — the i-th spin's RNG draw value. Position-first materializes draws
 * lazily, but the value for index `i` is IDENTICAL to what squad_first would
 * consume at that index (one `rng.next()` per index from the `"draft"`
 * substream) — same seed, same per-index entropy under either flow.
 */
function drawValueForIndex(draft_seed: string, index: number): number {
  const rng = createRng(draft_seed);
  let u = 0;
  for (let i = 0; i <= index; i++) u = rng.next();
  return u;
}

/**
 * Refresh every PENDING spin by replaying the seeded `"draft"` RNG stream and
 * the running pick context. Resolved spins (already frozen) pass through
 * UNCHANGED by reference — lock-on-pick — but the RNG is advanced one step
 * per index so the i-th `rng.next()` value always lines up with spin `i`.
 *
 * Algorithm (ENGINE-V2 E-1):
 *   for i in 0..16:
 *     u = rng.next()
 *     if spins[i].status === 'picked':
 *       carry it forward; update `priorPlayerPicks` / `managerPicked`.
 *     else:
 *       draw a fresh entry from `(u, excluded, managerPicked)` with
 *       deterministic depletion advance; build a new pending Spin.
 *
 * `priorPlayerPicks` accumulates in spin order (so each pending spin's
 * `excluded_player_ids` equals exactly the players picked before it) and
 * `managerPicked` flips after a manager pick (so every later pending spin's
 * `rolled_manager_card_id` becomes null even if the drawn (T, N) carries a
 * coach in the catalog).
 */
function rebuildSpins(
  catalog: DraftCatalog,
  draft_seed: string,
  spins: readonly Spin[],
  mode: DraftMode,
): Spin[] {
  const rng = createRng(draft_seed);
  const priorPlayerPicks: string[] = [];
  let managerPicked = false;
  const out: Spin[] = [];
  for (let i = 0; i < spins.length; i++) {
    const u = rng.next();
    const spin = spins[i]!;
    if (spin.status === "picked") {
      out.push(spin);
      if (spin.picked_kind === "player" && spin.picked_player_id !== null) {
        priorPlayerPicks.push(spin.picked_player_id);
      } else if (spin.picked_kind === "manager") {
        managerPicked = true;
      }
      continue;
    }
    const excluded = new Set(priorPlayerPicks);
    const { entry, draw_probability } = drawSpinEntry(catalog, u, excluded, managerPicked, mode);
    out.push(
      rollPendingSpinFromEntry(
        catalog,
        entry,
        i,
        priorPlayerPicks,
        managerPicked,
        draw_probability,
        draft_seed,
        mode,
      ),
    );
  }
  return out;
}

/**
 * Run the initial 17 weighted draws (no prior picks, no manager yet) to
 * produce the freshly-created draft's pending spin list. Each draw consumes
 * exactly one `rng.next()` from the seeded `"draft"` substream.
 */
function buildInitialSpins(catalog: DraftCatalog, draft_seed: string, mode: DraftMode): Spin[] {
  const rng = createRng(draft_seed);
  const excluded = new Set<string>();
  const spins: Spin[] = [];
  for (let i = 0; i < SPIN_COUNT; i++) {
    const u = rng.next();
    const { entry, draw_probability } = drawSpinEntry(
      catalog,
      u,
      excluded,
      /*managerPicked*/ false,
      mode,
    );
    spins.push(
      rollPendingSpinFromEntry(catalog, entry, i, [], false, draw_probability, draft_seed, mode),
    );
  }
  return spins;
}

// ─── SQUAD CONSTRUCTION ──────────────────────────────────────────────────────

function buildSquad(formation_id: string): SquadSlot[] {
  const template = FORMATION_TEMPLATES[formation_id];
  if (!template) {
    throw new RangeError(
      `createDraft: formation_id "${formation_id}" is not a known FormationTemplate`,
    );
  }
  const slots: SquadSlot[] = template.slots.map((fs) => ({
    slot_id: fs.slot_id,
    is_starter: true,
    slot_position: fs.slot_position,
    card_id: null,
    player_id: null,
    tournament_id: null,
    position_compatibility: 0,
    validation_warnings: [],
  }));
  for (let i = 0; i < BENCH_COUNT; i++) {
    slots.push({
      slot_id: `bench.${i}`,
      is_starter: false,
      slot_position: BENCH_LAYOUT[i]!,
      card_id: null,
      player_id: null,
      tournament_id: null,
      position_compatibility: 0,
      validation_warnings: [],
    });
  }
  return slots;
}

// ─── STATUS + WARNINGS ───────────────────────────────────────────────────────

function computeStatus(_spins: readonly Spin[], squad: readonly SquadSlot[]): DraftState["status"] {
  // HARD GATE (WS-0c contract): 'ready' ⟺ all 11 starter slots assigned
  // (is_fieldable). This is the ONLY gate — it fires the moment the XI has
  // bodies, even with bench/manager spins still pending, because the sim only
  // needs the starting 11 ("sim may run"). The transition to 'simulated' is
  // WS-B's responsibility and is never set here.
  const startersFilled = squad.every((s) => !s.is_starter || s.card_id !== null);
  return startersFilled ? "ready" : "drafting";
}

function buildSlotWarnings(
  slot_position: SlotPosition,
  eligible: readonly Position[],
  compat: number,
): string[] {
  if (compat >= 1) return [];
  const elig = eligible.join("/");
  if (slotPositionLine(slot_position) === "GK" && !eligible.includes("GK")) {
    return [
      `outfielder in goal: ${elig} placed in GK slot (compatibility ${compat.toFixed(2)}; soft sim penalty)`,
    ];
  }
  return [`out-of-position: ${elig} in ${slot_position} slot (compatibility ${compat.toFixed(2)})`];
}

function dedupedFromSpins(spins: readonly Spin[]): string[] {
  const out: string[] = [];
  for (const s of spins) {
    if (s.status === "picked" && s.picked_kind === "player" && s.picked_player_id !== null) {
      out.push(s.picked_player_id);
    }
  }
  return out;
}

/**
 * Assemble the next DraftState from refreshed spins + squad, re-derive the
 * dedup set + status, VALIDATE against the persistence schema (honest failure
 * if the engine ever drifts from the contract), then deep-freeze and return.
 */
function finalize(
  prev: DraftState,
  spins: Spin[],
  squad: SquadSlot[],
  manager_card_id: ManagerCardId | null,
): DraftState {
  const next: DraftState = {
    run_id: prev.run_id,
    draft_seed: prev.draft_seed,
    mode: prev.mode,
    formation_id: prev.formation_id,
    team_name: prev.team_name,
    spins,
    squad,
    manager_card_id,
    status: computeStatus(spins, squad),
    deduped_player_ids: dedupedFromSpins(spins),
    dataset_version: prev.dataset_version,
    rating_version: prev.rating_version,
    engine_version: prev.engine_version,
    draft_flow: prev.draft_flow,
    rating_basis: prev.rating_basis,
    era_preset: prev.era_preset,
  };
  const parsed = DraftStateSchema.safeParse(next);
  if (!parsed.success) {
    throw new Error(
      `draft engine produced a contract-invalid DraftState: ${JSON.stringify(parsed.error.issues)}`,
    );
  }
  Object.freeze(next.spins);
  Object.freeze(next.squad);
  Object.freeze(next.deduped_player_ids);
  return Object.freeze(next);
}

// ─── PUBLIC: CREATE ──────────────────────────────────────────────────────────

/**
 * Create a fresh draft. The formation is LOCKED here and immutable for the
 * lifetime of the draft. The 17 (tournament, nation) pairs are drawn via
 * ENGINE-V2 E-1 era-weighted, with-replacement sampling over the canonical
 * pool using the `"draft"` substream sub-seed (one `rng.next()` per spin).
 * All spins start PENDING; spin candidates reflect zero prior picks.
 */
export function createDraft(catalog: DraftCatalog, params: CreateDraftParams): DraftState {
  // ── DC-1 config gates — never record config this build does not enforce ──
  const draft_flow = params.draft_flow ?? DEFAULT_DRAFT_FLOW;
  const rating_basis = params.rating_basis ?? DEFAULT_RATING_BASIS;
  const era_preset = params.era_preset ?? DEFAULT_ERA_PRESET;
  const mode = params.mode ?? "classic";
  // Both `career` and `current` are materialized (runtime-data-2.0.0 dual
  // basis). createDraft records the basis; the squad's ratings are resolved
  // per-basis downstream (display adapter + sim world build), so the engine
  // consumes `basis_ratings.current` channels for a `current` run. The
  // DraftStateSchema parse below rejects any non-RatingBasis value.
  if (era_preset !== catalog.era.id) {
    // DC-2 coherence: a draft must never record a preset its catalog did not
    // enforce — the caller builds the catalog with the same preset it passes.
    throw new RangeError(
      `createDraft: era_preset "${era_preset}" does not match the catalog's era stamp "${catalog.era.id}"`,
    );
  }

  // Honest fail-fast: a complete draft needs exactly one manager. If the
  // catalog has NO coach-bearing pair, the draft can never be completed —
  // surface it now rather than strand the user mid-draft.
  if (!catalog.hasAnyCoach) {
    throw new RangeError(
      "createDraft: catalog has no coach-bearing (tournament, nation) pair; a complete draft requires exactly one manager",
    );
  }

  const draft_seed = deriveSubseed(params.parent_seed, "draft");
  // DC-3: position_first materializes NOTHING at creation — all 17 spins are
  // placeholders until a target is committed (the commitment boundary is in
  // the persisted state, not just the UI). squad_first is unchanged.
  const spins =
    draft_flow === "position_first"
      ? Array.from({ length: SPIN_COUNT }, (_, i) => buildAwaitingSpin(i))
      : buildInitialSpins(catalog, draft_seed, mode);
  const squad = buildSquad(params.formation_id);

  // ENGINE-V2 E-1 (squad_first only — position_first has no draws yet):
  // with-replacement sampling can produce 17 draws where NO pair offers a
  // coach (e.g. era weights happen to land on coach-less pairs). Without
  // bumping engine_version or adding a coach-forcing pass, surface this as
  // an honest creation failure (rare with a real-data catalog where most
  // pairs carry a coach; easy to hit in degenerate fixtures).
  if (
    draft_flow === "squad_first" &&
    !spins.some(
      (s) => s.rolled_manager_card_id !== null || (s.rolled_manager_card_ids?.length ?? 0) > 0,
    )
  ) {
    throw new RangeError(
      "createDraft: none of the 17 drawn (tournament, nation) pairs offers a coach; a complete draft requires exactly one manager",
    );
  }

  const draft: DraftState = {
    run_id: params.run_id,
    draft_seed,
    mode,
    formation_id: params.formation_id,
    team_name: params.team_name ?? "Your XI",
    spins,
    squad,
    manager_card_id: null,
    status: "drafting",
    deduped_player_ids: [],
    dataset_version: params.dataset_version,
    rating_version: params.rating_version,
    engine_version: params.engine_version,
    draft_flow,
    rating_basis,
    era_preset,
  };
  const parsed = DraftStateSchema.safeParse(draft);
  if (!parsed.success) {
    throw new Error(
      `createDraft produced a contract-invalid DraftState: ${JSON.stringify(parsed.error.issues)}`,
    );
  }
  return draft;
}

// ─── PUBLIC: STATE QUERIES ───────────────────────────────────────────────────

/**
 * The active spin = the lowest-index spin not yet `picked`, or null if
 * complete. Under squad_first this is always a `pending` spin (unchanged);
 * under position_first it is `awaiting_slot` (target not committed yet) or
 * `pending` (squad rolled, pick outstanding).
 */
export function activeSpin(state: DraftState): Spin | null {
  return state.spins.find((s) => s.status !== "picked") ?? null;
}

/** True once every spin is resolved (all 17 picked). */
export function isDraftComplete(state: DraftState): boolean {
  return state.spins.every((s) => s.status === "picked");
}

function firstVacantSlotId(state: DraftState): string | null {
  // Squad is stored [11 starters in template order, then 5 bench], so the
  // first vacant slot fills starters before bench — the hard 'ready' gate
  // (11 starters) is satisfied as early as possible.
  return state.squad.find((s) => s.card_id === null)?.slot_id ?? null;
}

// ─── PUBLIC: DC-3 POSITION-FIRST TARGET SELECTION ────────────────────────────

/**
 * DC-3 — thrown by `selectDraftTarget` when the committed target yields no
 * candidate in the drawn squad. The spin is NOT consumed (state unchanged,
 * no hidden seed advance); the UI shows a blocking honest state and returns
 * the user to target selection.
 */
export class DraftTargetDeadEndError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "DraftTargetDeadEndError";
  }
}

/**
 * DC-3 — commit a position-first TARGET for the active spin, then consume
 * the spin's normal RNG draw and roll the squad.
 *
 *   - Valid only on a `position_first` draft whose active spin is still
 *     `awaiting_slot` (the target is immutable once the squad rolls).
 *   - `target` is a vacant SquadSlot.slot_id, or `"manager"` while no
 *     manager has been drafted.
 *   - The draw is the SAME era-weighted (T, N) draw squad_first would make
 *     at this index (the target never changes sampling); only candidate
 *     EXPOSURE follows the target — a slot target offers that squad's
 *     players, the manager target offers only that squad's coach.
 *   - STRAND GUARD: when no manager is drafted and this is the LAST
 *     unresolved spin, only the `"manager"` target is selectable.
 *   - DEAD END: if the drawn squad has no candidate for the target (no
 *     coach on a manager target; every player already picked on a slot
 *     target), throws `DraftTargetDeadEndError` WITHOUT consuming the spin.
 */
export function selectDraftTarget(
  catalog: DraftCatalog,
  state: DraftState,
  target: string,
): DraftState {
  if (state.draft_flow !== "position_first") {
    throw new RangeError("selectDraftTarget: draft is not position_first");
  }
  if (state.era_preset !== catalog.era.id) {
    throw new RangeError(
      `selectDraftTarget: catalog era stamp "${catalog.era.id}" does not match the draft's era_preset "${state.era_preset}"`,
    );
  }
  const active = activeSpin(state);
  if (!active) {
    throw new RangeError("selectDraftTarget: the draft has no unresolved spin");
  }
  if (active.status !== "awaiting_slot") {
    throw new RangeError(
      `selectDraftTarget: spin ${active.index} already has a committed target (${active.target_slot_id}) — targets are immutable once the squad rolls`,
    );
  }

  const unresolvedAfter = state.spins.filter(
    (s) => s.status !== "picked" && s.index > active.index,
  ).length;

  if (target === "manager") {
    if (state.manager_card_id !== null) {
      throw new RangeError(
        "selectDraftTarget: a manager has already been drafted (≤1 manager across the 17 spins)",
      );
    }
  } else {
    const slot = state.squad.find((s) => s.slot_id === target);
    if (!slot) {
      throw new RangeError(`selectDraftTarget: unknown slot_id ${target}`);
    }
    if (slot.card_id !== null) {
      throw new RangeError(
        `selectDraftTarget: slot ${target} is already occupied (lock-on-pick: an assigned slot is immutable)`,
      );
    }
    if (state.manager_card_id === null && unresolvedAfter === 0) {
      throw new RangeError(
        "selectDraftTarget: this is the final spin and no manager has been drafted — the manager target is the only legal choice",
      );
    }
  }

  // The draw: identical per-index entropy to squad_first, current context.
  const u = drawValueForIndex(state.draft_seed, active.index);
  const priorPlayerPicks = dedupedFromSpins(state.spins);
  const excluded = new Set(priorPlayerPicks);
  const managerPicked = state.manager_card_id !== null;
  const { entry, draw_probability } = drawSpinEntry(
    catalog,
    u,
    excluded,
    managerPicked,
    state.mode,
  );

  // Honest dead-end checks BEFORE committing anything.
  if (target === "manager") {
    const hasManager =
      state.mode === "open"
        ? openDraftManagerChoices(catalog, entry.nation_id, managerPicked).length > 0
        : entry.coach !== null;
    if (!hasManager) {
      throw new DraftTargetDeadEndError(
        `selectDraftTarget: the drawn squad (tournament ${entry.tournament_id}, nation ${entry.nation_id}) has no coach — no candidate for the manager target in this configured pool; the spin was not consumed`,
      );
    }
  } else {
    const anyPlayerLeft =
      state.mode === "open"
        ? openDraftPlayerCards(catalog, entry.nation_id, excluded).length > 0
        : entry.roster.some((c) => !excluded.has(c.player_id));
    if (!anyPlayerLeft) {
      throw new DraftTargetDeadEndError(
        `selectDraftTarget: every player in the drawn squad (tournament ${entry.tournament_id}, nation ${entry.nation_id}) is already drafted — no candidate for slot ${target}; the spin was not consumed`,
      );
    }
  }

  const rolled = rollPendingSpinFromEntry(
    catalog,
    entry,
    active.index,
    priorPlayerPicks,
    managerPicked,
    draw_probability,
    state.draft_seed,
    state.mode,
    target,
  );
  const spins = state.spins.map((s) => (s.index === active.index ? rolled : s));
  return finalize(state, spins, [...state.squad], state.manager_card_id);
}

// ─── PUBLIC: PICK TRANSITIONS (lock-on-pick) ─────────────────────────────────

/**
 * Confirm a PLAYER pick on the active spin and assign the card to a vacant
 * SquadSlot. `position_compatibility` is computed via `positionCompatibility`
 * and stored; out-of-position / outfielder-in-goal placements add a soft
 * warning but never block. The resolved spin + occupied slot are frozen
 * (lock-on-pick); later pending spins are regenerated to drop the picked
 * player from their candidate pools (and potentially advance to a different
 * (T, N) if their drawn pair becomes depleted by this pick).
 *
 * @throws RangeError if the draft is complete, the card is not a candidate on
 *   the active spin, the player is already drafted, the slot is unknown, or the
 *   slot is already occupied (an assigned slot is immutable).
 */
export function pickPlayer(catalog: DraftCatalog, state: DraftState, card_id: CardId): DraftState;
export function pickPlayer(
  catalog: DraftCatalog,
  state: DraftState,
  card_id: CardId,
  slot_id: string,
): DraftState;
export function pickPlayer(
  catalog: DraftCatalog,
  state: DraftState,
  card_id: CardId,
  slot_id?: string,
): DraftState {
  const active = activeSpin(state);
  if (!active) {
    throw new RangeError("pickPlayer: the draft has no pending spin (all 17 are resolved)");
  }
  if (active.status === "awaiting_slot") {
    throw new RangeError(
      `pickPlayer: spin ${active.index} has no committed target yet — call selectDraftTarget first (position_first)`,
    );
  }
  const positionFirst = state.draft_flow === "position_first";
  if (positionFirst) {
    if (active.target_slot_id === "manager") {
      throw new RangeError(
        `pickPlayer: spin ${active.index} is committed to the manager target — only pickManager is legal`,
      );
    }
    if (slot_id !== undefined && slot_id !== active.target_slot_id) {
      throw new RangeError(
        `pickPlayer: slot ${slot_id} does not match the committed target ${active.target_slot_id} (position_first fills only its target)`,
      );
    }
    slot_id = active.target_slot_id ?? undefined;
  }
  if (!active.rolled_card_ids.includes(card_id)) {
    throw new RangeError(`pickPlayer: card ${card_id} is not a candidate on spin ${active.index}`);
  }
  const parsed = parseCardId(card_id);
  if (!parsed) {
    throw new RangeError(`pickPlayer: card_id ${card_id} is not a well-formed CardId`);
  }
  if (state.mode !== "open" && parsed.tournament_id !== active.tournament_id) {
    throw new RangeError(
      `pickPlayer: card ${card_id} tournament does not match spin ${active.index}`,
    );
  }
  if (state.deduped_player_ids.includes(parsed.player_id)) {
    // Defensive: rolled candidates are already dedup-filtered; this can only
    // fire on a contract bug.
    throw new RangeError(
      `pickPlayer: player ${parsed.player_id} is already drafted (global dedup)`,
    );
  }

  // STRAND GUARD: a complete draft needs exactly one manager.
  //   squad_first — if none is drafted yet and NO later spin offers a coach,
  //   the active spin is the last chance to take one (later pending spins
  //   carry a non-null rolled_manager_card_id iff their drawn (T,N) has a
  //   coach, since no manager is drafted yet).
  //   position_first — later spins are unmaterialized placeholders, so this
  //   inductive read is impossible; the equivalent forcing lives in
  //   `selectDraftTarget` (final unresolved spin + no manager → manager
  //   target only). Defensively reject a player pick that would leave zero
  //   unresolved spins with no manager drafted.
  if (state.manager_card_id === null) {
    if (positionFirst) {
      const unresolvedAfter = state.spins.filter(
        (s) => s.status !== "picked" && s.index > active.index,
      ).length;
      if (unresolvedAfter === 0) {
        throw new RangeError(
          `pickPlayer: spin ${active.index} is the last unresolved spin and no manager is drafted — a player pick here would strand the draft (selectDraftTarget should have forced the manager target)`,
        );
      }
    } else {
      const laterCoachOffered = state.spins.some(
        (s) =>
          s.index > active.index &&
          (s.rolled_manager_card_id !== null || (s.rolled_manager_card_ids?.length ?? 0) > 0),
      );
      if (!laterCoachOffered) {
        throw new RangeError(
          `pickPlayer: no manager is drafted and no later spin offers a coach — the manager must be drafted on spin ${active.index} now; a player pick here would strand the draft`,
        );
      }
    }
  }

  const entry = catalog.byPair.get(pairKey(active.tournament_id, active.nation_id));
  if (!entry) {
    throw new RangeError(
      `pickPlayer: no catalog entry for spin ${active.index} (tournament ${active.tournament_id}, nation ${active.nation_id})`,
    );
  }
  const pcard =
    state.mode === "open"
      ? openDraftPlayerCards(catalog, active.nation_id, new Set(active.excluded_player_ids)).find(
          (c) => c.player_id === parsed.player_id && c.tournament_id === parsed.tournament_id,
        )
      : entry.roster.find((c) => c.player_id === parsed.player_id);
  if (!pcard) {
    throw new RangeError(
      state.mode === "open"
        ? `pickPlayer: player ${parsed.player_id} is not in the open roster for nation ${active.nation_id}`
        : `pickPlayer: player ${parsed.player_id} is not in the (tournament ${active.tournament_id}, nation ${active.nation_id}) roster`,
    );
  }

  const targetSlotId = slot_id ?? firstVacantSlotId(state);
  if (targetSlotId === null) {
    throw new RangeError("pickPlayer: no vacant SquadSlot is available for this player");
  }
  const slot = state.squad.find((s) => s.slot_id === targetSlotId);
  if (!slot) {
    throw new RangeError(`pickPlayer: unknown slot_id ${targetSlotId}`);
  }
  if (slot.card_id !== null) {
    throw new RangeError(
      `pickPlayer: slot ${targetSlotId} is already occupied (lock-on-pick: an assigned slot is immutable)`,
    );
  }

  const compat = positionCompatibility(pcard.eligible_positions, slot.slot_position);
  const newCardId = buildCardId(parsed.player_id, parsed.tournament_id);
  const newSlot = freezeSlot({
    ...slot,
    card_id: newCardId,
    player_id: parsed.player_id,
    tournament_id: parsed.tournament_id,
    position_compatibility: compat,
    validation_warnings: buildSlotWarnings(slot.slot_position, pcard.eligible_positions, compat),
  });
  const squad = state.squad.map((s) => (s.slot_id === targetSlotId ? newSlot : s));

  const pickedSpin = freezeSpin({
    ...active,
    picked_kind: "player",
    picked_card_id: newCardId,
    picked_player_id: parsed.player_id,
    assigned_slot_id: targetSlotId,
    picked_manager_card_id: null,
    status: "picked",
  });
  const withPick = state.spins.map((s) => (s.index === active.index ? pickedSpin : s));
  // squad_first regenerates later PENDING spins (dedup / coach availability /
  // depletion advance). position_first has nothing to regenerate — later
  // spins are unmaterialized placeholders until their targets are committed.
  const spins = positionFirst
    ? withPick
    : rebuildSpins(catalog, state.draft_seed, withPick, state.mode);

  return finalize(state, spins, squad, state.manager_card_id);
}

/**
 * Confirm a MANAGER pick on the active spin. The coach goes to the dedicated
 * `DraftState.manager_card_id` slot — NEVER a SquadSlot — and no later spin
 * offers a coach. ≤1 manager across the run.
 *
 * @throws RangeError if the draft is complete, a manager has already been
 *   drafted, or the active spin offers no coach.
 */
export function pickManager(
  catalog: DraftCatalog,
  state: DraftState,
  manager_card_id?: ManagerCardId,
): DraftState {
  const active = activeSpin(state);
  if (!active) {
    throw new RangeError("pickManager: the draft has no pending spin (all 17 are resolved)");
  }
  if (active.status === "awaiting_slot") {
    throw new RangeError(
      `pickManager: spin ${active.index} has no committed target yet — call selectDraftTarget first (position_first)`,
    );
  }
  const positionFirst = state.draft_flow === "position_first";
  if (positionFirst && active.target_slot_id !== "manager") {
    throw new RangeError(
      `pickManager: spin ${active.index} is committed to slot ${active.target_slot_id} — only a player pick into that slot is legal`,
    );
  }
  if (state.manager_card_id !== null) {
    throw new RangeError(
      "pickManager: a manager has already been drafted (≤1 manager across the 17 spins)",
    );
  }
  const managerOffers =
    state.mode === "open"
      ? (active.rolled_manager_card_ids ?? [])
      : active.rolled_manager_card_id === null
        ? []
        : [active.rolled_manager_card_id];
  if (managerOffers.length === 0) {
    throw new RangeError(`pickManager: spin ${active.index} offers no coach`);
  }
  const mgr = manager_card_id ?? managerOffers[0]!;
  if (!managerOffers.includes(mgr)) {
    throw new RangeError(`pickManager: manager ${mgr} is not a candidate on spin ${active.index}`);
  }
  const pickedSpin = freezeSpin({
    ...active,
    picked_kind: "manager",
    picked_card_id: null,
    picked_player_id: null,
    assigned_slot_id: null,
    picked_manager_card_id: mgr,
    status: "picked",
  });
  const withPick = state.spins.map((s) => (s.index === active.index ? pickedSpin : s));
  const spins = positionFirst
    ? withPick
    : rebuildSpins(catalog, state.draft_seed, withPick, state.mode);
  // Squad untouched: the manager never occupies a SquadSlot.
  return finalize(state, spins, state.squad, mgr);
}

// ─── PUBLIC: DEFAULT AUTOPILOT POLICY ────────────────────────────────────────

/**
 * Advance the draft by exactly one spin using the deterministic default policy.
 * The policy is purely STATE-DERIVED (no hidden counters), so stepping from a
 * resumed snapshot reproduces the same forward sequence (lock-on-pick resume):
 *
 *   - Take the MANAGER the first time a coach is offered and none is drafted
 *     yet (≤1 manager; the other 16 spins fill the 16 player slots exactly).
 *   - Otherwise take the canonically-first player candidate
 *     (`rolled_card_ids[0]`) and assign it to the first vacant slot (starters
 *     before bench).
 *
 * @throws RangeError if the draft is complete, a player spin has no candidates,
 *   or no coach is ever offered (a 17th player has nowhere to go).
 */
export function stepDraft(catalog: DraftCatalog, state: DraftState): DraftState {
  if (state.draft_flow !== "squad_first") {
    // The default policy is squad-first-shaped (pick first, slot second).
    // Position-first walks are driven explicitly (selectDraftTarget → pick);
    // tests/harnesses own their own target policies.
    throw new RangeError("stepDraft: only squad_first drafts use the default autopilot policy");
  }
  const active = activeSpin(state);
  if (!active) {
    throw new RangeError("stepDraft: the draft is already complete");
  }
  const needManager = state.manager_card_id === null;
  if (
    needManager &&
    (active.rolled_manager_card_id !== null || (active.rolled_manager_card_ids?.length ?? 0) > 0)
  ) {
    return pickManager(catalog, state);
  }
  if (active.rolled_card_ids.length === 0) {
    throw new RangeError(
      `stepDraft: spin ${active.index} has no player candidates and no coach to draft`,
    );
  }
  const slotId = firstVacantSlotId(state);
  if (slotId === null) {
    throw new RangeError(
      `stepDraft: no vacant slot for a player at spin ${active.index} — was a coach ever offered?`,
    );
  }
  return pickPlayer(catalog, state, active.rolled_card_ids[0]!, slotId);
}

/**
 * Run a full 17-spin draft to completion with the deterministic default policy.
 * Identical (params, dataset) → byte-identical DraftState. This is the harness
 * the golden tests exercise; real gameplay drives `pickPlayer` / `pickManager`
 * from user choices instead.
 */
export function autoDraft(input: CreateDraftParams & { dataset: DraftDataset }): DraftState {
  const { dataset, ...params } = input;
  const catalog = buildDraftCatalog(dataset, params.era_preset);
  let state = createDraft(catalog, params);
  while (!isDraftComplete(state)) {
    state = stepDraft(catalog, state);
  }
  return state;
}

// ─── PUBLIC: SQUAD VALIDATION (soft summary) ─────────────────────────────────

/**
 * Compute the squad-level validation summary. `is_fieldable` (11 starters
 * assigned) is the ONLY hard gate; everything else is a soft warning surfaced
 * to the UI / sim (no-GK, out-of-position, missing manager on a complete draft).
 */
export function validateSquad(state: DraftState): SquadValidation {
  const starters = state.squad.filter((s) => s.is_starter);
  const is_fieldable = starters.every((s) => s.card_id !== null);
  const gkSlot = starters.find((s) => slotPositionLine(s.slot_position) === "GK");
  const has_goalkeeper = !!gkSlot && gkSlot.card_id !== null && gkSlot.position_compatibility === 1;

  const warnings: string[] = [];
  for (const slot of state.squad) {
    for (const w of slot.validation_warnings) warnings.push(`${slot.slot_id}: ${w}`);
  }
  if (!is_fieldable) {
    warnings.push("XI incomplete: not all 11 starter slots are filled");
  }
  if (!has_goalkeeper) {
    warnings.push("no recognised goalkeeper in the XI — outfielder-in-goal penalty applies");
  }
  if (state.manager_card_id === null && isDraftComplete(state)) {
    warnings.push("no manager drafted");
  }
  return { is_fieldable, has_goalkeeper, warnings };
}

// ─── TEST-ONLY INTROSPECTION (ENGINE-V2 E-1) ─────────────────────────────────
//
// Internal-only helpers exposed for the era-weighting + distribution-probe
// tests. NOT re-exported from `packages/core/src/index.ts` — consumers MUST
// not depend on these; they may evolve as the engine evolves.

/** Test-only: return a frozen view of a catalog entry's era-weighting fields. */
export function _testGetEntryWeight(
  catalog: DraftCatalog,
  tournament_id: number,
  nation_id: string,
): { year: number; rare: boolean; base_draw_weight: number } | null {
  const e = catalog.byPair.get(pairKey(tournament_id, nation_id));
  if (!e) return null;
  return Object.freeze({
    year: e.year,
    rare: e.rare,
    base_draw_weight: e.base_draw_weight,
  });
}

/** Test-only: total of all `base_draw_weight` over the catalog (≈ 1.0). */
export function _testTotalCatalogWeight(catalog: DraftCatalog): number {
  return catalog.cumulativeWeights[catalog.cumulativeWeights.length - 1] ?? 0;
}

/** Test-only: aggregate rare/modern mass over the catalog (for the era probe). */
export function _testEraMassSplit(catalog: DraftCatalog): { rare: number; modern: number } {
  let rare = 0;
  let modern = 0;
  for (const e of catalog.pairs) {
    if (e.rare) rare += e.base_draw_weight;
    else modern += e.base_draw_weight;
  }
  return { rare, modern };
}
