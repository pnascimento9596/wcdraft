// I3.4 — golden tests for `selectKnockoutLadderAfterGroup`.
//
// Exercises:
//   - `group_position` R32 feed for ranks 1/2,
//   - `best_third` R32 feed for rank 3 with lexicographic `slot_id` tiebreak,
//   - fallback to global escalating pool with `fallback_reason` shape,
//   - exclusions (no group opponent, no team in user's group ever picked),
//   - determinism (byte-stable across repeat runs).
//
// Bracket fixtures are intentionally synthetic — the real published 2026
// bracket is exercised end-to-end by the I3.6 e2e golden in @wcdraft/data.

import { describe, expect, it } from "vitest";

import { selectKnockoutLadderAfterGroup } from "./engine/opponent-selection.js";
import type {
  Bracket2026,
  CardId,
  GroupStageResult,
  GroupStanding,
  RunScenario,
  SimWorld,
  Slot,
  Team2026,
  TeamStrength,
} from "./index.js";
import { USER_GROUP_PARTICIPANT_ID, buildCardId } from "./index.js";

const SEED = "wcdraft:opp-select-golden:v1";

function teamStrength(v: number): TeamStrength {
  return { attack: v, midfield: v, defense: v, goalkeeping: v, coverage: 1 };
}

function buildTeam(
  team_id: string,
  group: import("./index.js").GroupId,
  group_slot: number,
  strength: number,
): Team2026 {
  const squad_card_ids: CardId[] = [];
  for (let i = 0; i < 11; i++) {
    squad_card_ids.push(buildCardId(`${team_id}p${String(i).padStart(2, "0")}`, 23));
  }
  return {
    team_id,
    nation_id: `nat_${team_id}`,
    group,
    group_slot,
    squad_card_ids,
    aggregate_rating: teamStrength(strength),
    squad_status: "projected",
    rating_version: "opp-fixture-rating-v1",
    sources: [],
  };
}

function buildOpponents(): Record<string, Team2026> {
  const out: Record<string, Team2026> = {};
  const groups: import("./index.js").GroupId[] = ["A", "B", "C", "D"];
  let strength = 40;
  for (const g of groups) {
    for (let i = 1; i <= 4; i++) {
      const tid = `T_${g}${i}`;
      out[tid] = buildTeam(tid, g, i, strength);
      strength += 3;
    }
  }
  return out;
}

function userMatches(opp1: string, opp2: string, opp3: string): GroupStageResult {
  // Pre-built stub group stage; opponent_ids drive only the exclusion set in
  // `selectKnockoutLadderAfterGroup`. user_rank/user_qualified set per test.
  const standings: GroupStanding[] = [
    {
      rank: 1,
      participant_id: USER_GROUP_PARTICIPANT_ID,
      kind: "user",
      team_id: null,
      played: 3,
      wins: 3,
      draws: 0,
      losses: 0,
      goals_for: 6,
      goals_against: 0,
      goal_difference: 6,
      points: 9,
      draw_lots_rank: 1,
    },
    {
      rank: 2,
      participant_id: opp1,
      kind: "team",
      team_id: opp1,
      played: 3,
      wins: 2,
      draws: 0,
      losses: 1,
      goals_for: 4,
      goals_against: 2,
      goal_difference: 2,
      points: 6,
      draw_lots_rank: 2,
    },
    {
      rank: 3,
      participant_id: opp2,
      kind: "team",
      team_id: opp2,
      played: 3,
      wins: 1,
      draws: 0,
      losses: 2,
      goals_for: 2,
      goals_against: 4,
      goal_difference: -2,
      points: 3,
      draw_lots_rank: 3,
    },
    {
      rank: 4,
      participant_id: opp3,
      kind: "team",
      team_id: opp3,
      played: 3,
      wins: 0,
      draws: 0,
      losses: 3,
      goals_for: 0,
      goals_against: 6,
      goal_difference: -6,
      points: 0,
      draw_lots_rank: 4,
    },
  ];
  return {
    group_id: "A",
    standings,
    user_rank: 1,
    user_qualified: true,
    qualification: "top_two",
    other_matches: [
      {
        other_match_index: 0,
        match_id: "x.0",
        round: "G1",
        team_a_id: opp1,
        team_b_id: opp2,
        team_a_goals: 1,
        team_b_goals: 0,
        outcome: "A",
      },
      {
        other_match_index: 1,
        match_id: "x.1",
        round: "G2",
        team_a_id: opp1,
        team_b_id: opp3,
        team_a_goals: 1,
        team_b_goals: 0,
        outcome: "A",
      },
      {
        other_match_index: 2,
        match_id: "x.2",
        round: "G3",
        team_a_id: opp2,
        team_b_id: opp3,
        team_a_goals: 1,
        team_b_goals: 0,
        outcome: "A",
      },
    ],
  };
}

function scenario(): RunScenario {
  // User group = A; opponents are A2/A3/A4. Engine excludes anyone in group A
  // AND any explicit group opponent.
  return {
    scenario_id: "scenario:test",
    user_group_id: "A",
    group_opponent_team_ids: ["T_A2", "T_A3", "T_A4"],
    knockout_opponent_rule: {
      kind: "escalating_strength_seeded",
      rounds: ["R32", "R16", "QF", "SF", "F"],
      seed_suffix: "opp-suffix",
    },
    ruleset_version: "ruleset-v1",
    scenario_seed: "scenario-seed",
  };
}

/** Build a synthetic R32 slot. */
function r32Slot(slot_id: string, match_id: string, source: Slot["source"]): Slot {
  return { slot_id, round: "R32", source, match_id };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("selectKnockoutLadderAfterGroup — fallback paths", () => {
  it("no bracket → fallback to global escalating pool (R32 fallback flagged)", () => {
    const opponents = buildOpponents();
    const world: SimWorld = { ratings: {}, opponents };
    const gs = userMatches("T_A2", "T_A3", "T_A4");
    const out = selectKnockoutLadderAfterGroup({
      scenario: scenario(),
      world,
      seed: SEED,
      groupStage: gs,
    });
    expect(out.ladder.length).toBe(5);
    expect(out.meta.rounds.length).toBe(5);
    expect(out.meta.rounds[0]!.round).toBe("R32");
    expect(out.meta.rounds[0]!.fallback).toBe(true);
    expect(out.meta.rounds[0]!.fallback_reason).toBe("no_bracket");
    expect(out.meta.rounds[0]!.bracket_constrained).toBe(false);
    // R16-F are never bracket-constrained today.
    for (let r = 1; r < 5; r++) {
      expect(out.meta.rounds[r]!.bracket_constrained).toBe(false);
      expect(out.meta.rounds[r]!.fallback).toBe(false);
    }
  });

  it("no matching user R32 slot → fallback with no_user_r32_slot", () => {
    const opponents = buildOpponents();
    // Bracket has no slot matching user group A position 1.
    const bracket: Bracket2026 = {
      groups: [],
      knockout_slots: [
        // Only group_position B/1 vs C/2.
        r32Slot("S0", "M0", { kind: "group_position", group_id: "B", position: 1 }),
        r32Slot("S1", "M0", { kind: "group_position", group_id: "C", position: 2 }),
      ],
    };
    const world: SimWorld = { ratings: {}, opponents, bracket };
    const gs = userMatches("T_A2", "T_A3", "T_A4");
    const out = selectKnockoutLadderAfterGroup({
      scenario: scenario(),
      world,
      seed: SEED,
      groupStage: gs,
    });
    expect(out.meta.rounds[0]!.fallback_reason).toBe("no_user_r32_slot");
  });

  it("empty constrained pool → fallback with empty_constrained_pool", () => {
    const opponents = buildOpponents();
    // User is rank 1 of group A; opposite seat is rank 2 of group A → all
    // candidate teams are in group A, which is excluded entirely.
    const bracket: Bracket2026 = {
      groups: [],
      knockout_slots: [
        r32Slot("S0", "M0", { kind: "group_position", group_id: "A", position: 1 }),
        r32Slot("S1", "M0", { kind: "group_position", group_id: "A", position: 2 }),
      ],
    };
    const world: SimWorld = { ratings: {}, opponents, bracket };
    const gs = userMatches("T_A2", "T_A3", "T_A4");
    const out = selectKnockoutLadderAfterGroup({
      scenario: scenario(),
      world,
      seed: SEED,
      groupStage: gs,
    });
    expect(out.meta.rounds[0]!.fallback_reason).toBe("empty_constrained_pool");
    expect(out.meta.rounds[0]!.user_slot_id).toBe("S0");
    expect(out.meta.rounds[0]!.opposite_slot_id).toBe("S1");
  });

  it("match_winner opposite seat → fallback with opposite_source_not_group_based", () => {
    const opponents = buildOpponents();
    const bracket: Bracket2026 = {
      groups: [],
      knockout_slots: [
        r32Slot("S0", "M0", { kind: "group_position", group_id: "A", position: 1 }),
        r32Slot("S1", "M0", { kind: "match_winner", match_slot_id: "X" }),
      ],
    };
    const world: SimWorld = { ratings: {}, opponents, bracket };
    const gs = userMatches("T_A2", "T_A3", "T_A4");
    const out = selectKnockoutLadderAfterGroup({
      scenario: scenario(),
      world,
      seed: SEED,
      groupStage: gs,
    });
    expect(out.meta.rounds[0]!.fallback_reason).toBe("opposite_source_not_group_based");
  });
});

describe("selectKnockoutLadderAfterGroup — bracket-constrained R32", () => {
  it("group_position user seat → constrained to opposite seat's group", () => {
    const opponents = buildOpponents();
    const bracket: Bracket2026 = {
      groups: [],
      knockout_slots: [
        r32Slot("S0", "M0", { kind: "group_position", group_id: "A", position: 1 }),
        r32Slot("S1", "M0", { kind: "group_position", group_id: "B", position: 2 }),
      ],
    };
    const world: SimWorld = { ratings: {}, opponents, bracket };
    const gs = userMatches("T_A2", "T_A3", "T_A4");
    const out = selectKnockoutLadderAfterGroup({
      scenario: scenario(),
      world,
      seed: SEED,
      groupStage: gs,
    });
    const m0 = out.meta.rounds[0]!;
    expect(m0.bracket_constrained).toBe(true);
    expect(m0.fallback).toBe(false);
    expect(m0.fallback_reason).toBeNull();
    expect(m0.user_slot_id).toBe("S0");
    expect(m0.opposite_slot_id).toBe("S1");
    expect(m0.candidate_group_ids).toEqual(["B"]);
    expect(opponents[m0.opponent_team_id]!.group).toBe("B");
  });

  it("best_third user seat selects candidate_groups deterministically", () => {
    const opponents = buildOpponents();
    const gs3 = userMatches("T_A2", "T_A3", "T_A4");
    // Mutate user rank to 3 + qualified.
    gs3.standings[0]!.rank = 3;
    gs3.standings[1]!.rank = 1;
    gs3.standings[2]!.rank = 2;
    gs3.user_rank = 3;
    gs3.user_qualified = true;
    gs3.qualification = "best_third_threshold";

    const bracket: Bracket2026 = {
      groups: [],
      knockout_slots: [
        r32Slot("U", "M0", { kind: "best_third", candidate_groups: ["A", "B", "C"] }),
        r32Slot("V", "M0", { kind: "group_position", group_id: "D", position: 1 }),
      ],
    };
    const world: SimWorld = { ratings: {}, opponents, bracket };
    const out = selectKnockoutLadderAfterGroup({
      scenario: scenario(),
      world,
      seed: SEED,
      groupStage: gs3,
    });
    const m0 = out.meta.rounds[0]!;
    expect(m0.bracket_constrained).toBe(true);
    expect(m0.user_slot_id).toBe("U");
    expect(m0.opposite_slot_id).toBe("V");
    expect(m0.candidate_group_ids).toEqual(["D"]);
    expect(opponents[m0.opponent_team_id]!.group).toBe("D");
  });

  it("multi-seat user candidates → lex-min slot_id wins", () => {
    const opponents = buildOpponents();
    const gs3 = userMatches("T_A2", "T_A3", "T_A4");
    gs3.standings[0]!.rank = 3;
    gs3.standings[1]!.rank = 1;
    gs3.standings[2]!.rank = 2;
    gs3.user_rank = 3;
    gs3.user_qualified = true;
    gs3.qualification = "best_third_threshold";

    // Two best_third seats include user group A. Lex-min "S_AAA" must win.
    const bracket: Bracket2026 = {
      groups: [],
      knockout_slots: [
        r32Slot("S_BBB", "M_BB", { kind: "best_third", candidate_groups: ["A", "B"] }),
        r32Slot("S_AAA", "M_AA", { kind: "best_third", candidate_groups: ["A", "C"] }),
        r32Slot("OPP_AA", "M_AA", { kind: "group_position", group_id: "B", position: 1 }),
        r32Slot("OPP_BB", "M_BB", { kind: "group_position", group_id: "D", position: 2 }),
      ],
    };
    const world: SimWorld = { ratings: {}, opponents, bracket };
    const out = selectKnockoutLadderAfterGroup({
      scenario: scenario(),
      world,
      seed: SEED,
      groupStage: gs3,
    });
    expect(out.meta.rounds[0]!.user_slot_id).toBe("S_AAA");
    expect(out.meta.rounds[0]!.opposite_slot_id).toBe("OPP_AA");
    expect(out.meta.rounds[0]!.candidate_group_ids).toEqual(["B"]);
  });

  it("never reselects a group opponent and never picks a team in user's group", () => {
    const opponents = buildOpponents();
    const bracket: Bracket2026 = {
      groups: [],
      knockout_slots: [
        r32Slot("S0", "M0", { kind: "group_position", group_id: "A", position: 1 }),
        r32Slot("S1", "M0", { kind: "group_position", group_id: "B", position: 2 }),
      ],
    };
    const world: SimWorld = { ratings: {}, opponents, bracket };
    const gs = userMatches("T_A2", "T_A3", "T_A4");
    const out = selectKnockoutLadderAfterGroup({
      scenario: scenario(),
      world,
      seed: SEED,
      groupStage: gs,
    });
    const ladderIds = new Set(out.ladder.map((t) => t.team_id));
    // Never a group opponent.
    for (const tid of ["T_A2", "T_A3", "T_A4"]) {
      expect(ladderIds.has(tid)).toBe(false);
    }
    // Never a team in user group A.
    for (const t of out.ladder) {
      expect(t.group).not.toBe("A");
    }
  });
});

describe("selectKnockoutLadderAfterGroup — determinism", () => {
  it("byte-stable across repeat invocations", () => {
    const opponents = buildOpponents();
    const bracket: Bracket2026 = {
      groups: [],
      knockout_slots: [
        r32Slot("S0", "M0", { kind: "group_position", group_id: "A", position: 1 }),
        r32Slot("S1", "M0", { kind: "group_position", group_id: "B", position: 2 }),
      ],
    };
    const world: SimWorld = { ratings: {}, opponents, bracket };
    const gs = userMatches("T_A2", "T_A3", "T_A4");
    const a = selectKnockoutLadderAfterGroup({
      scenario: scenario(),
      world,
      seed: SEED,
      groupStage: gs,
    });
    const b = selectKnockoutLadderAfterGroup({
      scenario: scenario(),
      world,
      seed: SEED,
      groupStage: gs,
    });
    expect(a.ladder.map((t) => t.team_id)).toEqual(b.ladder.map((t) => t.team_id));
    expect(a.meta).toEqual(b.meta);
  });

  it("changes when seed changes", () => {
    const opponents = buildOpponents();
    const bracket: Bracket2026 = {
      groups: [],
      knockout_slots: [
        r32Slot("S0", "M0", { kind: "group_position", group_id: "A", position: 1 }),
        r32Slot("S1", "M0", { kind: "group_position", group_id: "B", position: 2 }),
      ],
    };
    const world: SimWorld = { ratings: {}, opponents, bracket };
    const gs = userMatches("T_A2", "T_A3", "T_A4");
    const a = selectKnockoutLadderAfterGroup({
      scenario: scenario(),
      world,
      seed: "seed-A",
      groupStage: gs,
    });
    const b = selectKnockoutLadderAfterGroup({
      scenario: scenario(),
      world,
      seed: "seed-B",
      groupStage: gs,
    });
    expect(a.ladder.map((t) => t.team_id)).not.toEqual(b.ladder.map((t) => t.team_id));
  });
});
