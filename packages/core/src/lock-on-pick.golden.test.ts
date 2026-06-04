import { describe, it } from "vitest";

// GOLDEN INVARIANT (WS-0c depth-layer contract, WS-C implementation):
//   LOCK-ON-PICK — each pick + assignment is committed and IMMUTABLE the
//   moment it is confirmed, before the next spin. There is no end-of-draft
//   rearranging. The forward-committed placement raises difficulty +
//   leaderboard competitiveness on purpose.
//
// WHAT THIS INVARIANT MEANS FOR THE PERSISTED CONTRACT:
//   - Spin.status is append-only ('pending' → 'picked'); the union has no
//     'unpicked' state.
//   - A spin with status === 'picked' may NEVER have its
//     picked_kind / picked_card_id / picked_player_id / assigned_slot_id /
//     picked_manager_card_id mutated.
//
// HOW THE TEST WILL EXERCISE IT (when the WS-C engine ships):
//   - Run the engine forward by N spins, snapshot the partial DraftState.
//   - Resume the engine from that snapshot and continue to completion.
//   - Assert: the first N spins of the resumed-then-completed DraftState are
//     byte-equal to the snapshot's first N spins (no mutation of locked picks).
//   - Attempt to mutate a 'picked' spin's pick fields and re-parse via
//     DraftStateSchema: assert the parse fails (the schema accepts only the
//     original locked pick — see the WS-0c picked_kind discriminator refinement).
//
// IMPLEMENTATION DEFERRED: the runtime guard (engine-side) and the snapshot
// fixture live with WS-C. The schema-side rejection is partial today (the
// WS-0c SpinSchema rejects internally-inconsistent picks), but the
// snapshot-equality half of the invariant requires the engine.

describe.skip("lock-on-pick — confirmed picks are IMMUTABLE", () => {
  it.skip("resuming a partial draft preserves earlier spins byte-for-byte", () => {
    // FIXTURE TODO (WS-C):
    //   - Spin N times forward; snapshot DraftState.
    //   - Resume from snapshot, run to completion.
    //   - Assert: deep-equal(snapshot.spins, completed.spins.slice(0, N))
    //   - Assert: deep-equal(snapshot.squad assignments referenced by those
    //     first-N picks, completed.squad's same assignments)
  });

  it.skip("attempting to flip a picked spin's picked_kind / picked_card_id / assigned_slot_id is rejected", () => {
    // FIXTURE TODO (WS-C):
    //   - Take a completed DraftState.
    //   - Mutate one picked spin's `assigned_slot_id` to a different slot.
    //   - Assert: DraftStateSchema.safeParse(...).success === false.
    //   - Repeat for: `picked_card_id` (different rolled card),
    //     `picked_player_id` (different player), `picked_kind` (player↔manager).
  });
});
