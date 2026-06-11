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
import { loadDataManifest, loadDraftPoolBundle } from "@wcdraft/data/client";
import type {
  DraftPoolBundle,
  RuntimeDataManifest,
  RuntimeManagerCard,
  RuntimePlayerCard,
  RuntimeRating,
} from "@wcdraft/data";

import { MissingRecordError, RuntimeDataLoadError } from "./errors";

/** Version-anchor bundle written into every `RunRecordV1`. */
export interface RunRecordVersions {
  schema_version: string;
  dataset_version: string;
  /** Combined `historical+projected` per the e2e golden convention. */
  rating_version: string;
  engine_version: string;
  ruleset_version: string;
  /** Composite `draft_pool.sha256+scenario_2026.sha256`. */
  data_bundle_hash: string;
}

/** Read-only lookup maps over the compact bundle. */
export interface GameDataIndexes {
  playerByCardId: ReadonlyMap<string, RuntimePlayerCard>;
  managerByCardId: ReadonlyMap<string, RuntimeManagerCard>;
  ratingByCardId: ReadonlyMap<string, RuntimeRating>;
  nationById: ReadonlyMap<string, { canonical_name: string; code: string | null }>;
  tournamentById: ReadonlyMap<number, { year: number; name: string }>;
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
}

let cachedGameData: GameData | null = null;
let inFlight: Promise<GameData> | null = null;

/** Test-only — drop the session memo (no production caller). */
export function clearGameDataCacheForTests(): void {
  cachedGameData = null;
  inFlight = null;
}

/**
 * Build (or return the memoized) `GameData`. Multiple concurrent callers
 * share a single in-flight fetch. On error the in-flight slot is cleared so
 * a subsequent retry attempts a fresh fetch.
 */
export async function loadGameData(): Promise<GameData> {
  if (cachedGameData) return cachedGameData;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const manifest = await loadDataManifest();
      const draftPool = await loadDraftPoolBundle();
      const gd = buildGameData(manifest, draftPool);
      cachedGameData = gd;
      return gd;
    } catch (err) {
      throw new RuntimeDataLoadError(
        `Failed to load wcdraft runtime data: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function buildGameData(
  manifest: RuntimeDataManifest,
  draftPool: DraftPoolBundle,
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

/** Compose the eviction-key version bundle from the manifest. */
export function composeVersions(manifest: RuntimeDataManifest): RunRecordVersions {
  return {
    schema_version: manifest.schema_version,
    dataset_version: manifest.dataset_version,
    rating_version: `${manifest.rating_version_historical}+${manifest.rating_version_projected}`,
    engine_version: manifest.engine_version,
    ruleset_version: manifest.ruleset_version,
    data_bundle_hash: `${manifest.bundles.draft_pool.sha256}+${manifest.bundles.scenario_2026.sha256}`,
  };
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

  return { playerByCardId, managerByCardId, ratingByCardId, nationById, tournamentById };
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
      throw new MissingRecordError(
        "tournament",
        String(c.tournament_id),
        `for card ${c.card_id}`,
      );
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
  return {
    players: bundle.player_cards.map((c) => ({
      player_id: c.player_id,
      tournament_id: c.tournament_id,
      nation_id: c.nation_id,
      eligible_positions: c.eligible_positions,
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
