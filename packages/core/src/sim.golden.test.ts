import { describe, it } from "vitest";

// GOLDEN INVARIANT (WS-0b contract, WS-B implementation):
//   A fixed (draft, scenario, seed, all three version anchors) reproduces an
//   IDENTICAL RunResult — INCLUDING `score`, `score_breakdown`, and
//   `player_stats`.
//
// DETERMINISM INVARIANTS being asserted here (declared on `DraftState` /
// `RunScenario` / `MatchResult`):
//   - `seed` is a STRING; PRNG is cyrb128 + sfc32; no Date / Math.random /
//     crypto / performance / transcendentals anywhere in the sim chain.
//   - Sub-seeds for match-sim / event-gen / opponent-selection / narrative
//     are DERIVED from the run seed — never freshly instantiated.
//   - Sampling pools (event taxonomies, shootout taker order, opponent
//     selection) are CANONICALLY SORTED by stable id before any draw.
//   - The score equality `score = sum(score_breakdown[i].points)` is enforced.
//
// IMPLEMENTATION DEFERRED: the sim + score engine lands in WS-B. Scaffold only.

describe.skip("sim+score — fixed inputs reproduce byte-identical RunResult", () => {
  it.skip(
    "same (draft, scenario, seed, dataset_version, rating_version, engine_version) " +
      "yields deep-equal RunResult including score and breakdown",
    () => {
      // FIXTURE TODO (WS-B):
      //   - Build a fixed DraftState + RunScenario + version anchors.
      //   - Invoke runTournament twice with the same seed.
      //   - Assert: the two RunResult objects are deep-equal.
      //   - Assert: run.score === sum(run.score_breakdown.map(c => c.points)).
      //   - Assert: per-player aggregates in player_stats match the per-match sums.
    },
  );

  it.skip("regulation-vs-ET-vs-shootout fields are mutually exclusive in the documented way", () => {
    // FIXTURE TODO (WS-B):
    //   - For a knockout match decided in regulation:
    //       user_goals_et === null && opp_goals_et === null && shootout === null
    //   - For a knockout match decided in ET:
    //       user_goals_et !== null && opp_goals_et !== null && shootout === null
    //   - For a knockout match decided on penalties:
    //       user_goals_et !== null && opp_goals_et !== null && shootout !== null
    //   - For a group-stage draw:
    //       outcome === 'D' && shootout === null
  });

  it.skip("undefeated_regulation is FALSE whenever any knockout match required a shootout", () => {
    // FIXTURE TODO (WS-B):
    //   - Force a knockout match to go to penalties via the seed.
    //   - Assert: even if the user wins the shootout
    //     (counts_as_run_win === true), RunResult.undefeated_regulation is false.
  });
});
