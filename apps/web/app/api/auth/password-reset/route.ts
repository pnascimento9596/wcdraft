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
import { requestPasswordResetMagicLink } from "@/lib/auth/magic-link";
import { readClientIp } from "@/lib/http/client-ip";
import { requireJsonObject } from "@/lib/http/bounded-body";

export const runtime = "nodejs";

interface RequestBody {
  email?: unknown;
}

const MAX_RESET_BODY_BYTES = 2 * 1024;

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
      maxBytes: MAX_RESET_BODY_BYTES,
      allowedContentTypes: ["application/json"],
    })) as RequestBody;
    const email = typeof body.email === "string" ? body.email : "";
    await requestPasswordResetMagicLink(
      {
        email,
        next: "/account?set_new_password=1",
        ipAddress: readClientIp(req),
        purpose: "reset",
      },
      buildMagicLinkDeps(deps),
    );

    const response = NextResponse.json(
      {
        ok: true,
        message: "If this address is eligible, a password reset delivery was requested.",
      },
      { status: 202 },
    );
    if (fresh) {
      setSessionCookie(response, cookieValue);
      setCsrfCookie(response, session.csrfSecret);
      clearBootstrapCsrfCookie(response);
    }
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
