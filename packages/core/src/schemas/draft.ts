// Zod schema for persisted DraftState — boundary between disk / network and runtime.
//
// SuperRefine enforces the dedup / spin-order / slot-assignment invariants
// declared on the type comments, so persisted drafts cannot drift.

import { z } from "zod";

import type { DraftState, Spin, SquadSlot, SquadValidation } from "../types/draft.js";
import { buildCardId, parseCardId } from "../types/identity.js";
import { CardIdSchema } from "./identity.js";
import {
  FormationSchema,
  IntegerRangeSchema,
  NonEmptyIdSchema,
  PositionSchema,
  PositiveIntegerSchema,
} from "./primitives.js";

export const SpinSchema = z
  .object({
    index: IntegerRangeSchema(0, 15),
    tournament_id: PositiveIntegerSchema,
    nation_id: NonEmptyIdSchema,
    rolled_card_ids: z.array(CardIdSchema).min(1),
    excluded_player_ids: z.array(NonEmptyIdSchema),
    picked_card_id: CardIdSchema.nullable(),
    picked_player_id: NonEmptyIdSchema.nullable(),
    assigned_slot_id: NonEmptyIdSchema.nullable(),
    status: z.enum(["pending", "picked"]),
  })
  .superRefine((spin, ctx) => {
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

    // Status / pick coherence.
    if (spin.status === "pending") {
      if (spin.picked_card_id !== null || spin.picked_player_id !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "pending spin must have null picked_card_id and picked_player_id",
          path: ["status"],
        });
      }
    } else {
      if (spin.picked_card_id === null || spin.picked_player_id === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "picked spin must have non-null picked_card_id and picked_player_id",
          path: ["status"],
        });
        return;
      }
      const pickedStr = spin.picked_card_id as unknown as string;
      if (!rolledSeen.has(pickedStr)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "picked_card_id must appear in rolled_card_ids",
          path: ["picked_card_id"],
        });
      }
      const expected = buildCardId(spin.picked_player_id, spin.tournament_id);
      if (pickedStr !== expected) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `picked_card_id must equal buildCardId(picked_player_id, tournament_id) = "${expected}"`,
          path: ["picked_card_id"],
        });
      }
    }
  }) satisfies z.ZodType<Spin>;

export const SquadSlotSchema = z
  .object({
    slot_id: NonEmptyIdSchema,
    is_starter: z.boolean(),
    lineup_position: PositionSchema,
    allowed_positions: z.array(PositionSchema).min(1),
    card_id: CardIdSchema.nullable(),
    player_id: NonEmptyIdSchema.nullable(),
    tournament_id: PositiveIntegerSchema.nullable(),
    slot_valid: z.boolean(),
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
    if (slot.card_id !== null && slot.player_id !== null && slot.tournament_id !== null) {
      const expected = buildCardId(slot.player_id, slot.tournament_id);
      if ((slot.card_id as string) !== expected) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `slot card_id must equal buildCardId(player_id, tournament_id) = "${expected}"`,
          path: ["card_id"],
        });
      }
    }
    if (!slot.allowed_positions.includes(slot.lineup_position)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "lineup_position must be present in allowed_positions",
        path: ["lineup_position"],
      });
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
    formation: FormationSchema,
    team_name: z.string(),
    spins: z.array(SpinSchema).length(16),
    squad: z.array(SquadSlotSchema).length(16),
    status: z.enum(["drafting", "ready", "simulated"]),
    deduped_player_ids: z.array(NonEmptyIdSchema),
    dataset_version: NonEmptyIdSchema,
    rating_version: NonEmptyIdSchema,
    engine_version: NonEmptyIdSchema,
  })
  .superRefine((draft, ctx) => {
    // 11 starters + 5 bench.
    const starters = draft.squad.filter((s) => s.is_starter).length;
    if (starters !== 11) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `squad must have exactly 11 starters, got ${starters}`,
        path: ["squad"],
      });
    }
    const bench = draft.squad.filter((s) => !s.is_starter).length;
    if (bench !== 5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `squad must have exactly 5 bench slots, got ${bench}`,
        path: ["squad"],
      });
    }

    // Spin indices ordered 0..15.
    for (let i = 0; i < draft.spins.length; i++) {
      if (draft.spins[i]!.index !== i) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `spins[${i}].index must equal ${i}`,
          path: ["spins", i, "index"],
        });
      }
    }

    // (tournament_id, nation_id) uniqueness across spins.
    const pairSeen = new Set<string>();
    for (let i = 0; i < draft.spins.length; i++) {
      const s = draft.spins[i]!;
      const k = `${s.tournament_id}:${s.nation_id}`;
      if (pairSeen.has(k)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `(tournament_id, nation_id) pair ${k} repeated across spins`,
          path: ["spins", i],
        });
      }
      pairSeen.add(k);
    }

    // deduped_player_ids === ordered-unique picked_player_ids.
    const pickedOrdered: string[] = [];
    const pickedSet = new Set<string>();
    for (let i = 0; i < draft.spins.length; i++) {
      const s = draft.spins[i]!;
      if (s.picked_player_id !== null) {
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
    }
    if (draft.deduped_player_ids.length !== pickedOrdered.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `deduped_player_ids length ${draft.deduped_player_ids.length} != ordered-unique picks length ${pickedOrdered.length}`,
        path: ["deduped_player_ids"],
      });
    } else {
      for (let i = 0; i < pickedOrdered.length; i++) {
        if (draft.deduped_player_ids[i] !== pickedOrdered[i]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `deduped_player_ids[${i}] must equal ordered-unique picks[${i}]`,
            path: ["deduped_player_ids", i],
          });
          break;
        }
      }
    }

    // For each spin: excluded_player_ids === ordered list of prior picks.
    const priorPicks: string[] = [];
    for (let i = 0; i < draft.spins.length; i++) {
      const s = draft.spins[i]!;
      if (s.excluded_player_ids.length !== priorPicks.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `spins[${i}].excluded_player_ids length must equal ${priorPicks.length} (players picked before this spin)`,
          path: ["spins", i, "excluded_player_ids"],
        });
      } else {
        for (let j = 0; j < priorPicks.length; j++) {
          if (s.excluded_player_ids[j] !== priorPicks[j]) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `spins[${i}].excluded_player_ids[${j}] must equal prior pick ${priorPicks[j]}`,
              path: ["spins", i, "excluded_player_ids", j],
            });
            break;
          }
        }
      }
      if (s.picked_player_id !== null) {
        priorPicks.push(s.picked_player_id);
      }
    }

    // assigned_slot_id references — no duplicates; assigned slot card_id matches pick.
    const slotById = new Map<string, SquadSlot>();
    for (const slot of draft.squad) slotById.set(slot.slot_id, slot);
    const assignedSeen = new Set<string>();
    for (let i = 0; i < draft.spins.length; i++) {
      const s = draft.spins[i]!;
      if (s.assigned_slot_id === null) continue;
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
  }) satisfies z.ZodType<DraftState>;
