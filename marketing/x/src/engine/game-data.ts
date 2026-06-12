// Self-contained game-data + sim-world assembly for the marketing poster.
//
// This is a FAITHFUL, golden-locked port of the field-by-field mappings in
// `apps/web/lib/game/data.ts` (buildGameDataIndexes / buildDraftDataset /
// composeVersions / getCatalogForEra) and `apps/web/lib/game/simulate.ts`
// (buildSimWorldInputs) + `apps/web/lib/game/adapters.ts`
// (managerTournamentFor). We reproduce rather than import so the marketing
// package stays decoupled from the Next.js app (server/app untouched), and we
// pin the result with a golden fixture (`run-from-token` test): if any mapping
// here ever drifts from the app's sim, the pinned record breaks. Every claim
// in a result-spotlight post therefore matches what the live app shows for the
// same share token, or it is not posted.
//
// The data comes straight from the committed compact bundle (@wcdraft/data),
// the same bytes the app ships, so a record produced here is the record a
// player sees.

import {
  buildDraftCatalog,
  buildRunScenario,
  runTournamentFull,
  type Bracket2026,
  type DraftCatalog,
  type DraftDataset,
  type DraftState,
  type EraPresetId,
  type ManagerTournament,
  type Rating,
  type RunResult,
  type SimWorld,
  type Team2026,
} from "@wcdraft/core";
import {
  DRAFT_POOL_BUNDLE,
  RUNTIME_DATA_MANIFEST,
  SCENARIO_2026_BUNDLE,
  type DraftPoolBundle,
  type RuntimeDataManifest,
  type RuntimeManagerCard,
  type RuntimePlayerCard,
  type RuntimeRating,
  type Scenario2026Bundle,
} from "@wcdraft/data";

export interface RunRecordVersions {
  schema_version: string;
  dataset_version: string;
  rating_version: string;
  engine_version: string;
  ruleset_version: string;
  data_bundle_hash: string;
}

export interface MarketingGameData {
  manifest: RuntimeDataManifest;
  bundle: DraftPoolBundle;
  scenario: Scenario2026Bundle;
  versions: RunRecordVersions;
  catalog: DraftCatalog;
  draftDataset: DraftDataset;
  playerByCardId: ReadonlyMap<string, RuntimePlayerCard>;
  managerByCardId: ReadonlyMap<string, RuntimeManagerCard>;
  ratingByCardId: ReadonlyMap<string, RuntimeRating>;
  nationById: ReadonlyMap<string, { canonical_name: string; code: string | null }>;
  tournamentById: ReadonlyMap<number, { year: number; name: string }>;
  nationByCardId: Readonly<Record<string, string>>;
  playerByPlayerId: ReadonlyMap<string, RuntimePlayerCard[]>;
}

let cached: MarketingGameData | null = null;

/** Build (or return the memoized) marketing game data from the compact bundle. */
export function loadMarketingGameData(): MarketingGameData {
  if (cached) return cached;

  const bundle = DRAFT_POOL_BUNDLE;
  const scenario = SCENARIO_2026_BUNDLE;
  const manifest = RUNTIME_DATA_MANIFEST;

  const playerByCardId = new Map<string, RuntimePlayerCard>();
  const playerByPlayerId = new Map<string, RuntimePlayerCard[]>();
  for (const c of bundle.player_cards) {
    playerByCardId.set(c.card_id, c);
    const list = playerByPlayerId.get(c.player_id) ?? [];
    list.push(c);
    playerByPlayerId.set(c.player_id, list);
  }

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

  // Mirrors apps/web/lib/game/data.ts buildDraftDataset.
  const draftDataset: DraftDataset = {
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
    tournaments: Object.entries(bundle.tournaments).map(([tid, t]) => ({
      tournament_id: Number(tid),
      year: t.year,
    })),
  };

  const catalog = buildDraftCatalog(draftDataset);

  // Mirrors apps/web/lib/game/data.ts composeVersions.
  const versions: RunRecordVersions = {
    schema_version: manifest.schema_version,
    dataset_version: manifest.dataset_version,
    rating_version: `${manifest.rating_version_historical}+${manifest.rating_version_projected}`,
    engine_version: manifest.engine_version,
    ruleset_version: manifest.ruleset_version,
    data_bundle_hash: `${manifest.bundles.draft_pool.sha256}+${manifest.bundles.scenario_2026.sha256}`,
  };

  cached = {
    manifest,
    bundle,
    scenario,
    versions,
    catalog,
    draftDataset,
    playerByCardId,
    managerByCardId,
    ratingByCardId,
    nationById,
    tournamentById,
    nationByCardId: bundle.nation_by_card_id,
    playerByPlayerId,
  };
  return cached;
}

const eraCatalogCache = new Map<EraPresetId, DraftCatalog>();

/** Mirrors apps/web/lib/game/data.ts getCatalogForEra. */
export function getCatalogForEra(gd: MarketingGameData, era: EraPresetId): DraftCatalog {
  if (era === "all_time") return gd.catalog;
  let c = eraCatalogCache.get(era);
  if (!c) {
    c = buildDraftCatalog(gd.draftDataset, era);
    eraCatalogCache.set(era, c);
  }
  return c;
}

/** Mirrors apps/web/lib/game/adapters.ts managerTournamentFor. */
function managerTournamentFor(gd: MarketingGameData, manager_card_id: string): ManagerTournament {
  const m = gd.managerByCardId.get(manager_card_id);
  if (!m) throw new Error(`manager card not found: ${manager_card_id}`);
  return {
    manager_card_id: m.manager_card_id,
    manager_id: m.manager_id,
    tournament_id: m.tournament_id,
    nation_id: m.nation_id,
    matches: m.matches,
    final_placement: m.final_placement,
    sources: m.sources,
  };
}

/**
 * Run the tournament for a completed DraftState, byte-identically to the app's
 * runSimulationSync (same buildRunScenario + runTournamentFull, same world
 * assembly from the same compact bundle). Returns the engine's RunResult.
 */
export function simulateDraft(
  gd: MarketingGameData,
  draft: DraftState,
  parent_seed: string,
): RunResult {
  // World assembly mirrors apps/web/lib/game/simulate.ts buildSimWorldInputs.
  const ratings: Record<string, Rating> = {};
  for (const slot of draft.squad) {
    if (slot.card_id === null) continue;
    const cardId = slot.card_id as string;
    const r = gd.ratingByCardId.get(cardId);
    if (!r) throw new Error(`missing rating for squad card ${cardId}`);
    ratings[cardId] = r;
  }

  const opponents: Record<string, Team2026> = {};
  for (const t of gd.scenario.teams) {
    opponents[t.team_id] = {
      team_id: t.team_id,
      nation_id: t.nation_id,
      group: t.group,
      group_slot: t.group_slot,
      squad_card_ids: t.squad_card_ids,
      aggregate_rating: t.aggregate_rating,
      squad_status: t.squad_status,
      rating_version: t.rating_version,
      sources: t.sources,
    } satisfies Team2026;
  }

  const managerTournaments: Record<string, ManagerTournament> = {};
  if (draft.manager_card_id !== null) {
    const mt = managerTournamentFor(gd, draft.manager_card_id as string);
    managerTournaments[draft.manager_card_id as string] = mt;
  }

  const bracket: Bracket2026 = {
    groups: gd.scenario.groups,
    knockout_slots: gd.scenario.knockout_slots,
  };

  const world: SimWorld = {
    ratings,
    opponents,
    managerTournaments,
    nationByCardId: gd.nationByCardId,
    bracket,
  };

  const { scenario: runScenario } = buildRunScenario({
    parent_seed,
    teams: gd.scenario.teams as Team2026[],
    bracket,
    ruleset_version: gd.versions.ruleset_version,
  });

  return runTournamentFull(draft, runScenario, parent_seed, world).run;
}
