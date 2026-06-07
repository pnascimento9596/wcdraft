// F-3 — GET (list) + POST (save) /api/runs
//
// GET  — newest-first list of the caller's saved_runs, account-scoped if
//        signed in, session-scoped if anon. Read-only, no CSRF gate.
// POST — save a `t1.*` token + metadata to the caller's scope. Mutating →
//        Origin/Host + CSRF double-submit required.
import { NextResponse, type NextRequest } from "next/server";
import { resolveAuth } from "@/lib/game/__server-auth-context";
import {
  saveRun,
  listRuns,
  SAVED_RUNS_CAP,
} from "@/lib/game/saved-runs-store";
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
    const limit = limitRaw ? Math.min(SAVED_RUNS_CAP, Math.max(0, Number(limitRaw))) : SAVED_RUNS_CAP;
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
  claim_state: string;
  created_at: string;
}

function toApiShape(row: {
  id: string;
  token: string;
  runId: string | null;
  parentSeed: string | null;
  versionAnchors: unknown;
  claimState: string;
  createdAt: Date;
}): ApiRunShape {
  return {
    id: row.id,
    token: row.token,
    run_id: row.runId,
    parent_seed: row.parentSeed,
    version_anchors: row.versionAnchors,
    claim_state: row.claimState,
    created_at: row.createdAt.toISOString(),
  };
}

export { toApiShape };
export type { ApiRunShape };
