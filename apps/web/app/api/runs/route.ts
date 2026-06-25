// F-3 — GET (list) + POST (save) /api/runs
//
// GET  — newest-first list of the caller's saved_runs, account-scoped if
//        signed in, session-scoped if anon. Read-only, no CSRF gate.
// POST — save a replay token + metadata to the caller's scope. Mutating →
//        Origin/Host + CSRF double-submit required.
import { NextResponse, type NextRequest } from "next/server";
import { resolveAuth } from "@/lib/game/__server-auth-context";
import { saveRun, listRuns, SAVED_RUNS_CAP } from "@/lib/game/saved-runs-store";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  verifyCsrfDoubleSubmit,
  verifyOriginHost,
} from "@/lib/auth/csrf";
import { jsonError, readRequestCookie } from "@/lib/auth/handler-helpers";

interface SaveBody {
  token?: unknown;
  versionAnchors?: unknown;
  runId?: unknown;
  parentSeed?: unknown;
  summary?: unknown;
}

function isStringOrNull(x: unknown): x is string | null {
  return x === null || typeof x === "string";
}
function jsonObjOrNull(x: unknown): Record<string, unknown> | null {
  if (x === null || x === undefined) return null;
  if (typeof x === "object" && !Array.isArray(x)) return x as Record<string, unknown>;
  return null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await resolveAuth(req);
    const limitRaw = req.nextUrl.searchParams.get("limit");
    const limit = limitRaw
      ? Math.min(SAVED_RUNS_CAP, Math.max(0, Number(limitRaw)))
      : SAVED_RUNS_CAP;
    const rows = await listRuns(auth.ctx, auth.deps, { limit });
    return NextResponse.json({
      runs: rows.map(toApiShape),
      cap: SAVED_RUNS_CAP,
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await resolveAuth(req);
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

    const body = (await req.json().catch(() => null)) as SaveBody | null;
    if (!body || typeof body.token !== "string" || body.token.length < 4) {
      return NextResponse.json(
        { error: "TOKEN_MALFORMED", message: "token is required" },
        { status: 400 },
      );
    }
    const result = await saveRun(
      {
        token: body.token,
        versionAnchors: jsonObjOrNull(body.versionAnchors),
        runId: isStringOrNull(body.runId) ? body.runId : null,
        parentSeed: isStringOrNull(body.parentSeed) ? body.parentSeed : null,
        summary: coerceSummary(body.summary),
      },
      auth.ctx,
      auth.deps,
    );
    return NextResponse.json(
      {
        run: toApiShape(result.row),
        idempotent: result.idempotent,
        evicted: result.evicted,
      },
      { status: result.idempotent ? 200 : 201 },
    );
  } catch (err) {
    return jsonError(err);
  }
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
    created_at: row.createdAt.toISOString(),
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
  if (typeof o.team_name !== "string") return null;
  if (typeof o.display_record !== "string") return null;
  if (typeof o.formation_name !== "string") return null;
  if (typeof o.is_champion !== "boolean") return null;
  if (typeof o.seed !== "string") return null;
  if (!Array.isArray(o.key_picks)) return null;
  const key_picks = o.key_picks.filter(
    (p): p is { name: string; nation_code: string } =>
      !!p &&
      typeof p === "object" &&
      typeof (p as Record<string, unknown>).name === "string" &&
      typeof (p as Record<string, unknown>).nation_code === "string",
  );
  return {
    team_name: o.team_name,
    display_record: o.display_record,
    formation_name: o.formation_name,
    key_picks,
    is_champion: o.is_champion,
    seed: o.seed,
    created_seq: typeof o.created_seq === "number" ? o.created_seq : undefined,
    updated_seq: typeof o.updated_seq === "number" ? o.updated_seq : undefined,
  };
}

export { toApiShape };
export type { ApiRunShape };
