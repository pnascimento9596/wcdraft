// Deterministic SIM fixtures for the WS-B golden tests.
//
// These build seed-INDEPENDENT inputs (draft + scenario + SimWorld) for four
// characteristic run shapes. The golden generator searches a seed that exhibits
// each shape and records (seed, RunResult) into `sim-golden.json`; the golden
// tests rebuild these inputs + the recorded seed and assert byte-identity.
//
// SCOPE NOTE: these are SIM fixtures, not DRAFT fixtures — `runTournament`
// consumes only `draft.squad` / `draft.formation_id` / `draft.manager_card_id`
// / `draft.run_id` / version anchors, so `spins` is intentionally empty here
// (the 17-spin draft golden is WS-C's lane). The squads use in-position cards
// (position_compatibility === 1) and uniform per-squad rating channels so the
// expected scoreline behaviour is easy to reason about; the engine itself is
// exercised across the full event/ET/shootout/injury surface by the seed.

import type {
  CardId,
  DraftState,
  ManagerCardId,
  ManagerRating,
  ManagerTournament,
  Rating,
  RunScenario,
  SimWorld,
  SquadSlot,
  Team2026,
  TeamStrength,
} from "../../src/index.js";
import {
  FORMATION_TEMPLATES,
  buildCardId,
  buildManagerCardId,
  positionCompatibility,
  slotPositionLine,
} from "../../src/index.js";

const FORMATION_ID = "4-3-3";
const USER_TID = 14; // a historical-card tournament id for the user XI
const OPP_TID = 23; // the 2026 tournament id for opponents
const VERSIONS = {
  dataset_version: "wcb-fixture-dataset-v1",
  rating_version: "wcb-fixture-rating-v1",
  engine_version: "wcb-fixture-engine-v1",
};

function rating(card_id: CardId, player_id: string, tournament_id: number, ch: number): Rating {
  const v = Math.round(ch);
  return {
    card_id,
    player_id,
    tournament_id,
    overall: v,
    attack: v,
    midfield: v,
    defense: v,
    goalkeeping: v,
    components: [],
    coverage: 1,
    coverage_basis: "wc_signals",
    provenance: "projected_career",
    rating_version: VERSIONS.rating_version,
  };
}

export interface ScenarioInputs {
  draft: DraftState;
  scenario: RunScenario;
  world: SimWorld;
}

interface BuildParams {
  userChannel: number;
  oppStrengths: number[]; // one per opponent in the pool (group + knockout candidates)
  withManager: boolean;
}

/** Build the user squad (11 starters from the 4-3-3 template + 5 bench). */
function buildUserSquad(
  channel: number,
): { squad: SquadSlot[]; ratings: Record<string, Rating>; nationByCardId: Record<string, string> } {
  const template = FORMATION_TEMPLATES[FORMATION_ID]!;
  const squad: SquadSlot[] = [];
  const ratings: Record<string, Rating> = {};
  const nationByCardId: Record<string, string> = {};
  let p = 0;

  const place = (slot_id: string, slot_position: import("../../src/index.js").SlotPosition, is_starter: boolean): void => {
    p++;
    const player_id = `u${String(p).padStart(2, "0")}`;
    const card_id = buildCardId(player_id, USER_TID);
    const eligible = [slotPositionLine(slot_position)];
    const compat = positionCompatibility(eligible, slot_position);
    squad.push({
      slot_id,
      is_starter,
      slot_position,
      card_id,
      player_id,
      tournament_id: USER_TID,
      position_compatibility: compat,
      validation_warnings: [],
    });
    ratings[card_id as string] = rating(card_id, player_id, USER_TID, channel);
    // All user starters share one nation so Synergy clusters/links fire.
    nationByCardId[card_id as string] = "userland";
  };

  for (const s of template.slots) place(s.slot_id, s.slot_position, true);
  // Five bench slots covering each line for position-aware injury subs.
  place("bench.0", "GK", false);
  place("bench.1", "CB", false);
  place("bench.2", "CM", false);
  place("bench.3", "ST", false);
  place("bench.4", "RB", false);

  return { squad, ratings, nationByCardId };
}

function teamStrength(v: number): TeamStrength {
  const c = Math.round(v);
  return { attack: c, midfield: c, defense: c, goalkeeping: c, coverage: 1 };
}

/** Build one Team2026 opponent with an 11-card squad at the given strength. */
function buildOpponent(index: number, strength: number): Team2026 {
  const team_id = `T${String(index).padStart(2, "0")}`;
  const groups = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"] as const;
  const squad_card_ids: CardId[] = [];
  for (let i = 0; i < 11; i++) {
    squad_card_ids.push(buildCardId(`${team_id}p${String(i).padStart(2, "0")}`, OPP_TID));
  }
  return {
    team_id,
    nation_id: `nat_${team_id}`,
    group: groups[index % groups.length]!,
    group_slot: (index % 4) + 1,
    squad_card_ids,
    aggregate_rating: teamStrength(strength),
    squad_status: "projected",
    rating_version: VERSIONS.rating_version,
    sources: [],
  };
}

function buildInputs(name: string, params: BuildParams): ScenarioInputs {
  const { squad, ratings, nationByCardId } = buildUserSquad(params.userChannel);

  const opponents: Record<string, Team2026> = {};
  const oppList: Team2026[] = params.oppStrengths.map((s, i) => buildOpponent(i, s));
  for (const t of oppList) opponents[t.team_id] = t;

  // First three opponents are the group path; the rest feed the knockout ladder.
  const group_opponent_team_ids = [oppList[0]!.team_id, oppList[1]!.team_id, oppList[2]!.team_id];

  let manager_card_id: ManagerCardId | null = null;
  const managerTournaments: Record<string, ManagerTournament> = {};
  const managerRatings: Record<string, ManagerRating> = {};
  if (params.withManager) {
    const mid = "m001";
    manager_card_id = buildManagerCardId(mid, USER_TID);
    managerTournaments[manager_card_id as string] = {
      manager_card_id,
      manager_id: mid,
      tournament_id: USER_TID,
      nation_id: "userland", // shares the XI's nation → full manager link
      matches: 7,
      final_placement: 1,
      sources: [],
    };
    managerRatings[manager_card_id as string] = {
      manager_card_id,
      manager_id: mid,
      tournament_id: USER_TID,
      overall: 80,
      dimensions: { pedigree: 82, experience: 78 },
      components: [],
      coverage: 1,
      coverage_basis: "wc_signals",
      provenance: "wc_performance",
      rating_version: VERSIONS.rating_version,
    };
  }

  const draft: DraftState = {
    run_id: `run_${name}`,
    draft_seed: `draft-${name}`,
    mode: "classic",
    formation_id: FORMATION_ID,
    team_name: "Fixture XI",
    spins: [], // see SCOPE NOTE — runTournament consumes squad/formation/manager only
    squad,
    manager_card_id,
    status: "ready",
    deduped_player_ids: squad.filter((s) => s.player_id).map((s) => s.player_id as string),
    ...VERSIONS,
  };

  const scenario: RunScenario = {
    scenario_id: `scenario_${name}`,
    user_group_id: "A",
    group_opponent_team_ids,
    knockout_opponent_rule: {
      kind: "escalating_strength_seeded",
      rounds: ["R32", "R16", "QF", "SF", "F"],
      seed_suffix: `ko-${name}`,
    },
    ruleset_version: "wcb-fixture-ruleset-v1",
    scenario_seed: `scenario-seed-${name}`,
  };

  const world: SimWorld = {
    ratings,
    opponents,
    managerTournaments,
    managerRatings,
    nationByCardId,
    // scoringConfig omitted → engine uses DEFAULT_SCORING_CONFIG.
  };

  return { draft, scenario, world };
}

/** The five characteristic fixtures, by name. */
export const SCENARIO_NAMES = [
  "blowout",
  "upset",
  "draw_into_pens",
  "injury_cascade",
  "group_elimination",
] as const;
export type ScenarioName = (typeof SCENARIO_NAMES)[number];

export function buildScenarioInputs(name: ScenarioName): ScenarioInputs {
  switch (name) {
    case "blowout":
      // Strong user vs a weak field → lopsided wins.
      return buildInputs("blowout", {
        userChannel: 86,
        oppStrengths: [38, 42, 40, 36, 44, 41, 39, 43, 37, 45, 40, 42],
        withManager: true,
      });
    case "upset":
      // Below-average user vs a strong field. After the I3.3 group gate the
      // user must still qualify out of the group to reach knockouts, so the
      // user channel is calibrated above the absolute bottom — they should
      // squeeze into the round of 32 and then steal at least one knockout
      // match on variance.
      return buildInputs("upset", {
        userChannel: 62,
        oppStrengths: [60, 58, 56, 80, 82, 84, 86, 88, 78, 76, 81, 83],
        withManager: false,
      });
    case "draw_into_pens":
      // Tightly-matched field → a knockout tie that runs ET then penalties.
      return buildInputs("draw_into_pens", {
        userChannel: 60,
        oppStrengths: [60, 59, 61, 60, 58, 62, 60, 59, 61, 60, 58, 62],
        withManager: true,
      });
    case "injury_cascade":
      // Strong user (plays the full 8-match path) → persistent injuries accrue.
      return buildInputs("injury_cascade", {
        userChannel: 82,
        oppStrengths: [40, 44, 42, 46, 48, 50, 52, 54, 41, 43, 45, 47],
        withManager: true,
      });
    case "group_elimination":
      // Weak user vs strong group opponents — user is eliminated in the
      // group. Knockouts never play; `matches.length === 3`.
      return buildInputs("group_elimination", {
        userChannel: 35,
        oppStrengths: [80, 82, 84, 60, 58, 56, 54, 52, 50, 48, 46, 44],
        withManager: false,
      });
    default: {
      const _exhaustive: never = name;
      throw new RangeError(`unknown scenario ${String(_exhaustive)}`);
    }
  }
}
