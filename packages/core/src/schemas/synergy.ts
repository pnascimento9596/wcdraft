// Zod schemas for the Synergy layer (WS-0c depth layer).
//
// SynergyResult is consumed in-process by the WS-B aggregator; it does NOT
// cross disk / network in MVP, so these schemas are NON-AUTHORITATIVE but
// useful for test fixtures and any future debug-dump persistence path.

import { z } from "zod";

import type {
  LinkedPair,
  NationCluster,
  SynergyResult,
} from "../types/synergy.js";
import { NonEmptyIdSchema, NonNegativeIntegerSchema } from "./primitives.js";

export const NationClusterSchema = z
  .object({
    nation_id: NonEmptyIdSchema,
    slot_ids: z.array(NonEmptyIdSchema).min(1),
    size: NonNegativeIntegerSchema,
  })
  .superRefine((c, ctx) => {
    if (c.size !== c.slot_ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `NationCluster.size ${c.size} must equal slot_ids.length ${c.slot_ids.length}`,
        path: ["size"],
      });
    }
    // slot_ids canonically sorted lexicographically for stable equality.
    for (let i = 1; i < c.slot_ids.length; i++) {
      if (c.slot_ids[i - 1]! >= c.slot_ids[i]!) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `NationCluster.slot_ids must be sorted ascending lexicographically (index ${i})`,
          path: ["slot_ids", i],
        });
        break;
      }
    }
  }) satisfies z.ZodType<NationCluster>;

export const LinkedPairSchema = z
  .object({
    slot_id_a: NonEmptyIdSchema,
    slot_id_b: NonEmptyIdSchema,
    linked: z.boolean(),
    nation_id: NonEmptyIdSchema.nullable(),
  })
  .superRefine((p, ctx) => {
    if (p.slot_id_a >= p.slot_id_b) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "LinkedPair must be canonicalised so slot_id_a < slot_id_b lexicographically",
        path: ["slot_id_a"],
      });
    }
    if (p.linked && p.nation_id === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "LinkedPair with linked=true must carry the shared nation_id",
        path: ["nation_id"],
      });
    }
    if (!p.linked && p.nation_id !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "LinkedPair with linked=false must carry nation_id=null",
        path: ["nation_id"],
      });
    }
  }) satisfies z.ZodType<LinkedPair>;

export const SynergyResultSchema = z.object({
  overall: z.number().refine((n) => Number.isFinite(n) && n >= 0 && n <= 100, {
    message: "SynergyResult.overall must be a finite number in [0, 100]",
  }),
  nation_clusters: z.array(NationClusterSchema),
  linked_pairs: z.array(LinkedPairSchema),
  manager_link: z.number().refine((n) => Number.isFinite(n) && n >= 0 && n <= 1, {
    message: "SynergyResult.manager_link must be a finite number in [0, 1]",
  }),
  multiplier: z.number().refine((n) => Number.isFinite(n) && n > 0, {
    message: "SynergyResult.multiplier must be a finite positive number (bounds locked in WS-B)",
  }),
}) satisfies z.ZodType<SynergyResult>;
