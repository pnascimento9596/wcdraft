import { describe, it, expect } from "vitest";

import type { DraftState, Spin, SquadSlot } from "../types/draft.js";
import type { MatchLineupEntry, MatchResult } from "../types/sim.js";
import type { Player, PlayerTournament } from "../types/identity.js";
import type { Rating } from "../types/rating.js";
import type { RunResult } from "../types/run.js";
import type { Team2026 } from "../types/tournament.js";
import type { LeaderboardSubmission } from "./leaderboard.js";

import { buildCardId } from "../types/identity.js";
import { deriveSubseed } from "../rng.js";
import {
  DraftStateSchema,
  LeaderboardSubmissionSchema,
  MatchResultSchema,
  PlayerSchema,
  PlayerTournamentSchema,
  RatingSchema,
  RunResultSchema,
  Team2026Schema,
} from "./index.js";

// Zod boundary schemas — ACTIVE TESTS (not .skip): the schemas must compile,
// each hand-written fixture must round-trip via .parse() to the deep-equal
// object, and a focused set of rejection tests must reject impossible states.

// ─── Fixture builders ────────────────────────────────────────────────────────

const RUN_SEED = "seed.run.fixture.1";
const NARRATIVE_SEED = deriveSubseed(RUN_SEED, "narrative");

function makePlayerTournament(): PlayerTournament {
  return {
    card_id: buildCardId("player.puskas.ferenc", 1954),
    player_id: "player.puskas.ferenc",
    tournament_id: 1954,
    nation_id: "hun",
    shirt_number: 10,
    position_listed: "FW",
    eligible_positions: ["FW", "MF"],
    club_at_tournament: "Honvéd",
    appearances: 5,
    goals: 4,
    awards: [],
    captain: true,
    coverage: 0.85,
    sources: [
      {
        source: "fjelstul",
        source_type: "fjelstul",
        citation: "Fjelstul WC Database, players table",
        retrieved_date: "2026-05-01",
        field: null,
        confidence: 0.95,
      },
    ],
  };
}

function makeRating(): Rating {
  return {
    card_id: buildCardId("player.puskas.ferenc", 1954),
    player_id: "player.puskas.ferenc",
    tournament_id: 1954,
    overall: 92,
    attack: 96,
    midfield: 80,
    defense: 40,
    goalkeeping: 10,
    components: [{ signal: "goals_per_90", value: 1.5, weight: 0.6 }],
    coverage: 0.9,
    coverage_basis: "wc_signals",
    provenance: "wc_performance",
    rating_version: "rating@0.0.0",
  };
}

function makeTeam2026(): Team2026 {
  return {
    team_id: "team.2026.eng",
    nation_id: "eng",
    group: "A",
    group_slot: 1,
    squad_card_ids: [buildCardId("player.kane.harry", 2026), buildCardId("player.bellingham.jude", 2026)],
    aggregate_rating: {
      attack: 80,
      midfield: 80,
      defense: 75,
      goalkeeping: 78,
      coverage: 0.9,
    },
    squad_status: "projected",
    rating_version: "rating@0.0.0",
    sources: [
      {
        source: "wikipedia",
        source_type: "wikipedia",
        citation: "England squad projection",
        retrieved_date: "2026-05-01",
        field: null,
        confidence: 0.5,
      },
    ],
  };
}

function makeDraftState(): DraftState {
  const spins: Spin[] = [];
  const squad: SquadSlot[] = [];
  for (let i = 0; i < 16; i++) {
    const tournament_id = 1954 + i;
    const player_id = `player.fixture.${i}`;
    const card_id = buildCardId(player_id, tournament_id);
    const slot_id = `slot.${i < 11 ? "starter" : "bench"}.${i}`;
    spins.push({
      index: i,
      tournament_id,
      nation_id: `nation.${i}`,
      rolled_card_ids: [card_id],
      excluded_player_ids: Array.from({ length: i }, (_, j) => `player.fixture.${j}`),
      picked_card_id: card_id,
      picked_player_id: player_id,
      assigned_slot_id: slot_id,
      status: "picked",
    });
    squad.push({
      slot_id,
      is_starter: i < 11,
      lineup_position: i === 0 ? "GK" : i < 5 ? "DF" : i < 9 ? "MF" : "FW",
      allowed_positions: i === 0 ? ["GK"] : i < 5 ? ["DF"] : i < 9 ? ["MF"] : ["FW", "MF"],
      card_id,
      player_id,
      tournament_id,
      slot_valid: true,
      validation_warnings: [],
    });
  }
  return {
    run_id: "run.fixture.1",
    draft_seed: "seed.draft.fixture.1",
    mode: "classic",
    formation: "4-4-2",
    team_name: "Your XI",
    spins,
    squad,
    status: "ready",
    deduped_player_ids: Array.from({ length: 16 }, (_, i) => `player.fixture.${i}`),
    dataset_version: "dataset@0.0.0",
    rating_version: "rating@0.0.0",
    engine_version: "engine@0.0.0",
  };
}

function makeMatchResult(): MatchResult {
  const card_id = buildCardId("player.puskas.ferenc", 1954);
  const opp_card_id = buildCardId("player.kocsis.sandor", 1954);
  const lineup: MatchLineupEntry[] = [
    {
      side: "user",
      card_id,
      player_id: "player.puskas.ferenc",
      tournament_id: 1954,
      slot_id: "slot.starter.10",
      position: "FW",
      started: true,
      minutes: 90,
    },
    {
      side: "opp",
      card_id: opp_card_id,
      player_id: "player.kocsis.sandor",
      tournament_id: 1954,
      slot_id: "opp.slot.10",
      position: "FW",
      started: true,
      minutes: 90,
    },
  ];
  return {
    match_id: "match.fixture.0",
    match_index: 0,
    round: "G1",
    phase: "group",
    opponent_team_id: "team.2026.opp",
    user_goals: 2,
    opp_goals: 1,
    user_goals_et: null,
    opp_goals_et: null,
    shootout: null,
    outcome: "W",
    counts_as_run_win: true,
    advanced: true,
    lineup,
    events: [
      {
        event_id: "ev.1",
        minute: 30,
        period: "1H",
        side: "user",
        type: "goal",
        scorer_card_id: card_id,
        scorer_player_id: "player.puskas.ferenc",
        assist_card_id: null,
        assist_player_id: null,
        score_after: { user: 1, opp: 0 },
      },
    ],
  };
}

function makeRunResult(): RunResult {
  const card_id = buildCardId("player.puskas.ferenc", 1954);
  return {
    run_id: "run.fixture.1",
    scenario_id: "scenario.fixture.1",
    dataset_version: "dataset@0.0.0",
    rating_version: "rating@0.0.0",
    engine_version: "engine@0.0.0",
    seed: RUN_SEED,
    reached_round: "F",
    eliminated_in_match_id: null,
    is_champion: true,
    undefeated_regulation: true,
    record: "8-0-0",
    wins: 8,
    draws: 0,
    losses: 0,
    shootout_wins: 0,
    shootout_losses: 0,
    round_results: [
      { round: "G1", advanced: true, outcome: "W", goals_for: 3, goals_against: 0 },
      { round: "G2", advanced: true, outcome: "W", goals_for: 2, goals_against: 1 },
      { round: "G3", advanced: true, outcome: "W", goals_for: 3, goals_against: 1 },
      { round: "R32", advanced: true, outcome: "W", goals_for: 2, goals_against: 0 },
      { round: "R16", advanced: true, outcome: "W", goals_for: 3, goals_against: 1 },
      { round: "QF", advanced: true, outcome: "W", goals_for: 2, goals_against: 1 },
      { round: "SF", advanced: true, outcome: "W", goals_for: 3, goals_against: 0 },
      { round: "F", advanced: true, outcome: "W", goals_for: 2, goals_against: 0 },
    ],
    aggregate: {
      goals_for: 20,
      goals_against: 4,
      clean_sheets: 4,
      top_scorer_player_id: "player.puskas.ferenc",
    },
    score: 0,
    score_breakdown: [{ label: "Goals scored", raw: 20, weight: 0, points: 0 }],
    player_stats: [
      {
        player_id: "player.puskas.ferenc",
        card_id,
        tournament_id: 1954,
        per_match: [],
        totals: {
          goals: 4,
          assists: 2,
          shots: 18,
          shots_on_target: 11,
          key_passes: 7,
          fouls_committed: 3,
          fouls_suffered: 9,
          offsides: 2,
          yellows: 0,
          reds: 0,
          saves: 0,
          pens_won: 1,
          pens_scored: 1,
          pens_missed: 0,
          minutes: 720,
        },
        rating_at_draft: 92,
      },
    ],
    narrative: {
      template_id: "narrative.template.undefeated_champion.v1",
      narrative_seed: NARRATIVE_SEED,
      filled_text: "Your XI lifted the trophy unbeaten.",
    },
  };
}

function makeLeaderboardSubmission(): LeaderboardSubmission {
  return {
    run_id: "run.fixture.1",
    draft_id: "run.fixture.1",
    scenario_id: "scenario.fixture.1",
    draft_seed: "seed.draft.fixture.1",
    scenario_seed: "seed.scenario.fixture.1",
    run_seed: RUN_SEED,
    dataset_version: "dataset@0.0.0",
    rating_version: "rating@0.0.0",
    engine_version: "engine@0.0.0",
    claimed_score: 0,
  };
}

// ─── Round-trip tests ────────────────────────────────────────────────────────

describe("zod boundary schemas — hand-written fixture round-trips", () => {
  it("Player round-trips via PlayerSchema.parse", () => {
    const fixture: Player = {
      player_id: "player.puskas.ferenc",
      full_name: "Ferenc Puskás",
      common_name: "Puskás",
      primary_position: "FW",
      eligible_positions: ["FW", "MF"],
      birth_date: "1927-04-02",
      heritage_nation_id: "hun",
      sources: [
        {
          source: "fjelstul",
          source_type: "fjelstul",
          citation: "Fjelstul WC Database, players table",
          retrieved_date: "2026-05-01",
          field: null,
          confidence: 0.95,
        },
      ],
    };
    expect(PlayerSchema.parse(fixture)).toEqual(fixture);
  });

  it("PlayerTournament round-trips via PlayerTournamentSchema.parse", () => {
    const fixture = makePlayerTournament();
    expect(PlayerTournamentSchema.parse(fixture)).toEqual(fixture);
  });

  it("Rating round-trips via RatingSchema.parse", () => {
    const fixture = makeRating();
    expect(RatingSchema.parse(fixture)).toEqual(fixture);
  });

  it("Team2026 round-trips via Team2026Schema.parse", () => {
    const fixture = makeTeam2026();
    expect(Team2026Schema.parse(fixture)).toEqual(fixture);
  });

  it("DraftState round-trips via DraftStateSchema.parse", () => {
    const fixture = makeDraftState();
    expect(DraftStateSchema.parse(fixture)).toEqual(fixture);
  });

  it("MatchResult round-trips via MatchResultSchema.parse", () => {
    const fixture = makeMatchResult();
    expect(MatchResultSchema.parse(fixture)).toEqual(fixture);
  });

  it("RunResult round-trips via RunResultSchema.parse", () => {
    const fixture = makeRunResult();
    expect(RunResultSchema.parse(fixture)).toEqual(fixture);
  });

  it("LeaderboardSubmission round-trips via LeaderboardSubmissionSchema.parse", () => {
    const fixture = makeLeaderboardSubmission();
    expect(LeaderboardSubmissionSchema.parse(fixture)).toEqual(fixture);
  });
});

// ─── Rejection tests ─────────────────────────────────────────────────────────

describe("zod boundary schemas — REJECT impossible states", () => {
  // Missing fields / honest-state.
  it("Player rejects missing fields (no implicit defaults)", () => {
    const bad = {
      player_id: "x",
      full_name: "X",
      common_name: "X",
      primary_position: "FW",
      eligible_positions: ["FW"],
      // birth_date MISSING
      heritage_nation_id: null,
      sources: [],
    };
    expect(PlayerSchema.safeParse(bad).success).toBe(false);
  });

  it("Player rejects empty-string player_id", () => {
    const bad: Player = {
      player_id: "",
      full_name: "X",
      common_name: "X",
      primary_position: "FW",
      eligible_positions: ["FW"],
      birth_date: null,
      heritage_nation_id: null,
      sources: [],
    };
    expect(PlayerSchema.safeParse(bad).success).toBe(false);
  });

  it("LeaderboardSubmission rejects empty-string run_seed", () => {
    const bad = { ...makeLeaderboardSubmission(), run_seed: "" };
    expect(LeaderboardSubmissionSchema.safeParse(bad).success).toBe(false);
  });

  // Formation.
  it("DraftState rejects formation '0-5-5' (zero part)", () => {
    const bad = { ...makeDraftState(), formation: "0-5-5" as const };
    expect(DraftStateSchema.safeParse(bad).success).toBe(false);
  });

  it("DraftState rejects formation '4-4-3' (sum != 10)", () => {
    const bad = { ...makeDraftState(), formation: "4-4-3" as const };
    expect(DraftStateSchema.safeParse(bad).success).toBe(false);
  });

  it("DraftState accepts formation '4-3-3' and '3-1-4-2'", () => {
    const okA = { ...makeDraftState(), formation: "4-3-3" as const };
    const okB = { ...makeDraftState(), formation: "3-1-4-2" as const };
    expect(DraftStateSchema.safeParse(okA).success).toBe(true);
    expect(DraftStateSchema.safeParse(okB).success).toBe(true);
  });

  // Card ID mismatch.
  it("PlayerTournament rejects card_id that does not match (player_id, tournament_id)", () => {
    const bad: PlayerTournament = {
      ...makePlayerTournament(),
      card_id: buildCardId("player.other", 1954),
    };
    expect(PlayerTournamentSchema.safeParse(bad).success).toBe(false);
  });

  it("Rating rejects card_id with mismatched tournament_id", () => {
    const bad: Rating = {
      ...makeRating(),
      card_id: buildCardId("player.puskas.ferenc", 1962),
    };
    expect(RatingSchema.safeParse(bad).success).toBe(false);
  });

  it("DraftState rejects a SquadSlot with mismatched player_id/card_id", () => {
    const draft = makeDraftState();
    const tampered: SquadSlot = {
      ...draft.squad[0]!,
      player_id: "player.other",
    };
    const bad = { ...draft, squad: [tampered, ...draft.squad.slice(1)] };
    expect(DraftStateSchema.safeParse(bad).success).toBe(false);
  });

  // Out-of-range numerics.
  it("Rating rejects attack === 101", () => {
    const bad = { ...makeRating(), attack: 101 };
    expect(RatingSchema.safeParse(bad).success).toBe(false);
  });

  it("Rating rejects coverage === 1.1", () => {
    const bad = { ...makeRating(), coverage: 1.1 };
    expect(RatingSchema.safeParse(bad).success).toBe(false);
  });

  it("MatchResult rejects an event with minute === 131", () => {
    const m = makeMatchResult();
    const bad: MatchResult = {
      ...m,
      events: [{ ...m.events[0]! }],
    };
    (bad.events[0] as { minute: number }).minute = 131;
    expect(MatchResultSchema.safeParse(bad).success).toBe(false);
  });

  it("Team2026 rejects group_slot === 0", () => {
    const bad = { ...makeTeam2026(), group_slot: 0 };
    expect(Team2026Schema.safeParse(bad).success).toBe(false);
  });

  // ET / shootout impossibilities.
  it("MatchResult rejects group-stage match with ET fields", () => {
    const m = makeMatchResult();
    const bad: MatchResult = { ...m, user_goals_et: 0, opp_goals_et: 0 };
    expect(MatchResultSchema.safeParse(bad).success).toBe(false);
  });

  it("MatchResult rejects knockout tied-in-regulation with null ET fields", () => {
    const m = makeMatchResult();
    const bad: MatchResult = {
      ...m,
      phase: "knockout",
      round: "R16",
      user_goals: 1,
      opp_goals: 1,
      outcome: "W",
      user_goals_et: null,
      opp_goals_et: null,
      shootout: null,
    };
    expect(MatchResultSchema.safeParse(bad).success).toBe(false);
  });

  it("MatchResult rejects knockout still-level-after-ET with null shootout", () => {
    const m = makeMatchResult();
    const bad: MatchResult = {
      ...m,
      phase: "knockout",
      round: "R16",
      user_goals: 1,
      opp_goals: 1,
      user_goals_et: 0,
      opp_goals_et: 0,
      shootout: null,
      outcome: "W",
    };
    expect(MatchResultSchema.safeParse(bad).success).toBe(false);
  });

  it("MatchResult rejects knockout not-tied-after-ET with non-null shootout", () => {
    const m = makeMatchResult();
    const bad: MatchResult = {
      ...m,
      phase: "knockout",
      round: "R16",
      user_goals: 1,
      opp_goals: 1,
      user_goals_et: 1,
      opp_goals_et: 0,
      shootout: { user: 0, opp: 0, sequence: [] },
      outcome: "W",
    };
    expect(MatchResultSchema.safeParse(bad).success).toBe(false);
  });

  it("MatchResult rejects shootout summary that disagrees with sequence", () => {
    const m = makeMatchResult();
    const bad: MatchResult = {
      ...m,
      phase: "knockout",
      round: "F",
      user_goals: 1,
      opp_goals: 1,
      user_goals_et: 0,
      opp_goals_et: 0,
      shootout: {
        user: 5,
        opp: 4,
        sequence: [],
      },
      outcome: "W",
    };
    expect(MatchResultSchema.safeParse(bad).success).toBe(false);
  });

  // Draft dedup drift.
  it("DraftState rejects deduped_player_ids missing a picked player", () => {
    const d = makeDraftState();
    const bad = { ...d, deduped_player_ids: d.deduped_player_ids.slice(0, -1) };
    expect(DraftStateSchema.safeParse(bad).success).toBe(false);
  });

  it("DraftState rejects a spin whose excluded_player_ids != prior picks", () => {
    const d = makeDraftState();
    const spinsClone = d.spins.map((s) => ({ ...s }));
    // Index 5 should exclude players 0..4 in order; truncate one.
    spinsClone[5] = {
      ...spinsClone[5]!,
      excluded_player_ids: spinsClone[5]!.excluded_player_ids.slice(0, -1),
    };
    const bad = { ...d, spins: spinsClone };
    expect(DraftStateSchema.safeParse(bad).success).toBe(false);
  });

  it("DraftState rejects two spins assigning to the same slot", () => {
    const d = makeDraftState();
    const spinsClone = d.spins.map((s) => ({ ...s }));
    spinsClone[1] = { ...spinsClone[1]!, assigned_slot_id: spinsClone[0]!.assigned_slot_id };
    const bad = { ...d, spins: spinsClone };
    expect(DraftStateSchema.safeParse(bad).success).toBe(false);
  });

  // RunResult invariant drift.
  it("RunResult rejects score != sum(score_breakdown.points)", () => {
    const bad: RunResult = { ...makeRunResult(), score: 999 };
    expect(RunResultSchema.safeParse(bad).success).toBe(false);
  });

  it("RunResult rejects aggregate.clean_sheets != count(round_results goals_against === 0)", () => {
    const r = makeRunResult();
    const bad: RunResult = { ...r, aggregate: { ...r.aggregate, clean_sheets: 8 } };
    expect(RunResultSchema.safeParse(bad).success).toBe(false);
  });

  it('RunResult rejects narrative.narrative_seed != deriveSubseed(seed, "narrative")', () => {
    const r = makeRunResult();
    const bad: RunResult = {
      ...r,
      narrative: { ...r.narrative, narrative_seed: "wcdraft:narrative:v1:deadbeef00000000deadbeef00000000" },
    };
    expect(RunResultSchema.safeParse(bad).success).toBe(false);
  });

  it("RunResult rejects is_champion=true with non-null eliminated_in_match_id", () => {
    const r = makeRunResult();
    const bad: RunResult = { ...r, eliminated_in_match_id: "match.fixture.7" };
    expect(RunResultSchema.safeParse(bad).success).toBe(false);
  });
});
