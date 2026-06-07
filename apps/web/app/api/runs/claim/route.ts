// F-3 — POST /api/runs/claim
//
// Explicit retry surface for the anon→account claim. The implicit claim
// already fires inside the F-2 verify POST (via consumeAndIssueSession's
// `onAuthenticatedSessionReady` hook); this endpoint is for the
// rare case where the implicit claim was a no-op (e.g. anon rows
// were saved AFTER sign-in but BEFORE the cookie rotated, which can
// happen with concurrent tabs) or the hook errored and the user
// wants a clean retry.
//
// Auth: requires a signed-in session (anon caller → ANON_FORBIDDEN).
// Mutating: Origin/Host + CSRF double-submit required.
import { NextResponse, type NextRequest } from "next/server";
import { resolveAuth } from "@/lib/game/__server-auth-context";
import { claimAnonRuns } from "@/lib/game/saved-runs-store";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  verifyCsrfDoubleSubmit,
  verifyOriginHost,
} from "@/lib/auth/csrf";
import { AuthError } from "@/lib/auth/errors";
import { jsonError, readRequestCookie } from "@/lib/auth/handler-helpers";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await resolveAuth(req);
    if (auth.ctx.userId === null) {
      throw new AuthError("ANON_FORBIDDEN", "anonymous callers cannot claim");
    }
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
    const result = await claimAnonRuns(
      { sessionId: auth.ctx.sessionId, userId: auth.ctx.userId },
      auth.deps,
    );
    return NextResponse.json({
      transferred: result.transferred,
      dropped: result.dropped,
    });
  } catch (err) {
    return jsonError(err);
  }
}
