/**
 * Shared pure re-sim kernel for server-side run-token verification.
 *
 * Consumed by OG/sign, challenge verify, lineup inspector (`verifyRunTokenForOg`)
 * and leaderboard submit (`validateSubmission`). Outer pipelines keep their
 * identity: cheap-gate ordering, rejection vocabulary, claimed_score, and OG
 * narrative construction stay in the adapters.
 *
 * CONTRACT:
 * - Single codec seam: callers pass an already-decoded v3/v4 token; this
 *   module never decodes and never invents a second path.
 * - `mp`/`a` reconciliation flows through `reconcileRunToken` identically for
 *   all consumers (pre-sim draft + post-sim match reconciliation).
 * - Pure: no I/O, no clock, no ambient state. Deterministic over (token, gameData, scenario).
 */

import {
  buildRunScenario,
  runTournamentFull,
  type DraftState,
  type MatchResult,
  type RunResult,
} from "@wcdraft/core";
import type { Scenario2026Bundle } from "@wcdraft/data";

import type { GameData } from "./data";
import type { RunRecordV1 } from "./run-record";
import { reconcileRunToken, type RunTokenBody } from "./run-token";
import { buildSimWorldInputs } from "./simulate";

export type ResimKernelResult =
  | {
      readonly status: "ok";
      readonly draft: DraftState;
      readonly run: RunResult;
      readonly matches: readonly MatchResult[];
    }
  | {
      readonly status: "rejected";
      readonly reason: "ILLEGAL_PICK" | "SIM_FAILURE";
      readonly message: string;
    };

/**
 * Replay the token into a DraftState, re-sim on server-owned scenario/world,
 * then re-reconcile with match results (`mp`/`a` path).
 *
 * Accepts any decoded `RunTokenBody` so legacy v1/v2 still fail through the
 * shared reconcile seam as `ILLEGAL_PICK` (same vocabulary as pre-extraction).
 */
export function verifyAndResimRunToken(
  token: RunTokenBody,
  gameData: GameData,
  scenario: Scenario2026Bundle,
): ResimKernelResult {
  let draft: DraftState;
  try {
    draft = reconcileRunToken(token, gameData);
  } catch (err) {
    return {
      status: "rejected",
      reason: "ILLEGAL_PICK",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    const record: RunRecordV1 = {
      record_version: 1,
      run_id: token.rid,
      parent_seed: token.ps,
      created_seq: 0,
      updated_seq: 0,
      versions: gameData.versions,
      draft,
      status: "ready",
    };
    const { world, teams, bracket } = buildSimWorldInputs(gameData, scenario, record);
    const { scenario: runScenario } = buildRunScenario({
      parent_seed: token.ps,
      teams,
      bracket,
      ruleset_version: gameData.versions.ruleset_version,
    });
    const result = runTournamentFull(draft, runScenario, token.ps, world);
    try {
      reconcileRunToken(token, gameData, result.matches);
    } catch (error) {
      return {
        status: "rejected",
        reason: "ILLEGAL_PICK",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    return {
      status: "ok",
      draft,
      run: result.run,
      matches: result.matches,
    };
  } catch (err) {
    return {
      status: "rejected",
      reason: "SIM_FAILURE",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
