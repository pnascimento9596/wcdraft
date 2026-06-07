// F-2 — /api/auth/session
//
// GET    → current session info {userId, isAnonymous, expiresAt}.
// DELETE → sign-out. Requires CSRF + Origin/Host. Clears cookies.
//
// GET intentionally does NOT mint an anon session — call /api/auth/csrf for
// that. This endpoint reads-or-zero.
import { NextResponse, type NextRequest } from "next/server";
import { validateSessionCookie, deleteSession } from "@/lib/auth/sessions";
import { verifyCsrfDoubleSubmit, verifyOriginHost, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/lib/auth/csrf";
import { AuthError } from "@/lib/auth/errors";
import {
  buildRuntimeDeps,
  clearSessionCookie,
  jsonError,
  readRequestCookie,
} from "@/lib/auth/handler-helpers";
import { SESSION_COOKIE_NAME } from "@/lib/auth/sessions";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const deps = buildRuntimeDeps();
    const cookie = readRequestCookie(req, SESSION_COOKIE_NAME);
    if (!cookie) {
      return NextResponse.json({ session: null });
    }
    try {
      const session = await validateSessionCookie(cookie, deps);
      return NextResponse.json({
        session: {
          userId: session.userId,
          isAnonymous: session.userId === null,
          expiresAt: session.expiresAt.toISOString(),
        },
      });
    } catch (e) {
      if (e instanceof AuthError) {
        return NextResponse.json({ session: null });
      }
      throw e;
    }
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const deps = buildRuntimeDeps();
    verifyOriginHost({
      origin: req.headers.get("origin"),
      referer: req.headers.get("referer"),
      host: req.headers.get("host"),
    });
    const cookie = readRequestCookie(req, SESSION_COOKIE_NAME);
    if (!cookie) {
      throw new AuthError("SESSION_INVALID");
    }
    const session = await validateSessionCookie(cookie, deps);
    verifyCsrfDoubleSubmit({
      cookieValue: readRequestCookie(req, CSRF_COOKIE_NAME),
      headerValue: req.headers.get(CSRF_HEADER_NAME),
      sessionCsrfSecret: session.csrfSecret,
    });
    await deleteSession(session.id, deps);
    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response);
    return response;
  } catch (err) {
    return jsonError(err);
  }
}
