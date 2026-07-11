// F-3 — GET (list) + POST (save) /api/runs
//
// GET  — newest-first list of the caller's saved_runs, account-scoped if
//        signed in, session-scoped if anon. Read-only, no CSRF gate.
// POST — save a replay token + metadata to the caller's scope. Mutating →
//        Origin/Host + CSRF double-submit required.
import { NextResponse, type NextRequest } from "next/server";
import { resolveAuth, resolveMutationAuth } from "@/lib/game/__server-auth-context";
import {
  ACCOUNT_SAVED_RUNS_CAP,
  ANON_SAVED_RUNS_CAP,
  SavedRunQuotaError,
  listRuns,
  readSavedRunQuota,
  saveRun,
  setRunPinnedByRunId,
} from "@/lib/game/saved-runs-store";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  verifyCsrfDoubleSubmit,
  verifyOriginHost,
} from "@/lib/auth/csrf";
import {
  clearBootstrapCsrfCookie,
  jsonError,
  readRequestCookie,
  setCsrfCookie,
  setSessionCookie,
} from "@/lib/auth/handler-helpers";
import {
  BoundedBodyError,
  boundedPlainObject,
  nullableBoundedString,
  requireJsonObject,
  validateJsonRequestMetadata,
} from "@/lib/http/bounded-body";
import { RUN_TOKEN_MAX_LEN } from "@/lib/game/run-token";

interface SaveBody {
  token?: unknown;
  versionAnchors?: unknown;
  runId?: unknown;
  parentSeed?: unknown;
  summary?: unknown;
  pinned?: unknown;
}

interface PinBody {
  runId?: unknown;
  pinned?: unknown;
}

const MAX_SAVE_RUN_BODY_BYTES = RUN_TOKEN_MAX_LEN + 12 * 1024;
const MAX_RUN_ID_CHARS = 128;
const MAX_PARENT_SEED_CHARS = 256;
const MAX_SUMMARY_TEXT_CHARS = 256;
const MAX_SUMMARY_RECORD_CHARS = 32;
const MAX_KEY_PICKS = 8;

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await resolveAuth(req);
    const cap = auth.ctx.userId === null ? ANON_SAVED_RUNS_CAP : ACCOUNT_SAVED_RUNS_CAP;
    const limitRaw = req.nextUrl.searchParams.get("limit");
    const limit = limitRaw ? Math.min(cap, Math.max(0, Number(limitRaw))) : cap;
    const rows = await listRuns(auth.ctx, auth.deps, { limit });
    const quota = await readSavedRunQuota(auth.ctx, auth.deps);
    return NextResponse.json({
      runs: rows.map(toApiShape),
      cap,
      quota: toQuotaShape(quota),
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let freshSession: Awaited<ReturnType<typeof resolveMutationAuth>>["freshSession"] = null;
  try {
    const auth = await resolveMutationAuth(req);
    freshSession = auth.freshSession;
    verifyOriginHost({
      origin: req.headers.get("origin"),
      referer: req.headers.get("referer"),
      host: req.headers.get("host"),
    });
    verifyCsrfDoubleSubmit({
      cookieValue: readRequestCookie(req, CSRF_COOKIE_NAME),
      headerValue: req.headers.get(CSRF_HEADER_NAME),
      sessionCsrfSecret: auth.csrfSecret,
    });

    const bodyOptions = {
      maxBytes: MAX_SAVE_RUN_BODY_BYTES,
      allowedContentTypes: ["application/json"],
    } as const;
    validateJsonRequestMetadata(req, bodyOptions);
    if (auth.ctx.userId !== null) {
      const quota = await readSavedRunQuota(auth.ctx, auth.deps);
      if (quota.usedBytes >= quota.maxBytes) {
        // Identifying an idempotent token would itself require consuming and
        // parsing the body. At the byte ceiling the cost firewall therefore
        // rejects every save attempt before body read; saveRun retains the
        // locked post-parse check for near-cap requests and concurrent writes.
        throw new SavedRunQuotaError();
      }
    }

    const body = (await requireJsonObject(req, {
      ...bodyOptions,
    })) as SaveBody;
    if (typeof body.token !== "string" || body.token.length < 4) {
      return attachFreshSession(
        NextResponse.json(
          { error: "TOKEN_MALFORMED", message: "token is required" },
          { status: 400 },
        ),
        freshSession,
      );
    }
    if (body.token.length > RUN_TOKEN_MAX_LEN) {
      return attachFreshSession(
        NextResponse.json(
          { error: "TOKEN_TOO_LARGE", message: `token exceeds ${RUN_TOKEN_MAX_LEN} chars` },
          { status: 400 },
        ),
        freshSession,
      );
    }
    const result = await saveRun(
      {
        token: body.token,
        versionAnchors: boundedPlainObject(body.versionAnchors, {
          field: "versionAnchors",
          maxKeys: 16,
        }),
        runId: nullableBoundedString(body.runId, {
          field: "runId",
          maxChars: MAX_RUN_ID_CHARS,
          allowEmpty: true,
        }),
        parentSeed: nullableBoundedString(body.parentSeed, {
          field: "parentSeed",
          maxChars: MAX_PARENT_SEED_CHARS,
          allowEmpty: true,
        }),
        summary: coerceSummary(body.summary),
        pinned: body.pinned === true,
      },
      auth.ctx,
      auth.deps,
    );
    const response = NextResponse.json(
      {
        run: toApiShape(result.row),
        idempotent: result.idempotent,
        evicted: result.evicted,
        quota: toQuotaShape(result.quota),
      },
      { status: result.idempotent ? 200 : 201 },
    );
    return attachFreshSession(response, freshSession);
  } catch (err) {
    if (err instanceof SavedRunQuotaError) {
      return attachFreshSession(
        NextResponse.json({ error: err.code, message: err.message }, { status: err.status }),
        freshSession,
      );
    }
    return attachFreshSession(jsonError(err), freshSession);
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  let freshSession: Awaited<ReturnType<typeof resolveMutationAuth>>["freshSession"] = null;
  try {
    const auth = await resolveMutationAuth(req);
    freshSession = auth.freshSession;
    verifyOriginHost({
      origin: req.headers.get("origin"),
      referer: req.headers.get("referer"),
      host: req.headers.get("host"),
    });
    verifyCsrfDoubleSubmit({
      cookieValue: readRequestCookie(req, CSRF_COOKIE_NAME),
      headerValue: req.headers.get(CSRF_HEADER_NAME),
      sessionCsrfSecret: auth.csrfSecret,
    });
    const body = (await requireJsonObject(req, {
      maxBytes: 1024,
      allowedContentTypes: ["application/json"],
    })) as PinBody;
    if (typeof body.runId !== "string" || body.runId.length === 0 || body.runId.length > 128) {
      throw new BoundedBodyError("INVALID_BODY", "runId is required");
    }
    if (typeof body.pinned !== "boolean") {
      throw new BoundedBodyError("INVALID_BODY", "pinned must be boolean");
    }
    const result = await setRunPinnedByRunId(body.runId, body.pinned, auth.ctx, auth.deps);
    const response = NextResponse.json({
      ok: true,
      updated: result.updated,
      quota: toQuotaShape(result.quota),
    });
    return attachFreshSession(response, freshSession);
  } catch (err) {
    return attachFreshSession(jsonError(err), freshSession);
  }
}

function attachFreshSession(
  response: NextResponse,
  freshSession: Awaited<ReturnType<typeof resolveMutationAuth>>["freshSession"],
): NextResponse {
  if (freshSession) {
    setSessionCookie(response, freshSession.cookieValue);
    setCsrfCookie(response, freshSession.csrfSecret);
    clearBootstrapCsrfCookie(response);
  }
  return response;
}

interface ApiRunShape {
  id: string;
  token: string;
  run_id: string | null;
  parent_seed: string | null;
  version_anchors: unknown;
  /** F-3.5 display summary. Null on pre-F-3.5 rows; client renders "—". */
  summary: unknown;
  claim_state: string;
  payload_bytes: number;
  pinned: boolean;
  created_at: string;
}

function toApiShape(row: {
  id: string;
  token: string;
  runId: string | null;
  parentSeed: string | null;
  versionAnchors: unknown;
  summary: unknown;
  claimState: string;
  payloadBytes: number;
  pinnedAt: Date | null;
  createdAt: Date;
}): ApiRunShape {
  return {
    id: row.id,
    token: row.token,
    run_id: row.runId,
    parent_seed: row.parentSeed,
    version_anchors: row.versionAnchors,
    summary: row.summary ?? null,
    claim_state: row.claimState,
    payload_bytes: row.payloadBytes,
    pinned: row.pinnedAt !== null,
    created_at: row.createdAt.toISOString(),
  };
}

function toQuotaShape(quota: import("@/lib/game/saved-runs-store").SavedRunQuota) {
  return {
    max_rows: quota.maxRows,
    max_bytes: quota.maxBytes,
    used_rows: quota.usedRows,
    used_bytes: quota.usedBytes,
  };
}

/**
 * Tolerant coercion: the server treats summary as opaque jsonb but we still
 * gate at the API layer so a malformed body can't poison the column with
 * non-objects. Strict structural validation lives client-side; here we only
 * reject "this isn't a plain object" cases.
 */
function coerceSummary(x: unknown): import("@/lib/game/saved-runs-store").SavedRunSummary | null {
  if (x === null || x === undefined) return null;
  if (typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const team_name = nullableBoundedString(o.team_name, {
    field: "summary.team_name",
    maxChars: MAX_SUMMARY_TEXT_CHARS,
  });
  const display_record = nullableBoundedString(o.display_record, {
    field: "summary.display_record",
    maxChars: MAX_SUMMARY_RECORD_CHARS,
  });
  const formation_name = nullableBoundedString(o.formation_name, {
    field: "summary.formation_name",
    maxChars: MAX_SUMMARY_TEXT_CHARS,
  });
  const seed = nullableBoundedString(o.seed, {
    field: "summary.seed",
    maxChars: MAX_PARENT_SEED_CHARS,
  });
  if (team_name === null) return null;
  if (display_record === null) return null;
  if (formation_name === null) return null;
  if (typeof o.is_champion !== "boolean") return null;
  if (seed === null) return null;
  if (!Array.isArray(o.key_picks)) return null;
  if (o.key_picks.length > MAX_KEY_PICKS) {
    throw new BoundedBodyError("INVALID_BODY", `summary.key_picks exceeds ${MAX_KEY_PICKS} items`);
  }
  const key_picks = o.key_picks.flatMap((p): Array<{ name: string; nation_code: string }> => {
    if (!p || typeof p !== "object") return [];
    const pick = p as Record<string, unknown>;
    const name = nullableBoundedString(pick.name, {
      field: "summary.key_picks.name",
      maxChars: MAX_SUMMARY_TEXT_CHARS,
    });
    const nation_code = nullableBoundedString(pick.nation_code, {
      field: "summary.key_picks.nation_code",
      maxChars: 16,
    });
    return name !== null && nation_code !== null ? [{ name, nation_code }] : [];
  });
  return {
    team_name,
    display_record,
    score: finiteNumber(o.score),
    wins: finiteNumber(o.wins),
    draws: finiteNumber(o.draws),
    losses: finiteNumber(o.losses),
    undefeated_regulation:
      typeof o.undefeated_regulation === "boolean" ? o.undefeated_regulation : undefined,
    formation_name,
    draft_mode:
      o.draft_mode === "classic" ||
      o.draft_mode === "hidden" ||
      o.draft_mode === "open" ||
      o.draft_mode === "open_hidden"
        ? o.draft_mode
        : undefined,
    draft_order:
      o.draft_order === "squad_first" || o.draft_order === "position_first"
        ? o.draft_order
        : undefined,
    era_preset:
      o.era_preset === "all_time" ||
      o.era_preset === "post_2000" ||
      o.era_preset === "post_2010" ||
      o.era_preset === "modern"
        ? o.era_preset
        : undefined,
    rating_basis:
      o.rating_basis === "career" || o.rating_basis === "current" ? o.rating_basis : undefined,
    key_picks,
    is_champion: o.is_champion,
    is_perfect_eight_zero:
      typeof o.is_perfect_eight_zero === "boolean" ? o.is_perfect_eight_zero : undefined,
    reached_round:
      typeof o.reached_round === "string" && o.reached_round.length <= 16
        ? o.reached_round
        : undefined,
    matches_played: finiteNumber(o.matches_played),
    challenge_date:
      typeof o.challenge_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.challenge_date)
        ? o.challenge_date
        : null,
    seed,
    created_seq: typeof o.created_seq === "number" ? o.created_seq : undefined,
    updated_seq: typeof o.updated_seq === "number" ? o.updated_seq : undefined,
  };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export { toApiShape };
export type { ApiRunShape };
