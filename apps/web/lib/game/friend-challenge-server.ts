import {
  decodeRunToken,
  tokenDraftConfig,
  versionsAgree,
  type RunTokenV3Body,
  type RunTokenV4Body,
} from "./run-token";
import { dailyCoverageForDate } from "./daily";
import type { ValidationData } from "../leaderboard/validate";
import { verifyRunTokenForOg, type RunOgVerificationResult } from "./run-og-server";
import {
  sha256Hex,
  signFriendChallengePayload,
  verifySignedFriendChallengePayload,
} from "./run-og-signing";
import type { VerifiedFriendChallengeSetup } from "./friend-challenge";

export type FriendChallengeServerResult =
  | { readonly status: "accepted"; readonly challenge: VerifiedFriendChallengeSetup }
  | { readonly status: "rejected"; readonly reason: "INVALID_CHALLENGE" | "DAILY_UNAVAILABLE" };

export async function signVerifiedFriendChallenge(
  runValue: string,
  verification: RunOgVerificationResult,
  data: ValidationData,
  secret: string,
): Promise<string | null> {
  if (verification.status !== "accepted") return null;
  const token = decodeRunToken(runValue);
  if (
    !token ||
    (token.v !== 3 && token.v !== 4) ||
    JSON.stringify(token) !== JSON.stringify(verification.token)
  ) {
    return null;
  }
  if (!dailyChallengeCovered(token, data)) return null;
  return signFriendChallengePayload({ v: 1, token_hash: await sha256Hex(runValue) }, secret);
}

/** Exact-token proof first; unchanged OG replay is the only score authority. */
export async function verifyFriendChallengeForPlay(
  runValue: string,
  proof: string,
  data: ValidationData,
  secret: string,
): Promise<FriendChallengeServerResult> {
  const signed = await verifySignedFriendChallengePayload(proof, secret);
  if (!signed || signed.token_hash !== (await sha256Hex(runValue))) {
    return { status: "rejected", reason: "INVALID_CHALLENGE" };
  }
  const token = decodeRunToken(runValue);
  if (!token || (token.v !== 3 && token.v !== 4)) {
    return { status: "rejected", reason: "INVALID_CHALLENGE" };
  }
  if (!dailyChallengeCovered(token, data)) {
    return { status: "rejected", reason: "DAILY_UNAVAILABLE" };
  }
  const config = tokenDraftConfig(token);
  const common = {
    parentSeed: token.ps,
    formationId: token.fid,
    mode: token.md,
    draftFlow: config.draft_flow,
    ratingBasis: config.rating_basis,
    eraPreset: config.era_preset,
    dailyDate: token.ch?.k === "daily" ? token.ch.d : null,
    challengerDisplay: "a friend",
  } as const;
  if (!versionsAgree(token, data.gameData.versions)) {
    return {
      status: "accepted",
      challenge: { status: "DIFFERENT_BUILD", ...common, challengerScore: null },
    };
  }
  const verified = verifyRunTokenForOg(runValue, data);
  if (verified.status !== "accepted") {
    return { status: "rejected", reason: "INVALID_CHALLENGE" };
  }
  return {
    status: "accepted",
    challenge: { status: "VERIFIED", ...common, challengerScore: verified.run.score },
  };
}

function dailyChallengeCovered(
  token: RunTokenV3Body | RunTokenV4Body,
  data: ValidationData,
): boolean {
  if (token.ch?.k !== "daily") return true;
  const coverage = dailyCoverageForDate(token.ch.d, data.gameData.dailySeedSaltMap);
  return coverage.covered && coverage.seed === token.ps && token.ch.s === token.ps;
}
