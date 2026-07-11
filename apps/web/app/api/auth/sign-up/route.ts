import { NextResponse, type NextRequest } from "next/server";

import { isAuthEnabled } from "@/lib/auth/auth-enabled";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  verifyCsrfDoubleSubmit,
  verifyOriginHost,
} from "@/lib/auth/csrf";
import { AuthError } from "@/lib/auth/errors";
import {
  buildMagicLinkDeps,
  buildRuntimeDeps,
  clearBootstrapCsrfCookie,
  ensureMutationSession,
  jsonError,
  readRequestCookie,
  setCsrfCookie,
  setSessionCookie,
} from "@/lib/auth/handler-helpers";
import { requestMagicLink } from "@/lib/auth/magic-link";
import { safeNextPath } from "@/lib/auth/safe-next-path";
import { issueAuthenticatedSession } from "@/lib/auth/session-issue";
import { createPasswordAccount } from "@/lib/auth/signup";
import { claimAnonArtifacts } from "@/lib/leaderboard/claim";
import { readClientIp } from "@/lib/http/client-ip";
import { requireJsonObject } from "@/lib/http/bounded-body";

export const runtime = "nodejs";

interface RequestBody {
  username?: unknown;
  email?: unknown;
  password?: unknown;
  next?: unknown;
}

const MAX_SIGN_UP_BODY_BYTES = 6 * 1024;

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
      maxBytes: MAX_SIGN_UP_BODY_BYTES,
      allowedContentTypes: ["application/json"],
    })) as RequestBody;

    const created = await createPasswordAccount(
      { username: body.username, email: body.email, password: body.password },
      deps,
    );
    if (!created.ok) {
      return NextResponse.json(
        {
          error: created.code,
          message: created.message,
          ...("usernameReason" in created ? { username_reason: created.usernameReason } : {}),
        },
        { status: created.status },
      );
    }

    await requestMagicLink(
      {
        email: created.user.email ?? "",
        ipAddress: readClientIp(req),
        next: "/account?verify=sent",
        purpose: "verification",
      },
      buildMagicLinkDeps(deps),
    );

    const issued = await issueAuthenticatedSession(
      {
        session,
        userId: created.user.id,
        onAuthenticatedSessionReady: async ({ sessionId, userId }) => {
          await claimAnonArtifacts({ sessionId, userId }, { db: deps.db });
        },
      },
      deps,
    );
    const response = NextResponse.json(
      {
        ok: true,
        redirectTo: safeNextPath(typeof body.next === "string" ? body.next : "/account"),
        emailVerificationSent: true,
      },
      { status: 201 },
    );
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
