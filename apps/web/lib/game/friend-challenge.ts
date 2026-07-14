import {
  isDraftFlow,
  isEraPresetId,
  isRatingBasis,
  type DraftFlow,
  type DraftMode,
  type EraPresetId,
  type RatingBasis,
} from "@wcdraft/core";
import { boundedRequest } from "@wcdraft/data/client";

import { RUN_TOKEN_MAX_LEN } from "./run-token";
import { isLikelySignedFriendChallenge, SIGNED_FRIEND_CHALLENGE_MAX_LEN } from "./run-og-signing";

export const FRIEND_CHALLENGE_PARAM = "challenge" as const;
export const FRIEND_CHALLENGE_PROOF_PARAM = "proof" as const;
export const FRIEND_CHALLENGE_URL_MAX_LEN = 8192 as const;
export const FRIEND_CHALLENGE_VERIFICATION_BUDGET_MS = 4_000 as const;

export interface FriendChallengeRef {
  readonly token: string;
  readonly proof: string;
}

export type FriendChallengeSearchState =
  | { readonly kind: "none" }
  | { readonly kind: "invalid" }
  | { readonly kind: "ready"; readonly ref: FriendChallengeRef };

interface FriendChallengeSetupCommon {
  readonly parentSeed: string;
  readonly formationId: string;
  readonly mode: DraftMode;
  readonly draftFlow: DraftFlow;
  readonly ratingBasis: RatingBasis;
  readonly eraPreset: EraPresetId;
  readonly dailyDate: string | null;
  readonly challengerDisplay: string;
}

export type VerifiedFriendChallengeSetup = FriendChallengeSetupCommon &
  (
    | { readonly status: "VERIFIED"; readonly challengerScore: number }
    | { readonly status: "DIFFERENT_BUILD"; readonly challengerScore: null }
  );

export type FriendChallengeVerifyResult =
  | { readonly ok: true; readonly challenge: VerifiedFriendChallengeSetup }
  | {
      readonly ok: false;
      readonly error: "INVALID_CHALLENGE" | "DAILY_UNAVAILABLE" | "RATE_LIMITED" | "UNAVAILABLE";
    };

export function parseFriendChallengeSearchParams(
  params: { get: (key: string) => string | null } | null | undefined,
): FriendChallengeSearchState {
  if (!params) return { kind: "none" };
  const token = params.get(FRIEND_CHALLENGE_PARAM);
  const proof = params.get(FRIEND_CHALLENGE_PROOF_PARAM);
  if (token === null && proof === null) return { kind: "none" };
  if (
    typeof token !== "string" ||
    typeof proof !== "string" ||
    token.length === 0 ||
    token.length > RUN_TOKEN_MAX_LEN ||
    !/^t\d{1,4}\./u.test(token) ||
    proof.length > SIGNED_FRIEND_CHALLENGE_MAX_LEN ||
    !isLikelySignedFriendChallenge(proof)
  ) {
    return { kind: "invalid" };
  }
  return { kind: "ready", ref: { token, proof } };
}

/** Build the self-contained deep link and enforce an 8 KiB escaped URL budget. */
export function buildFriendChallengeUrl(
  origin: string,
  ref: FriendChallengeRef,
  dailyDate: string | null,
): string {
  const base = dailyDate === null ? "/play/draft" : "/play/daily";
  const params = new URLSearchParams({
    [FRIEND_CHALLENGE_PARAM]: ref.token,
    [FRIEND_CHALLENGE_PROOF_PARAM]: ref.proof,
  });
  if (dailyDate !== null) params.set("date", dailyDate);
  const value = `${origin.replace(/\/$/u, "")}${base}?${params.toString()}`;
  if (value.length > FRIEND_CHALLENGE_URL_MAX_LEN) {
    throw new RangeError(
      `challenge link is ${value.length.toString()} characters; maximum is ${FRIEND_CHALLENGE_URL_MAX_LEN.toString()}`,
    );
  }
  return value;
}

export function buildFriendChallengeShareCopy(url: string): string {
  return `Challenge a friend on my WCDraft board. Same seed, same setup. Can you beat my score?\n${url}`;
}

export const FRIEND_CHALLENGE_VERIFICATION_COPY =
  "Your friend’s score was re-derived from the shared token; your completed run used the same seed and build.";

export async function verifyFriendChallenge(
  ref: FriendChallengeRef,
  signal?: AbortSignal,
): Promise<FriendChallengeVerifyResult> {
  let result: { readonly response: Response; readonly body: unknown };
  try {
    result = await boundedRequest(
      async (requestSignal) => {
        const response = await fetch("/api/challenge/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ref),
          signal: requestSignal,
        });
        const body: unknown = await response.json();
        return { response, body };
      },
      {
        operation: "friend challenge verification",
        timeoutMs: FRIEND_CHALLENGE_VERIFICATION_BUDGET_MS,
        // Verification is read-only, but the server-side rate-limit counter
        // may have committed before a timeout. Never classify an ambiguous
        // POST as automatically replayable.
        safety: "unsafe-mutation",
        signal,
      },
    );
  } catch {
    return { ok: false, error: "UNAVAILABLE" };
  }
  if (!result.response.ok) return { ok: false, error: readChallengeError(result.body) };
  const challenge = parseVerifiedSetup(result.body);
  return challenge ? { ok: true, challenge } : { ok: false, error: "UNAVAILABLE" };
}

function readChallengeError(
  value: unknown,
): "INVALID_CHALLENGE" | "DAILY_UNAVAILABLE" | "RATE_LIMITED" | "UNAVAILABLE" {
  const error =
    value && typeof value === "object" ? (value as { error?: unknown }).error : undefined;
  return error === "DAILY_UNAVAILABLE" || error === "RATE_LIMITED" || error === "INVALID_CHALLENGE"
    ? error
    : "UNAVAILABLE";
}

function parseVerifiedSetup(value: unknown): VerifiedFriendChallengeSetup | null {
  if (!value || typeof value !== "object") return null;
  const root = value as { ok?: unknown; challenge?: unknown };
  if (root.ok !== true || !root.challenge || typeof root.challenge !== "object") return null;
  const o = root.challenge as Record<string, unknown>;
  if (o.status !== "VERIFIED" && o.status !== "DIFFERENT_BUILD") return null;
  if (typeof o.parentSeed !== "string" || o.parentSeed.length === 0 || o.parentSeed.length > 256)
    return null;
  if (typeof o.formationId !== "string" || o.formationId.length === 0 || o.formationId.length > 64)
    return null;
  if (
    !isDraftMode(o.mode) ||
    !isDraftFlow(o.draftFlow) ||
    !isRatingBasis(o.ratingBasis) ||
    !isEraPresetId(o.eraPreset)
  )
    return null;
  if (o.dailyDate !== null && !isUtcDate(o.dailyDate)) return null;
  if (!isVerifiedDisplay(o.challengerDisplay)) return null;
  if (o.status === "VERIFIED") {
    if (typeof o.challengerScore !== "number" || !Number.isSafeInteger(o.challengerScore))
      return null;
  } else if (o.challengerScore !== null) return null;
  return o as unknown as VerifiedFriendChallengeSetup;
}

function isDraftMode(value: unknown): value is DraftMode {
  return value === "classic" || value === "hidden" || value === "open" || value === "open_hidden";
}

function isUtcDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isVerifiedDisplay(value: unknown): value is string {
  // No verified identity/display claim exists in t3/t4. Never render a team
  // name, email address, or user-controlled alias as challenger provenance.
  return value === "a friend";
}
