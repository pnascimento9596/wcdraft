import { describe, it, expect } from "vitest";

import { resolveTopScorer } from "./engine/scoring.js";
import { buildCardId } from "./types/identity.js";
import type { MatchEvent, MatchLineupEntry, MatchResult } from "./types/sim.js";

// GOLDEN INVARIANT (WS-0b contract, WS-B implementation):
//   `resolveTopScorer(matches)` derives top-scorer ELIGIBILITY from the typed
//   MatchEvent union (no stored flag): eligible IFF side==='user' &&
//   type ∈ {goal, pen_scored}. Exclusions: own_goal, shootout_kick, pen_missed,
//   opposition events. Tiebreaks: most goals → fewest minutes (summed from
//   user lineup entries) → lowest player_id.

const TID = 14;

function goal(player_id: string, minute: number): MatchEvent {
  return {
    event_id: `g-${player_id}-${minute}`,
    minute,
    period: "2H",
    side: "user",
    type: "goal",
    scorer_card_id: buildCardId(player_id, TID),
    scorer_player_id: player_id,
    assist_card_id: null,
    assist_player_id: null,
    score_after: { user: 1, opp: 0 },
  };
}

function lineupEntry(player_id: string, minutes: number): MatchLineupEntry {
  return {
    side: "user",
    card_id: buildCardId(player_id, TID),
    player_id,
    tournament_id: TID,
    slot_id: `slot-${player_id}`,
    position: "FW",
    started: true,
    minutes,
  };
}

function match(match_index: number, events: MatchEvent[], lineup: MatchLineupEntry[]): MatchResult {
  // Only `events` + `lineup` are read by resolveTopScorer; the rest is filler.
  return {
    match_id: `m${match_index}`,
    match_index,
    round: "G1",
    phase: "group",
    opponent_team_id: "OPP",
    user_goals: events.filter((e) => e.type === "goal").length,
    opp_goals: 0,
    user_goals_et: null,
    opp_goals_et: null,
    shootout: null,
    outcome: "W",
    counts_as_run_win: true,
    advanced: false,
    lineup,
    events,
  };
}

describe("top-scorer derivation — exclusions and null cases", () => {
  it("own-goal scorer never wins top_scorer", () => {
    const m = match(
      0,
      [
        {
          event_id: "og",
          minute: 30,
          period: "1H",
          side: "user",
          type: "own_goal",
          scorer_card_id: buildCardId("X", TID),
          scorer_player_id: "X",
          beneficiary_side: "user",
          score_after: { user: 1, opp: 0 },
        },
      ],
      [lineupEntry("X", 90)],
    );
    expect(resolveTopScorer([m])).toBeNull();
  });

  it("shootout scorer never wins top_scorer", () => {
    const m = match(
      0,
      [
        {
          event_id: "so0",
          minute: 0,
          period: "shootout",
          side: "user",
          type: "shootout_kick",
          index: 0,
          taker_card_id: buildCardId("Y", TID),
          taker_player_id: "Y",
          scored: true,
        },
      ],
      [lineupEntry("Y", 120)],
    );
    expect(resolveTopScorer([m])).toBeNull();
  });

  it("pen_missed never counts toward top_scorer", () => {
    const m = match(
      0,
      [
        {
          event_id: "pm",
          minute: 70,
          period: "2H",
          side: "user",
          type: "pen_missed",
          taker_card_id: buildCardId("Z", TID),
          taker_player_id: "Z",
          on_target: true,
          saved_by_card_id: null,
          saved_by_player_id: null,
        },
      ],
      [lineupEntry("Z", 90)],
    );
    expect(resolveTopScorer([m])).toBeNull();
  });

  it("opposition goals never count", () => {
    const oppGoal: MatchEvent = { ...goal("opp1", 50), side: "opp" };
    const m = match(0, [oppGoal], [lineupEntry("opp1", 90)]);
    expect(resolveTopScorer([m])).toBeNull();
  });

  it("returns null when nobody scored a counting goal", () => {
    const m = match(0, [], [lineupEntry("A", 90), lineupEntry("B", 90)]);
    expect(resolveTopScorer([m])).toBeNull();
  });

  it("pen_scored counts as a goal toward top_scorer", () => {
    const pen: MatchEvent = {
      event_id: "ps",
      minute: 80,
      period: "2H",
      side: "user",
      type: "pen_scored",
      taker_card_id: buildCardId("P", TID),
      taker_player_id: "P",
      score_after: { user: 1, opp: 0 },
    };
    const m = match(0, [pen], [lineupEntry("P", 90)]);
    expect(resolveTopScorer([m])).toBe("P");
  });

  it("tiebreak order: counting goals → fewest minutes → lowest player_id", () => {
    // A: 3 goals, 270 min (90×3). B: 3 goals, 180 min (60×3). → B wins (fewer minutes).
    const matches: MatchResult[] = [0, 1, 2].map((i) =>
      match(i, [goal("a", 10), goal("b", 20)], [lineupEntry("a", 90), lineupEntry("b", 60)]),
    );
    expect(resolveTopScorer(matches)).toBe("b");

    // Add C: 3 goals, 180 min (60×3), id 'aaa' (< 'b'). Ties B on minutes → lowest id wins.
    const withC: MatchResult[] = [0, 1, 2].map((i) =>
      match(
        i,
        [goal("a", 10), goal("b", 20), goal("aaa", 30)],
        [lineupEntry("a", 90), lineupEntry("b", 60), lineupEntry("aaa", 60)],
      ),
    );
    expect(resolveTopScorer(withC)).toBe("aaa");
  });
});
