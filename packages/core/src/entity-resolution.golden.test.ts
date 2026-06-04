import { describe, it } from "vitest";

// GOLDEN INVARIANT (WS-0b contract, WS-A implementation):
//   ENTITY RESOLUTION yields ONE stable Player.player_id for a human who
//   represented two different nations across tournaments. The classic
//   nation-switcher is Ferenc Puskás (HUN 1954, ESP 1962) — two
//   PlayerTournament cards with DIFFERENT nation_ids must collapse to a SINGLE
//   player_id once the WS-A ER pipeline runs.
//
// WHY THIS IS A CONTRACT-LEVEL GUARDRAIL: dedup across the 16-spin draft
// (`Spin.excluded_player_ids`, `DraftState.deduped_player_ids`) is keyed on
// `player_id`. If ER splits a single human into two player_ids by mistake,
// the same human could be drafted twice. If ER merges two humans into one
// player_id by mistake, one would be invisibly excluded.
//
// FIXTURING DEFERRED: the candidate switcher (Puskás and other historical
// dual-nationals) must be VERIFIED against the Fjelstul dataset before the
// fixture is committed — I am NOT going to fabricate a dual-nation player
// from memory for a golden contract.

describe.skip("entity resolution — nation-switcher dedup", () => {
  it.skip("a verified nation-switcher resolves to ONE player_id across two nation_ids", () => {
    // FIXTURE TODO (WS-A):
    //   - Pick a player VERIFIED in the Fjelstul dataset to have represented
    //     two different national federations (e.g. Puskás HUN'54 / ESP'62).
    //   - Construct two PlayerTournament cards with the same person but
    //     different nation_ids + tournament_ids.
    //   - Run the WS-A entity-resolution pipeline.
    //   - Assert: both PlayerTournament rows share ONE player_id.
    //   - Assert: that player_id appears exactly once in
    //     DraftState.deduped_player_ids after both cards are added.
  });
});
