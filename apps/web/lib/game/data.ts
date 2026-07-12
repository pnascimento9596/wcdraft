// Runtime data loader + immutable indexes for the web game layer.
//
// What this owns:
//   - Lazy-load `RuntimeDataManifest` + `DraftPoolBundle` via
//     `@wcdraft/data/client` (browser fetch). NEVER imports the top-level
//     `@wcdraft/data` static JSON exports — those would inline the 22MB
//     uncompressed bundle into the homepage.
//   - Build `GameDataIndexes` (read-only Map lookups) for adapters.
//   - Build the `DraftDataset` + `DraftCatalog` consumed by `createDraft`.
//   - Compose `RunRecordVersions` from the manifest (the eviction key).
//   - Session-memoize the result. One bundle parse per browser session.
//
// The dataset/catalog construction mirrors the e2e golden test pattern in
// `packages/data/test/e2e-real-run.golden.test.ts` — same field-by-field
// mapping so behaviour stays consistent with the locked golden.

import {
  buildDraftCatalog,
  type DraftCatalog,
  type DraftDataset,
  type EraPresetId,
} from "@wcdraft/core";
import {
  boundedRequest,
  isRequestTimeoutError,
  loadDailySeedSaltMap,
  loadDataManifest,
  loadDraftPoolBundle,
  REQUEST_BUDGET_MS,
} from "@wcdraft/data/client";
import type {
  DailySeedSaltMap,
  DraftPoolBundle,
  RuntimeDataManifest,
  RuntimeManagerCard,
  RuntimePlayerCard,
  RuntimeRating,
} from "@wcdraft/data";

import { MissingRecordError, RuntimeDataLoadError, toRuntimeDataLoadError } from "./errors";
import { dailyCoverageForDate } from "./daily";
import { composeVersions, type RunRecordVersions } from "./versions";
import { displayNameFromNames, fullDisplayName } from "./display-names";
import {
  type RuntimeDataServiceWorkerHandoff,
  waitForRuntimeDataServiceWorkerHandoff,
} from "../service-worker";

export { composeVersions, type RunRecordVersions } from "./versions";

/** Read-only lookup maps over the compact bundle. */
export interface GameDataIndexes {
  playerByCardId: ReadonlyMap<string, RuntimePlayerCard>;
  managerByCardId: ReadonlyMap<string, RuntimeManagerCard>;
  ratingByCardId: ReadonlyMap<string, RuntimeRating>;
  nationById: ReadonlyMap<string, { canonical_name: string; code: string | null }>;
  tournamentById: ReadonlyMap<number, { year: number; name: string }>;
  /**
   * q-005 — surname-collision disambiguation. Card → display name, present
   * ONLY for cards whose short name (`common_name`, falling back to
   * `full_name`) is shared by more than one distinct `player_id` in the pool
   * (e.g. Cesare vs Paolo "Maldini"). The override is the given-name-initial
   * form ("C. Maldini") when the short name is the final token of the full
   * name, otherwise the full name; if initial forms still collide across
   * different players, both fall back to the full name. Display-only.
   */
  displayNameByCardId: ReadonlyMap<string, string>;
}

/** The full bundle of loaded data, indexes, and engine-ready inputs. */
export interface GameData {
  manifest: RuntimeDataManifest;
  draftPool: DraftPoolBundle;
  versions: RunRecordVersions;
  indexes: GameDataIndexes;
  draftDataset: DraftDataset;
  catalog: DraftCatalog;
  nationByCardId: Readonly<Record<string, string>>;
  dailySeedSaltMap: DailySeedSaltMap | null;
}

let cachedGameData: GameData | null = null;
let inFlight: Promise<GameData> | null = null;

export interface GameDataLoadDeps {
  waitForHandoff: () => Promise<unknown>;
  loadManifest: () => Promise<RuntimeDataManifest>;
  loadDraftPool: (opts: { manifest: RuntimeDataManifest }) => Promise<DraftPoolBundle>;
  loadSaltMap: (opts: { manifest: RuntimeDataManifest }) => Promise<DailySeedSaltMap>;
  build: typeof buildGameData;
}

/** Test-only — drop the session memo (no production caller). */
export function clearGameDataCacheForTests(): void {
  cachedGameData = null;
  inFlight = null;
}

/**
 * Page-side half of the cold-install transfer handoff. The manifest remains
 * free to load concurrently, but the large pool request waits until the new
 * worker controls this page (or the bounded coordinator deliberately falls
 * through). Exported for an executable uncontrolled-page race test.
 */
export async function loadDraftPoolAfterServiceWorkerHandoff({
  manifest,
  waitForHandoff = waitForRuntimeDataServiceWorkerHandoff,
  loadDraftPool = loadDraftPoolBundle,
}: {
  manifest: RuntimeDataManifest;
  waitForHandoff?: () => Promise<RuntimeDataServiceWorkerHandoff>;
  loadDraftPool?: (opts: { manifest: RuntimeDataManifest }) => Promise<DraftPoolBundle>;
}): Promise<DraftPoolBundle> {
  const handoff = await waitForHandoff();
  if (handoff === "timed-out") {
    throw new Error("Runtime-data service-worker promotion timed out");
  }
  return loadDraftPool({ manifest });
}

/**
 * Load one coherent runtime-data revision. All revision-bearing requests start
 * only after the same service-worker controller has been selected. A slow
 * install fails this attempt instead of launching duplicate pool work while
 * the worker is still filling its atomic cache.
 */
export async function loadRuntimeDataAfterServiceWorkerHandoff({
  waitForHandoff = waitForRuntimeDataServiceWorkerHandoff,
  loadManifest = loadDataManifest,
  loadDraftPool = loadDraftPoolBundle,
  loadDailyMap = loadDailySeedSaltMap,
}: {
  waitForHandoff?: () => Promise<RuntimeDataServiceWorkerHandoff>;
  loadManifest?: () => Promise<RuntimeDataManifest>;
  loadDraftPool?: (opts: { manifest: RuntimeDataManifest }) => Promise<DraftPoolBundle>;
  loadDailyMap?: (opts: { manifest: RuntimeDataManifest }) => Promise<DailySeedSaltMap>;
} = {}): Promise<{
  manifest: RuntimeDataManifest;
  draftPool: DraftPoolBundle;
  dailySeedSaltMap: DailySeedSaltMap | null;
}> {
  const handoff = await waitForHandoff();
  if (handoff === "timed-out") {
    throw new Error("Runtime-data service-worker promotion timed out");
  }

  const manifest = await loadManifest();
  const [draftPool, dailySeedSaltMap] = await Promise.all([
    loadDraftPool({ manifest }),
    manifest.bundles.daily_seed_salt_map === undefined
      ? Promise.resolve(null)
      : loadDailyMap({ manifest }),
  ]);
  return { manifest, draftPool, dailySeedSaltMap };
}

/**
 * Lightweight Daily availability probe for the mode picker. It fetches only
 * the small manifest and salt map; the decoded draft pool remains on the
 * actual play path. Missing, malformed, or inconsistent metadata is an honest
 * unavailable result.
 */
export async function loadDailyAvailability(date: string): Promise<boolean> {
  try {
    return await boundedRequest(
      async (signal) => {
        const manifest = await loadDataManifest({
          signal,
          timeoutMs: REQUEST_BUDGET_MS.dailyMetadata,
        });
        if (manifest.bundles.daily_seed_salt_map === undefined) return false;
        const saltMap = await loadDailySeedSaltMap({
          manifest,
          signal,
          timeoutMs: REQUEST_BUDGET_MS.dailyMetadata,
        });
        return dailyCoverageForDate(date, saltMap).covered;
      },
      {
        operation: "Daily metadata",
        timeoutMs: REQUEST_BUDGET_MS.dailyMetadata,
        safety: "safe-read",
      },
    );
  } catch (err) {
    if (isRequestTimeoutError(err)) {
      throw new RuntimeDataLoadError(
        "Daily metadata took too long to load. Retry the check or choose another mode.",
        err,
      );
    }
    console.error("[daily] availability metadata failed", err);
    return false;
  }
}

/**
 * Build (or return the memoized) `GameData`. Multiple concurrent callers
 * share a single in-flight fetch. On error the in-flight slot is cleared so
 * a subsequent retry attempts a fresh fetch.
 */
export async function loadGameData(): Promise<GameData> {
  if (cachedGameData) return cachedGameData;
  if (inFlight) return inFlight;
  inFlight = boundedRequest(
    async (signal) => {
      try {
        // Select one controller before any revision-bearing request begins.
        // This prevents an old manifest from being combined with a new pool.
        // The D1 signal still binds every fetch to the shared 30-second budget.
        const gd = await loadGameDataUncached({
          waitForHandoff: waitForRuntimeDataServiceWorkerHandoff,
          loadManifest: () => loadDataManifest({ signal }),
          loadDraftPool: ({ manifest }) => loadDraftPoolBundle({ manifest, signal }),
          loadSaltMap: ({ manifest }) => loadDailySeedSaltMap({ manifest, signal }),
          build: buildGameData,
        });
        cachedGameData = gd;
        return gd;
      } catch (err) {
        throw toRuntimeDataLoadError("Failed to load wcdraft runtime data", err);
      }
    },
    {
      operation: "runtime game data",
      timeoutMs: REQUEST_BUDGET_MS.runtimeData,
      safety: "safe-read",
    },
  )
    .catch((err: unknown) => {
      throw toRuntimeDataLoadError("Failed to load wcdraft runtime data", err);
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Build/version anchors are unreachable until every bundle passes manifest verification. */
export async function loadGameDataUncached(deps: GameDataLoadDeps): Promise<GameData> {
  const handoff = await deps.waitForHandoff();
  if (handoff === "timed-out") {
    throw new Error("Runtime-data service-worker promotion timed out");
  }
  const manifest = await deps.loadManifest();
  const [draftPool, dailySeedSaltMap] = await Promise.all([
    deps.loadDraftPool({ manifest }),
    manifest.bundles.daily_seed_salt_map === undefined
      ? Promise.resolve(null)
      : deps.loadSaltMap({ manifest }),
  ]);
  return deps.build(manifest, draftPool, dailySeedSaltMap);
}

export function buildGameData(
  manifest: RuntimeDataManifest,
  draftPool: DraftPoolBundle,
  dailySeedSaltMap: DailySeedSaltMap | null = null,
): GameData {
  const indexes = buildGameDataIndexes(draftPool);
  validateIndexes(draftPool, indexes);
  const draftDataset = buildDraftDataset(draftPool);
  const catalog = buildDraftCatalog(draftDataset);
  const versions = composeVersions(manifest);
  return {
    manifest,
    draftPool,
    versions,
    indexes,
    draftDataset,
    catalog,
    nationByCardId: draftPool.nation_by_card_id,
    dailySeedSaltMap,
  };
}

// ─── DC-2 — era-filtered catalogs ────────────────────────────────────────────

/**
 * Per-GameData cache of era-filtered catalogs. The default (`all_time`)
 * preset returns `gameData.catalog` BY OBJECT IDENTITY — the default path is
 * provably the same catalog the rest of the app already uses, not a rebuilt
 * twin. Non-default catalogs build lazily once per (GameData, preset).
 */
const eraCatalogCache = new WeakMap<GameData, Map<EraPresetId, DraftCatalog>>();

export function getCatalogForEra(gameData: GameData, era_preset: EraPresetId): DraftCatalog {
  if (era_preset === "all_time") return gameData.catalog;
  let cache = eraCatalogCache.get(gameData);
  if (!cache) {
    cache = new Map();
    eraCatalogCache.set(gameData, cache);
  }
  let catalog = cache.get(era_preset);
  if (!catalog) {
    catalog = buildDraftCatalog(gameData.draftDataset, era_preset);
    cache.set(era_preset, catalog);
  }
  return catalog;
}

/** Build read-only Maps from the compact bundle arrays + objects. */
export function buildGameDataIndexes(bundle: DraftPoolBundle): GameDataIndexes {
  const playerByCardId = new Map<string, RuntimePlayerCard>();
  for (const c of bundle.player_cards) playerByCardId.set(c.card_id, c);

  const managerByCardId = new Map<string, RuntimeManagerCard>();
  for (const m of bundle.manager_cards) managerByCardId.set(m.manager_card_id, m);

  const ratingByCardId = new Map<string, RuntimeRating>();
  for (const r of bundle.ratings) ratingByCardId.set(r.card_id, r);

  const nationById = new Map<string, { canonical_name: string; code: string | null }>();
  for (const nid of Object.keys(bundle.nations)) {
    const entry = bundle.nations[nid];
    if (entry) nationById.set(nid, entry);
  }

  const tournamentById = new Map<number, { year: number; name: string }>();
  for (const tidStr of Object.keys(bundle.tournaments)) {
    const tid = Number(tidStr);
    if (!Number.isFinite(tid)) continue;
    const entry = bundle.tournaments[tidStr];
    if (entry) tournamentById.set(tid, entry);
  }

  const displayNameByCardId = buildDisplayNameOverrides(bundle.player_cards);

  return {
    playerByCardId,
    managerByCardId,
    ratingByCardId,
    nationById,
    tournamentById,
    displayNameByCardId,
  };
}

/** Short display name before disambiguation — mirrors the adapter fallback. */
function baseDisplayName(c: RuntimePlayerCard): string {
  return displayNameFromNames(c.common_name, c.full_name);
}

/**
 * Given-name-initial form ("C. Maldini") when the short name is the final
 * token of a multi-token full name; null when that shape doesn't hold
 * (mononyms, nicknames unrelated to the surname).
 */
function initialForm(c: RuntimePlayerCard, base: string): string | null {
  const tokens = fullDisplayName(c.full_name).split(/\s+/);
  if (tokens.length < 2) return null;
  if (tokens[tokens.length - 1]!.toLowerCase() !== base.toLowerCase()) return null;
  return `${tokens[0]!.charAt(0).toUpperCase()}. ${base}`;
}

/** See `GameDataIndexes.displayNameByCardId`. */
export function buildDisplayNameOverrides(
  cards: readonly RuntimePlayerCard[],
): ReadonlyMap<string, string> {
  // Group cards by short display name once. Keeping the base beside each card
  // avoids both the old whole-array rescan per collision and repeated name
  // normalization inside the collision passes.
  const groupsByName = new Map<
    string,
    {
      cards: { card: RuntimePlayerCard; base: string }[];
      playerIds: Set<string>;
    }
  >();
  for (const c of cards) {
    const base = baseDisplayName(c);
    const key = base.toLowerCase();
    const group = groupsByName.get(key);
    if (group) {
      group.cards.push({ card: c, base });
      group.playerIds.add(c.player_id);
    } else {
      groupsByName.set(key, {
        cards: [{ card: c, base }],
        playerIds: new Set([c.player_id]),
      });
    }
  }

  const overrides = new Map<string, string>();
  for (const group of groupsByName.values()) {
    if (group.playerIds.size < 2) continue;
    // First pass: candidate per card (initial form, else full name).
    const candidateByCard = new Map<string, string>();
    const playersByCandidate = new Map<string, Set<string>>();
    for (const { card: c, base } of group.cards) {
      const cand = initialForm(c, base) ?? fullDisplayName(c.full_name);
      candidateByCard.set(c.card_id, cand);
      const set = playersByCandidate.get(cand.toLowerCase()) ?? new Set<string>();
      set.add(c.player_id);
      playersByCandidate.set(cand.toLowerCase(), set);
    }
    // Second pass: if a candidate is still shared by >1 player, fall back to
    // the full name (year on the card disambiguates any remaining tie).
    for (const { card: c } of group.cards) {
      const cand = candidateByCard.get(c.card_id)!;
      const stillShared = playersByCandidate.get(cand.toLowerCase())!.size > 1;
      overrides.set(c.card_id, stillShared ? fullDisplayName(c.full_name) : cand);
    }
  }
  return overrides;
}

/**
 * Cross-validate the compact bundle once at load time so adapter joins can
 * trust the indexes. Anything that would have become a silent fallback gets
 * caught here with a precise MissingRecordError.
 */
function validateIndexes(bundle: DraftPoolBundle, idx: GameDataIndexes): void {
  for (const c of bundle.player_cards) {
    if (!c.eligible_positions || c.eligible_positions.length === 0) {
      throw new MissingRecordError(
        "player_card",
        c.card_id,
        "eligible_positions is empty (compatibility cannot be computed)",
      );
    }
    if (!idx.ratingByCardId.has(c.card_id)) {
      throw new MissingRecordError("rating", c.card_id, "no rating for draftable player card");
    }
    if (!idx.nationById.has(c.nation_id)) {
      throw new MissingRecordError("nation", c.nation_id, `for card ${c.card_id}`);
    }
    if (!idx.tournamentById.has(c.tournament_id)) {
      throw new MissingRecordError("tournament", String(c.tournament_id), `for card ${c.card_id}`);
    }
  }
  for (const m of bundle.manager_cards) {
    if (!idx.nationById.has(m.nation_id)) {
      throw new MissingRecordError("nation", m.nation_id, `for manager ${m.manager_card_id}`);
    }
    if (!idx.tournamentById.has(m.tournament_id)) {
      throw new MissingRecordError(
        "tournament",
        String(m.tournament_id),
        `for manager ${m.manager_card_id}`,
      );
    }
  }
}

function buildDraftDataset(bundle: DraftPoolBundle): DraftDataset {
  const ratingByCardId = new Map<string, RuntimeRating>();
  for (const rating of bundle.ratings) ratingByCardId.set(rating.card_id, rating);
  return {
    players: bundle.player_cards.map((c) => ({
      player_id: c.player_id,
      tournament_id: c.tournament_id,
      nation_id: c.nation_id,
      eligible_positions: c.eligible_positions,
      choice_overall: ratingByCardId.get(c.card_id)?.overall ?? null,
    })),
    managers: bundle.manager_cards.map((m) => ({
      manager_id: m.manager_id,
      tournament_id: m.tournament_id,
      nation_id: m.nation_id,
    })),
    // ENGINE-V2 E-1: era-weighted sampling needs tournament years. The
    // DraftPoolBundle already carries `{ year, name }` per tournament; map
    // it onto the engine's narrow DraftTournament view.
    tournaments: Object.entries(bundle.tournaments).map(([tid, t]) => ({
      tournament_id: Number(tid),
      year: t.year,
    })),
  };
}
