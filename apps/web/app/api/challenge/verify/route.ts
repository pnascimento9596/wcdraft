import { NextResponse } from "next/server";
import { getDb } from "@wcdraft/db";

import { getValidationData } from "@/lib/leaderboard/server-data";
import { verifyFriendChallengeForPlay } from "@/lib/game/friend-challenge-server";
import { RUN_TOKEN_MAX_LEN } from "@/lib/game/run-token";
import {
  EXPENSIVE_VERIFY_STORE_ERROR_RETRY_AFTER_SECONDS,
  type ExpensiveVerifyRateLimitDecision,
  type ExpensiveVerifyRateLimiter,
} from "@/lib/game/expensive-verify-rate-limiter-db";
import { createDbChallengeVerifyRateLimiter } from "@/lib/game/run-og-sign-rate-limiter-db";
import {
  isLikelySignedFriendChallenge,
  readOgSigningSecret,
  SIGNED_FRIEND_CHALLENGE_MAX_LEN,
} from "@/lib/game/run-og-signing";
import { readClientIp } from "@/lib/http/client-ip";
import { readBoundedText } from "@/lib/http/read-bounded-text";
import {
  createRequestCorrelationId,
  logRequestError,
  rateLimitUnavailableResponse,
} from "@/lib/http/request-error-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** DB statement_timeout (8s) fires before this platform kill. */
export const maxDuration = 10;

const MAX_BODY_BYTES = RUN_TOKEN_MAX_LEN + SIGNED_FRIEND_CHALLENGE_MAX_LEN + 256;
const NO_STORE = { "Cache-Control": "no-store" } as const;

export interface ChallengeVerifyRouteDeps {
  readonly now: () => number;
  readonly getRateLimiter: () => ExpensiveVerifyRateLimiter;
}

export async function POST(request: Request): Promise<Response> {
  return handleChallengeVerifyPost(request, defaultDeps());
}

export async function handleChallengeVerifyPost(
  request: Request,
  deps: ChallengeVerifyRouteDeps,
): Promise<Response> {
  const secret = readOgSigningSecret();
  if (!secret) return jsonError("UNAVAILABLE", 503);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return jsonError("INVALID_CHALLENGE", 415);
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES)
    return jsonError("INVALID_CHALLENGE", 413);
  const bodyRead = await readBoundedText(request, MAX_BODY_BYTES);
  if (bodyRead.status === "too_large") return jsonError("INVALID_CHALLENGE", 413);
  if (bodyRead.status === "invalid") return jsonError("INVALID_CHALLENGE", 400);
  const raw = bodyRead.value;
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError("INVALID_CHALLENGE", 400);
  }
  const token = body && typeof body === "object" ? (body as { token?: unknown }).token : null;
  const proof = body && typeof body === "object" ? (body as { proof?: unknown }).proof : null;
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > RUN_TOKEN_MAX_LEN ||
    typeof proof !== "string" ||
    proof.length === 0 ||
    proof.length > SIGNED_FRIEND_CHALLENGE_MAX_LEN ||
    !isLikelySignedFriendChallenge(proof)
  )
    return jsonError("INVALID_CHALLENGE", 400);

  const decision = await checkRateLimit(deps, readClientIp(request));
  if (!decision.allowed) {
    if (decision.reason === "store_unavailable") {
      return rateLimitUnavailableResponse({
        correlationId: decision.correlationId,
        retryAfterSeconds: decision.retryAfterSeconds,
        okFalse: true,
      });
    }
    return NextResponse.json(
      { ok: false, error: "RATE_LIMITED" },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(decision.retryAfterSeconds) } },
    );
  }
  const result = await verifyFriendChallengeForPlay(token, proof, getValidationData(), secret);
  if (result.status === "rejected") {
    return jsonError(result.reason, result.reason === "DAILY_UNAVAILABLE" ? 410 : 422);
  }
  return NextResponse.json(
    { ok: true, challenge: result.challenge },
    { status: 200, headers: NO_STORE },
  );
}

function jsonError(error: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });
}

function defaultDeps(): ChallengeVerifyRouteDeps {
  const now = () => Date.now();
  return {
    now,
    getRateLimiter: () =>
      createDbChallengeVerifyRateLimiter({ db: getDb(), now, random: Math.random }),
  };
}

async function checkRateLimit(
  deps: ChallengeVerifyRouteDeps,
  ip: string,
): Promise<ExpensiveVerifyRateLimitDecision> {
  try {
    return await deps.getRateLimiter().check({ ip });
  } catch (err) {
    const correlationId = createRequestCorrelationId();
    logRequestError({
      code: "RATE_LIMIT_UNAVAILABLE",
      correlationId,
      route: "POST /api/challenge/verify",
      error: err,
    });
    return {
      allowed: false,
      reason: "store_unavailable",
      retryAfterSeconds: EXPENSIVE_VERIFY_STORE_ERROR_RETRY_AFTER_SECONDS,
      correlationId,
    };
  }
}
