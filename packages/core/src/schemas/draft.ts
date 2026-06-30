// Zod schema for persisted DraftState — boundary between disk / network and runtime.
//
// SuperRefine enforces the dedup / spin-order / slot-assignment / lock-on-pick
// / one-manager-only / formation-FK invariants declared on the type comments,
// so persisted drafts cannot drift.
//
// WS-0c depth-layer revision: 17-spin + formation_id FK + manager_card_id slot
// + lock-on-pick + at-most-one-manager + manager-vs-player picked_kind
// discriminator. The WS-0b 16-spin shape is GONE.

import { z } from "zod";

import type { DraftState, Spin, SquadSlot, SquadValidation } from "../types/draft.js";
import { buildCardId, parseCardId } from "../types/identity.js";
import { FORMATION_TEMPLATES } from "../types/formation.js";
import { buildManagerCardId, parseManagerCardId } from "../types/manager.js";
import { CardIdSchema } from "./identity.js";
import { ManagerCardIdSchema } from "./manager.js";
import { SlotPositionSchema } from "./formation.js";
import {
  IntegerRangeSchema,
  NonEmptyIdSchema,
  PercentSchema,
  PositiveIntegerSchema,
} from "./primitives.js";

const MAX_PLAYER_CHOICES_PER_SPIN = 3;

export const SpinSchema = z
  .object({
    index: IntegerRangeSchema(0, 16),
    // DC-3: tournament_id 0 / nation_id "" are the awaiting_slot placeholder
    // sentinels (no draw materialized yet); superRefine requires the real
    // positive-id / non-empty shape on every NON-awaiting spin.
    tournament_id: z.number().int().nonnegative(),
    nation_id: z.string(),
    // ENGINE-V2 E-1 rare exposure: pre-1998 flag + per-spin emitted probability
    // in [0, 1] (audit/display only — never re-fed into sampling). See Spin doc.
    rare: z.boolean(),
    draw_probability: PercentSchema,
    // rolled_card_ids MAY be empty on a manager-only spin (no remaining
    // players for this (tournament, nation)) — see the Spin comment.
    rolled_card_ids: z.array(CardIdSchema).max(MAX_PLAYER_CHOICES_PER_SPIN),
    excluded_player_ids: z.array(NonEmptyIdSchema),
    rolled_manager_card_id: ManagerCardIdSchema.nullable(),
    picked_kind: z.enum(["player", "manager"]),
    picked_card_id: CardIdSchema.nullable(),
    picked_player_id: NonEmptyIdSchema.nullable(),
    assigned_slot_id: NonEmptyIdSchema.nullable(),
    picked_manager_card_id: ManagerCardIdSchema.nullable(),
    // DC-3 position-first target commitment (see types/draft.ts).
    target_slot_id: NonEmptyIdSchema.nullable(),
    status: z.enum(["awaiting_slot", "pending", "picked"]),
  })
  .superRefine((spin, ctx) => {
    // DC-3 — awaiting_slot placeholder coherence: NOTHING is materialized.
    if (spin.status === "awaiting_slot") {
      const placeholderOk =
        spin.tournament_id === 0 &&
        spin.nation_id === "" &&
        spin.rare === false &&
        spin.draw_probability === 0 &&
        spin.rolled_card_ids.length === 0 &&
        spin.excluded_player_ids.length === 0 &&
        spin.rolled_manager_card_id === null &&
        spin.picked_card_id === null &&
        spin.picked_player_id === null &&
        spin.assigned_slot_id === null &&
        spin.picked_manager_card_id === null &&
        spin.target_slot_id === null;
      if (!placeholderOk) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "awaiting_slot spin must be an empty placeholder (no draw, no candidates, no target, no picks)",
          path: ["status"],
        });
      }
      return;
    }
    // Every NON-awaiting spin carries a real materialized draw.
    if (spin.tournament_id <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "materialized spin must have a positive tournament_id",
        path: ["tournament_id"],
      });
    }
    if (spin.nation_id.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "materialized spin must have a non-empty nation_id",
        path: ["nation_id"],
      });
    }

    // rolled_card_ids uniqueness + every rolled card's tournament_id matches.
    const rolledSeen = new Set<string>();
    for (let i = 0; i < spin.rolled_card_ids.length; i++) {
      const cid = spin.rolled_card_ids[i]! as string;
      if (rolledSeen.has(cid)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `rolled_card_ids contains duplicate ${cid}`,
          path: ["rolled_card_ids", i],
        });
      }
      rolledSeen.add(cid);
      const parsed = parseCardId(cid);
      if (parsed && parsed.tournament_id !== spin.tournament_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `rolled card ${cid} tournament_id does not match spin tournament_id ${spin.tournament_id}`,
          path: ["rolled_card_ids", i],
        });
      }
    }

    // rolled_manager_card_id, when present, must point at this spin's tournament.
    if (spin.rolled_manager_card_id !== null) {
      const parsedMgr = parseManagerCardId(spin.rolled_manager_card_id);
      if (parsedMgr && parsedMgr.tournament_id !== spin.tournament_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `rolled_manager_card_id tournament_id does not match spin tournament_id ${spin.tournament_id}`,
          path: ["rolled_manager_card_id"],
        });
      }
    }

    // Status / pick coherence — discriminated on `picked_kind`.
    if (spin.status === "pending") {
      // No picked fields set yet. picked_kind is meaningful only after pick.
      if (
        spin.picked_card_id !== null ||
        spin.picked_player_id !== null ||
        spin.picked_manager_card_id !== null ||
        spin.assigned_slot_id !== null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "pending spin must have null picked_card_id, picked_player_id, picked_manager_card_id, assigned_slot_id",
          path: ["status"],
        });
      }
      return;
    }
    // status === 'picked' below.
    if (spin.picked_kind === "player") {
      if (spin.picked_card_id === null || spin.picked_player_id === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "player-pick spin must have non-null picked_card_id and picked_player_id",
          path: ["picked_card_id"],
        });
        return;
      }
      // Lock-on-pick: a picked PLAYER must occupy a SquadSlot. Without this a
      // "picked" player could carry assigned_slot_id: null — counted in
      // deduped_player_ids yet leaving its slot vacant (a ghost pick). Managers
      // never take a field/bench slot, so this requirement is player-only.
      if (spin.assigned_slot_id === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "player-pick spin must have a non-null assigned_slot_id (lock-on-pick: a picked player occupies a SquadSlot)",
          path: ["assigned_slot_id"],
        });
      }
      if (spin.picked_manager_card_id !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "player-pick spin must have null picked_manager_card_id",
          path: ["picked_manager_card_id"],
        });
      }
      const pickedStr = spin.picked_card_id as unknown as string;
      if (!rolledSeen.has(pickedStr)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "picked_card_id must appear in rolled_card_ids",
          path: ["picked_card_id"],
        });
      }
      // Guard buildCardId so a dirty (e.g. empty) picked_player_id yields a
      // clean issue instead of an exception escaping safeParse.
      let expected: string;
      try {
        expected = buildCardId(spin.picked_player_id, spin.tournament_id);
      } catch (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `picked_card_id cannot be built from (picked_player_id, tournament_id): ${(err as Error).message}`,
          path: ["picked_card_id"],
        });
        return;
      }
      if (pickedStr !== expected) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `picked_card_id must equal buildCardId(picked_player_id, tournament_id) = "${expected}"`,
          path: ["picked_card_id"],
        });
      }
    } else {
      // picked_kind === 'manager'
      if (spin.picked_manager_card_id === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "manager-pick spin must have non-null picked_manager_card_id",
          path: ["picked_manager_card_id"],
        });
        return;
      }
      if (
        spin.picked_card_id !== null ||
        spin.picked_player_id !== null ||
        spin.assigned_slot_id !== null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "manager-pick spin must have null picked_card_id, picked_player_id, assigned_slot_id (managers never occupy a SquadSlot)",
          path: ["picked_card_id"],
        });
      }
      if (spin.rolled_manager_card_id === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "manager-pick spin must have a non-null rolled_manager_card_id",
          path: ["rolled_manager_card_id"],
        });
        return;
      }
      if ((spin.picked_manager_card_id as string) !== (spin.rolled_manager_card_id as string)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "picked_manager_card_id must equal rolled_manager_card_id (cannot pick a manager not on the wheel)",
          path: ["picked_manager_card_id"],
        });
      }
      // Card id consistency check for the manager card itself.
      let expectedMgr: string;
      try {
        const parsed = parseManagerCardId(spin.picked_manager_card_id);
        if (!parsed) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "picked_manager_card_id is not a well-formed ManagerCardId",
            path: ["picked_manager_card_id"],
          });
          return;
        }
        expectedMgr = buildManagerCardId(parsed.manager_id, spin.tournament_id);
      } catch (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `picked_manager_card_id cannot be rebuilt: ${(err as Error).message}`,
          path: ["picked_manager_card_id"],
        });
        return;
      }
      if ((spin.picked_manager_card_id as string) !== expectedMgr) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `picked_manager_card_id must equal buildManagerCardId(parsed.manager_id, tournament_id) = "${expectedMgr}"`,
          path: ["picked_manager_card_id"],
        });
      }
    }
  }) satisfies z.ZodType<Spin>;

export const SquadSlotSchema = z
  .object({
    slot_id: NonEmptyIdSchema,
    is_starter: z.boolean(),
    slot_position: SlotPositionSchema,
    card_id: CardIdSchema.nullable(),
    player_id: NonEmptyIdSchema.nullable(),
    tournament_id: PositiveIntegerSchema.nullable(),
    position_compatibility: PercentSchema,
    validation_warnings: z.array(z.string()),
  })
  .superRefine((slot, ctx) => {
    const triple = [slot.card_id, slot.player_id, slot.tournament_id] as const;
    const nullCount = triple.filter((v) => v === null).length;
    if (nullCount !== 0 && nullCount !== 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "SquadSlot card_id / player_id / tournament_id must be all-null (vacant) or all-non-null (assigned)",
        path: ["card_id"],
      });
      return;
    }
    if (slot.card_id === null) {
      // Vacant slot — honest-state: position_compatibility MUST be 0.
      if (slot.position_compatibility !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "vacant SquadSlot must have position_compatibility === 0 (honest-state: an empty slot contributes nothing)",
          path: ["position_compatibility"],
        });
      }
      return;
    }
    if (slot.player_id !== null && slot.tournament_id !== null) {
      // Guard buildCardId so a dirty (e.g. empty) player_id yields a clean
      // issue instead of an exception escaping safeParse.
      let expected: string | null = null;
      try {
        expected = buildCardId(slot.player_id, slot.tournament_id);
      } catch (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `slot card_id cannot be built from (player_id, tournament_id): ${(err as Error).message}`,
          path: ["card_id"],
        });
      }
      if (expected !== null && (slot.card_id as string) !== expected) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `slot card_id must equal buildCardId(player_id, tournament_id) = "${expected}"`,
          path: ["card_id"],
        });
      }
    }
  }) satisfies z.ZodType<SquadSlot>;

export const SquadValidationSchema = z.object({
  is_fieldable: z.boolean(),
  has_goalkeeper: z.boolean(),
  warnings: z.array(z.string()),
}) satisfies z.ZodType<SquadValidation>;

export const DraftStateSchema = z
  .object({
    run_id: NonEmptyIdSchema,
    draft_seed: NonEmptyIdSchema,
    mode: z.enum(["classic", "hidden"]),
    formation_id: NonEmptyIdSchema,
    team_name: z.string(),
    spins: z.array(SpinSchema).length(17),
    squad: z.array(SquadSlotSchema).length(16),
    manager_card_id: ManagerCardIdSchema.nullable(),
    status: z.enum(["drafting", "ready", "simulated"]),
    deduped_player_ids: z.array(NonEmptyIdSchema),
    dataset_version: NonEmptyIdSchema,
    rating_version: NonEmptyIdSchema,
    engine_version: NonEmptyIdSchema,
    // DC-1 config axes — stored explicitly (plan §A/§G). `rating_basis`
    // admits both enum values so the persisted contract never needs a second
    // evolution for the MV2-12b basis season; runtime construction of
    // `current` is refused in `createDraft` until that season lands.
    draft_flow: z.enum(["squad_first", "position_first"]),
    rating_basis: z.enum(["career", "current"]),
    era_preset: z.enum(["all_time", "post_2000", "post_2010", "modern"]),
  })
  .superRefine((draft, ctx) => {
    // formation_id MUST resolve to a known FormationTemplate.
    const template = FORMATION_TEMPLATES[draft.formation_id];
    if (!template) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `formation_id ${draft.formation_id} is not a known FormationTemplate id`,
        path: ["formation_id"],
      });
    }

    // 11 starters + 5 bench.
    const starters = draft.squad.filter((s) => s.is_starter);
    const bench = draft.squad.filter((s) => !s.is_starter);
    if (starters.length !== 11) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `squad must have exactly 11 starters, got ${starters.length}`,
        path: ["squad"],
      });
    }
    if (bench.length !== 5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `squad must have exactly 5 bench slots, got ${bench.length}`,
        path: ["squad"],
      });
    }

    // STARTER slot_ids + slot_positions must match the FormationTemplate 1:1.
    if (template) {
      const expectedById = new Map(template.slots.map((s) => [s.slot_id, s.slot_position]));
      const seen = new Set<string>();
      for (let i = 0; i < draft.squad.length; i++) {
        const slot = draft.squad[i]!;
        if (!slot.is_starter) continue;
        const expectedPos = expectedById.get(slot.slot_id);
        if (expectedPos === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `starter slot_id ${slot.slot_id} is not in FormationTemplate ${draft.formation_id}`,
            path: ["squad", i, "slot_id"],
          });
          continue;
        }
        if (slot.slot_position !== expectedPos) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `starter slot ${slot.slot_id} slot_position ${slot.slot_position} does not match FormationTemplate ${expectedPos}`,
            path: ["squad", i, "slot_position"],
          });
        }
        seen.add(slot.slot_id);
      }
      for (const fs of template.slots) {
        if (!seen.has(fs.slot_id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `starter slot ${fs.slot_id} from FormationTemplate ${draft.formation_id} is missing from squad`,
            path: ["squad"],
          });
        }
      }
    }

    // Spin indices ordered 0..16.
    for (let i = 0; i < draft.spins.length; i++) {
      if (draft.spins[i]!.index !== i) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `spins[${i}].index must equal ${i}`,
          path: ["spins", i, "index"],
        });
      }
    }

    // ENGINE-V2 E-1: (tournament_id, nation_id) MAY repeat across spins under
    // with-replacement weighted sampling. The WS-0c uniqueness refinement is
    // intentionally GONE — global player_id dedup is what stops the same human
    // being drafted twice (enforced below via the deduped_player_ids / per-spin
    // excluded_player_ids invariants).

    // ─── PLAYER-pick / MANAGER-pick accounting ─────────────────────────────
    //
    // - At most ONE manager pick across the 17 spins.
    // - rolled_manager_card_id MUST be null on every spin AFTER the manager
    //   pick spin (the coach is no longer a candidate).
    // - deduped_player_ids == ordered-unique picked_player_id from PLAYER-pick
    //   spins (manager picks do not contribute).
    let managerPickIndex: number | null = null;
    let managerPickCount = 0;
    for (let i = 0; i < draft.spins.length; i++) {
      const s = draft.spins[i]!;
      if (s.status === "picked" && s.picked_kind === "manager") {
        managerPickCount += 1;
        if (managerPickIndex === null) managerPickIndex = i;
      }
    }
    if (managerPickCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `at most ONE manager pick is allowed across all 17 spins; found ${managerPickCount}`,
        path: ["spins"],
      });
    }
    if (managerPickIndex !== null) {
      for (let i = managerPickIndex + 1; i < draft.spins.length; i++) {
        const s = draft.spins[i]!;
        if (s.rolled_manager_card_id !== null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `spins[${i}].rolled_manager_card_id must be null after the manager pick at spin ${managerPickIndex}`,
            path: ["spins", i, "rolled_manager_card_id"],
          });
        }
      }
    }

    // DraftState.manager_card_id coherence with the picked spin.
    if (managerPickIndex !== null) {
      const mgrSpin = draft.spins[managerPickIndex]!;
      if (draft.manager_card_id === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `DraftState.manager_card_id must be set when a manager-pick spin exists`,
          path: ["manager_card_id"],
        });
      } else if ((draft.manager_card_id as string) !== (mgrSpin.picked_manager_card_id as string)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `DraftState.manager_card_id must equal the manager-pick spin's picked_manager_card_id`,
          path: ["manager_card_id"],
        });
      }
    } else if (draft.manager_card_id !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `DraftState.manager_card_id must be null when no manager-pick spin exists`,
        path: ["manager_card_id"],
      });
    }

    // deduped_player_ids === ordered-unique picked_player_ids from PLAYER picks only.
    const pickedOrdered: string[] = [];
    const pickedSet = new Set<string>();
    for (let i = 0; i < draft.spins.length; i++) {
      const s = draft.spins[i]!;
      if (s.status !== "picked" || s.picked_kind !== "player") continue;
      if (s.picked_player_id === null) continue; // already flagged in SpinSchema
      if (pickedSet.has(s.picked_player_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `picked_player_id ${s.picked_player_id} appears in more than one spin`,
          path: ["spins", i, "picked_player_id"],
        });
      }
      pickedSet.add(s.picked_player_id);
      pickedOrdered.push(s.picked_player_id);
    }
    if (draft.deduped_player_ids.length !== pickedOrdered.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `deduped_player_ids length ${draft.deduped_player_ids.length} != ordered-unique player-picks length ${pickedOrdered.length}`,
        path: ["deduped_player_ids"],
      });
    } else {
      for (let i = 0; i < pickedOrdered.length; i++) {
        if (draft.deduped_player_ids[i] !== pickedOrdered[i]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `deduped_player_ids[${i}] must equal ordered-unique player-picks[${i}]`,
            path: ["deduped_player_ids", i],
          });
          break;
        }
      }
    }

    // For each MATERIALIZED spin: excluded_player_ids === ordered list of
    // PRIOR PLAYER picks. Manager picks do NOT contribute to the dedup set.
    // DC-3: awaiting_slot placeholders exclude nothing (no draw happened) —
    // their per-spin coherence is enforced in SpinSchema.
    const priorPlayerPicks: string[] = [];
    for (let i = 0; i < draft.spins.length; i++) {
      const s = draft.spins[i]!;
      if (s.status === "awaiting_slot") continue;
      if (s.excluded_player_ids.length !== priorPlayerPicks.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `spins[${i}].excluded_player_ids length must equal ${priorPlayerPicks.length} (players picked before this spin)`,
          path: ["spins", i, "excluded_player_ids"],
        });
      } else {
        for (let j = 0; j < priorPlayerPicks.length; j++) {
          if (s.excluded_player_ids[j] !== priorPlayerPicks[j]) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `spins[${i}].excluded_player_ids[${j}] must equal prior pick ${priorPlayerPicks[j]}`,
              path: ["spins", i, "excluded_player_ids", j],
            });
            break;
          }
        }
      }
      if (s.status === "picked" && s.picked_kind === "player" && s.picked_player_id !== null) {
        priorPlayerPicks.push(s.picked_player_id);
      }
    }

    // assigned_slot_id references (player picks only) — no duplicates;
    // assigned slot card_id matches pick.
    const slotById = new Map<string, SquadSlot>();
    for (const slot of draft.squad) slotById.set(slot.slot_id, slot);
    const assignedSeen = new Set<string>();
    for (let i = 0; i < draft.spins.length; i++) {
      const s = draft.spins[i]!;
      // Lock-on-pick (DraftState-level, defensive even if SpinSchema is later
      // refactored): a picked PLAYER spin MUST reference a SquadSlot. A picked
      // player carrying assigned_slot_id: null is a GHOST PICK — it is counted
      // in deduped_player_ids yet leaves its slot vacant. SpinSchema already
      // rejects this per-spin; re-asserting it here keeps the DraftState
      // contract self-contained (no ghost picks).
      if (s.status === "picked" && s.picked_kind === "player" && s.assigned_slot_id === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `picked player spin ${i} must reference a SquadSlot via assigned_slot_id (lock-on-pick: no ghost picks)`,
          path: ["spins", i, "assigned_slot_id"],
        });
        continue;
      }
      if (s.assigned_slot_id === null) continue;
      // Manager picks already required to leave assigned_slot_id null in SpinSchema;
      // any non-null here implies a player pick.
      if (assignedSeen.has(s.assigned_slot_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `assigned_slot_id ${s.assigned_slot_id} used by more than one spin`,
          path: ["spins", i, "assigned_slot_id"],
        });
        continue;
      }
      assignedSeen.add(s.assigned_slot_id);
      const slot = slotById.get(s.assigned_slot_id);
      if (!slot) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `assigned_slot_id ${s.assigned_slot_id} does not match any squad slot`,
          path: ["spins", i, "assigned_slot_id"],
        });
        continue;
      }
      if (
        slot.card_id !== s.picked_card_id ||
        slot.player_id !== s.picked_player_id ||
        slot.tournament_id !== s.tournament_id
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `assigned slot ${s.assigned_slot_id} card/player/tournament differs from spin pick`,
          path: ["spins", i, "assigned_slot_id"],
        });
      }
    }

    // Every occupied slot must be referenced by exactly one assigned spin.
    for (const slot of draft.squad) {
      if (slot.card_id !== null && !assignedSeen.has(slot.slot_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `squad slot ${slot.slot_id} is occupied but no spin assigns to it`,
          path: ["squad"],
        });
      }
    }

    // ready/simulated status gate: all 11 starter slots must be assigned.
    if (draft.status === "ready" || draft.status === "simulated") {
      const unassignedStarter = draft.squad.find((s) => s.is_starter && s.card_id === null);
      if (unassignedStarter) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `status ${draft.status} requires all starter slots assigned`,
          path: ["status"],
        });
      }
    }
    // A 'simulated' run REQUIRES a manager pick (a complete draft has exactly
    // one). 'ready' does not — the hard "bodies present" gate is XI only.
    if (draft.status === "simulated" && draft.manager_card_id === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `status 'simulated' requires a drafted manager (DraftState.manager_card_id must be non-null)`,
        path: ["manager_card_id"],
      });
    }

    // ─── DC-3 — draft-flow coherence ────────────────────────────────────────
    if (draft.draft_flow === "squad_first") {
      // Squad-first never uses the position-first lifecycle or targets.
      for (let i = 0; i < draft.spins.length; i++) {
        const s = draft.spins[i]!;
        if (s.status === "awaiting_slot") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `squad_first draft must not contain awaiting_slot spins (spins[${i}])`,
            path: ["spins", i, "status"],
          });
        }
        if (s.target_slot_id !== null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `squad_first spins carry no target_slot_id (spins[${i}])`,
            path: ["spins", i, "target_slot_id"],
          });
        }
      }
    } else {
      // position_first: every materialized spin carries its committed target;
      // at most ONE pending spin exists and it is the LOWEST unresolved index
      // (later unresolved spins stay unmaterialized placeholders).
      let pendingCount = 0;
      let firstUnresolved: number | null = null;
      for (let i = 0; i < draft.spins.length; i++) {
        const s = draft.spins[i]!;
        if (firstUnresolved === null && s.status !== "picked") firstUnresolved = i;
        if (s.status === "pending") {
          pendingCount += 1;
          if (firstUnresolved !== i) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `position_first pending spin must be the lowest unresolved index (spins[${i}] vs first unresolved ${firstUnresolved})`,
              path: ["spins", i, "status"],
            });
          }
        }
        if (s.status === "picked" || s.status === "pending") {
          if (s.target_slot_id === null) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `position_first materialized spin must carry its committed target_slot_id (spins[${i}])`,
              path: ["spins", i, "target_slot_id"],
            });
            continue;
          }
          if (s.status === "picked" && s.picked_kind === "player") {
            if (s.assigned_slot_id !== s.target_slot_id) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `position_first player pick must fill its committed target (spins[${i}]: target ${s.target_slot_id}, assigned ${s.assigned_slot_id})`,
                path: ["spins", i, "assigned_slot_id"],
              });
            }
          }
          if (s.status === "picked" && s.picked_kind === "manager") {
            if (s.target_slot_id !== "manager") {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `position_first manager pick must target "manager" (spins[${i}])`,
                path: ["spins", i, "target_slot_id"],
              });
            }
          }
          if (s.status === "pending") {
            // Candidate exposure matches the committed target: a manager
            // target offers ONLY the coach; a slot target offers ONLY players.
            if (s.target_slot_id === "manager") {
              if (s.rolled_card_ids.length !== 0 || s.rolled_manager_card_id === null) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: `position_first manager-target spin exposes only the coach (spins[${i}])`,
                  path: ["spins", i, "rolled_manager_card_id"],
                });
              }
            } else if (s.rolled_manager_card_id !== null) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `position_first slot-target spin must not expose a coach (spins[${i}])`,
                path: ["spins", i, "rolled_manager_card_id"],
              });
            }
          }
        }
      }
      if (pendingCount > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `position_first draft can have at most ONE pending spin; found ${pendingCount}`,
          path: ["spins"],
        });
      }
    }
  }) satisfies z.ZodType<DraftState>;
