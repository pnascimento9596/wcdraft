// LeaderboardSubmission — the SERVER-SIDE TRUST BOUNDARY for score submission.
//
// The server uses this payload to:
//   1) parse-and-validate the submission shape (`LeaderboardSubmissionSchema`),
//   2) re-derive the run from (draft, scenario, seeds, version anchors) using
//      the same engine the client used, and
//   3) compare the re-derived score to the `claimed_score`.
//
// If the re-derived score doesn't match, the submission is rejected. The whole
// point of putting all three version anchors + all seeds on the submission is
// to make this re-derivation possible.

import { z } from "zod";

import { NonEmptyIdSchema } from "./primitives.js";

/**
 * Versioned, replayable score submission. EXPLICIT contract type — kept in
 * lockstep with `LeaderboardSubmissionSchema` via `satisfies z.ZodType<T>`.
 *
 * SECURITY POSTURE: the server NEVER trusts `claimed_score`. The score is
 * accepted only after server-side re-derivation produces the same number.
 */
export interface LeaderboardSubmission {
  /** The RunResult.run_id this submission is asserting. */
  run_id: string;
  /** The DraftState.run_id (== `run_id` for canonical runs). */
  draft_id: string;
  /** The RunScenario.scenario_id used. */
  scenario_id: string;
  /** Draft substream seed. */
  draft_seed: string;
  /** Scenario substream seed (carried so server can reproduce opponent ladder). */
  scenario_seed: string;
  /** Top-level run seed from which sim / event-gen / narrative sub-seeds are derived. */
  run_seed: string;
  /** ETL dataset version. */
  dataset_version: string;
  /** Rating-engine version. */
  rating_version: string;
  /** Single core-package semver covering RNG / sim / scoring / ruleset / narrative. */
  engine_version: string;
  /** Client-asserted final score. Server MUST re-derive and compare. */
  claimed_score: number;
}

export const LeaderboardSubmissionSchema = z.object({
  run_id: NonEmptyIdSchema,
  draft_id: NonEmptyIdSchema,
  scenario_id: NonEmptyIdSchema,

  // ─── SEEDS (STRING; never numeric) ─────────────────────────────────────────
  draft_seed: NonEmptyIdSchema,
  scenario_seed: NonEmptyIdSchema,
  run_seed: NonEmptyIdSchema,
  // ───────────────────────────────────────────────────────────────────────────

  // ─── ALL THREE VERSION ANCHORS ARE REQUIRED ────────────────────────────────
  dataset_version: NonEmptyIdSchema,
  rating_version: NonEmptyIdSchema,
  engine_version: NonEmptyIdSchema,
  // ───────────────────────────────────────────────────────────────────────────

  /** Client-asserted final score. Server MUST re-derive and compare. */
  claimed_score: z.number().refine(Number.isFinite, {
    message: "claimed_score must be a finite number",
  }),
}) satisfies z.ZodType<LeaderboardSubmission>;
