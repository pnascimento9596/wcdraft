// POST /api/ranked/attempt handler.
//
// Authenticated ranked draft creation seam: return the one short-window server
// seed for the signed-in user and exact draft config, minting only when no live
// attempt exists. This is intentionally separate from /api/leaderboard/submit
// so ranked submit can reject client-chosen seeds.

import { NextResponse, type NextRequest } from "next/server";
import type { Db } from "@wcdraft/db";
import { z } from "zod";

import {
  BoundedBodyError,
  boundedBodyErrorResponse,
  requireJsonObject,
} from "../http/bounded-body";
import { internalErrorResponse, rateLimitUnavailableResponse } from "../http/request-error-log";
import { isBoardDraftMode, isBoardDraftOrder, isBoardEra, isBoardRatingBasis } from "./config";
import { LeaderboardGateError, requireSubmitIdentity } from "./identity-gate";
import {
  createRankedAttempt,
  RankedAttemptRateLimitError,
  RankedAttemptRateLimitUnavailableError,
  type CreateRankedAttemptDeps,
  type IssuedRankedAttempt,
} from "./ranked-attempts";

/**
 * Ranked attempt body is a small config object (formation + 4 axes). Derivation:
 *   formation_id ≤ 64 chars + draft_mode/order/era/rating_basis enums (~80)
 *   + JSON envelope (~80) + UTF-8 headroom → well under 1 KiB legal max.
 * Bound set to 4 KiB (dispatch 2–4 KiB band) so legitimate clients never 413
 * while still rejecting multi-megabyte buffers before identity/DB work.
 */
export const MAX_RANKED_ATTEMPT_BODY_BYTES = 4 * 1024;

export interface RankedAttemptRouteDeps {
  readonly db: Db;
  readonly now: () => number;
  readonly getCookieSecret: () => string;
  readonly currentSeasonKey: () => string;
  readonly randomBytes?: (size: number) => Uint8Array;
  readonly consumeIssueRateLimit?: CreateRankedAttemptDeps["consumeIssueRateLimit"];
}

const RankedAttemptBodySchema = z.object({
  formation_id: z.string().min(1).max(64),
  draft_mode: z.string(),
  draft_order: z.string(),
  era: z.string(),
  rating_basis: z.string(),
});

export interface RankedAttemptResponseBody {
  readonly attempt_id: string;
  readonly parent_seed: string;
  readonly expires_at: string;
  readonly season_key: string;
  readonly formation_id: string;
  readonly draft_mode: string;
  readonly draft_order: string;
  readonly era: string;
  readonly rating_basis: string;
}

function invalidBody(message: string): NextResponse {
  return NextResponse.json({ error: "INVALID_BODY", message }, { status: 400 });
}

export async function handleRankedAttemptPost(
  req: NextRequest,
  deps: RankedAttemptRouteDeps,
): Promise<NextResponse> {
  try {
    let parsedObject: Record<string, unknown>;
    try {
      parsedObject = await requireJsonObject(req, { maxBytes: MAX_RANKED_ATTEMPT_BODY_BYTES });
    } catch (err) {
      if (err instanceof BoundedBodyError) {
        const response = boundedBodyErrorResponse(err);
        if (response) return response;
      }
      throw err;
    }

    const bodyResult = RankedAttemptBodySchema.safeParse(parsedObject);
    if (!bodyResult.success) return invalidBody("body must include ranked draft config");
    const body = bodyResult.data;
    if (!isBoardDraftMode(body.draft_mode)) {
      return invalidBody("draft_mode must be 'classic' or 'hidden'");
    }
    if (!isBoardDraftOrder(body.draft_order)) {
      return invalidBody("draft_order must be 'squad_first' or 'position_first'");
    }
    if (!isBoardEra(body.era)) {
      return invalidBody("era must be 'all_time', 'post_2000', 'post_2010', or 'modern'");
    }
    if (!isBoardRatingBasis(body.rating_basis)) {
      return invalidBody("rating_basis must be 'career' or 'current'");
    }

    const identity = await requireSubmitIdentity(req, {
      db: deps.db,
      now: deps.now,
      getCookieSecret: deps.getCookieSecret,
      requireAccount: () => true,
    });
    if (identity.userId === null) {
      throw new LeaderboardGateError("AUTH_REQUIRED");
    }

    const issued = await createRankedAttempt(
      deps.db,
      {
        userId: identity.userId,
        sessionId: identity.sessionId,
        seasonKey: deps.currentSeasonKey(),
        formationId: body.formation_id,
        draftMode: body.draft_mode,
        draftOrder: body.draft_order,
        era: body.era,
        ratingBasis: body.rating_basis,
      },
      {
        now: deps.now,
        randomBytes: deps.randomBytes,
        consumeIssueRateLimit: deps.consumeIssueRateLimit,
      },
    );
    const res = NextResponse.json(toResponseBody(issued), { status: issued.reused ? 200 : 201 });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    if (err instanceof RankedAttemptRateLimitUnavailableError) {
      return rateLimitUnavailableResponse({
        correlationId: err.correlationId,
        retryAfterSeconds: err.retryAfterSeconds,
        message: "Rate limiting is temporarily unavailable. Try again shortly.",
      });
    }
    if (err instanceof RankedAttemptRateLimitError) {
      const res = NextResponse.json(
        { error: "RATE_LIMITED", message: err.message },
        { status: 429 },
      );
      res.headers.set("Retry-After", String(err.retryAfterSeconds));
      res.headers.set("Cache-Control", "no-store");
      return res;
    }
    if (err instanceof LeaderboardGateError) {
      return NextResponse.json(
        {
          error: err.code,
          message: err.message,
          ...(err.code === "VERIFICATION_REQUIRED"
            ? { resend_verification: "/api/auth/resend-verification" }
            : {}),
        },
        { status: err.status },
      );
    }
    return internalErrorResponse("POST /api/ranked/attempt", err);
  }
}

function toResponseBody(issued: IssuedRankedAttempt): RankedAttemptResponseBody {
  return {
    attempt_id: issued.attemptId,
    parent_seed: issued.parentSeed,
    expires_at: issued.expiresAt.toISOString(),
    season_key: issued.seasonKey,
    formation_id: issued.formationId,
    draft_mode: issued.draftMode,
    draft_order: issued.draftOrder,
    era: issued.era,
    rating_basis: issued.ratingBasis,
  };
}
