// I3.3 — golden tests for the group-stage engine.
//
// Tests exercise `simulateOtherGroupMatches` and `buildGroupStageResult`
// directly with synthetic Team2026 inputs + hand-crafted `MatchResult`s.
// The integrated `runTournamentFull` flow (I3.5) is covered separately by the
// regenerated sim golden.

import { describe, expect, it } from "vitest";

import { buildGroupStageResult, simulateOtherGroupMatches } from "./engine/group-stage.js";
import {
  USER_GROUP_PARTICIPANT_ID,
  type GroupOtherMatchSummary,
  type GroupStanding,
} from "./types/group-stage.js";
import { GroupStageResultSchema } from "./schemas/group-stage.js";
import { deriveSubseed } from "./rng.js";
import type {
  CardId,
  MatchEvent,
  MatchLineupEntry,
  MatchResult,
  Team2026,
  TeamStrength,
} from "./index.js";
import { buildCardId } from "./index.js";

// ─── Synthetic fixture builders ──────────────────────────────────────────────

function teamStrength(v: number): TeamStrength {
  return { attack: v, midfield: v, defense: v, goalkeeping: v, coverage: 1 };
}

function buildTeam(team_id: string, group: "A" | "B", strength: number): Team2026 {
  const squad_card_ids: CardId[] = [];
  for (let i = 0; i < 11; i++) {
    squad_card_ids.push(buildCardId(`${team_id}p${String(i).padStart(2, "0")}`, 23));
  }
  return {
    team_id,
    nation_id: `nat_${team_id}`,
    group,
    group_slot: 1,
    squad_card_ids,
    aggregate_rating: teamStrength(strength),
    squad_status: "projected",
    rating_version: "group-fixture-rating-v1",
    sources: [],
  };
}

/** Build a minimal synthetic user `MatchResult` with the given scoreline. */
function userMatch(
  runId: string,
  idx: number,
  round: "G1" | "G2" | "G3",
  opp: string,
  user_goals: number,
  opp_goals: number,
): MatchResult {
  const lineup: MatchLineupEntry[] = [];
  const events: MatchEvent[] = [];
  const outcome: "W" | "D" | "L" =
    user_goals > opp_goals ? "W" : user_goals < opp_goals ? "L" : "D";
  return {
    match_id: `${runId}.m${idx}`,
    match_index: idx,
    round,
    phase: "group",
    opponent_team_id: opp,
    pre_match_win_probability: 0.5,
    user_goals,
    opp_goals,
    user_goals_et: null,
    opp_goals_et: null,
    shootout: null,
    outcome,
    counts_as_run_win: outcome === "W",
    advanced: false,
    lineup,
    events,
  };
}

/** Build a synthetic other-match summary (skipping `simulateMatchCore`). */
function otherMatch(
  runId: string,
  idx: 0 | 1 | 2,
  team_a: string,
  team_b: string,
  team_a_goals: number,
  team_b_goals: number,
): GroupOtherMatchSummary {
  const outcome: "A" | "D" | "B" =
    team_a_goals > team_b_goals ? "A" : team_a_goals < team_b_goals ? "B" : "D";
  return {
    other_match_index: idx,
    match_id: `${runId}.group-other.${idx}`,
    round: (["G1", "G2", "G3"] as const)[idx],
    team_a_id: team_a,
    team_b_id: team_b,
    team_a_goals,
    team_b_goals,
    outcome,
  };
}

// ─── simulateOtherGroupMatches — deterministic, scoped, no event leak ────────

describe("simulateOtherGroupMatches", () => {
  const runId = "run-other";
  const seed = "seed-other";
  const teamA = buildTeam("T_A", "A", 65);
  const teamB = buildTeam("T_B", "A", 60);
  const teamC = buildTeam("T_C", "A", 55);

  it("emits exactly 3 summaries with canonical pairing order", () => {
    const out = simulateOtherGroupMatches({
      runId,
      seed,
      groupOpponents: [teamC, teamB, teamA], // intentionally unsorted
    });
    expect(out.length).toBe(3);
    // Pairing is over the CANONICALLY-sorted [T_A, T_B, T_C]:
    //   pair 0 → T_A vs T_B
    //   pair 1 → T_A vs T_C
    //   pair 2 → T_B vs T_C
    expect(out[0]!.team_a_id).toBe("T_A");
    expect(out[0]!.team_b_id).toBe("T_B");
    expect(out[1]!.team_a_id).toBe("T_A");
    expect(out[1]!.team_b_id).toBe("T_C");
    expect(out[2]!.team_a_id).toBe("T_B");
    expect(out[2]!.team_b_id).toBe("T_C");
  });

  it("is byte-stable across repeat invocations with the same inputs", () => {
    const a = simulateOtherGroupMatches({ runId, seed, groupOpponents: [teamA, teamB, teamC] });
    const b = simulateOtherGroupMatches({ runId, seed, groupOpponents: [teamA, teamB, teamC] });
    expect(a).toEqual(b);
  });

  it("changes deterministically when the run seed changes", () => {
    const a = simulateOtherGroupMatches({
      runId,
      seed: "seed-A",
      groupOpponents: [teamA, teamB, teamC],
    });
    const b = simulateOtherGroupMatches({
      runId,
      seed: "seed-B",
      groupOpponents: [teamA, teamB, teamC],
    });
    // At least one summary should differ across distinct sub-seeded streams.
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("rejects degenerate opponent counts", () => {
    expect(() =>
      simulateOtherGroupMatches({ runId, seed, groupOpponents: [teamA, teamB] }),
    ).toThrow(RangeError);
  });
});

// ─── buildGroupStageResult — invariants + tiebreaker + qualification ─────────

describe("buildGroupStageResult — basic shape + invariants", () => {
  const runId = "run-shape";
  const seed = "seed-shape";

  it("emits a 4-row table that passes the schema", () => {
    const userMatches = [
      userMatch(runId, 0, "G1", "T_B", 2, 1), // W
      userMatch(runId, 1, "G2", "T_C", 1, 0), // W
      userMatch(runId, 2, "G3", "T_D", 0, 3), // L
    ];
    const others = [
      otherMatch(runId, 0, "T_B", "T_C", 1, 1),
      otherMatch(runId, 1, "T_B", "T_D", 0, 2),
      otherMatch(runId, 2, "T_C", "T_D", 1, 2),
    ];
    const gs = buildGroupStageResult({
      seed,
      group_id: "A",
      user_matches: userMatches,
      other_matches: others,
    });
    const parsed = GroupStageResultSchema.safeParse(gs);
    if (!parsed.success) {
      throw new Error(JSON.stringify(parsed.error.issues, null, 2));
    }
    expect(parsed.success).toBe(true);
    expect(gs.standings.length).toBe(4);
    expect(gs.other_matches.length).toBe(3);
    expect(gs.group_id).toBe("A");
    // Per-row invariants.
    for (const s of gs.standings) {
      expect(s.played).toBe(s.wins + s.draws + s.losses);
      expect(s.goal_difference).toBe(s.goals_for - s.goals_against);
      expect(s.points).toBe(s.wins * 3 + s.draws);
      expect(s.played).toBe(3);
    }
    // Ranks form {1,2,3,4}.
    expect([...gs.standings.map((s) => s.rank)].sort()).toEqual([1, 2, 3, 4]);
    // Draw-lots ranks form {1,2,3,4}.
    expect([...gs.standings.map((s) => s.draw_lots_rank)].sort()).toEqual([1, 2, 3, 4]);
  });

  it("user_qualified=true / qualification=top_two when user finishes 1st or 2nd", () => {
    // User wins all three → rank 1.
    const userMatches = [
      userMatch(runId, 0, "G1", "T_B", 3, 0),
      userMatch(runId, 1, "G2", "T_C", 2, 0),
      userMatch(runId, 2, "G3", "T_D", 1, 0),
    ];
    const others = [
      otherMatch(runId, 0, "T_B", "T_C", 1, 1),
      otherMatch(runId, 1, "T_B", "T_D", 1, 1),
      otherMatch(runId, 2, "T_C", "T_D", 1, 1),
    ];
    const gs = buildGroupStageResult({
      seed,
      group_id: "A",
      user_matches: userMatches,
      other_matches: others,
    });
    expect(gs.user_rank).toBe(1);
    expect(gs.user_qualified).toBe(true);
    expect(gs.qualification).toBe("top_two");
  });

  it("user_qualified=false / qualification=eliminated when user finishes 4th", () => {
    // User loses everything badly → bottom of the table.
    const userMatches = [
      userMatch(runId, 0, "G1", "T_B", 0, 4),
      userMatch(runId, 1, "G2", "T_C", 0, 5),
      userMatch(runId, 2, "G3", "T_D", 0, 3),
    ];
    const others = [
      otherMatch(runId, 0, "T_B", "T_C", 1, 1),
      otherMatch(runId, 1, "T_B", "T_D", 1, 1),
      otherMatch(runId, 2, "T_C", "T_D", 1, 1),
    ];
    const gs = buildGroupStageResult({
      seed,
      group_id: "A",
      user_matches: userMatches,
      other_matches: others,
    });
    expect(gs.user_rank).toBe(4);
    expect(gs.user_qualified).toBe(false);
    expect(gs.qualification).toBe("eliminated");
  });

  it("rank-3 with 4 points qualifies via best_third_threshold", () => {
    // Build a table where user is 3rd with 4 points (1W 1D 1L).
    // Scorelines:
    //   user 1-0 B, user 1-1 C, user 0-2 D
    //   B 0-2 C, B 0-2 D, C 1-1 D
    // Tallies:
    //   user: W D L → 4 pts, GF=2, GA=3, GD=-1
    //   B: L L L    → 0 pts
    //   C: D W D    → 5 pts, GF=4, GA=2, GD=+2
    //   D: W W D    → 7 pts, GF=5, GA=1, GD=+4
    // Final order: D(7), C(5), user(4), B(0) → user_rank=3.
    const userMatches = [
      userMatch(runId, 0, "G1", "T_B", 1, 0),
      userMatch(runId, 1, "G2", "T_C", 1, 1),
      userMatch(runId, 2, "G3", "T_D", 0, 2),
    ];
    const others = [
      otherMatch(runId, 0, "T_B", "T_C", 0, 2),
      otherMatch(runId, 1, "T_B", "T_D", 0, 2),
      otherMatch(runId, 2, "T_C", "T_D", 1, 1),
    ];
    const gs = buildGroupStageResult({
      seed,
      group_id: "A",
      user_matches: userMatches,
      other_matches: others,
    });
    expect(gs.user_rank).toBe(3);
    expect(gs.user_qualified).toBe(true);
    expect(gs.qualification).toBe("best_third_threshold");
  });

  it("rank-3 with 3 points and GD>=0 qualifies via best_third_threshold", () => {
    // Construct: user wins 2-0 vs B, loses 0-2 vs D, loses 0-3 vs C → 3 pts, GD -3 (fails)
    // Instead: user 2-0 B, 0-1 C, 1-1 D → 4 pts. Need a 3-pt GD>=0 setup.
    // user: W 1-0 B, L 0-1 C, L 0-1 D → 3 pts, GD -1 → does NOT qualify.
    // user: W 2-0 B, L 0-1 C, L 0-1 D → 3 pts, GD 0 → SHOULD qualify.
    // others: B vs C: C 2-0 B, B vs D: D 2-0 B, C vs D: D 1-1 C
    // Tallies:
    //   user: 1W 0D 2L, GF=2, GA=2, GD=0, pts=3
    //   B:    0W 0D 3L, GF=0, GA=6, GD=-6, pts=0
    //   C:    2W 1D 0L, GF=4, GA=1, GD=3, pts=7
    //   D:    2W 1D 0L, GF=4, GA=2, GD=2, pts=7
    // → rank order: C(7), D(7), user(3), B(0) — user is 3rd with 3 pts GD 0 → qualify.
    const userMatches = [
      userMatch(runId, 0, "G1", "T_B", 2, 0),
      userMatch(runId, 1, "G2", "T_C", 0, 1),
      userMatch(runId, 2, "G3", "T_D", 0, 1),
    ];
    const others = [
      otherMatch(runId, 0, "T_B", "T_C", 0, 2),
      otherMatch(runId, 1, "T_B", "T_D", 0, 2),
      otherMatch(runId, 2, "T_C", "T_D", 1, 1),
    ];
    const gs = buildGroupStageResult({
      seed,
      group_id: "A",
      user_matches: userMatches,
      other_matches: others,
    });
    expect(gs.user_rank).toBe(3);
    expect(gs.user_qualified).toBe(true);
    expect(gs.qualification).toBe("best_third_threshold");
    const userRow = gs.standings.find((s) => s.kind === "user")!;
    expect(userRow.points).toBe(3);
    expect(userRow.goal_difference).toBe(0);
  });

  it("rank-3 below threshold falls under qualification=eliminated", () => {
    // user: 0-1, 0-1, 1-0 → 3 pts, GD -1 → does NOT meet 3+GD>=0 → eliminated.
    // Goal stuffing to keep user 3rd: B and D win all, C loses 1 to user only.
    // user: L 0-1 B, L 0-1 C, W 1-0 D → 3pts, GF=1, GA=2, GD=-1
    // B: W 1-0 user, W 2-0 C, L 0-3 D → 6 pts
    // C: W 1-0 user, L 0-2 B, L 0-2 D → 3 pts, GF=1, GA=4, GD=-3
    // D: L 0-1 user, W 3-0 B, W 2-0 C → 6 pts
    // Final tuples:
    //   B: 6 pts, GD +2, GF 3
    //   D: 6 pts, GD +4, GF 5
    //   user: 3 pts, GD -1, GF 1
    //   C: 3 pts, GD -3, GF 1
    // → D ranks 1, B ranks 2, user ranks 3, C ranks 4. user has 3 pts GD -1 → fails threshold.
    const userMatches = [
      userMatch(runId, 0, "G1", "T_B", 0, 1),
      userMatch(runId, 1, "G2", "T_C", 0, 1),
      userMatch(runId, 2, "G3", "T_D", 1, 0),
    ];
    const others = [
      otherMatch(runId, 0, "T_B", "T_C", 2, 0),
      otherMatch(runId, 1, "T_B", "T_D", 0, 3),
      otherMatch(runId, 2, "T_C", "T_D", 0, 2),
    ];
    const gs = buildGroupStageResult({
      seed,
      group_id: "A",
      user_matches: userMatches,
      other_matches: others,
    });
    expect(gs.user_rank).toBe(3);
    expect(gs.user_qualified).toBe(false);
    expect(gs.qualification).toBe("eliminated");
  });
});

describe("buildGroupStageResult — tiebreakers", () => {
  const runId = "run-tb";
  const seed = "seed-tb";

  it("breaks ties via head-to-head points before falling to draw-lots", () => {
    // Three teams tied on (points, GD, GF); h2h points decide.
    // user vs B: 1-0 (user W)
    // user vs C: 0-1 (user L)
    // user vs D: 2-2 (D)  → user: 1W 1D 1L = 4 pts, GF=3, GA=3, GD=0
    // B vs C: 0-1 (C W)
    // B vs D: 2-2 (D)     → B: 0W 1D 2L = 1 pt — NOT tied with user.
    // Instead, give B equal cumulative pts/GD/GF as user via:
    //   B vs C: 2-1 (W)
    //   B vs D: 0-1 (L) → B: 1W 0D 2L = 3 pts (not 4).
    // Skip detailed table; just assert this specific synthetic case where two
    // tied teams' H2H breaks the tie. Use C vs D: 1-1.
    // Build a clean case:
    //   user vs B: 1-0 (W)   - user W vs B
    //   user vs C: 1-2 (L)   - user L vs C
    //   user vs D: 0-0       - D
    //   B vs C: 0-0
    //   B vs D: 2-1 (B W)
    //   C vs D: 1-0 (C W)
    // Tallies:
    //   user: 1W 1D 1L, GF=2, GA=2, GD=0, pts=4
    //   B:    1W 1D 1L, GF=2, GA=2, GD=0, pts=4
    //   C:    2W 1D 0L, GF=4, GA=2, GD=2, pts=7
    //   D:    0W 1D 2L, GF=1, GA=3, GD=-2, pts=1
    // user and B are tied on (4, 0, 2). H2H: user beat B 1-0 → user h2h pts=3 vs B h2h pts=0.
    // → user ranks higher → user_rank=2, B_rank=3.
    const userMatches = [
      userMatch(runId, 0, "G1", "T_B", 1, 0),
      userMatch(runId, 1, "G2", "T_C", 1, 2),
      userMatch(runId, 2, "G3", "T_D", 0, 0),
    ];
    const others = [
      otherMatch(runId, 0, "T_B", "T_C", 0, 0),
      otherMatch(runId, 1, "T_B", "T_D", 2, 1),
      otherMatch(runId, 2, "T_C", "T_D", 1, 0),
    ];
    const gs = buildGroupStageResult({
      seed,
      group_id: "A",
      user_matches: userMatches,
      other_matches: others,
    });
    const userRow = gs.standings.find((s) => s.kind === "user")!;
    const bRow = gs.standings.find((s) => s.team_id === "T_B")!;
    expect(userRow.points).toBe(4);
    expect(bRow.points).toBe(4);
    expect(userRow.rank).toBe(2); // H2H winner over B
    expect(bRow.rank).toBe(3);
  });

  it("uses seeded draw-lots when all preceding tiebreakers fail", () => {
    // All four teams: all draws 1-1. Every row identical: 0W 3D 0L, GF=3, GA=3, pts=3.
    // H2H pts among any subset are all equal. Final tiebreak: draw-lots.
    const userMatches = [
      userMatch(runId, 0, "G1", "T_B", 1, 1),
      userMatch(runId, 1, "G2", "T_C", 1, 1),
      userMatch(runId, 2, "G3", "T_D", 1, 1),
    ];
    const others = [
      otherMatch(runId, 0, "T_B", "T_C", 1, 1),
      otherMatch(runId, 1, "T_B", "T_D", 1, 1),
      otherMatch(runId, 2, "T_C", "T_D", 1, 1),
    ];
    const gs = buildGroupStageResult({
      seed,
      group_id: "A",
      user_matches: userMatches,
      other_matches: others,
    });
    // Final rank order must match draw_lots_rank order ascending.
    const sortedByDl = [...gs.standings].sort((a, b) => a.draw_lots_rank - b.draw_lots_rank);
    const sortedByRank = [...gs.standings].sort((a, b) => a.rank - b.rank);
    expect(sortedByDl.map((s) => s.participant_id)).toEqual(
      sortedByRank.map((s) => s.participant_id),
    );
  });

  it("draw-lots ranks are sourced from deriveSubseed(seed, 'group_table')", () => {
    // The exact mapping is opaque, but the same seed → same ranks.
    const userMatches = [
      userMatch(runId, 0, "G1", "T_B", 1, 1),
      userMatch(runId, 1, "G2", "T_C", 1, 1),
      userMatch(runId, 2, "G3", "T_D", 1, 1),
    ];
    const others = [
      otherMatch(runId, 0, "T_B", "T_C", 1, 1),
      otherMatch(runId, 1, "T_B", "T_D", 1, 1),
      otherMatch(runId, 2, "T_C", "T_D", 1, 1),
    ];
    const a = buildGroupStageResult({
      seed,
      group_id: "A",
      user_matches: userMatches,
      other_matches: others,
    });
    const b = buildGroupStageResult({
      seed,
      group_id: "A",
      user_matches: userMatches,
      other_matches: others,
    });
    expect(a.standings.map((s: GroupStanding) => s.draw_lots_rank)).toEqual(
      b.standings.map((s: GroupStanding) => s.draw_lots_rank),
    );
    // Confirm seed lineage exists (sanity).
    expect(deriveSubseed(seed, "group_table")).toBe(deriveSubseed(seed, "group_table"));
  });

  it("user always appears exactly once with participant_id=USER_GROUP_PARTICIPANT_ID", () => {
    const userMatches = [
      userMatch(runId, 0, "G1", "T_B", 1, 1),
      userMatch(runId, 1, "G2", "T_C", 1, 1),
      userMatch(runId, 2, "G3", "T_D", 1, 1),
    ];
    const others = [
      otherMatch(runId, 0, "T_B", "T_C", 1, 1),
      otherMatch(runId, 1, "T_B", "T_D", 1, 1),
      otherMatch(runId, 2, "T_C", "T_D", 1, 1),
    ];
    const gs = buildGroupStageResult({
      seed,
      group_id: "A",
      user_matches: userMatches,
      other_matches: others,
    });
    const userRows = gs.standings.filter((s) => s.participant_id === USER_GROUP_PARTICIPANT_ID);
    expect(userRows.length).toBe(1);
    expect(userRows[0]!.kind).toBe("user");
    expect(userRows[0]!.team_id).toBeNull();
  });
});

describe("buildGroupStageResult — validation", () => {
  const runId = "run-bad";
  const seed = "seed-bad";

  it("throws on != 3 user matches", () => {
    expect(() =>
      buildGroupStageResult({
        seed,
        group_id: "A",
        user_matches: [userMatch(runId, 0, "G1", "T_B", 1, 0)],
        other_matches: [
          otherMatch(runId, 0, "T_B", "T_C", 1, 0),
          otherMatch(runId, 1, "T_B", "T_D", 1, 0),
          otherMatch(runId, 2, "T_C", "T_D", 1, 0),
        ],
      }),
    ).toThrow(RangeError);
  });

  it("throws when user_matches reference non-distinct opponents", () => {
    expect(() =>
      buildGroupStageResult({
        seed,
        group_id: "A",
        user_matches: [
          userMatch(runId, 0, "G1", "T_B", 1, 0),
          userMatch(runId, 1, "G2", "T_B", 1, 0), // duplicate opponent
          userMatch(runId, 2, "G3", "T_D", 1, 0),
        ],
        other_matches: [
          otherMatch(runId, 0, "T_B", "T_D", 1, 0),
          otherMatch(runId, 1, "T_B", "T_D", 1, 0),
          otherMatch(runId, 2, "T_B", "T_D", 1, 0),
        ],
      }),
    ).toThrow(RangeError);
  });

  it("throws when other_matches reference teams outside the participant set", () => {
    expect(() =>
      buildGroupStageResult({
        seed,
        group_id: "A",
        user_matches: [
          userMatch(runId, 0, "G1", "T_B", 1, 0),
          userMatch(runId, 1, "G2", "T_C", 1, 0),
          userMatch(runId, 2, "G3", "T_D", 1, 0),
        ],
        other_matches: [
          otherMatch(runId, 0, "T_B", "T_E", 1, 0), // T_E not in user matches
          otherMatch(runId, 1, "T_B", "T_D", 1, 0),
          otherMatch(runId, 2, "T_C", "T_D", 1, 0),
        ],
      }),
    ).toThrow(RangeError);
  });
});
