import { describe, it, expect } from "vitest";

import type { DraftState, Spin, SquadSlot } from "../types/draft.js";
import type { MatchLineupEntry, MatchResult } from "../types/sim.js";
import type { Player, PlayerTournament } from "../types/identity.js";
import type { Rating } from "../types/rating.js";
import type { RunResult } from "../types/run.js";
import type { Team2026 } from "../types/tournament.js";
import type { LeaderboardSubmission } from "./leaderboard.js";

import { buildCardId } from "../types/identity.js";
import { buildManagerCardId } from "../types/manager.js";
import { FORMATION_TEMPLATES } from "../types/formation.js";
import { deriveSubseed } from "../rng.js";
import {
  DraftStateSchema,
  LeaderboardSubmissionSchema,
  MatchLineupEntrySchema,
  MatchResultSchema,
  PlayerMatchStatsSchema,
  PlayerRunStatsSchema,
  PlayerSchema,
  PlayerTournamentSchema,
  RatingSchema,
  RunResultSchema,
  SpinSchema,
  SquadSlotSchema,
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

// 4-4-2 starter slots (11) — taken from the locked FormationTemplate so the
// fixture aligns with the schema's formation_id ↔ slot_id 1:1 cross-check.
// Order matches FORMATION_TEMPLATES["4-4-2"].slots — needed so spin i (i<11)
// assigns to the i-th starter slot.
const FIXTURE_FORMATION_ID = "4-4-2";
const FIXTURE_STARTER_SLOTS = FORMATION_TEMPLATES[FIXTURE_FORMATION_ID]!.slots;
// Bench slots — engine-owned ids; positions chosen as utility roles.
const FIXTURE_BENCH_SLOTS = [
  { slot_id: "bench.0", slot_position: "CB" as const },
  { slot_id: "bench.1", slot_position: "CM" as const },
  { slot_id: "bench.2", slot_position: "ST" as const },
  { slot_id: "bench.3", slot_position: "LCM" as const },
  { slot_id: "bench.4", slot_position: "AM" as const },
];
// Manager pick lands on the LAST spin (index 16). Under ENGINE-V2 E-1
// with-replacement sampling the schema allows repeated (T, N) pairs, but this
// fixture still uses a distinct manager pair for clarity.
const FIXTURE_MGR_TOURNAMENT_ID = 1994;
const FIXTURE_MGR_NATION_ID = "bra";
const FIXTURE_MGR_ID = "M-311"; // Carlos Alberto Parreira — see manager-identity golden.

function makeDraftState(): DraftState {
  const spins: Spin[] = [];
  const squad: SquadSlot[] = [];
  // Spins 0..15 — player picks (11 starters + 5 bench).
  for (let i = 0; i < 16; i++) {
    const tournament_id = 1954 + i;
    const player_id = `player.fixture.${i}`;
    const card_id = buildCardId(player_id, tournament_id);
    const isStarter = i < 11;
    const slotInfo = isStarter
      ? { slot_id: FIXTURE_STARTER_SLOTS[i]!.slot_id, slot_position: FIXTURE_STARTER_SLOTS[i]!.slot_position }
      : FIXTURE_BENCH_SLOTS[i - 11]!;
    spins.push({
      index: i,
      tournament_id,
      nation_id: `nation.${i}`,
      rare: false,
      draw_probability: 0.05,
      rolled_card_ids: [card_id],
      excluded_player_ids: Array.from({ length: i }, (_, j) => `player.fixture.${j}`),
      rolled_manager_card_id: null,
      picked_kind: "player",
      picked_card_id: card_id,
      picked_player_id: player_id,
      assigned_slot_id: slotInfo.slot_id,
      picked_manager_card_id: null,
      target_slot_id: null,
      status: "picked",
    });
    squad.push({
      slot_id: slotInfo.slot_id,
      is_starter: isStarter,
      slot_position: slotInfo.slot_position,
      card_id,
      player_id,
      tournament_id,
      position_compatibility: 1,
      validation_warnings: [],
    });
  }
  // Spin 16 — manager pick. Distinct (tournament_id, nation_id) for readability.
  const managerCardId = buildManagerCardId(FIXTURE_MGR_ID, FIXTURE_MGR_TOURNAMENT_ID);
  spins.push({
    index: 16,
    tournament_id: FIXTURE_MGR_TOURNAMENT_ID,
    nation_id: FIXTURE_MGR_NATION_ID,
    rare: false,
    draw_probability: 0.05,
    rolled_card_ids: [],
    excluded_player_ids: Array.from({ length: 16 }, (_, j) => `player.fixture.${j}`),
    rolled_manager_card_id: managerCardId,
    picked_kind: "manager",
    picked_card_id: null,
    picked_player_id: null,
    assigned_slot_id: null,
    picked_manager_card_id: managerCardId,
    target_slot_id: null,
    status: "picked",
  });
  return {
    run_id: "run.fixture.1",
    draft_seed: "seed.draft.fixture.1",
    mode: "classic",
    formation_id: FIXTURE_FORMATION_ID,
    team_name: "Your XI",
    spins,
    squad,
    manager_card_id: managerCardId,
    status: "ready",
    deduped_player_ids: Array.from({ length: 16 }, (_, i) => `player.fixture.${i}`),
    dataset_version: "dataset@0.0.0",
    rating_version: "rating@0.0.0",
    engine_version: "engine@0.0.0",
    draft_flow: "squad_first",
    rating_basis: "career",
    era_preset: "all_time",
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

  // Formation FK (WS-0c).
  it("DraftState rejects unknown formation_id", () => {
    const bad = { ...makeDraftState(), formation_id: "9-9-9-9" };
    expect(DraftStateSchema.safeParse(bad).success).toBe(false);
  });

  it("DraftState rejects formation_id whose template's starter slot_ids do not match the squad", () => {
    // 4-3-3 has a different starter slot_id set than 4-4-2 (e.g. ST / LW / RW
    // vs LF / RF), so flipping formation_id without re-laying the squad must fail.
    const bad = { ...makeDraftState(), formation_id: "4-3-3" };
    expect(DraftStateSchema.safeParse(bad).success).toBe(false);
  });

  it("DraftState accepts the fixture formation_id '4-4-2' (round-trip control)", () => {
    expect(DraftStateSchema.safeParse(makeDraftState()).success).toBe(true);
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

  // Lock-on-pick: a picked PLAYER must occupy a SquadSlot (no ghost picks).
  it("SpinSchema rejects a player pick with assigned_slot_id: null (lock-on-pick)", () => {
    const card_id = buildCardId("player.fixture.0", 1954);
    // Otherwise-valid player pick: card appears in rolled_card_ids and matches
    // buildCardId(player_id, tournament_id); the ONLY defect is the null slot.
    const bad = {
      index: 0,
      tournament_id: 1954,
      nation_id: "nation.0",
      rare: false,
      draw_probability: 0.05,
      rolled_card_ids: [card_id],
      excluded_player_ids: [],
      rolled_manager_card_id: null,
      picked_kind: "player",
      picked_card_id: card_id,
      picked_player_id: "player.fixture.0",
      assigned_slot_id: null,
      picked_manager_card_id: null,
      status: "picked",
    };
    expect(SpinSchema.safeParse(bad).success).toBe(false);
  });

  it("DraftState rejects a ghost picked player (picked, in deduped_player_ids, no assigned slot)", () => {
    const d = makeDraftState();
    // Spin 0 stays a 'picked' player — so it remains in deduped_player_ids —
    // but drops its slot assignment, and its squad slot is vacated. The player
    // is "drafted" yet occupies no slot: a ghost pick.
    const ghostSlotId = d.spins[0]!.assigned_slot_id!;
    const spinsClone = d.spins.map((s) => ({ ...s }));
    spinsClone[0] = { ...spinsClone[0]!, assigned_slot_id: null };
    const squadClone = d.squad.map((s) => ({ ...s }));
    const gi = squadClone.findIndex((s) => s.slot_id === ghostSlotId);
    squadClone[gi] = {
      ...squadClone[gi]!,
      card_id: null,
      player_id: null,
      tournament_id: null,
      position_compatibility: 0,
    };
    const bad = { ...d, spins: spinsClone, squad: squadClone };
    expect(DraftStateSchema.safeParse(bad).success).toBe(false);
  });

  it("DraftState rejects a picked-player spin whose assigned_slot_id points to a slot holding a different card", () => {
    const d = makeDraftState();
    // Swap the slot assignments of the first two player picks: each spin now
    // references a slot holding the OTHER pick's card — slot/spin disagreement
    // with no duplicate assignment and both slots still occupied.
    const spinsClone = d.spins.map((s) => ({ ...s }));
    const slot0 = spinsClone[0]!.assigned_slot_id;
    spinsClone[0] = { ...spinsClone[0]!, assigned_slot_id: spinsClone[1]!.assigned_slot_id };
    spinsClone[1] = { ...spinsClone[1]!, assigned_slot_id: slot0 };
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

// ─── No-throw boundary contract ──────────────────────────────────────────────
// safeParse MUST return {success:false} — NEVER throw — on adversarial input.
// The card-id consistency refinements call buildCardId, which throws on an
// empty player_id / non-positive tournament_id. Because the field-level
// NonEmptyIdSchema only marks the result DIRTY (not aborted), the superRefine
// still runs; an unguarded buildCardId would let that RangeError escape
// safeParse. These five schemas are the card-id-bearing trust boundaries
// (MatchResult.lineup, RunResult.player_stats, DraftState.spins/squad).

describe("zod boundary schemas — safeParse never throws on empty player_id", () => {
  it("MatchLineupEntrySchema rejects empty player_id without throwing", () => {
    const bad = {
      side: "user",
      card_id: "x:1",
      player_id: "",
      tournament_id: 1,
      slot_id: "s",
      position: "FW",
      started: true,
      minutes: 90,
    };
    expect(() => MatchLineupEntrySchema.safeParse(bad)).not.toThrow();
    expect(MatchLineupEntrySchema.safeParse(bad).success).toBe(false);
  });

  it("PlayerMatchStatsSchema rejects empty player_id without throwing", () => {
    const bad = {
      player_id: "",
      card_id: "x:1",
      tournament_id: 1,
      match_id: "m",
      goals: 0,
      assists: 0,
      shots: 0,
      shots_on_target: 0,
      key_passes: 0,
      fouls_committed: 0,
      fouls_suffered: 0,
      offsides: 0,
      yellows: 0,
      reds: 0,
      saves: 0,
      pens_won: 0,
      pens_scored: 0,
      pens_missed: 0,
      minutes: 90,
      subbed_on: false,
      subbed_off: false,
      injured: false,
    };
    expect(() => PlayerMatchStatsSchema.safeParse(bad)).not.toThrow();
    expect(PlayerMatchStatsSchema.safeParse(bad).success).toBe(false);
  });

  it("PlayerRunStatsSchema rejects empty player_id without throwing", () => {
    const bad = {
      player_id: "",
      card_id: "x:1",
      tournament_id: 1,
      per_match: [],
      totals: {
        goals: 0,
        assists: 0,
        shots: 0,
        shots_on_target: 0,
        key_passes: 0,
        fouls_committed: 0,
        fouls_suffered: 0,
        offsides: 0,
        yellows: 0,
        reds: 0,
        saves: 0,
        pens_won: 0,
        pens_scored: 0,
        pens_missed: 0,
        minutes: 0,
      },
      rating_at_draft: null,
    };
    expect(() => PlayerRunStatsSchema.safeParse(bad)).not.toThrow();
    expect(PlayerRunStatsSchema.safeParse(bad).success).toBe(false);
  });

  it("SpinSchema rejects picked player-spin with empty picked_player_id without throwing", () => {
    const bad = {
      index: 0,
      tournament_id: 1,
      nation_id: "n",
      rare: false,
      draw_probability: 0.05,
      rolled_card_ids: ["p:1"],
      excluded_player_ids: [],
      rolled_manager_card_id: null,
      picked_kind: "player",
      picked_card_id: "p:1",
      picked_player_id: "",
      assigned_slot_id: null,
      picked_manager_card_id: null,
      status: "picked",
    };
    expect(() => SpinSchema.safeParse(bad)).not.toThrow();
    expect(SpinSchema.safeParse(bad).success).toBe(false);
  });

  it("SquadSlotSchema rejects occupied slot with empty player_id without throwing", () => {
    const bad = {
      slot_id: "s",
      is_starter: true,
      slot_position: "ST",
      card_id: "p:1",
      player_id: "",
      tournament_id: 1,
      position_compatibility: 1,
      validation_warnings: [],
    };
    expect(() => SquadSlotSchema.safeParse(bad)).not.toThrow();
    expect(SquadSlotSchema.safeParse(bad).success).toBe(false);
  });
});
