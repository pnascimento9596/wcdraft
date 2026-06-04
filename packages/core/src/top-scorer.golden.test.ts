import { describe, it } from "vitest";

// GOLDEN INVARIANT (WS-0b contract, WS-B implementation):
//   `resolveTopScorer(matches)` derives top-scorer ELIGIBILITY from the typed
//   `MatchEvent` discriminated union — no stored flag.
//
//   eligible IFF: event.side === "user" && type ∈ {"goal", "pen_scored"}
//   EXCLUSIONS by event type (no flag): own_goal, shootout_kick, pen_missed.
//
//   TIEBREAKS, in order:
//     1) Most counting goals.
//     2) Fewest minutes played across the run — summed from
//        `MatchResult.lineup[*]` entries where `side === "user"` and the
//        player_id matches.
//     3) Lowest player_id lexicographically.
//
//   Returns `null` IFF nobody on the user side scored a counting goal.
//
// IMPLEMENTATION DEFERRED: resolver lands in WS-B. Scaffold only.

describe.skip("top-scorer derivation — exclusions and null cases", () => {
  it.skip("own-goal scorer never wins top_scorer", () => {
    // FIXTURE TODO (WS-B):
    //   - Construct a MatchResult.events list with exactly ONE event of
    //     type:'own_goal'.
    //   - Assert: resolveTopScorer([m]) === null.
  });

  it.skip("shootout scorer never wins top_scorer", () => {
    // FIXTURE TODO (WS-B):
    //   - Construct a MatchResult with shootout events only:
    //     {type:'shootout_kick', side:'user', taker_player_id:'Y', scored:true, ...}
    //   - Assert: resolveTopScorer([m]) === null.
  });

  it.skip("returns null when nobody scored a counting goal", () => {
    // FIXTURE TODO (WS-B):
    //   - A whole run with zero counting goals (e.g. all 0-0 → shootouts only).
    //   - Assert: resolveTopScorer(matches) === null.
  });

  it.skip("tiebreak order: counting goals → fewest minutes → lowest player_id", () => {
    // FIXTURE TODO (WS-B):
    //   - Player A: 3 counting goals, 540 minutes (sum from
    //     MatchResult.lineup), id 'a'.
    //   - Player B: 3 counting goals, 360 minutes, id 'b'.
    //   - Assert: resolveTopScorer(matches) === 'b' (fewest minutes wins).
    //   - Adjust C: 3 counting goals, 360 minutes, id 'aaa' — earlier lex.
    //   - Assert: resolveTopScorer(matches) === 'aaa'.
  });
});
