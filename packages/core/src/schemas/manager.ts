// Zod schemas for the manager layer (WS-0c depth layer).
//
// TRUST-BOUNDARY: the ETL `managers.json` / `manager_tournaments.json`
// payloads are parsed through these schemas before any draft / sim code
// touches them. The shape mirrors the player layer (Player /
// PlayerTournament / Rating) so reviewers can pattern-match across the two.

import { z } from "zod";

import type {
  Manager,
  ManagerCardId,
  ManagerRating,
  ManagerTournament,
} from "../types/manager.js";
import { buildManagerCardId, parseManagerCardId } from "../types/manager.js";
import {
  NonEmptyIdSchema,
  NonNegativeIntegerSchema,
  PercentSchema,
  PositiveIntegerSchema,
  RatingChannelSchema,
  SourceRefSchema,
} from "./primitives.js";

/**
 * Branded `ManagerCardId` schema. Accepts only strings that parse via
 * `parseManagerCardId` (i.e. `<manager_id>:<tournament_id>` with non-empty
 * manager_id and a positive safe-integer tournament_id). The schema OUTPUT
 * is the branded `ManagerCardId` type so `satisfies z.ZodType<ManagerCardId>`
 * on owner schemas type-checks.
 */
export const ManagerCardIdSchema = z
  .string()
  .refine((s) => parseManagerCardId(s) !== null, {
    message: "manager_card_id must be of form '<manager_id>:<tournament_id>'",
  }) as unknown as z.ZodType<ManagerCardId>;

/**
 * Helper: shared cross-field refinement asserting that a record's
 * `manager_card_id` exactly equals `buildManagerCardId(manager_id,
 * tournament_id)`. Used by ManagerTournament + ManagerRating.
 *
 * Mirrors `refineCardIdConsistency` in `schemas/identity.ts` — same try/catch
 * helper pattern so `buildManagerCardId`'s RangeError on an empty manager_id
 * cannot escape `safeParse`.
 */
export function refineManagerCardIdConsistency<
  T extends { manager_card_id: ManagerCardId; manager_id: string; tournament_id: number },
>(value: T, ctx: z.RefinementCtx): void {
  let expected: string;
  try {
    expected = buildManagerCardId(value.manager_id, value.tournament_id);
  } catch (err) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `manager_card_id cannot be built from (manager_id, tournament_id): ${(err as Error).message}`,
      path: ["manager_card_id"],
    });
    return;
  }
  if ((value.manager_card_id as string) !== expected) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `manager_card_id must equal buildManagerCardId(manager_id, tournament_id) = "${expected}"`,
      path: ["manager_card_id"],
    });
  }
}

export const ManagerSchema = z.object({
  manager_id: NonEmptyIdSchema,
  full_name: NonEmptyIdSchema,
  nation_id: NonEmptyIdSchema,
  birth_date: z.string().nullable(),
  sources: z.array(SourceRefSchema),
}) satisfies z.ZodType<Manager>;

export const ManagerTournamentSchema = z
  .object({
    manager_card_id: ManagerCardIdSchema,
    manager_id: NonEmptyIdSchema,
    tournament_id: PositiveIntegerSchema,
    nation_id: NonEmptyIdSchema,
    matches: NonNegativeIntegerSchema.nullable(),
    final_placement: PositiveIntegerSchema.nullable(),
    sources: z.array(SourceRefSchema),
  })
  .superRefine(refineManagerCardIdConsistency) satisfies z.ZodType<ManagerTournament>;

export const ManagerRatingComponentSchema = z.object({
  signal: NonEmptyIdSchema,
  value: z.number().nullable(),
  weight: z.number().refine((n) => Number.isFinite(n) && n >= 0, {
    message: "manager rating component weight must be a finite, non-negative number",
  }),
});

export const ManagerRatingSchema = z
  .object({
    manager_card_id: ManagerCardIdSchema,
    manager_id: NonEmptyIdSchema,
    tournament_id: PositiveIntegerSchema,
    overall: RatingChannelSchema.nullable(),
    dimensions: z.object({
      pedigree: RatingChannelSchema,
      experience: RatingChannelSchema,
    }),
    components: z.array(ManagerRatingComponentSchema),
    coverage: PercentSchema,
    coverage_basis: z.enum(["wc_signals", "career_signals"]),
    provenance: z.enum(["wc_performance", "projected_career"]),
    rating_version: NonEmptyIdSchema,
  })
  .superRefine(refineManagerCardIdConsistency) satisfies z.ZodType<ManagerRating>;
