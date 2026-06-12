// Authenticated public profile API.
//
// GET returns only public profile fields. PUT updates username with
// last-write-wins semantics for the signed-in user. Email is deliberately
// neither selected nor serialized here.
import { NextResponse, type NextRequest } from "next/server";

import { buildRuntimeDeps, jsonError, readRequestCookie } from "@/lib/auth/handler-helpers";
import { AuthError } from "@/lib/auth/errors";
import { isAuthEnabled } from "@/lib/auth/auth-enabled";
import { readPublicProfile, updateUsername } from "@/lib/auth/profile";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  verifyCsrfDoubleSubmit,
  verifyOriginHost,
} from "@/lib/auth/csrf";
import { SESSION_COOKIE_NAME, validateSessionCookie } from "@/lib/auth/sessions";

export interface PublicProfileBody {
  readonly profile: {
    readonly user_id: string;
    readonly username: string | null;
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId } = await requireSignedInSession(req, false);
    const profile = await readProfile(userId);
    return NextResponse.json({ profile } satisfies PublicProfileBody, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, csrfSecret } = await requireSignedInSession(req, true);
    verifyOriginHost({
      origin: req.headers.get("origin"),
      referer: req.headers.get("referer"),
      host: req.headers.get("host"),
    });
    verifyCsrfDoubleSubmit({
      cookieValue: readRequestCookie(req, CSRF_COOKIE_NAME),
      headerValue: req.headers.get(CSRF_HEADER_NAME),
      sessionCsrfSecret: csrfSecret,
    });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "INVALID_BODY", message: "body must be valid JSON" },
        { status: 400 },
      );
    }
    const username = (body as { username?: unknown } | null)?.username;
    const deps = buildRuntimeDeps();
    const updated = await updateUsername(deps.db, userId, username);
    if (!updated.ok && updated.code === "INVALID_USERNAME") {
      return NextResponse.json(
        {
          error: "INVALID_USERNAME",
          message: `username rejected (${updated.reason})`,
          username_reason: updated.reason,
        },
        { status: 422 },
      );
    }
    if (!updated.ok && updated.code === "USERNAME_TAKEN") {
      return NextResponse.json(
        {
          error: "USERNAME_TAKEN",
          message: "That username is already taken.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ profile: updated.profile } satisfies PublicProfileBody, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return jsonError(err);
  }
}

async function requireSignedInSession(
  req: NextRequest,
  includeCsrf: boolean,
): Promise<{ userId: string; csrfSecret: string }> {
  if (!isAuthEnabled()) {
    throw new AuthError("AUTH_DISABLED", "Auth feature is not enabled.");
  }
  const deps = buildRuntimeDeps();
  const cookie = readRequestCookie(req, SESSION_COOKIE_NAME);
  const session = await validateSessionCookie(cookie, deps);
  if (session.userId === null) {
    throw new AuthError("SESSION_INVALID", "a signed-in account is required");
  }
  return {
    userId: session.userId,
    csrfSecret: includeCsrf ? session.csrfSecret : "",
  };
}

async function readProfile(userId: string): Promise<PublicProfileBody["profile"]> {
  const profile = await readPublicProfile(buildRuntimeDeps().db, userId);
  if (!profile) throw new AuthError("SESSION_INVALID", "user row missing");
  return profile;
}
