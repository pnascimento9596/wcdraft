import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { users } from "@wcdraft/db";

import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  verifyCsrfDoubleSubmit,
  verifyOriginHost,
} from "@/lib/auth/csrf";
import { AuthError } from "@/lib/auth/errors";
import {
  buildRuntimeDeps,
  clearSessionCookie,
  jsonError,
  readRequestCookie,
} from "@/lib/auth/handler-helpers";
import { SESSION_COOKIE_NAME, validateSessionCookie } from "@/lib/auth/sessions";
import { requireJsonObject } from "@/lib/http/bounded-body";

interface RequestBody {
  confirm?: unknown;
}

const MAX_DELETE_BODY_BYTES = 512;

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const deps = buildRuntimeDeps();
    verifyOriginHost({
      origin: req.headers.get("origin"),
      referer: req.headers.get("referer"),
      host: req.headers.get("host"),
    });
    const session = await validateSessionCookie(readRequestCookie(req, SESSION_COOKIE_NAME), deps);
    if (session.userId === null) {
      throw new AuthError("ANON_FORBIDDEN", "account delete requires sign-in");
    }
    verifyCsrfDoubleSubmit({
      cookieValue: readRequestCookie(req, CSRF_COOKIE_NAME),
      headerValue: req.headers.get(CSRF_HEADER_NAME),
      sessionCsrfSecret: session.csrfSecret,
    });
    const body = (await requireJsonObject(req, {
      maxBytes: MAX_DELETE_BODY_BYTES,
      allowedContentTypes: ["application/json"],
    })) as RequestBody;
    if (body.confirm !== "delete my account") {
      return NextResponse.json(
        { error: "CONFIRMATION_REQUIRED", message: "Type delete my account to confirm." },
        { status: 400 },
      );
    }
    await deps.db.delete(users).where(eq(users.id, session.userId));
    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response);
    return response;
  } catch (err) {
    return jsonError(err);
  }
}
