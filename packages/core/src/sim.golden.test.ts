import { describe, it } from "vitest";

// GOLDEN INVARIANT (WS-0b contract, WS-B implementation):
//   A fixed (draft, scenario, seed, all three version anchors) reproduces an
//   IDENTICAL RunResult — INCLUDING `seed`, `round_results`,
//   `aggregate.clean_sheets`, `narrative.narrative_seed`, `score`,
//   `score_breakdown`, and `player_stats`.
//
// DETERMINISM INVARIANTS being asserted here (declared on `DraftState` /
// `RunScenario` / `MatchResult`):
//   - `seed` is a STRING; PRNG is cyrb128 + sfc32; no Date / Math.random /
//     crypto / performance / transcendentals anywhere in the sim chain (lint
//     guard enforces in `packages/core/src` except `rng.ts`).
//   - Sub-seeds for `match_sim` / `event_gen` / `opponent_selection` /
//     `narrative` are derived from the run seed via `deriveSubseed` — never
//     freshly instantiated.
//   - Sampling pools (event taxonomies, shootout taker order, opponent
//     selection) are CANONICALLY SORTED via `canonicalSortBy` by stable id
//     before any draw.
//   - The score equality `score = sum(score_breakdown[i].points)` is enforced.
//   - `narrative.narrative_seed === deriveSubseed(seed, "narrative")`.
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
      //   - Assert: run.narrative.narrative_seed === deriveSubseed(run.seed, "narrative").
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
    //       AND `events` projection of type==='shootout_kick' === shootout.sequence
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
