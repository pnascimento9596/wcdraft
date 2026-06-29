// POST /api/ranked/attempt handler.
//
// Authenticated ranked draft creation seam: mint one short-window server seed
// for the signed-in user and exact draft config. This is intentionally separate
// from /api/leaderboard/submit so ranked submit can reject client-chosen seeds.

import { NextResponse, type NextRequest } from "next/server";
import type { Db } from "@wcdraft/db";
import { z } from "zod";

import {
  isBoardDraftMode,
  isBoardDraftOrder,
  isBoardEra,
  isBoardRatingBasis,
} from "./config";
import { LeaderboardGateError, requireSubmitIdentity } from "./identity-gate";
import { createRankedAttempt, type IssuedRankedAttempt } from "./ranked-attempts";

export interface RankedAttemptRouteDeps {
  readonly db: Db;
  readonly now: () => number;
  readonly getCookieSecret: () => string;
  readonly currentSeasonKey: () => string;
  readonly randomBytes?: (size: number) => Uint8Array;
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
    const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.includes("application/json")) {
      return NextResponse.json(
        { error: "UNSUPPORTED_MEDIA_TYPE", message: "content-type must be application/json" },
        { status: 415 },
      );
    }

    let parsed: unknown;
    try {
      parsed = await req.json();
    } catch {
      return invalidBody("body is not valid JSON");
    }
    const bodyResult = RankedAttemptBodySchema.safeParse(parsed);
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
      { now: deps.now, randomBytes: deps.randomBytes },
    );
    const res = NextResponse.json(toResponseBody(issued), { status: 201 });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    if (err instanceof LeaderboardGateError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error("[leaderboard] unexpected ranked attempt error", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
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
