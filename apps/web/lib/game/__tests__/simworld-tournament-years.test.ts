import { describe, expect, it } from "vitest";

import {
  autoDraft,
  buildCardId,
  deriveNarrativeFacts,
  deriveSubseed,
  type MatchLineupEntry,
  type MatchResult,
  type RunResult,
} from "@wcdraft/core";
import {
  DRAFT_POOL_BUNDLE,
  RUNTIME_DATA_MANIFEST,
  SCENARIO_2026_BUNDLE,
  type RuntimeDataManifest,
} from "@wcdraft/data";

import { buildGameData, type GameData } from "../data";
import type { RunRecordV1 } from "../run-record";
import { buildSimWorldInputs } from "../simulate";

function buildRecord(gameData: GameData): RunRecordV1 {
  const draft = autoDraft({
    run_id: "tournament-years-origin",
    parent_seed: "wcdraft:tournament-years:v1:1",
    formation_id: "4-3-3",
    mode: "classic",
    team_name: "Tournament Years XI",
    dataset_version: gameData.versions.dataset_version,
    rating_version: gameData.versions.rating_version,
    engine_version: gameData.versions.engine_version,
    dataset: gameData.draftDataset,
  });
  return {
    record_version: 1,
    run_id: "tournament-years-origin",
    parent_seed: "wcdraft:tournament-years:v1:1",
    created_seq: 1,
    updated_seq: 1,
    versions: gameData.versions,
    draft,
  };
}

function lineup(player_id: string, tournament_id: number): MatchLineupEntry {
  return {
    side: "user",
    card_id: buildCardId(player_id, tournament_id),
    player_id,
    tournament_id,
    slot_id: `user-${player_id}`,
    position: "MF",
    started: true,
    minutes: 90,
  };
}

function run(seed = "narrative-tournament-years"): RunResult {
  return {
    run_id: "run-tournament-years",
    scenario_id: "scenario-tournament-years",
    dataset_version: "dataset-test",
    rating_version: "rating-test",
    engine_version: "engine-test",
    seed,
    reached_round: "G3",
    eliminated_in_match_id: "m0",
    is_champion: false,
    undefeated_regulation: true,
    record: "0-1-0",
    wins: 0,
    draws: 1,
    losses: 0,
    shootout_wins: 0,
    shootout_losses: 0,
    round_results: [{ round: "G3", advanced: false, outcome: "D", goals_for: 0, goals_against: 0 }],
    aggregate: {
      goals_for: 0,
      goals_against: 0,
      clean_sheets: 1,
      top_scorer_player_id: null,
    },
    score: 0,
    score_breakdown: [],
    player_stats: [],
    narrative: {
      template_id: "",
      narrative_seed: deriveSubseed(seed, "narrative"),
      filled_text: "",
    },
  };
}

function eraClashMatch(): MatchResult {
  return {
    match_id: "m0",
    match_index: 0,
    round: "G3",
    phase: "group",
    opponent_team_id: "t_test",
    pre_match_win_probability: 0.5,
    user_goals: 0,
    opp_goals: 0,
    user_goals_et: null,
    opp_goals_et: null,
    shootout: null,
    outcome: "D",
    counts_as_run_win: false,
    advanced: false,
    lineup: [lineup("p_old", 7), lineup("p_new", 8)],
    events: [],
  };
}

describe("buildSimWorldInputs tournament years", () => {
  const gameData = buildGameData(RUNTIME_DATA_MANIFEST as RuntimeDataManifest, DRAFT_POOL_BUNDLE);
  const record = buildRecord(gameData);

  it("populates SimWorld.tournamentYears from the loaded runtime tournament metadata", () => {
    const { world } = buildSimWorldInputs(gameData, SCENARIO_2026_BUNDLE, record);
    const expected = Object.fromEntries(
      Object.entries(DRAFT_POOL_BUNDLE.tournaments).map(([tid, tournament]) => [
        tid,
        tournament.year,
      ]),
    );

    expect(world.tournamentYears).toEqual(expected);
    expect(Object.keys(world.tournamentYears ?? {})).toHaveLength(
      Object.keys(DRAFT_POOL_BUNDLE.tournaments).length,
    );
    expect(world.tournamentYears?.["2026"]).toBe(2026);
  });

  it("feeds narrative era logic with calendar years instead of raw tournament ids", () => {
    const syntheticGameData: GameData = {
      ...gameData,
      indexes: {
        ...gameData.indexes,
        tournamentById: new Map([
          [7, { year: 1930, name: "Synthetic 1930" }],
          [8, { year: 2026, name: "Synthetic 2026" }],
        ]),
      },
    };
    const { world } = buildSimWorldInputs(syntheticGameData, SCENARIO_2026_BUNDLE, record);
    const syntheticRun = run();
    const matches = [eraClashMatch()];

    expect(
      deriveNarrativeFacts(syntheticRun, matches).scenario_spotlights.map((s) => s.family),
    ).not.toContain("era_clash");

    const facts = deriveNarrativeFacts(syntheticRun, matches, {
      tournamentYears: world.tournamentYears,
    });
    const spotlight = facts.scenario_spotlights.find((s) => s.family === "era_clash");

    expect(spotlight).toBeDefined();
    expect(spotlight!.era_min_year).toBe(1930);
    expect(spotlight!.era_max_year).toBe(2026);
    expect(spotlight!.player_id).toBe("p_old");
    expect(spotlight!.secondary_player_id).toBe("p_new");
  });
});
