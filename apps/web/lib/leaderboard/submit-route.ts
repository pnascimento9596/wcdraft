// F-4 U3 — POST /api/leaderboard/submit handler (thin server lib).
//
// GATE ORDER (locked; tests assert it):
//   0. feature flag                  — in the route FILE, before deps exist
//   1. method                        — only POST is exported by the route file
//   2. content-type / body size      — 415 / 413, before any parse
//   3. JSON shape + mode             — 400 INVALID_BODY / 403 BAD_ATTEMPT
//   4. identity gate (plan §5.3)     — 401 AUTH_REQUIRED / 403 CSRF_FAILED
//   5. rate-limit SEAM (U5 plugs in) — 429 RATE_LIMITED + Retry-After
//   6. validateSubmission (U2)       — steps 1–3, 5, 7–9; SUBMIT_ERROR_HTTP_STATUS
//   7. insert (NULLS-NOT-DISTINCT dedupe) → 201 inserted / 200 duplicate
//
// Honest-state: the persisted score is the SERVER's re-sim, the returned
// rank is computed by the DB in the same snapshot as the insert (null when
// the identity has no visible entry), nulls stay null, and every error is a
// typed code — never prose-only.

import { NextResponse, type NextRequest } from "next/server";
import type { Db } from "@wcdraft/db";

import { readClientIp } from "../auth/handler-helpers";
import {
  LeaderboardGateError,
  requireSubmitIdentity,
  type IdentityGateDeps,
} from "./identity-gate";
import {
  identityBoardRank,
  insertAcceptedEntry,
  toApiEntry,
  type ApiLeaderboardEntry,
} from "./store";
import type { SubmitRateLimiter } from "./submit-rate-limit";
import {
  SUBMIT_ERROR_HTTP_STATUS,
  validateSubmission,
  type ValidationData,
} from "./validate";

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
  readonly requireAccount: () => boolean;
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

export interface SubmitResponseBody {
  readonly entry: ApiLeaderboardEntry;
  readonly duplicate: boolean;
  /** Identity's CURRENT board rank (season+mode view), same DB snapshot as
   *  the insert. Null only if the identity has no visible entry. */
  readonly rank: number | null;
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
    if (raw.length > MAX_SUBMIT_BODY_BYTES) {
      return transportError("BODY_TOO_LARGE", `body exceeds ${MAX_SUBMIT_BODY_BYTES} bytes`);
    }

    // 3 — JSON object shape + mode. Ranked is a DARK lane in U3: the token
    // mint/consume flow does not exist yet, so a ranked submission is an
    // out-of-protocol attempt, not an invalid body.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return transportError("INVALID_BODY", "body is not valid JSON");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return transportError("INVALID_BODY", "body must be a JSON object");
    }
    const body = parsed as Record<string, unknown>;
    const mode = body.mode ?? "casual";
    if (mode === "ranked") {
      return NextResponse.json(
        { error: "BAD_ATTEMPT", message: "ranked submissions are not open" },
        { status: SUBMIT_ERROR_HTTP_STATUS.BAD_ATTEMPT },
      );
    }
    if (mode !== "casual") {
      return transportError("INVALID_BODY", "mode must be 'casual'");
    }

    // 4 — identity gate (throws LeaderboardGateError).
    const identity = await requireSubmitIdentity(req, gateDeps(deps));

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
        display_name: body.display_name,
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

    // 7 — persist + honest dedupe; rank from the same snapshot.
    const result = await insertAcceptedEntry(
      deps.db,
      {
        seasonKey: verdict.season_key,
        mode: "casual",
        draftMode: verdict.draft_mode,
        userId: identity.userId,
        sessionId: identity.sessionId,
        displayName: verdict.display_name,
        // validateSubmission guaranteed this is a string (step 1).
        token: body.token as string,
        verifiedScore: verdict.verified_score,
        scoreBreakdown: verdict.score_breakdown,
      },
      deps.now,
    );
    const best = await identityBoardRank(deps.db, {
      seasonKey: verdict.season_key,
      mode: "casual",
      identityKey:
        result.row.userId ?? result.row.sessionId ?? result.row.id,
    });
    const responseBody: SubmitResponseBody = {
      entry: toApiEntry(result.row),
      duplicate: result.kind === "duplicate",
      rank: best?.rank ?? null,
    };
    return NextResponse.json(responseBody, {
      status: result.kind === "inserted" ? 201 : 200,
    });
  } catch (err) {
    if (err instanceof LeaderboardGateError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.status },
      );
    }
    console.error("[leaderboard] unexpected submit error", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

function gateDeps(deps: SubmitRouteDeps): IdentityGateDeps {
  return {
    db: deps.db,
    now: deps.now,
    getCookieSecret: deps.getCookieSecret,
    requireAccount: deps.requireAccount,
  };
}
