import { NextResponse, type NextRequest } from "next/server";

import { ensureSession } from "@/lib/auth/anon-session";
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
  jsonError,
  readRequestCookie,
  setCsrfCookie,
  setSessionCookie,
} from "@/lib/auth/handler-helpers";
import { requestMagicLink } from "@/lib/auth/magic-link";
import { safeNextPath } from "@/lib/auth/safe-next-path";
import { issueAuthenticatedSession } from "@/lib/auth/session-issue";
import { SESSION_COOKIE_NAME } from "@/lib/auth/sessions";
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
    const cookieRaw = readRequestCookie(req, SESSION_COOKIE_NAME);
    const { session } = await ensureSession(cookieRaw, deps);
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
    return response;
  } catch (err) {
    return jsonError(err);
  }
}
