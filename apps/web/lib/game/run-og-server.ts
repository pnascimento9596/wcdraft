import {
  buildNarrative,
  buildRunScenario,
  runTournamentFull,
  type DraftState,
  type MatchResult,
  type RunResult,
} from "@wcdraft/core";

import type { ValidationData } from "../leaderboard/validate";
import {
  decodeRunToken,
  reconcileRunToken,
  versionsAgree,
  type RunTokenOgSummary,
  type RunTokenV3Body,
  type RunTokenV4Body,
} from "./run-token";
import type { RunRecordV1 } from "./run-record";
import { buildSimWorldInputs } from "./simulate";
import { buildRunOgModelFromTrustedDraft, type RunOgModel } from "./run-og-model";
import { buildNarrativeLabels } from "./results-adapters";

export type RunOgVerificationResult =
  | {
      status: "accepted";
      token: RunTokenV3Body | RunTokenV4Body;
      draft: DraftState;
      run: RunResult;
      matches: readonly MatchResult[];
      model: RunOgModel;
      summary: RunTokenOgSummary;
    }
  | {
      status: "rejected";
      reason: "MALFORMED" | "UNSUPPORTED_VERSION" | "WRONG_SEASON" | "ILLEGAL_PICK" | "SIM_FAILURE";
    };

export function verifyRunTokenForOg(
  runValue: string,
  data: ValidationData,
): RunOgVerificationResult {
  const token = decodeRunToken(runValue);
  if (!token) return { status: "rejected", reason: "MALFORMED" };
  if (token.v !== 3 && token.v !== 4) {
    return { status: "rejected", reason: "UNSUPPORTED_VERSION" };
  }
  if (!versionsAgree(token, data.gameData.versions)) {
    return { status: "rejected", reason: "WRONG_SEASON" };
  }

  let draft;
  try {
    draft = reconcileRunToken(token, data.gameData);
  } catch {
    return { status: "rejected", reason: "ILLEGAL_PICK" };
  }

  try {
    const record: RunRecordV1 = {
      record_version: 1,
      run_id: token.rid,
      parent_seed: token.ps,
      created_seq: 0,
      updated_seq: 0,
      versions: data.gameData.versions,
      draft,
      status: "ready",
    };
    const { world, teams, bracket } = buildSimWorldInputs(data.gameData, data.scenario, record);
    const { scenario } = buildRunScenario({
      parent_seed: token.ps,
      teams,
      bracket,
      ruleset_version: data.gameData.versions.ruleset_version,
    });
    const result = runTournamentFull(draft, scenario, token.ps, world);
    try {
      reconcileRunToken(token, data.gameData, result.matches);
    } catch {
      return { status: "rejected", reason: "ILLEGAL_PICK" };
    }
    const narrativeLabels = buildNarrativeLabels(data.gameData, data.scenario, draft);
    const narrative = buildNarrative(result.run, [...result.matches], narrativeLabels).filled_text;
    const summary: RunTokenOgSummary = {
      w: result.run.wins,
      l: result.run.losses,
      mp: result.matches.length,
      gf: result.run.aggregate.goals_for,
      ga: result.run.aggregate.goals_against,
      rr: result.run.reached_round,
      ch: result.run.is_champion,
      sw: result.run.shootout_wins,
    };
    return {
      status: "accepted",
      token,
      draft,
      run: result.run,
      matches: result.matches,
      summary,
      model: buildRunOgModelFromTrustedDraft(data.gameData, token, draft, summary, narrative),
    };
  } catch {
    return { status: "rejected", reason: "SIM_FAILURE" };
  }
}
