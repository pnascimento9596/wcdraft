// Full-path Final-reaching deterministic fixture + assertions.
//
// CONTEXT — review on PR #18 noted the existing e2e seed produces a 5-match
// R16-elimination run, so the 8-match round labeling (Group 1/2/3 · R32 · R16
// · QF · SF · Final) and the perfect-8-0 gold record rendering were never
// exercised. The spec calls for either a real seed that wins out OR a
// deterministic fixture/seed that reaches the Final.
//
// WHY A FIXTURE (and not a seed):
//   We did a 500-seed bounded search across `parent_seed` counters using a
//   best-by-OVR draft strategy and found ZERO seeds where the user drafted XI
//   wins the tournament. The autoDraft pool spans 1930-2026 player_tournament
//   cards; the 2026 opponent national teams are calibrated as full 23-man
//   squads with aggregate ratings, and the user's 16-player draft is
//   systematically outclassed on real data. (Best result was an R32 loss with
//   a 3-1 record.) Reaching the Final in a deterministic test would require
//   either reshaping the engine, the calibration, or the draft pool — none of
//   which is in scope for this fix pass.
//
//   So the test uses a HAND-BUILT fixture: a synthetic 8-match
//   `MatchResult[]` + `RunResult` shaped exactly like an 8-0 sweep. The
//   fixture is deterministic, exercises the real adapter code paths
//   (`matchCardViews`, `roundLabel`, `buildRunSummary`), and pins the gold
//   `is_perfect_eight_zero` rendering branch.

import { describe, expect, it } from "vitest";
import type { MatchResult, MatchRound, RunResult } from "@wcdraft/core";
import type { Scenario2026Bundle } from "@wcdraft/data";

import type { GameData, GameDataIndexes } from "../data";
import { buildRunSummary, matchCardViews, roundLabel } from "../results-adapters";

// ─── Round table (ground truth — pinned here to fail loudly on relabeling) ──

const ROUND_ORDER: readonly MatchRound[] = [
  "G1",
  "G2",
  "G3",
  "R32",
  "R16",
  "QF",
  "SF",
  "F",
] as const;

const ROUND_LABEL_GOLD: Record<MatchRound, string> = {
  G1: "Group · M1",
  G2: "Group · M2",
  G3: "Group · M3",
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarter-final",
  SF: "Semi-final",
  F: "Final",
};

// ─── Minimal GameData / Scenario stubs ───────────────────────────────────────

function makeGameDataStub(): GameData {
  const nationById = new Map<string, { canonical_name: string; code: string | null }>([
    ["nation-A", { canonical_name: "Atlantis", code: "ATL" }],
    ["nation-B", { canonical_name: "Borduria", code: "BRD" }],
    ["nation-C", { canonical_name: "Carpathia", code: "CRP" }],
    ["nation-D", { canonical_name: "Doraz", code: "DRZ" }],
    ["nation-E", { canonical_name: "Estiva", code: "EST" }],
    ["nation-F", { canonical_name: "Fjeldland", code: "FJL" }],
    ["nation-G", { canonical_name: "Gemini", code: "GEM" }],
    ["nation-H", { canonical_name: "Halland", code: "HAL" }],
  ]);
  const indexes = {
    playerByCardId: new Map(),
    managerByCardId: new Map(),
    ratingByCardId: new Map(),
    nationById,
    tournamentById: new Map(),
    displayNameByCardId: new Map(),
  } as unknown as GameDataIndexes;
  return { indexes } as unknown as GameData;
}

function makeScenarioStub(): Scenario2026Bundle {
  const teamIds = [
    "team-OPP-G1",
    "team-OPP-G2",
    "team-OPP-G3",
    "team-OPP-R32",
    "team-OPP-R16",
    "team-OPP-QF",
    "team-OPP-SF",
    "team-OPP-F",
  ];
  const teams = teamIds.map((team_id, i) => ({
    team_id,
    nation_id: `nation-${String.fromCharCode(65 + i)}`,
    group: "A",
    group_slot: 1,
    squad_card_ids: [],
    aggregate_rating: 80,
    squad_status: "confirmed",
    rating_version: "test",
    sources: [],
  }));
  const team_display_names: Record<string, string> = {};
  for (const id of teamIds) team_display_names[id] = id.replace("team-OPP-", "Team ");
  return {
    teams,
    team_display_names,
  } as unknown as Scenario2026Bundle;
}

// ─── Synthetic 8-0 fixture ───────────────────────────────────────────────────

function buildPerfectFixture(): { run: RunResult; matches: MatchResult[] } {
  const matches: MatchResult[] = ROUND_ORDER.map((round, i) => ({
    match_id: `m-${round}`,
    match_index: i,
    round,
    phase: i < 3 ? "group" : "knockout",
    opponent_team_id: `team-OPP-${round}`,
    pre_match_win_probability: 0.5,
    user_goals: 2,
    opp_goals: 0,
    user_goals_et: null,
    opp_goals_et: null,
    shootout: null,
    outcome: "W",
    counts_as_run_win: true,
    advanced: i < 7,
    lineup: [],
    events: [],
  })) as MatchResult[];
  const run = {
    run_id: "fixture-perfect-8-0",
    scenario_id: "fixture-scenario",
    dataset_version: "test",
    rating_version: "test",
    engine_version: "test",
    seed: "fixture:perfect:v1",
    reached_round: "F",
    eliminated_in_match_id: null,
    is_champion: true,
    undefeated_regulation: true,
    record: "8-0",
    wins: 8,
    draws: 0,
    losses: 0,
    shootout_wins: 0,
    shootout_losses: 0,
    round_results: matches.map((m) => ({
      round: m.round,
      advanced: m.advanced,
      goals_for: m.user_goals,
      goals_against: m.opp_goals,
      outcome: m.outcome,
    })),
    aggregate: {
      goals_for: 16,
      goals_against: 0,
      clean_sheets: 8,
      top_scorer_player_id: null,
    },
    score: 1000,
    score_breakdown: [],
    player_stats: [],
    narrative: {
      template_id: "fixture",
      narrative_seed: "fixture-narrative",
      filled_text: "Won every match. A perfect run.",
    },
  } as unknown as RunResult;
  return { run, matches };
}

// ─── Synthetic R16-out fixture (sanity counterpart) ──────────────────────────

function buildR16OutFixture(): { run: RunResult; matches: MatchResult[] } {
  const rounds: MatchRound[] = ["G1", "G2", "G3", "R32", "R16"];
  const matches: MatchResult[] = rounds.map((round, i) => ({
    match_id: `m-${round}`,
    match_index: i,
    round,
    phase: i < 3 ? "group" : "knockout",
    opponent_team_id: `team-OPP-${round}`,
    pre_match_win_probability: i === 4 ? 0.42 : 0.5,
    user_goals: i === 4 ? 0 : 2,
    opp_goals: i === 4 ? 1 : 0,
    user_goals_et: null,
    opp_goals_et: null,
    shootout: null,
    outcome: i === 4 ? "L" : "W",
    counts_as_run_win: i !== 4,
    advanced: i < 4,
    lineup: [],
    events: [],
  })) as MatchResult[];
  const run = {
    run_id: "fixture-r16-out",
    scenario_id: "fixture-scenario",
    dataset_version: "test",
    rating_version: "test",
    engine_version: "test",
    seed: "fixture:r16:v1",
    reached_round: "R16",
    eliminated_in_match_id: "m-R16",
    is_champion: false,
    undefeated_regulation: false,
    record: "4-1",
    wins: 4,
    draws: 0,
    losses: 1,
    shootout_wins: 0,
    shootout_losses: 0,
    round_results: matches.map((m) => ({
      round: m.round,
      advanced: m.advanced,
      goals_for: m.user_goals,
      goals_against: m.opp_goals,
      outcome: m.outcome,
    })),
    aggregate: {
      goals_for: 8,
      goals_against: 1,
      clean_sheets: 4,
      top_scorer_player_id: null,
    },
    score: 500,
    score_breakdown: [],
    player_stats: [],
    narrative: {
      template_id: "fixture",
      narrative_seed: "fixture-narrative",
      filled_text: "Knocked out in the round of 16.",
    },
  } as unknown as RunResult;
  return { run, matches };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("full-path Final coverage — perfect 8-0 fixture", () => {
  const gameData = makeGameDataStub();
  const scenario = makeScenarioStub();
  const { run, matches } = buildPerfectFixture();

  it("the fixture is exactly 8 matches in canonical round order", () => {
    expect(matches.length).toBe(8);
    expect(matches.map((m) => m.round)).toEqual([...ROUND_ORDER]);
  });

  it("roundLabel covers every MatchRound used in the run", () => {
    for (const r of ROUND_ORDER) {
      expect(roundLabel(r)).toBe(ROUND_LABEL_GOLD[r]);
    }
  });

  it("matchCardViews labels all 8 rows with the canonical round labels", () => {
    const cards = matchCardViews(scenario, gameData, matches);
    expect(cards.length).toBe(8);
    expect(cards.map((c) => c.round_label)).toEqual([
      "Group · M1",
      "Group · M2",
      "Group · M3",
      "Round of 32",
      "Round of 16",
      "Quarter-final",
      "Semi-final",
      "Final",
    ]);
    // Every card is a win.
    expect(cards.every((c) => c.outcome === "W")).toBe(true);
    // Every scoreline is 2-0 with no a.e.t. / pens tag.
    for (const c of cards) {
      expect(c.scoreline.user).toBe(2);
      expect(c.scoreline.opp).toBe(0);
      expect(c.scoreline.tag).toBeNull();
    }
  });

  it("buildRunSummary returns is_perfect_eight_zero === true (gold record state)", () => {
    const summary = buildRunSummary(gameData, "Perfect XI", run, matches, false);
    expect(summary.is_champion).toBe(true);
    expect(summary.is_perfect_eight_zero).toBe(true);
    expect(summary.display_record).toBe("8-0");
    expect(summary.matches_played).toBe(8);
    expect(summary.wins).toBe(8);
    expect(summary.losses).toBe(0);
    expect(summary.goals_for).toBe(16);
    expect(summary.goals_against).toBe(0);
    expect(summary.reached_round).toBe("F");
    expect(summary.eliminated_in_group).toBe(false);
  });
});

describe("full-path Final coverage — non-perfect runs do NOT trigger gold rendering", () => {
  const gameData = makeGameDataStub();
  const scenario = makeScenarioStub();

  it("a 5-match R16 elimination labels through R16 and is NOT gold", () => {
    const { run, matches } = buildR16OutFixture();
    const cards = matchCardViews(scenario, gameData, matches);
    expect(cards.length).toBe(5);
    expect(cards.map((c) => c.round_label)).toEqual([
      "Group · M1",
      "Group · M2",
      "Group · M3",
      "Round of 32",
      "Round of 16",
    ]);
    const summary = buildRunSummary(gameData, "Plucky XI", run, matches, false);
    expect(summary.is_perfect_eight_zero).toBe(false);
    expect(summary.is_champion).toBe(false);
    expect(summary.display_record).toBe("4-1");
    expect(summary.matches_played).toBe(5);
  });

  it("an 8-match champion with a single loss is still NOT gold (8-0 is the gate)", () => {
    const { run: perfectRun, matches: perfectMatches } = buildPerfectFixture();
    // Tweak: same shape, but flip one win to a loss + matching aggregate.
    const matches = perfectMatches.map((m, i) =>
      i === 3
        ? ({ ...m, user_goals: 0, opp_goals: 1, outcome: "L", advanced: false } as MatchResult)
        : m,
    );
    const run = {
      ...perfectRun,
      wins: 7,
      losses: 1,
      record: "7-1",
      is_champion: true, // pretend the run "champions" with one loss for the gate check
    } as RunResult;
    const summary = buildRunSummary(gameData, "Imperfect XI", run, matches, false);
    // is_champion is true but wins !== 8 OR losses !== 0 — gold gate fails.
    expect(summary.is_perfect_eight_zero).toBe(false);
    expect(summary.display_record).toBe("7-1");
  });

  it("a champion with wins=8 / losses=0 but matches.length < 8 is NOT gold", () => {
    // Defends the matches.length === 8 clause of `is_perfect_eight_zero` —
    // a perfect record with a missing match should never render gold.
    const { run, matches } = buildPerfectFixture();
    const truncated = matches.slice(0, 7);
    const summary = buildRunSummary(gameData, "Truncated XI", run, truncated, false);
    expect(summary.is_perfect_eight_zero).toBe(false);
  });
});

describe("full-path Final coverage — round-ordering invariant", () => {
  it("ROUND_ORDER matches the canonical Group→Final sequence (pin the table)", () => {
    // If any of these labels changes intentionally, the rendering layer must
    // be reviewed end-to-end — the gold table is the truth source for the
    // results screen.
    expect([...ROUND_ORDER]).toEqual(["G1", "G2", "G3", "R32", "R16", "QF", "SF", "F"]);
    expect(Object.values(ROUND_LABEL_GOLD)).toEqual([
      "Group · M1",
      "Group · M2",
      "Group · M3",
      "Round of 32",
      "Round of 16",
      "Quarter-final",
      "Semi-final",
      "Final",
    ]);
  });
});
