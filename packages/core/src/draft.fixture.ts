// Synthetic fixture squad sets for the WS-C draft engine.
//
// The draft develops + golden-tests against THESE deterministic fixtures so the
// lane does not block on real data wiring. The ingested PlayerTournament /
// ManagerTournament cards are the real candidate source in production; they map
// 1:1 onto the narrow `DraftPlayerCard` / `DraftManagerCard` views built here.
//
// This module is NOT part of the published library (excluded from the build via
// tsconfig.build.json), but IS type-checked and consumed by the golden tests +
// the golden-snapshot generator.

import type {
  CreateDraftParams,
  DraftDataset,
  DraftManagerCard,
  DraftPlayerCard,
} from "./draft.js";
import type { Position } from "./types/primitives.js";

const TOURNAMENTS = [1, 2, 3, 4, 5, 6] as const;
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
 * The primary fixture: a LARGE pool (6 tournaments × 10 nations = 60 unique
 * (tournament, nation) pairs, well over the 17 spins) so the without-
 * replacement draw genuinely samples and never starves. Coaches sit on ~half
 * the pairs (those where `tournament + nationIndex` is even), so the run has
 * both coach-bearing and coach-less spins and the at-most-one-manager + later-
 * coach-suppression invariants are exercised. Players are unique per bucket.
 */
export function buildDraftFixture(): DraftFixture {
  const players: DraftPlayerCard[] = [];
  const managers: DraftManagerCard[] = [];
  for (const t of TOURNAMENTS) {
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
    dataset: { players, managers },
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
 * Nation-switcher fixture: EXACTLY 17 (tournament, nation) pairs, so the whole
 * pool is drawn and every pair lands on some spin. A single shared player_id
 * (`aaa-switcher`, sorts first in any bucket) sits in TWO distinct buckets —
 * (1, "esp") and (2, "bra") — guaranteeing it is offered on two spins and
 * deterministically exercising cross-bucket GLOBAL player dedup. Every pair
 * carries a coach so the autopilot always has a manager to take.
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
    dataset: { players, managers },
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
 * Single-coach fixture: EXACTLY 17 (tournament, nation) pairs (whole pool is
 * drawn) with exactly ONE coach, on (1, "arg"). Used to exercise the
 * strand-prevention guard deterministically: wherever the lone coach-bearing
 * spin lands, the engine must REFUSE a player pick there (while no manager is
 * drafted and no later spin offers a coach) and force the manager.
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
    dataset: { players, managers },
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
