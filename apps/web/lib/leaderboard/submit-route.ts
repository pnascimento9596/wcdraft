// F-4 U3 — POST /api/leaderboard/submit handler (thin server lib).
//
// GATE ORDER (locked; tests assert it):
//   0. feature flag                  — in the route FILE, before deps exist
//   1. method                        — only POST is exported by the route file
//   2. content-type / body size      — 415 / 413, before any parse
//   3. JSON shape + mode             — 400 INVALID_BODY
//   4. identity gate                 — ranked requires account;
//                                      401 AUTH_REQUIRED / 403 CSRF_FAILED
//   5. cheap validation preflight     — malformed requests never burn limiter
//   6. rate-limit SEAM (U5 plugs in)  — 429 RATE_LIMITED + Retry-After
//   7. ranked attempt precheck         — duplicate OR matching live attempt
//   8. validateSubmission (U2)         — full replay/resim; SUBMIT_ERROR_HTTP_STATUS
//   9. insert (NULLS-NOT-DISTINCT dedupe) → 201 inserted / 200 duplicate
//
// Honest-state: the persisted score is the SERVER's re-sim, the returned
// rank is the identity's CURRENT board rank read by a SECOND statement after
// the insert — not the insert's snapshot, so a concurrent insert can move it
// (null when the identity has no visible entry), nulls stay null, and every
// error is a typed code — never prose-only.

import { NextResponse, type NextRequest } from "next/server";
import { users, type Db } from "@wcdraft/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { readClientIp } from "../http/client-ip";
import {
  BoundedBodyError,
  boundedBodyErrorResponse,
  requireJsonObject,
} from "../http/bounded-body";
import { rateLimitUnavailableResponse } from "../http/request-error-log";
import { DAILY_CHALLENGE_KIND, utcDateString } from "../game/daily";
import { decodeRunToken, RUN_TOKEN_MAX_LEN, tokenDraftConfig } from "../game/run-token";
import {
  clearBootstrapCsrfCookie,
  jsonError,
  setCsrfCookie,
  setSessionCookie,
} from "../auth/handler-helpers";
import { DISPLAY_NAME_MAX } from "./display-name";
import {
  LeaderboardGateError,
  RANKED_AUTH_REQUIRED_MESSAGE,
  requireSubmitIdentity,
  type IdentityGateDeps,
  type SubmitIdentity,
} from "./identity-gate";
import {
  identityBoardRank,
  insertAcceptedEntry,
  toApiEntryWithProfile,
  type ApiLeaderboardEntry,
  type BoardMode,
} from "./store";
import {
  consumeRankedAttempt,
  findExistingRankedAttemptEntry,
  precheckRankedAttempt,
} from "./ranked-attempts";
import { DEFAULT_LEADERBOARD_SEASON_ID } from "./season";
import type { SubmitRateLimiter } from "./submit-rate-limit";
import {
  SUBMIT_ERROR_HTTP_STATUS,
  validateSubmission,
  validateSubmissionCheap,
  type RejectedSubmission,
  type ValidationData,
} from "./validate";

/**
 * Streaming body ceiling for POST /api/leaderboard/submit.
 *
 * Derivation (bytes, not characters):
 *   - RUN_TOKEN_MAX_LEN (8192) — hard cap on the token string. A maximal legal
 *     `t4` body already packs 17 card IDs + manager ID + 6-anchor conjunction +
 *     config axes + optional `mp`/`a` under URL-safe base64url inflation
 *     *inside* this cap; the bound must never reject a legal maximal token.
 *   - claimed_score digits (≤20) + mode/challenge enums (~48)
 *   - display_alias + display_name: DISPLAY_NAME_MAX (20) × 4 UTF-8 bytes × 2
 *     fields = 160
 *   - JSON keys/punctuation/quotes for the submit envelope (~140)
 *   - ~25% headroom for future optional fields without silent 413
 *   = 8192 + 20 + 48 + 160 + 140 + ~2140 ≈ 10_700 → 11 KiB.
 *
 * Checked on declared Content-Length (header-only reject) AND on the streaming
 * read (missing / understated Content-Length cannot buffer past this ceiling).
 */
export const MAX_SUBMIT_BODY_BYTES =
  RUN_TOKEN_MAX_LEN +
  20 + // claimed_score
  48 + // enums
  DISPLAY_NAME_MAX * 4 * 2 + // alias + name UTF-8 worst case
  140 + // JSON envelope
  2140; // headroom → 11264 (11 KiB)

export interface SubmitRouteDeps {
  readonly db: Db;
  readonly now: () => number;
  /** Lazy — only read when a session cookie is present (F-3.6 lesson). */
  readonly getCookieSecret: () => string;
  /** Lazy heavy server data — only touched after every cheap gate passed. */
  readonly getValidation: () => ValidationData;
  readonly rateLimiter: SubmitRateLimiter;
  readonly todayUtcDate?: () => string;
}

/** Route-transport error codes owned by this handler (not pipeline codes). */
type TransportErrorCode = "UNSUPPORTED_MEDIA_TYPE" | "BODY_TOO_LARGE" | "INVALID_BODY";

const TRANSPORT_STATUS: Record<TransportErrorCode, number> = {
  UNSUPPORTED_MEDIA_TYPE: 415,
  BODY_TOO_LARGE: 413,
  INVALID_BODY: 400,
};

function transportError(code: TransportErrorCode, message: string): NextResponse {
  return NextResponse.json({ error: code, message }, { status: TRANSPORT_STATUS[code] });
}

function validationError(verdict: RejectedSubmission): NextResponse {
  if (verdict.code === "SIM_FAILURE") {
    // Contract bug (re-sim threw after a successful replay) — alert, never
    // persist. The 500 mapping is deliberate.
    console.error("[leaderboard] SIM_FAILURE — re-sim contract bug:", verdict.reason);
  }
  return NextResponse.json(
    {
      error: verdict.code,
      message: verdict.reason,
      ...(verdict.name_reason !== undefined && { name_reason: verdict.name_reason }),
      ...(verdict.mismatched_anchors !== undefined && {
        mismatched_anchors: verdict.mismatched_anchors,
      }),
    },
    { status: SUBMIT_ERROR_HTTP_STATUS[verdict.code] },
  );
}

const SubmitBodySchema = z.object({
  token: z.unknown().optional(),
  claimed_score: z.unknown().optional(),
  draft_mode: z.unknown().optional(),
  display_alias: z.unknown().optional(),
  display_name: z.unknown().optional(),
  challenge: z
    .enum(["season", "daily"])
    .nullish()
    .transform((challenge) => challenge ?? "season"),
  challenge_date: z.unknown().optional(),
  /** Optional; when present must match the active write season (WRONG_SEASON else). */
  season_key: z.unknown().optional(),
  mode: z
    .enum(["casual", "ranked"])
    .nullish()
    .transform((mode) => mode ?? "casual"),
});

type SubmitBoundaryBody = z.infer<typeof SubmitBodySchema>;
type ExpectedSubmitBoundaryBody = {
  token?: unknown;
  claimed_score?: unknown;
  draft_mode?: unknown;
  display_alias?: unknown;
  display_name?: unknown;
  challenge: "season" | "daily";
  challenge_date?: unknown;
  season_key?: unknown;
  mode: BoardMode;
};
type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
      ? true
      : false
    : false;
const submitBodyTypeParity: Exact<SubmitBoundaryBody, ExpectedSubmitBoundaryBody> = true;
void submitBodyTypeParity;

export interface SubmitResponseBody {
  readonly entry: ApiLeaderboardEntry;
  readonly duplicate: boolean;
  /** Identity's CURRENT board rank (season+lane+config view), read by a second
   *  statement after the insert — a concurrent insert can move it between
   *  the two. Null only if the identity has no visible entry. */
  readonly rank: number | null;
  readonly percentile: number | null;
  readonly field_size: number | null;
}

export async function handleLeaderboardSubmit(
  req: NextRequest,
  deps: SubmitRouteDeps,
): Promise<NextResponse> {
  let resolvedIdentity: SubmitIdentity | null = null;
  try {
    // 2 — content-type + streaming byte ceiling via shared bounded-body helper
    // (header-only reject when Content-Length is over, then stream-capped read
    // so a missing/understated Content-Length cannot buffer past the ceiling).
    let parsedObject: Record<string, unknown>;
    try {
      parsedObject = await requireJsonObject(req, { maxBytes: MAX_SUBMIT_BODY_BYTES });
    } catch (err) {
      if (err instanceof BoundedBodyError) {
        const response = boundedBodyErrorResponse(err);
        if (response) return response;
      }
      throw err;
    }

    // 3 — JSON object shape + mode. Ranked is open only to account-bound
    // sessions; casual remains anonymous-capable.
    const bodyResult = SubmitBodySchema.safeParse(parsedObject);
    if (!bodyResult.success) {
      const modeIssue = bodyResult.error.issues.some((issue) => issue.path[0] === "mode");
      return transportError(
        "INVALID_BODY",
        modeIssue ? "mode must be 'casual' or 'ranked'" : "body must be a JSON object",
      );
    }
    const body = bodyResult.data;
    const submissionMode: BoardMode = body.mode;
    if (body.challenge === DAILY_CHALLENGE_KIND && submissionMode !== "casual") {
      return transportError("INVALID_BODY", "daily submissions are casual only");
    }

    // 4 — identity gate (throws LeaderboardGateError).
    const identity = await requireSubmitIdentity(req, gateDeps(deps, submissionMode));
    resolvedIdentity = identity;

    const submission = {
      token: body.token,
      claimed_score: body.claimed_score,
      draft_mode: body.draft_mode,
      display_alias: body.display_alias,
      display_name: body.display_name,
      challenge: body.challenge,
      challenge_date: body.challenge_date,
      season_key: body.season_key,
    };
    const validationData = deps.getValidation();
    const cheapVerdict = validateSubmissionCheap(submission, validationData);
    if (cheapVerdict !== null) return withIdentitySession(validationError(cheapVerdict), identity);

    // 6 — rate-limit seam (deny-nothing default in U3; U5 implements).
    const decision = await deps.rateLimiter.checkSubmit({
      sessionId: identity.sessionId,
      userId: identity.userId,
      ip: readClientIp(req),
    });
    if (!decision.allowed) {
      if (decision.reason === "store_unavailable") {
        return withIdentitySession(
          rateLimitUnavailableResponse({
            correlationId: decision.correlationId,
            retryAfterSeconds: decision.retryAfterSeconds,
            message: "Rate limiting is temporarily unavailable. Try again shortly.",
          }),
          identity,
        );
      }
      const res = NextResponse.json(
        { error: "RATE_LIMITED", message: "too many submissions" },
        { status: SUBMIT_ERROR_HTTP_STATUS.RATE_LIMITED },
      );
      res.headers.set("Retry-After", String(decision.retryAfterSeconds));
      return withIdentitySession(res, identity);
    }

    // 7 — ranked requests must prove the cheap, indexed attempt boundary
    // before any pick replay or simulation. This read does not consume; the
    // post-replay transaction retains the atomic consumed_at IS NULL update.
    if (submissionMode === "ranked") {
      if (identity.userId === null) {
        throw new LeaderboardGateError("AUTH_REQUIRED", RANKED_AUTH_REQUIRED_MESSAGE);
      }
      const token = decodeRunToken(body.token as string);
      if (token === null) throw new Error("cheap-ranked preflight lost decoded token");
      if (token.md !== "classic" && token.md !== "hidden") {
        throw new Error("cheap-ranked preflight admitted a non-board draft mode");
      }
      const config = tokenDraftConfig(token);
      const seasonKey = validationData.seasonKey ?? DEFAULT_LEADERBOARD_SEASON_ID;
      const attempt = await precheckRankedAttempt(
        deps.db,
        {
          seasonKey,
          formationId: token.fid,
          draftMode: token.md,
          draftOrder: config.draft_flow,
          era: config.era_preset,
          ratingBasis: config.rating_basis,
          userId: identity.userId,
          parentSeed: token.ps,
          token: body.token as string,
        },
        deps.now,
      );
      if (attempt.kind === "duplicate") {
        const best = await identityBoardRank(deps.db, {
          seasonKey,
          challengeType: "season",
          challengeDate: null,
          mode: "ranked",
          draftMode: token.md,
          draftOrder: config.draft_flow,
          era: config.era_preset,
          ratingBasis: config.rating_basis,
          identityKey: identity.userId,
        });
        const responseBody: SubmitResponseBody = {
          entry: await toApiEntryWithProfile(deps.db, attempt.row),
          duplicate: true,
          rank: best?.rank ?? null,
          percentile: best?.percentile ?? null,
          field_size: best?.fieldSize ?? null,
        };
        return NextResponse.json(responseBody, { status: 200 });
      }
      if (attempt.kind === "missing") {
        throw new LeaderboardGateError(
          "BAD_ATTEMPT",
          "ranked submissions require a valid unexpired server-issued attempt",
        );
      }
    }

    // 8 — the U2 pure pipeline (full replay + re-sim run only past this point).
    const verdict = validateSubmission(submission, validationData);
    if (verdict.status === "rejected") {
      return withIdentitySession(validationError(verdict), identity);
    }

    if (
      verdict.challenge_type === DAILY_CHALLENGE_KIND &&
      verdict.challenge_date !== (deps.todayUtcDate ?? utcDateString)()
    ) {
      return withIdentitySession(
        NextResponse.json(
          {
            error: "BAD_ATTEMPT",
            message: "daily submissions are only open for today's UTC draft",
          },
          { status: SUBMIT_ERROR_HTTP_STATUS.BAD_ATTEMPT },
        ),
        identity,
      );
    }

    const username =
      identity.userId === null ? null : await publicUsernameForUser(deps.db, identity.userId);
    if (verdict.display_alias === null && username === null) {
      return withIdentitySession(
        NextResponse.json(
          {
            error: "INVALID_NAME",
            message: "a username or display alias is required for public board entries",
            name_reason: "not_a_string",
          },
          { status: SUBMIT_ERROR_HTTP_STATUS.INVALID_NAME },
        ),
        identity,
      );
    }

    // 9 — persist + honest dedupe; rank is a SECOND read after the insert
    // (current rank, not the insert's snapshot).
    const token = body.token as string;
    const result =
      submissionMode === "ranked"
        ? await deps.db.transaction(async (tx) => {
            if (identity.userId === null) {
              throw new LeaderboardGateError("AUTH_REQUIRED", RANKED_AUTH_REQUIRED_MESSAGE);
            }
            const duplicate = await findExistingRankedAttemptEntry(tx as Db, {
              seasonKey: verdict.season_key,
              formationId: verdict.token_body.fid,
              userId: identity.userId,
              token,
              draftMode: verdict.draft_mode,
              draftOrder: verdict.draft_order,
              era: verdict.era,
              ratingBasis: verdict.rating_basis,
            });
            if (duplicate) return { kind: "duplicate" as const, row: duplicate };

            const attempt = await consumeRankedAttempt(
              tx as Db,
              {
                seasonKey: verdict.season_key,
                formationId: verdict.token_body.fid,
                draftMode: verdict.draft_mode,
                draftOrder: verdict.draft_order,
                era: verdict.era,
                ratingBasis: verdict.rating_basis,
                userId: identity.userId,
                parentSeed: verdict.token_body.ps,
              },
              deps.now,
            );
            if (attempt === null) {
              // A concurrent identical submit can commit while this UPDATE is
              // waiting on its attempt row. Reconcile that winner from a new
              // READ COMMITTED statement snapshot before rejecting the loser.
              const concurrentDuplicate = await findExistingRankedAttemptEntry(tx as Db, {
                seasonKey: verdict.season_key,
                formationId: verdict.token_body.fid,
                userId: identity.userId,
                token,
                draftMode: verdict.draft_mode,
                draftOrder: verdict.draft_order,
                era: verdict.era,
                ratingBasis: verdict.rating_basis,
              });
              if (concurrentDuplicate) {
                return { kind: "duplicate" as const, row: concurrentDuplicate };
              }
              throw new LeaderboardGateError(
                "BAD_ATTEMPT",
                "ranked submissions require a valid unexpired server-issued attempt",
              );
            }
            return insertAcceptedEntry(
              tx as Db,
              {
                seasonKey: verdict.season_key,
                challengeType: verdict.challenge_type,
                challengeDate: verdict.challenge_date,
                ratingVersion: verdict.rating_version,
                mode: submissionMode,
                draftMode: verdict.draft_mode,
                draftOrder: verdict.draft_order,
                era: verdict.era,
                ratingBasis: verdict.rating_basis,
                userId: identity.userId,
                sessionId: identity.sessionId,
                displayAlias: verdict.display_alias,
                token,
                verifiedScore: verdict.verified_score,
                scoreBreakdown: verdict.score_breakdown,
                attemptId: attempt.id,
                attemptFormationId: verdict.token_body.fid,
                attemptConsumedAt: attempt.consumedAt,
              },
              deps.now,
            );
          })
        : await insertAcceptedEntry(
            deps.db,
            {
              seasonKey: verdict.season_key,
              challengeType: verdict.challenge_type,
              challengeDate: verdict.challenge_date,
              ratingVersion: verdict.rating_version,
              mode: submissionMode,
              draftMode: verdict.draft_mode,
              draftOrder: verdict.draft_order,
              era: verdict.era,
              ratingBasis: verdict.rating_basis,
              userId: identity.userId,
              sessionId: identity.sessionId,
              displayAlias: verdict.display_alias,
              token,
              verifiedScore: verdict.verified_score,
              scoreBreakdown: verdict.score_breakdown,
              attemptId: null,
              attemptFormationId: null,
              attemptConsumedAt: null,
            },
            deps.now,
          );
    const best = await identityBoardRank(deps.db, {
      seasonKey: verdict.season_key,
      challengeType: verdict.challenge_type,
      challengeDate: verdict.challenge_date,
      mode: submissionMode,
      draftMode: verdict.draft_mode,
      draftOrder: verdict.draft_order,
      era: verdict.era,
      ratingBasis: verdict.rating_basis,
      identityKey: result.row.userId ?? result.row.sessionId ?? result.row.id,
    });
    const responseBody: SubmitResponseBody = {
      entry: await toApiEntryWithProfile(deps.db, result.row),
      duplicate: result.kind === "duplicate",
      rank: best?.rank ?? null,
      percentile: best?.percentile ?? null,
      field_size: best?.fieldSize ?? null,
    };
    return withIdentitySession(
      NextResponse.json(responseBody, {
        status: result.kind === "duplicate" ? 200 : 201,
      }),
      identity,
    );
  } catch (err) {
    if (err instanceof LeaderboardGateError) {
      return withIdentitySession(
        NextResponse.json(
          {
            error: err.code,
            message: err.message,
            ...(err.code === "VERIFICATION_REQUIRED"
              ? { resend_verification: "/api/auth/resend-verification" }
              : {}),
          },
          { status: err.status },
        ),
        resolvedIdentity,
      );
    }
    return withIdentitySession(jsonError(err), resolvedIdentity);
  }
}

function withIdentitySession(
  response: NextResponse,
  identity: SubmitIdentity | null,
): NextResponse {
  if (identity?.freshSessionCookieValue && identity.csrfSecret) {
    setSessionCookie(response, identity.freshSessionCookieValue);
    setCsrfCookie(response, identity.csrfSecret);
    clearBootstrapCsrfCookie(response);
  }
  return response;
}

async function publicUsernameForUser(db: Db, userId: string): Promise<string | null> {
  const row = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row[0]?.username ?? null;
}

function gateDeps(deps: SubmitRouteDeps, mode: BoardMode): IdentityGateDeps {
  return {
    db: deps.db,
    now: deps.now,
    getCookieSecret: deps.getCookieSecret,
    requireAccount: () => mode === "ranked",
  };
}
