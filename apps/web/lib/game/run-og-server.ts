import { buildNarrative, type DraftState, type MatchResult, type RunResult } from "@wcdraft/core";

import type { ValidationData } from "../leaderboard/validate";
import {
  decodeRunToken,
  versionsAgree,
  type RunTokenOgSummary,
  type RunTokenV3Body,
  type RunTokenV4Body,
} from "./run-token";
import { buildRunOgModelFromTrustedDraft, type RunOgModel } from "./run-og-model";
import { buildNarrativeLabels } from "./results-adapters";
import { verifyAndResimRunToken } from "./verify-and-resim-run-token";

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
      reason:
        | "MALFORMED"
        | "UNSUPPORTED_VERSION"
        | "DIFFERENT_BUILD"
        | "ILLEGAL_PICK"
        | "SIM_FAILURE";
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
  // Version-anchor skew is a different build, not a different season. Season
  // identity is an explicit leaderboard policy; OG has no season write path.
  if (!versionsAgree(token, data.gameData.versions)) {
    return { status: "rejected", reason: "DIFFERENT_BUILD" };
  }

  const resim = verifyAndResimRunToken(token, data.gameData, data.scenario);
  if (resim.status === "rejected") {
    return { status: "rejected", reason: resim.reason };
  }

  const narrativeLabels = buildNarrativeLabels(data.gameData, data.scenario, resim.draft);
  const narrative = buildNarrative(resim.run, [...resim.matches], narrativeLabels).filled_text;
  const summary: RunTokenOgSummary = {
    w: resim.run.wins,
    l: resim.run.losses,
    mp: resim.matches.length,
    gf: resim.run.aggregate.goals_for,
    ga: resim.run.aggregate.goals_against,
    rr: resim.run.reached_round,
    ch: resim.run.is_champion,
    sw: resim.run.shootout_wins,
  };
  return {
    status: "accepted",
    token,
    draft: resim.draft,
    run: resim.run,
    matches: resim.matches,
    summary,
    model: buildRunOgModelFromTrustedDraft(data.gameData, token, resim.draft, summary, narrative),
  };
}
