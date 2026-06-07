// F-3 — GET + DELETE /api/runs/[id]
//
// Own-only: the store's `getRun` / `deleteRun` apply the scope predicate
// before fetching, so a user can never see (or delete) another user's
// row. Returns 404 (not 403) for "not found in your scope" so we don't
// leak existence.
import { NextResponse, type NextRequest } from "next/server";
import { resolveAuth } from "@/lib/game/__server-auth-context";
import { getRun, deleteRun } from "@/lib/game/saved-runs-store";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  verifyCsrfDoubleSubmit,
  verifyOriginHost,
} from "@/lib/auth/csrf";
import { jsonError, readRequestCookie } from "@/lib/auth/handler-helpers";
import { toApiShape } from "../route";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  req: NextRequest,
  ctx: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    const auth = await resolveAuth(req);
    const row = await getRun(id, auth.ctx, auth.deps);
    if (!row) {
      return NextResponse.json(
        { error: "NOT_FOUND" },
        { status: 404 },
      );
    }
    return NextResponse.json({ run: toApiShape(row) });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
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
    const deleted = await deleteRun(id, auth.ctx, auth.deps);
    if (!deleted) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
