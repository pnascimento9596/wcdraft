import { describe, it, expect } from "vitest";

import {
  buildDraftCatalog,
  createDraft,
  stepDraft,
  isDraftComplete,
  DraftStateSchema,
} from "./index.js";
import type { DraftState, Spin } from "./index.js";
import { buildDraftFixture } from "./draft.fixture.js";

// GOLDEN INVARIANT (WS-0c depth-layer contract, WS-C implementation):
//   LOCK-ON-PICK — each pick + assignment is committed and IMMUTABLE the
//   moment it is confirmed, before the next spin. There is no end-of-draft
//   rearranging.
//
// WHAT THIS INVARIANT MEANS FOR THE PERSISTED CONTRACT:
//   - Spin.status is append-only ('pending' → 'picked'); the union has no
//     'unpicked' state.
//   - A spin with status === 'picked' may NEVER have its
//     picked_kind / picked_card_id / picked_player_id / assigned_slot_id /
//     picked_manager_card_id mutated.
//
// The WS-C engine enforces this two ways: resolved spins (and their occupied
// SquadSlots) are deep-FROZEN and carried by reference into every later state,
// and the DraftStateSchema rejects any draft whose locked picks were tampered.

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stepN(
  catalog: ReturnType<typeof buildDraftCatalog>,
  state: DraftState,
  n: number,
): DraftState {
  let s = state;
  for (let i = 0; i < n; i++) s = stepDraft(catalog, s);
  return s;
}

describe("lock-on-pick — confirmed picks are IMMUTABLE", () => {
  const N = 6;

  it("resuming a partial draft preserves earlier spins byte-for-byte", () => {
    const { dataset, params } = buildDraftFixture();
    const catalog = buildDraftCatalog(dataset);

    const start = createDraft(catalog, params);
    const partial = stepN(catalog, start, N);
    const snapshotFirstN = clone(partial.spins.slice(0, N));
    const snapshotSquad = clone(partial.squad);

    // Continue the SAME partial state to completion.
    let completed = partial;
    while (!isDraftComplete(completed)) completed = stepDraft(catalog, completed);
    expect(clone(completed.spins.slice(0, N))).toEqual(snapshotFirstN);

    // The occupied slots referenced by the first-N picks are unchanged too.
    const firstNSlotIds = new Set(
      partial.spins
        .slice(0, N)
        .map((s) => s.assigned_slot_id)
        .filter((x): x is string => x !== null),
    );
    const completedById = new Map(completed.squad.map((s) => [s.slot_id, s]));
    for (const slot of snapshotSquad) {
      if (firstNSlotIds.has(slot.slot_id)) {
        expect(clone(completedById.get(slot.slot_id)!)).toEqual(slot);
      }
    }

    // A FRESH run from the same seed reproduces the same first-N spins —
    // resume-from-rebuild equivalence.
    const freshFull = stepN(catalog, createDraft(catalog, params), 17);
    expect(clone(freshFull.spins.slice(0, N))).toEqual(snapshotFirstN);
  });

  it("a resolved spin object and its occupied slot are frozen at runtime", () => {
    const { dataset, params } = buildDraftFixture();
    const catalog = buildDraftCatalog(dataset);
    const partial = stepN(catalog, createDraft(catalog, params), N);

    const picked = partial.spins.find((s) => s.status === "picked" && s.picked_kind === "player")!;
    expect(Object.isFrozen(picked)).toBe(true);
    // Strict-mode write to a frozen object throws.
    expect(() => {
      (picked as unknown as { assigned_slot_id: string }).assigned_slot_id = "tampered";
    }).toThrow();

    const occupied = partial.squad.find((s) => s.card_id !== null)!;
    expect(Object.isFrozen(occupied)).toBe(true);
    expect(() => {
      (occupied as unknown as { player_id: string }).player_id = "tampered";
    }).toThrow();
  });

  it("tampering with a picked spin's pick fields is rejected by DraftStateSchema", () => {
    const { dataset, params } = buildDraftFixture();
    const catalog = buildDraftCatalog(dataset);
    let completed = createDraft(catalog, params);
    while (!isDraftComplete(completed)) completed = stepDraft(catalog, completed);
    expect(DraftStateSchema.safeParse(completed).success).toBe(true);

    const playerSpinIndex = completed.spins.find(
      (s) => s.picked_kind === "player" && s.status === "picked",
    )!.index;

    // (a) flip assigned_slot_id to a different (occupied) slot.
    const mutA = clone(completed);
    const otherSlot = completed.squad.find(
      (s) => s.card_id !== null && s.slot_id !== completed.spins[playerSpinIndex]!.assigned_slot_id,
    )!;
    (mutA.spins[playerSpinIndex] as Spin).assigned_slot_id = otherSlot.slot_id;
    expect(DraftStateSchema.safeParse(mutA).success).toBe(false);

    // (b) flip picked_card_id to a different rolled candidate.
    const mutB = clone(completed);
    const spinB = mutB.spins[playerSpinIndex] as Spin;
    const otherCard = spinB.rolled_card_ids.find((c) => c !== spinB.picked_card_id)!;
    spinB.picked_card_id = otherCard;
    expect(DraftStateSchema.safeParse(mutB).success).toBe(false);

    // (c) flip picked_player_id only (card id no longer matches).
    const mutC = clone(completed);
    (mutC.spins[playerSpinIndex] as Spin).picked_player_id = "totally-different-player";
    expect(DraftStateSchema.safeParse(mutC).success).toBe(false);

    // (d) flip picked_kind player → manager.
    const mutD = clone(completed);
    (mutD.spins[playerSpinIndex] as Spin).picked_kind = "manager";
    expect(DraftStateSchema.safeParse(mutD).success).toBe(false);
  });
});
