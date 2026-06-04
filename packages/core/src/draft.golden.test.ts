import { describe, it } from "vitest";

// GOLDEN INVARIANT (WS-0c depth-layer revision, WS-C implementation):
//   A fixed `draft_seed` reproduces an IDENTICAL 17-spin sequence — same
//   (tournament_id, nation_id) pairs in the same order, same rolled card sets,
//   same post-dedup pools, same per-spin `rolled_manager_card_id`. The 17th
//   pick can be a manager on ANY spin, but the candidate space (player cards
//   AND the team's coach) is reproducible byte-for-byte.
//
// DETERMINISM INVARIANTS being asserted here (declared on `DraftState` /
// `Spin` types):
//   - PRNG is the existing cyrb128 + sfc32 — no Date / Math.random / crypto /
//     performance / transcendentals anywhere in the draft chain (lint guard
//     enforces in `packages/core/src` except `rng.ts`).
//   - The draft substream seed is `deriveSubseed(parent_seed, "draft")`.
//   - The (tournament_id, nation_id) sampling pool is canonically sorted via
//     `canonicalSortBy` by (tournament_id, nation_id) BEFORE the draw.
//   - Each rolled roster's candidate pool is canonically sorted by `card_id`
//     BEFORE the draw.
//   - The 17 (tournament_id, nation_id) pairs are UNIQUE across spins.
//   - Player-id dedup never yields a duplicate player_id across the 16 player
//     picks. Manager picks do NOT contribute to player dedup.
//
// WS-0c-SPECIFIC INVARIANTS asserted alongside determinism:
//   - Every spin offers BOTH that squad's player cards AND the team's coach
//     for that year as candidates (when both exist in the dataset).
//   - At most ONE manager is selectable across the run (and exactly one in a
//     complete squad): once `DraftState.manager_card_id` is set, no later
//     spin's `rolled_manager_card_id` is non-null.
//   - The manager NEVER occupies a field/bench SquadSlot — it lives in
//     `DraftState.manager_card_id`.
//
// IMPLEMENTATION DEFERRED: the draft engine itself lands in WS-C. This file
// declares the invariant + scaffolds the test so the harness exists when the
// engine arrives — but does not run yet.

describe.skip("draft — fixed seed reproduces identical 17-spin sequence", () => {
  it.skip(
    "the same (dataset_version, rating_version, engine_version, draft_seed) " +
      "produces a byte-identical Spin[] of length 17",
    () => {
      // FIXTURE TODO (WS-C):
      //   - Build a fixed minimal dataset (Players + PlayerTournaments +
      //     Ratings + Managers + ManagerTournaments covering enough
      //     tournament_id × nation_id pairs to fill 17 unique spins, with at
      //     least one (tournament, nation) carrying a coach).
      //   - Run the WS-C draft engine twice with the same input + draft_seed.
      //   - Assert: the two Spin[] arrays are deep-equal.
      //   - Assert: each (tournament_id, nation_id) appears exactly once
      //     across the 17 spins.
      //   - Assert: no duplicate player_id appears across picked_player_id
      //     among player-pick spins.
      //   - Assert: each spin's `rolled_manager_card_id` mirrors the dataset's
      //     coach for that (tournament, nation), or null when absent.
    },
  );

  it.skip("the post-dedup roster for each spin excludes any player_id picked in earlier spins", () => {
    // FIXTURE TODO (WS-C):
    //   - Construct a draft where the same player is in two different
    //     (tournament_id, nation_id) buckets (a nation-switcher).
    //   - Pick them in spin N.
    //   - Assert: spin > N excludes that player_id from rolled_card_ids.
    //   - Assert: manager-pick spins do NOT change excluded_player_ids
    //     (they do not contribute to player dedup).
  });

  it.skip("at most ONE manager is selectable across the 17 spins (and exactly one in a complete squad)", () => {
    // FIXTURE TODO (WS-C):
    //   - Run a full 17-spin draft to completion with the WS-C engine.
    //   - Assert: exactly one spin has `picked_kind === 'manager'`.
    //   - Assert: that spin's `picked_manager_card_id` matches
    //     `DraftState.manager_card_id`.
    //   - Assert: every spin after that one carries
    //     `rolled_manager_card_id === null` (the coach is no longer a candidate).
    //   - Assert: NO SquadSlot in `DraftState.squad` references the manager
    //     (the manager never occupies a field/bench slot).
  });
});
