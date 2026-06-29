// F-4 U3 — POST /api/leaderboard/submit handler (thin server lib).
//
// GATE ORDER (locked; tests assert it):
//   0. feature flag                  — in the route FILE, before deps exist
//   1. method                        — only POST is exported by the route file
//   2. content-type / body size      — 415 / 413, before any parse
//   3. JSON shape + mode             — 400 INVALID_BODY
//   4. identity gate                 — ranked requires account;
//                                      401 AUTH_REQUIRED / 403 CSRF_FAILED
//   5. rate-limit SEAM (U5 plugs in) — 429 RATE_LIMITED + Retry-After
//   6. validateSubmission (U2)       — steps 1–3, 5, 7–9; SUBMIT_ERROR_HTTP_STATUS
//   7. insert (NULLS-NOT-DISTINCT dedupe) → 201 inserted / 200 duplicate
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
import { DAILY_CHALLENGE_KIND, utcDateString } from "../game/daily";
import {
  LeaderboardGateError,
  RANKED_AUTH_REQUIRED_MESSAGE,
  requireSubmitIdentity,
  type IdentityGateDeps,
} from "./identity-gate";
import {
  identityBoardRank,
  insertAcceptedEntry,
  toApiEntryWithProfile,
  type ApiLeaderboardEntry,
  type BoardMode,
} from "./store";
import { consumeRankedAttempt, findExistingRankedAttemptEntry } from "./ranked-attempts";
import type { SubmitRateLimiter } from "./submit-rate-limit";
import { SUBMIT_ERROR_HTTP_STATUS, validateSubmission, type ValidationData } from "./validate";

/** Generous bound over the worst legitimate body: token ≤ 8192 chars + name
 *  + integer score + JSON envelope. Checked on declared AND actual size. */
export const MAX_SUBMIT_BODY_BYTES = 16 * 1024;

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
  try {
    // 2 — content-type, then declared + actual size, before any JSON work.
    const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.includes("application/json")) {
      return transportError("UNSUPPORTED_MEDIA_TYPE", "content-type must be application/json");
    }
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_SUBMIT_BODY_BYTES) {
      return transportError("BODY_TOO_LARGE", `body exceeds ${MAX_SUBMIT_BODY_BYTES} bytes`);
    }
    const raw = await req.text();
    // Byte length, not char count — multi-byte chars made `raw.length`
    // under-count the actual wire size.
    if (new TextEncoder().encode(raw).length > MAX_SUBMIT_BODY_BYTES) {
      return transportError("BODY_TOO_LARGE", `body exceeds ${MAX_SUBMIT_BODY_BYTES} bytes`);
    }

    // 3 — JSON object shape + mode. Ranked is open only to account-bound
    // sessions; casual remains anonymous-capable.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return transportError("INVALID_BODY", "body is not valid JSON");
    }
    const bodyResult = SubmitBodySchema.safeParse(parsed);
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

    // 5 — rate-limit seam (deny-nothing default in U3; U5 implements).
    const decision = await deps.rateLimiter.checkSubmit({
      sessionId: identity.sessionId,
      userId: identity.userId,
      ip: readClientIp(req),
    });
    if (!decision.allowed) {
      const res = NextResponse.json(
        { error: "RATE_LIMITED", message: "too many submissions" },
        { status: SUBMIT_ERROR_HTTP_STATUS.RATE_LIMITED },
      );
      res.headers.set("Retry-After", String(decision.retryAfterSeconds));
      return res;
    }

    // 6 — the U2 pure pipeline (replay + re-sim run only past this point).
    const verdict = validateSubmission(
      {
        token: body.token,
        claimed_score: body.claimed_score,
        draft_mode: body.draft_mode,
        display_alias: body.display_alias,
        display_name: body.display_name,
        challenge: body.challenge,
        challenge_date: body.challenge_date,
      },
      deps.getValidation(),
    );
    if (verdict.status === "rejected") {
      if (verdict.code === "SIM_FAILURE") {
        // Contract bug (re-sim threw after a successful replay) — alert,
        // never persist. The 500 mapping is deliberate.
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

    if (
      verdict.challenge_type === DAILY_CHALLENGE_KIND &&
      verdict.challenge_date !== (deps.todayUtcDate ?? utcDateString)()
    ) {
      return NextResponse.json(
        {
          error: "BAD_ATTEMPT",
          message: "daily submissions are only open for today's UTC draft",
        },
        { status: SUBMIT_ERROR_HTTP_STATUS.BAD_ATTEMPT },
      );
    }

    const username =
      identity.userId === null ? null : await publicUsernameForUser(deps.db, identity.userId);
    if (verdict.display_alias === null && username === null) {
      return NextResponse.json(
        {
          error: "INVALID_NAME",
          message: "a username or display alias is required for public board entries",
          name_reason: "not_a_string",
        },
        { status: SUBMIT_ERROR_HTTP_STATUS.INVALID_NAME },
      );
    }

    // 7 — persist + honest dedupe; rank is a SECOND read after the insert
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
    return NextResponse.json(responseBody, {
      status: result.kind === "duplicate" ? 200 : 201,
    });
  } catch (err) {
    if (err instanceof LeaderboardGateError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error("[leaderboard] unexpected submit error", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
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
