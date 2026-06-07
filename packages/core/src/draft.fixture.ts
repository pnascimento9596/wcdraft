// Synthetic fixture squad sets for the WS-C / ENGINE-V2 E-1 draft engine.
//
// The draft develops + golden-tests against THESE deterministic fixtures so the
// lane does not block on real data wiring. The ingested PlayerTournament /
// ManagerTournament cards are the real candidate source in production; they map
// 1:1 onto the narrow `DraftPlayerCard` / `DraftManagerCard` views built here.
//
// ENGINE-V2 E-1: every fixture also supplies `DraftTournament` metadata
// ({tournament_id, year}). Years are picked to straddle the RARE_YEAR_CUTOFF
// (1998) so the era-weighting + `Spin.rare` exposure is exercised by every
// fixture, AND so the byte-stable golden meaningfully witnesses both eras.
//
// This module is NOT part of the published library (excluded from the build via
// tsconfig.build.json), but IS type-checked and consumed by the golden tests +
// the golden-snapshot generator.

import type {
  CreateDraftParams,
  DraftDataset,
  DraftManagerCard,
  DraftPlayerCard,
  DraftTournament,
} from "./draft.js";
import type { Position } from "./types/primitives.js";

// Synthetic tournament ids 1..6 → calendar years straddling pre-/post-1998.
// Three rare years (1934, 1962, 1990) and three modern (2002, 2014, 2026).
// The cutoff is RARE_YEAR_CUTOFF=1998 (re-exported from draft.ts); these years
// are picked to land on either side of it with a meaningful spread so the
// distribution probe + per-spin `rare` flag are both exercised.
const TOURNAMENT_META: readonly { tournament_id: number; year: number }[] = [
  { tournament_id: 1, year: 1934 },
  { tournament_id: 2, year: 1962 },
  { tournament_id: 3, year: 1990 },
  { tournament_id: 4, year: 2002 },
  { tournament_id: 5, year: 2014 },
  { tournament_id: 6, year: 2026 },
];
const TOURNAMENT_IDS = TOURNAMENT_META.map((t) => t.tournament_id);
const NATIONS = ["arg", "bra", "eng", "esp", "fra", "ger", "ita", "ned", "por", "uru"] as const;
const ROSTER_SIZE = 12;

/** Position spread so picks (and their stored compatibility) vary across buckets. */
const ELIGIBLE_CYCLE: readonly (readonly Position[])[] = [
  ["GK"],
  ["DF"],
  ["MF"],
  ["FW"],
  ["DF", "MF"],
];

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function eligibleFor(t: number, ordinal: number, k: number): readonly Position[] {
  const i = (t * 3 + ordinal * 2 + k) % ELIGIBLE_CYCLE.length;
  return ELIGIBLE_CYCLE[i]!;
}

export interface DraftFixture {
  dataset: DraftDataset;
  params: CreateDraftParams;
}

/**
 * Build the `DraftTournament[]` view for a subset of the synthetic tournament
 * ids. Every fixture passes through this so the era distribution is
 * deterministic and identical across fixtures.
 */
function tournamentsFor(ids: readonly number[]): DraftTournament[] {
  return ids.map((id) => {
    const meta = TOURNAMENT_META.find((m) => m.tournament_id === id);
    if (!meta) {
      throw new RangeError(`buildDraftFixture: no synthetic year for tournament_id ${id}`);
    }
    return { tournament_id: meta.tournament_id, year: meta.year };
  });
}

/**
 * The primary fixture: a LARGE pool (6 tournaments × 10 nations = 60 unique
 * (tournament, nation) pairs, well over the 17 spins) so the era-weighted
 * with-replacement draw genuinely samples and may repeat. Coaches sit on
 * ~half the pairs (those where `tournament + nationIndex` is even), so the
 * run has both coach-bearing and coach-less spins and the at-most-one-manager
 * + later-coach-suppression invariants are exercised. Players are unique per
 * bucket.
 */
export function buildDraftFixture(): DraftFixture {
  const players: DraftPlayerCard[] = [];
  const managers: DraftManagerCard[] = [];
  for (const t of TOURNAMENT_IDS) {
    NATIONS.forEach((nation, nationIdx) => {
      for (let k = 0; k < ROSTER_SIZE; k++) {
        players.push({
          player_id: `p-${t}-${nation}-${pad2(k)}`,
          tournament_id: t,
          nation_id: nation,
          eligible_positions: eligibleFor(t, nationIdx, k),
        });
      }
      if ((t + nationIdx) % 2 === 0) {
        managers.push({ manager_id: `m-${t}-${nation}`, tournament_id: t, nation_id: nation });
      }
    });
  }
  return {
    dataset: { players, managers, tournaments: tournamentsFor(TOURNAMENT_IDS) },
    params: {
      run_id: "ws-c-fixture-run",
      parent_seed: "wcdraft/ws-c/draft-fixture-v1",
      formation_id: "4-3-3",
      mode: "classic",
      team_name: "Fixture XI",
      dataset_version: "fixture-dataset-v1",
      rating_version: "fixture-rating-v1",
      engine_version: "wcdraft-core@ws-c-fixture",
    },
  };
}

/**
 * Nation-switcher fixture (ENGINE-V2 E-1 update). A small two-tournament pool
 * where ONE shared `player_id` (`aaa-switcher`, sorts first in any bucket)
 * sits in TWO distinct buckets — (1, "esp") and (2, "bra"). Under
 * with-replacement weighted sampling we no longer GUARANTEE both buckets are
 * drawn in any specific run, but the GLOBAL player_id dedup invariant is
 * still exercised by the draft.golden tests via the primary fixture; this
 * fixture exists for finer-grained tests that drive the engine by hand.
 *
 * Every pair carries a coach so the autopilot always has a manager to take.
 */
export function buildNationSwitcherFixture(): DraftFixture {
  const players: DraftPlayerCard[] = [];
  const managers: DraftManagerCard[] = [];
  const pairs: Array<[number, string]> = [];
  NATIONS.forEach((n) => pairs.push([1, n])); // 10 pairs
  NATIONS.slice(0, 7).forEach((n) => pairs.push([2, n])); // + 7 pairs = 17
  pairs.forEach(([t, nation], ordinal) => {
    for (let k = 0; k < ROSTER_SIZE; k++) {
      players.push({
        player_id: `q-${t}-${nation}-${pad2(k)}`,
        tournament_id: t,
        nation_id: nation,
        eligible_positions: eligibleFor(t, ordinal, k),
      });
    }
    managers.push({ manager_id: `mm-${t}-${nation}`, tournament_id: t, nation_id: nation });
  });
  const switcherBuckets: Array<[number, string]> = [
    [1, "esp"],
    [2, "bra"],
  ];
  for (const [t, nation] of switcherBuckets) {
    players.push({
      player_id: "aaa-switcher",
      tournament_id: t,
      nation_id: nation,
      eligible_positions: ["MF", "FW"],
    });
  }
  return {
    dataset: { players, managers, tournaments: tournamentsFor([1, 2]) },
    params: {
      run_id: "ws-c-switcher-run",
      parent_seed: "wcdraft/ws-c/nation-switcher-v1",
      formation_id: "4-4-2",
      dataset_version: "fixture-dataset-v1",
      rating_version: "fixture-rating-v1",
      engine_version: "wcdraft-core@ws-c-fixture",
    },
  };
}

/** The (tournament, nation) buckets the switcher inhabits — for test assertions. */
export const SWITCHER_PLAYER_ID = "aaa-switcher";

/**
 * Single-coach fixture (ENGINE-V2 E-1 update). EXACTLY one coach, on
 * (1, "arg"). Used to exercise the strand-prevention guard: under
 * with-replacement sampling, even if the lone coach-bearing pair lands on
 * multiple spins, once any later spin still offers a coach the strand guard
 * holds off; but if no later pending spin offers a coach, the active spin
 * must take the manager.
 */
export function buildSingleCoachFixture(): DraftFixture {
  const players: DraftPlayerCard[] = [];
  const pairs: Array<[number, string]> = [];
  NATIONS.forEach((n) => pairs.push([1, n])); // 10
  NATIONS.slice(0, 7).forEach((n) => pairs.push([2, n])); // + 7 = 17
  pairs.forEach(([t, nation], ordinal) => {
    for (let k = 0; k < ROSTER_SIZE; k++) {
      players.push({
        player_id: `s-${t}-${nation}-${pad2(k)}`,
        tournament_id: t,
        nation_id: nation,
        eligible_positions: eligibleFor(t, ordinal, k),
      });
    }
  });
  const managers: DraftManagerCard[] = [
    { manager_id: "solo-mgr", tournament_id: 1, nation_id: "arg" },
  ];
  return {
    dataset: { players, managers, tournaments: tournamentsFor([1, 2]) },
    params: {
      run_id: "ws-c-single-coach-run",
      parent_seed: "wcdraft/ws-c/single-coach-v1",
      formation_id: "4-4-2",
      dataset_version: "fixture-dataset-v1",
      rating_version: "fixture-rating-v1",
      engine_version: "wcdraft-core@ws-c-fixture",
    },
  };
}
