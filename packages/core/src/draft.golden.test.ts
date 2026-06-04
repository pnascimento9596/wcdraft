import { describe, it } from "vitest";

// GOLDEN INVARIANT (WS-0b contract, WS-C implementation):
//   A fixed `draft_seed` reproduces an IDENTICAL 16-spin sequence — same
//   (tournament_id, nation_id) pairs in the same order, same rolled card sets,
//   same post-dedup pools.
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
//   - The 16 (tournament_id, nation_id) pairs are UNIQUE across spins.
//   - Player-id dedup never yields a duplicate player_id across the 16 picks.
//
// IMPLEMENTATION DEFERRED: the draft engine itself lands in WS-C. This file
// declares the invariant + scaffolds the test so the harness exists when the
// engine arrives — but does not run yet.

describe.skip("draft — fixed seed reproduces identical 16-spin sequence", () => {
  it.skip(
    "the same (dataset_version, rating_version, engine_version, draft_seed) " +
      "produces a byte-identical Spin[] of length 16",
    () => {
      // FIXTURE TODO (WS-C):
      //   - Build a fixed minimal dataset (Players + PlayerTournaments + Ratings
      //     covering enough tournament_id × nation_id pairs to fill 16 unique
      //     spins).
      //   - Run the WS-C draft engine twice with the same input + draft_seed.
      //   - Assert: the two Spin[] arrays are deep-equal.
      //   - Assert: each (tournament_id, nation_id) appears exactly once across
      //     the 16 spins.
      //   - Assert: no duplicate player_id appears across picked_player_id.
    },
  );

  it.skip("the post-dedup roster for each spin excludes any player_id picked in earlier spins", () => {
    // FIXTURE TODO (WS-C):
    //   - Construct a draft where the same player is in two different
    //     (tournament_id, nation_id) buckets (a nation-switcher).
    //   - Pick them in spin N.
    //   - Assert: spin > N excludes that player_id from rolled_card_ids.
  });
});
