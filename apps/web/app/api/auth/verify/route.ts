// F-2 — GET /api/auth/verify?token=...
//
// Consumes the magic-link token, upserts the user, rotates the existing
// anonymous session (if any) to an authenticated session bound to user_id,
// and redirects the browser to /play (or ?next=, after same-origin check).
//
// Important details:
//   - We REUSE the anon session row if present, rotating its user_id +
//     issuing a fresh csrf_secret + new cookie HMAC. This preserves any
//     server state already bound to the session id (F-4 ranked attempts).
//     If no anon session, we mint a fresh authenticated session.
//   - The `next` query param is whitelisted to same-origin pathnames so a
//     `?next=https://evil/` can't redirect through us.
//   - Token errors (TOKEN_*) bubble through jsonError as 401 JSON; we
//     deliberately do NOT redirect on failure so the bad URL is not
//     re-attempted silently.
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { sessions as sessionsTable } from "@wcdraft/db";
import { verifyMagicLink } from "@/lib/auth/magic-link";
import { createSession, SESSION_TTL_MS, signCookie } from "@/lib/auth/sessions";
import { ensureSession } from "@/lib/auth/anon-session";
import {
  buildRuntimeDeps,
  jsonError,
  readRequestCookie,
  setCsrfCookie,
  setSessionCookie,
} from "@/lib/auth/handler-helpers";
import { SESSION_COOKIE_NAME } from "@/lib/auth/sessions";
import { generateOpaqueToken } from "@/lib/auth/tokens";

function safeNextPath(raw: string | null): string {
  if (!raw) return "/play";
  // Must be an absolute pathname starting with `/` and not `//` (protocol-relative).
  if (!/^\/[A-Za-z0-9_\-./?&=%]*$/.test(raw)) return "/play";
  if (raw.startsWith("//")) return "/play";
  return raw;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const deps = buildRuntimeDeps();
    const token = req.nextUrl.searchParams.get("token") ?? "";
    const next = safeNextPath(req.nextUrl.searchParams.get("next"));

    // Atomic token consume + user upsert. Throws on any failure mode.
    const { user } = await verifyMagicLink({ token }, deps);

    // Rotate / mint the authenticated session.
    const existingCookie = readRequestCookie(req, SESSION_COOKIE_NAME);
    let sessionId: string;
    let csrfSecret: string;
    let cookieValue: string;
    if (existingCookie) {
      // Validate, but don't fail if invalid — we'll mint a fresh row.
      try {
        const { session: anon } = await ensureSession(existingCookie, deps);
        // Rotate user_id + csrf_secret atomically.
        csrfSecret = generateOpaqueToken();
        const updated = await deps.db
          .update(sessionsTable)
          .set({
            userId: user.id,
            csrfSecret,
            expiresAt: new Date(deps.now() + SESSION_TTL_MS),
          })
          .where(eq(sessionsTable.id, anon.id))
          .returning();
        if (!updated[0]) throw new Error("session rotate failed");
        sessionId = anon.id;
        cookieValue = signCookie(sessionId, deps.cookieSecret);
      } catch {
        const fresh = await createSession({ userId: user.id }, deps);
        sessionId = fresh.session.id;
        csrfSecret = fresh.session.csrfSecret;
        cookieValue = fresh.cookieValue;
      }
    } else {
      const fresh = await createSession({ userId: user.id }, deps);
      sessionId = fresh.session.id;
      csrfSecret = fresh.session.csrfSecret;
      cookieValue = fresh.cookieValue;
    }

    // 303 See Other so the next nav is a GET. NextResponse.redirect()
    // doesn't pin status — pass it via init.
    const response = NextResponse.redirect(new URL(next, req.url), 303);
    setSessionCookie(response, cookieValue);
    setCsrfCookie(response, csrfSecret);
    return response;
  } catch (err) {
    return jsonError(err);
  }
}
