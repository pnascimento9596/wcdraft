import { NextResponse, type NextRequest } from "next/server";
import { leaderboardEntries, users, type Db } from "@wcdraft/db";
import { sql } from "drizzle-orm";

import type { ExpensiveVerifyRateLimiter } from "../game/expensive-verify-rate-limiter-db";
import { RUN_TOKEN_MAX_LEN } from "../game/run-token";
import { readClientIp } from "../http/client-ip";
import { readBoundedText } from "../http/read-bounded-text";
import { internalErrorResponse, rateLimitUnavailableResponse } from "../http/request-error-log";
import {
  deriveAndCacheLineupInspector,
  readCachedLineupInspector,
  type LineupInspectorRejectionReason,
} from "./lineup-inspector";
import type { LeaderboardLineupView, LeaderboardLineupWire } from "./lineup-view";
import type { ValidationData } from "./validate";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const MAX_LINEUP_BODY_BYTES = RUN_TOKEN_MAX_LEN + 512;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface LineupRouteDeps {
  readonly db: Db;
  readonly now: () => number;
  readonly getValidationData: () => ValidationData;
  readonly getRateLimiter: () => ExpensiveVerifyRateLimiter;
}

export async function handleLeaderboardLineupGet(
  req: NextRequest,
  deps: LineupRouteDeps,
): Promise<NextResponse<LeaderboardLineupWire | Record<string, unknown>>> {
  try {
    const q = req.nextUrl.searchParams;
    const entryId = q.get("entry_id");
    if (entryId === null || q.has("token")) {
      return errorResponse("INVALID_QUERY", "Pass entry_id for GET lineup inspection.", 400);
    }
    if (!UUID_RE.test(entryId)) {
      return errorResponse("INVALID_QUERY", "entry_id must be a UUID.", 400);
    }
    const entryToken = await visibleEntryTokenById(deps.db, entryId);
    if (entryToken === null) {
      return errorResponse("ENTRY_NOT_FOUND", "That leaderboard entry is not visible.", 404);
    }
    return resolveToken(req, entryToken, deps);
  } catch (err) {
    return internalErrorResponse("GET /api/leaderboard/lineup", err);
  }
}

export async function handleLeaderboardLineupPost(
  request: Request,
  deps: LineupRouteDeps,
): Promise<NextResponse<LeaderboardLineupWire | Record<string, unknown>>> {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_LINEUP_BODY_BYTES) {
      return errorResponse("BODY_TOO_LARGE", "The lineup request body is too large.", 413);
    }
    const bodyRead = await readBoundedText(request, MAX_LINEUP_BODY_BYTES);
    if (bodyRead.status === "too_large") {
      return errorResponse("BODY_TOO_LARGE", "The lineup request body is too large.", 413);
    }
    if (bodyRead.status === "invalid") {
      return errorResponse("INVALID_BODY", "The lineup request body could not be read.", 400);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyRead.value);
    } catch {
      return errorResponse("INVALID_JSON", "The lineup request body is not valid JSON.", 400);
    }
    const token =
      parsed !== null && typeof parsed === "object"
        ? (parsed as { token?: unknown }).token
        : undefined;
    if (typeof token !== "string" || token.length === 0 || token.length > RUN_TOKEN_MAX_LEN) {
      return errorResponse("INVALID_BODY", "token is not a supported run token.", 400);
    }
    return resolveToken(request, token, deps);
  } catch (err) {
    return internalErrorResponse("POST /api/leaderboard/lineup", err);
  }
}

async function resolveToken(
  request: Pick<Request, "headers">,
  token: string,
  deps: LineupRouteDeps,
): Promise<NextResponse<LeaderboardLineupWire | Record<string, unknown>>> {
  const data = deps.getValidationData();
  const cached = readCachedLineupInspector(token, data);
  if (cached) {
    return successResponse(cached.view, true);
  }

  const decision = await deps.getRateLimiter().check({ ip: readClientIp(request) });
  if (!decision.allowed) {
    if (decision.reason === "store_unavailable") {
      return rateLimitUnavailableResponse({
        correlationId: decision.correlationId,
        retryAfterSeconds: decision.retryAfterSeconds,
        okFalse: true,
      });
    }
    return NextResponse.json(
      {
        ok: false,
        error: "RATE_LIMITED",
        message: "Too many lineup inspections. Try again shortly.",
      },
      {
        status: 429,
        headers: { ...NO_STORE, "Retry-After": String(decision.retryAfterSeconds) },
      },
    );
  }

  const result = deriveAndCacheLineupInspector(token, data);
  if (result.status === "rejected") {
    return inspectorError(result.reason);
  }
  return successResponse(result.view, result.cacheHit);
}

async function visibleEntryTokenById(db: Db, entryId: string): Promise<string | null> {
  const result = await db.execute<{ token: string }>(sql`
    SELECT ${leaderboardEntries.token} AS token
      FROM ${leaderboardEntries}
      LEFT JOIN ${users} ON ${users.id} = ${leaderboardEntries.userId}
     WHERE ${leaderboardEntries.id} = ${entryId}::uuid
       AND ${leaderboardEntries.hiddenAt} IS NULL
       AND COALESCE(${leaderboardEntries.displayAlias}, ${users.username}) IS NOT NULL
     LIMIT 1
  `);
  return result.rows[0]?.token ?? null;
}

function successResponse(
  lineup: LeaderboardLineupView,
  cacheHit: boolean,
): NextResponse<LeaderboardLineupWire> {
  return NextResponse.json(
    { ok: true, lineup },
    {
      status: 200,
      headers: { ...NO_STORE, "X-WCDraft-Lineup-Cache": cacheHit ? "hit" : "miss" },
    },
  );
}

function inspectorError(
  reason: LineupInspectorRejectionReason,
): NextResponse<LeaderboardLineupWire> {
  switch (reason) {
    case "MALFORMED_TOKEN":
      return errorResponse("MALFORMED_TOKEN", "The run token is malformed or truncated.", 400);
    case "UNSUPPORTED_TOKEN":
      return errorResponse(
        "UNSUPPORTED_TOKEN",
        "Leaderboard lineups require a current t3 run token.",
        422,
      );
    case "DIFFERENT_BUILD":
      return errorResponse(
        "DIFFERENT_BUILD",
        "This run was created on a different build, so it cannot be inspected here.",
        404,
      );
    case "ILLEGAL_PICK":
      return errorResponse(
        "ILLEGAL_PICK",
        "The run token contains a pick that cannot replay.",
        422,
      );
    case "SIM_FAILURE":
      return errorResponse("SIM_FAILURE", "The verified run could not be replayed.", 500);
  }
}

function errorResponse(
  error: string,
  message: string,
  status: number,
): NextResponse<LeaderboardLineupWire> {
  return NextResponse.json({ ok: false, error, message }, { status, headers: NO_STORE });
}
