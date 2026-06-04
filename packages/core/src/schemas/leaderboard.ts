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

/**
 * Versioned, replayable score submission.
 *
 * SECURITY POSTURE: the server NEVER trusts `claimed_score`. The score is
 * accepted only after server-side re-derivation produces the same number.
 */
export const LeaderboardSubmissionSchema = z.object({
  /** The RunResult.run_id this submission is asserting. */
  run_id: z.string(),
  /** The DraftState.run_id (== `run_id` for canonical runs). */
  draft_id: z.string(),
  /** The RunScenario.scenario_id used. */
  scenario_id: z.string(),

  // ─── SEEDS (STRING; never numeric) ─────────────────────────────────────────
  /** Draft substream seed. */
  draft_seed: z.string(),
  /** Scenario substream seed (carried so server can reproduce opponent ladder). */
  scenario_seed: z.string(),
  /** Top-level run seed from which sim / event-gen / narrative sub-seeds are derived. */
  run_seed: z.string(),
  // ───────────────────────────────────────────────────────────────────────────

  // ─── ALL THREE VERSION ANCHORS ARE REQUIRED ────────────────────────────────
  dataset_version: z.string(),
  rating_version: z.string(),
  engine_version: z.string(),
  // ───────────────────────────────────────────────────────────────────────────

  /** Client-asserted final score. Server MUST re-derive and compare. */
  claimed_score: z.number(),
});

/** Inferred TS type for downstream consumers. */
export type LeaderboardSubmission = z.infer<typeof LeaderboardSubmissionSchema>;
