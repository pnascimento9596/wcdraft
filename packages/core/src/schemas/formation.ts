// Zod schemas for the formation layer (WS-0c depth layer).
//
// TRUST-BOUNDARY: these schemas validate any FormationTemplate that crosses
// disk / network → runtime. The MVP templates exported by `types/formation.ts`
// are materialised IN-PROCESS by `deriveFormationAdjacency` and don't need to
// be re-parsed at startup; the schemas exist so external consumers (e.g. a
// future "custom formation pack" payload) cross the boundary safely.

import { z } from "zod";

import type {
  FormationChannel,
  FormationSlot,
  FormationTemplate,
  SlotPosition,
} from "../types/formation.js";
import { SLOT_POSITIONS, deriveFormationAdjacency } from "../types/formation.js";
import { NonEmptyIdSchema } from "./primitives.js";

/**
 * Fine slot position enum schema, generated from the SLOT_POSITIONS const so
 * the union and the schema cannot drift. The cast is the standard idiom for
 * narrowing the `readonly string[]` to a tuple `z.enum` accepts.
 */
export const SlotPositionSchema = z.enum(
  SLOT_POSITIONS as unknown as [SlotPosition, ...SlotPosition[]],
) satisfies z.ZodType<SlotPosition>;

export const FormationChannelSchema = z.enum([
  "L",
  "C",
  "R",
]) satisfies z.ZodType<FormationChannel>;

export const FormationSlotSchema = z.object({
  slot_id: NonEmptyIdSchema,
  slot_position: SlotPositionSchema,
  channel: FormationChannelSchema,
}) satisfies z.ZodType<FormationSlot>;

/**
 * Canonical-form FormationTemplate schema. Enforces:
 *  - exactly 11 starter slots;
 *  - slot ids unique within the template;
 *  - adjacency edges canonicalised `[a, b]` with `a < b`, no self-edges, no
 *    duplicates, every endpoint references a real slot;
 *  - the array of edges is sorted lexicographically;
 *  - the adjacency edge list re-derives EXACTLY (deep-equal) from the rule
 *    via `deriveFormationAdjacency(slots)`. This is the drift guard.
 */
export const FormationTemplateSchema = z
  .object({
    formation_id: NonEmptyIdSchema,
    name: NonEmptyIdSchema,
    slots: z.array(FormationSlotSchema).length(11),
    adjacency: z.array(z.tuple([NonEmptyIdSchema, NonEmptyIdSchema])),
  })
  .superRefine((tpl, ctx) => {
    // Slot-id uniqueness.
    const slotIds = new Set<string>();
    for (let i = 0; i < tpl.slots.length; i++) {
      const id = tpl.slots[i]!.slot_id;
      if (slotIds.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `slots[${i}].slot_id ${id} is duplicated`,
          path: ["slots", i, "slot_id"],
        });
      }
      slotIds.add(id);
    }
    // Edge well-formedness: canonicalised ordering, no self-edges, endpoints
    // resolve, no duplicates.
    const edgeSeen = new Set<string>();
    for (let i = 0; i < tpl.adjacency.length; i++) {
      const [a, b] = tpl.adjacency[i]!;
      if (a === b) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `adjacency[${i}] is a self-edge`,
          path: ["adjacency", i],
        });
        continue;
      }
      if (a >= b) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `adjacency[${i}] must be canonicalised so slot_id_a < slot_id_b lexicographically`,
          path: ["adjacency", i],
        });
      }
      if (!slotIds.has(a) || !slotIds.has(b)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `adjacency[${i}] references an unknown slot_id`,
          path: ["adjacency", i],
        });
      }
      const key = `${a} ${b}`;
      if (edgeSeen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `adjacency[${i}] duplicates edge ${key}`,
          path: ["adjacency", i],
        });
      }
      edgeSeen.add(key);
    }
    // Lexicographic sort of the edge list.
    for (let i = 1; i < tpl.adjacency.length; i++) {
      const [pa, pb] = tpl.adjacency[i - 1]!;
      const [ca, cb] = tpl.adjacency[i]!;
      const prev = `${pa} ${pb}`;
      const curr = `${ca} ${cb}`;
      if (prev >= curr) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `adjacency edges must be sorted lexicographically (index ${i} out of order)`,
          path: ["adjacency", i],
        });
        break;
      }
    }
    // Drift guard: edge list MUST equal the rule-derived list (deep-equal).
    const expected = deriveFormationAdjacency(tpl.slots);
    if (expected.length !== tpl.adjacency.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `adjacency length ${tpl.adjacency.length} != rule-derived length ${expected.length}`,
        path: ["adjacency"],
      });
      return;
    }
    for (let i = 0; i < expected.length; i++) {
      const [ea, eb] = expected[i]!;
      const [ga, gb] = tpl.adjacency[i]!;
      if (ea !== ga || eb !== gb) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `adjacency[${i}] = [${ga}, ${gb}] differs from rule-derived [${ea}, ${eb}]`,
          path: ["adjacency", i],
        });
        break;
      }
    }
  }) satisfies z.ZodType<FormationTemplate>;
