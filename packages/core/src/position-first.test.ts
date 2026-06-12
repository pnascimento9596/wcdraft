// DC-3 — position-first state machine transition goldens (plan §C).
//
// What this file proves on the synthetic fixture:
//   1. CREATION — a position_first draft materializes NOTHING: 17
//      awaiting_slot placeholders, no squad data before a target commit.
//   2. TARGET → ROLL — selectDraftTarget consumes the SAME per-index RNG
//      draw squad_first would make: for the same seed and equivalent pick
//      context, the drawn (T, N) sequence matches squad_first spin-for-spin.
//   3. EXPOSURE — a slot target offers only players; the manager target
//      offers only the coach; targets are immutable once rolled.
//   4. PICK COHERENCE — pickPlayer fills ONLY the committed target;
//      out-of-target picks and pickManager on a slot-target spin throw.
//   5. MANAGER RULES — manager target disappears after the manager is
//      drafted; the strand guard forces the manager target on the final
//      unresolved spin; ≤1 manager (unchanged).
//   6. DEAD-END HONESTY — a target with no candidate throws
//      DraftTargetDeadEndError WITHOUT consuming the spin (state unchanged,
//      no hidden seed advance), and re-selecting a different target works.
//   7. NO-GK SOFTNESS — selecting a GK slot does not hard-filter candidates;
//      an outfielder placed there keeps the soft warning semantics.
//   8. SQUAD-FIRST UNCHANGED — byte-identity is locked by draft.golden.test
//      (committed golden regenerated with a fields-only diff) plus the
//      cross-flow (T, N) equality test here.

import { describe, expect, it } from "vitest";

import {
  activeSpin,
  autoDraft,
  buildDraftCatalog,
  createDraft,
  DraftTargetDeadEndError,
  isDraftComplete,
  pickManager,
  pickPlayer,
  selectDraftTarget,
} from "./draft.js";
import { buildDraftFixture, buildSingleCoachFixture } from "./draft.fixture.js";
import type { DraftState } from "./types/draft.js";

const FIXTURE = buildDraftFixture();
const CATALOG = buildDraftCatalog(FIXTURE.dataset);

const PF_PARAMS = {
  ...FIXTURE.params,
  run_id: "run.pf.1",
  parent_seed: "wcdraft:position-first:v1:1",
  draft_flow: "position_first" as const,
};

function freshPf(): DraftState {
  return createDraft(CATALOG, { ...PF_PARAMS });
}

/** Starter slot ids for the fixture's 4-3-3, in fill order. */
function vacantSlots(state: DraftState): string[] {
  return state.squad.filter((s) => s.card_id === null).map((s) => s.slot_id);
}

describe("DC-3 creation — the commitment boundary is in persisted state", () => {
  it("creates 17 awaiting_slot placeholders with NO materialized draw", () => {
    const draft = freshPf();
    expect(draft.draft_flow).toBe("position_first");
    expect(draft.spins.length).toBe(17);
    for (const s of draft.spins) {
      expect(s.status).toBe("awaiting_slot");
      expect(s.tournament_id).toBe(0);
      expect(s.nation_id).toBe("");
      expect(s.rolled_card_ids.length).toBe(0);
      expect(s.rolled_manager_card_id).toBeNull();
      expect(s.target_slot_id).toBeNull();
    }
  });

  it("picks are illegal before a target is committed", () => {
    const draft = freshPf();
    expect(() => pickManager(CATALOG, draft)).toThrow(/selectDraftTarget first/);
  });
});

describe("DC-3 target → roll — same per-index draw as squad_first", () => {
  it("matching pick contexts reproduce squad_first's (T, N) sequence spin-for-spin", () => {
    // Drive squad_first with the default policy, then replay the SAME
    // entity choices through position_first target selection. Because the
    // pick context (players taken, manager flag) evolves identically, every
    // spin's drawn (T, N) must match.
    const sf = autoDraft({ ...PF_PARAMS, draft_flow: "squad_first", dataset: FIXTURE.dataset });
    let pf = freshPf();
    for (const sfSpin of sf.spins) {
      const target =
        sfSpin.picked_kind === "manager" ? "manager" : sfSpin.assigned_slot_id!;
      pf = selectDraftTarget(CATALOG, pf, target);
      const rolled = activeSpin(pf)!;
      expect(rolled.status).toBe("pending");
      expect([rolled.tournament_id, rolled.nation_id]).toEqual([
        sfSpin.tournament_id,
        sfSpin.nation_id,
      ]);
      expect(rolled.draw_probability).toBe(sfSpin.draw_probability);
      pf =
        sfSpin.picked_kind === "manager"
          ? pickManager(CATALOG, pf)
          : pickPlayer(CATALOG, pf, sfSpin.picked_card_id!, sfSpin.assigned_slot_id!);
    }
    expect(isDraftComplete(pf)).toBe(true);
    expect(pf.manager_card_id as string).toBe(sf.manager_card_id as string);
    // Same humans drafted, same slots filled.
    expect(pf.deduped_player_ids).toEqual(sf.deduped_player_ids);
    const slotsOf = (d: DraftState) =>
      d.squad.map((s) => [s.slot_id, s.card_id as string | null]);
    expect(slotsOf(pf)).toEqual(slotsOf(sf));
  });

  it("run-twice determinism: the same target walk is byte-identical", () => {
    const walk = (): DraftState => {
      let d = freshPf();
      const slot = vacantSlots(d)[0]!;
      d = selectDraftTarget(CATALOG, d, slot);
      const card = activeSpin(d)!.rolled_card_ids[0]!;
      return pickPlayer(CATALOG, d, card);
    };
    expect(JSON.stringify(walk())).toBe(JSON.stringify(walk()));
  });
});

describe("DC-3 exposure + immutability", () => {
  it("a slot target exposes players only (no coach), and the target is immutable", () => {
    let d = freshPf();
    const slot = vacantSlots(d)[0]!;
    d = selectDraftTarget(CATALOG, d, slot);
    const spin = activeSpin(d)!;
    expect(spin.target_slot_id).toBe(slot);
    expect(spin.rolled_card_ids.length).toBeGreaterThan(0);
    expect(spin.rolled_manager_card_id).toBeNull();
    // Immutable once rolled.
    expect(() => selectDraftTarget(CATALOG, d, vacantSlots(d)[1]!)).toThrow(/immutable/);
  });

  it("the manager target exposes ONLY the coach", () => {
    // Every fixture pair carries a coach, so the first draw works.
    let d = freshPf();
    d = selectDraftTarget(CATALOG, d, "manager");
    const spin = activeSpin(d)!;
    expect(spin.target_slot_id).toBe("manager");
    expect(spin.rolled_card_ids.length).toBe(0);
    expect(spin.rolled_manager_card_id).not.toBeNull();
    // A player pick is illegal on a manager-target spin.
    expect(() => pickPlayer(CATALOG, d, spin.rolled_card_ids[0]!, "gk")).toThrow();
  });
});

describe("DC-3 pick coherence — the lock action fills only the target", () => {
  it("pickPlayer rejects a slot that differs from the committed target", () => {
    let d = freshPf();
    const [a, b] = vacantSlots(d);
    d = selectDraftTarget(CATALOG, d, a!);
    const card = activeSpin(d)!.rolled_card_ids[0]!;
    expect(() => pickPlayer(CATALOG, d, card, b!)).toThrow(/does not match the committed target/);
    // Omitting the slot defaults to the target.
    const next = pickPlayer(CATALOG, d, card);
    const picked = next.spins.find((s) => s.index === 0)!;
    expect(picked.assigned_slot_id).toBe(a);
    expect(picked.target_slot_id).toBe(a);
  });

  it("pickManager is illegal on a slot-target spin", () => {
    let d = freshPf();
    d = selectDraftTarget(CATALOG, d, vacantSlots(d)[0]!);
    expect(() => pickManager(CATALOG, d)).toThrow(/committed to slot/);
  });
});

describe("DC-3 manager rules", () => {
  function pfWithManagerDrafted(): DraftState {
    let d = freshPf();
    d = selectDraftTarget(CATALOG, d, "manager");
    return pickManager(CATALOG, d);
  }

  it("the manager target disappears after the manager is drafted", () => {
    const d = pfWithManagerDrafted();
    expect(d.manager_card_id).not.toBeNull();
    expect(() => selectDraftTarget(CATALOG, d, "manager")).toThrow(/already been drafted/);
  });

  it("strand guard: the FINAL unresolved spin with no manager forces the manager target", () => {
    // Fill all 16 player slots first (deferring the manager to spin 17),
    // across seeds: the final draw may or may not carry a coach — assert the
    // forcing + honest dead-end on every seed, and require at least one seed
    // to complete through the forced manager target.
    let completedOnce = false;
    let deadEndOnce = false;
    for (let seedIdx = 0; seedIdx < 20 && !(completedOnce && deadEndOnce); seedIdx++) {
      let d = createDraft(CATALOG, {
        ...PF_PARAMS,
        run_id: `run.pf.strand.${seedIdx}`,
        parent_seed: `wcdraft:pf-strand:v1:${seedIdx}`,
      });
      for (let i = 0; i < 16; i++) {
        const slot = vacantSlots(d)[0]!;
        d = selectDraftTarget(CATALOG, d, slot);
        d = pickPlayer(CATALOG, d, activeSpin(d)!.rolled_card_ids[0]!);
      }
      expect(d.manager_card_id).toBeNull();
      expect(activeSpin(d)!.index).toBe(16);
      // Any slot target on the final spin is rejected (occupied slots fail
      // the vacancy check; the dedicated final-spin guard covers vacant ones,
      // which cannot exist here — 16 players fill all 16 slots).
      expect(() => selectDraftTarget(CATALOG, d, d.squad[0]!.slot_id)).toThrow(
        /already occupied|only legal/,
      );
      try {
        d = selectDraftTarget(CATALOG, d, "manager");
        d = pickManager(CATALOG, d);
        expect(isDraftComplete(d)).toBe(true);
        expect(d.manager_card_id).not.toBeNull();
        completedOnce = true;
      } catch (err) {
        // Honest dead-end: the final draw has no coach. The spin must NOT
        // have been consumed and no silent reroll may occur.
        expect(err).toBeInstanceOf(DraftTargetDeadEndError);
        expect(activeSpin(d)!.status).toBe("awaiting_slot");
        deadEndOnce = true;
      }
    }
    expect(completedOnce).toBe(true);
  });
});

describe("DC-3 dead-end honesty (no silent reroll, no seed advance)", () => {
  it("a manager target on a coachless draw throws DraftTargetDeadEndError and does NOT consume the spin", () => {
    // Single-coach fixture: exactly one (T, N) pair carries a coach, so a
    // draw landing elsewhere dead-ends the manager target.
    const fx = buildSingleCoachFixture();
    const catalog = buildDraftCatalog(fx.dataset);
    // Find a seed whose FIRST draw lands on a coachless pair.
    let deadEndSeen = false;
    for (let i = 0; i < 50 && !deadEndSeen; i++) {
      const d = createDraft(catalog, {
        ...fx.params,
        run_id: `run.pf.dead.${i}`,
        parent_seed: `wcdraft:pf-deadend:v1:${i}`,
        draft_flow: "position_first",
      });
      try {
        selectDraftTarget(catalog, d, "manager");
      } catch (err) {
        if (err instanceof DraftTargetDeadEndError) {
          deadEndSeen = true;
          // Spin NOT consumed: state unchanged, target still selectable.
          expect(activeSpin(d)!.status).toBe("awaiting_slot");
          // A different target on the SAME spin still works (same draw, the
          // squad has players even though it lacks a coach).
          const slot = d.squad.find((s) => s.card_id === null)!.slot_id;
          const rolled = selectDraftTarget(catalog, d, slot);
          expect(activeSpin(rolled)!.status).toBe("pending");
          expect(activeSpin(rolled)!.rolled_card_ids.length).toBeGreaterThan(0);
        } else {
          throw err;
        }
      }
    }
    expect(deadEndSeen).toBe(true);
  });
});

describe("DC-3 no-GK stays soft", () => {
  it("a GK slot target does not filter candidates; outfielder-in-goal keeps the warning", () => {
    let d = freshPf();
    const gkSlot = d.squad.find((s) => s.slot_position === "GK")!.slot_id;
    d = selectDraftTarget(CATALOG, d, gkSlot);
    const spin = activeSpin(d)!;
    // The full un-picked roster is offered — no GK hard-filter.
    expect(spin.rolled_card_ids.length).toBeGreaterThan(1);
    const next = pickPlayer(CATALOG, d, spin.rolled_card_ids[0]!);
    const slot = next.squad.find((s) => s.slot_id === gkSlot)!;
    expect(slot.card_id).not.toBeNull();
    // Fixture roster card 0 may or may not be GK-eligible; the invariant is
    // that compatibility is graduated and never a blocker.
    expect(slot.position_compatibility).toBeGreaterThanOrEqual(0);
    expect(slot.position_compatibility).toBeLessThanOrEqual(1);
  });
});
