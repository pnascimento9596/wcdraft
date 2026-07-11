// Optional password login. Magic-link auth remains first-class; this route
// only verifies an existing password hash and then uses the shared session
// issuance path from the magic-link verifier.
import { NextResponse, type NextRequest } from "next/server";

import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  verifyCsrfDoubleSubmit,
  verifyOriginHost,
} from "@/lib/auth/csrf";
import { AuthError } from "@/lib/auth/errors";
import {
  buildRuntimeDeps,
  clearBootstrapCsrfCookie,
  ensureMutationSession,
  jsonError,
  readRequestCookie,
  setCsrfCookie,
  setSessionCookie,
} from "@/lib/auth/handler-helpers";
import { isAuthEnabled } from "@/lib/auth/auth-enabled";
import { authenticatePassword } from "@/lib/auth/passwords";
import { issueAuthenticatedSession } from "@/lib/auth/session-issue";
import { safeNextPath } from "@/lib/auth/safe-next-path";
import { claimAnonArtifacts } from "@/lib/leaderboard/claim";
import { readClientIp } from "@/lib/http/client-ip";
import { requireJsonObject } from "@/lib/http/bounded-body";

export const runtime = "nodejs";

interface RequestBody {
  identifier?: unknown;
  email?: unknown;
  password?: unknown;
  next?: unknown;
}

const MAX_PASSWORD_LOGIN_BODY_BYTES = 4 * 1024;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let freshSession: { readonly cookieValue: string; readonly csrfSecret: string } | null = null;
  try {
    if (!isAuthEnabled()) {
      throw new AuthError("AUTH_DISABLED", "Auth feature is not enabled.");
    }
    const deps = buildRuntimeDeps();
    verifyOriginHost({
      origin: req.headers.get("origin"),
      referer: req.headers.get("referer"),
      host: req.headers.get("host"),
    });
    const { session, fresh, cookieValue } = await ensureMutationSession(req, deps);
    if (fresh) freshSession = { cookieValue, csrfSecret: session.csrfSecret };
    verifyCsrfDoubleSubmit({
      cookieValue: readRequestCookie(req, CSRF_COOKIE_NAME),
      headerValue: req.headers.get(CSRF_HEADER_NAME),
      sessionCsrfSecret: session.csrfSecret,
    });

    const body = (await requireJsonObject(req, {
      maxBytes: MAX_PASSWORD_LOGIN_BODY_BYTES,
      allowedContentTypes: ["application/json"],
    })) as RequestBody;
    const { user } = await authenticatePassword(
      {
        identifier: body.identifier ?? body.email,
        password: body.password,
        ipAddress: readClientIp(req),
      },
      deps,
    );
    const issued = await issueAuthenticatedSession(
      {
        session,
        userId: user.id,
        onAuthenticatedSessionReady: async ({ sessionId, userId }) => {
          await claimAnonArtifacts({ sessionId, userId }, { db: deps.db });
        },
      },
      deps,
    );
    const response = NextResponse.json({
      ok: true,
      redirectTo: safeNextPath(typeof body.next === "string" ? body.next : null),
    });
    setSessionCookie(response, issued.sessionCookieValue);
    setCsrfCookie(response, issued.csrfSecret);
    clearBootstrapCsrfCookie(response);
    return response;
  } catch (err) {
    const response = jsonError(err);
    if (freshSession) {
      setSessionCookie(response, freshSession.cookieValue);
      setCsrfCookie(response, freshSession.csrfSecret);
      clearBootstrapCsrfCookie(response);
    }
    return response;
  }
}
