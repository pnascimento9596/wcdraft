// F-2 (post-review) — two-step magic-link verify (anti-prefetch).
//
// Background
// ----------
// Modern email providers run link-scanning bots that GET every URL in
// inbound mail to surface previews and check for phishing. The original
// single-step verify (GET consumes the token, sets cookies, redirects)
// would let those bots BURN THE TOKEN before the human ever clicks it —
// the user gets a `TOKEN_CONSUMED` error on every link.
//
// Fix: two-step flow.
//   1. GET /api/auth/verify?token=…&next=… — read-only interstitial.
//      Renders an HTML page with a single FORM (POST to the same URL),
//      whose hidden inputs carry `token`, `next`, and a CSRF token bound
//      to the ensured anon session. The GET handler MUST ensure a
//      session row + csrf cookie so the POST has a valid double-submit
//      target. The GET itself does NOT touch `magic_link_tokens`.
//   2. Intentional user click → form POST → CSRF + Origin/Host enforced
//      → `verifyMagicLink` consumes atomically → session rotated to
//      authenticated → 303 redirect to `next`.
//
// A scanner that follows the GET pulls only the interstitial (and a
// throwaway anon session it discards). The token survives for the human.
//
// This module is the pure logic. `app/api/auth/verify/route.ts` is the
// thin Next.js adapter wired to it; the tests in
// `lib/auth/__tests__/verify-flow.test.ts` exercise this file directly.
import { eq } from "drizzle-orm";
import { sessions as sessionsTable } from "@wcdraft/db";
import { AuthError } from "./errors";
import { verifyMagicLink, type MagicLinkDeps } from "./magic-link";
import {
  createSession,
  SESSION_TTL_MS,
  signCookie,
  validateSessionCookie,
  type SessionDeps,
} from "./sessions";
import type { Session } from "@wcdraft/db";
import { ensureSession } from "./anon-session";
import { generateOpaqueToken } from "./tokens";
import { verifyCsrfDoubleSubmit, verifyOriginHost } from "./csrf";

// ── Interstitial render ────────────────────────────────────────────────────

export interface RenderInterstitialArgs {
  readonly token: string;
  readonly next: string;
  readonly csrfToken: string;
  /** Same-origin path the form POSTs back to; defaults to /api/auth/verify. */
  readonly action?: string;
}

const ESC_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtmlAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC_MAP[c] ?? c);
}

/**
 * Build the prefetch-safe HTML interstitial. The page deliberately does NOT
 * include any client-side JS — a link-scanning bot fetching the GET sees a
 * static page; the form only submits when a real user clicks the button.
 * Auto-submitting via JS would re-introduce the prefetch-burn problem in
 * scanners that DO execute JS, so the button is a hard requirement.
 */
export function renderVerifyInterstitialHtml(
  args: RenderInterstitialArgs,
): string {
  const action = args.action ?? "/api/auth/verify";
  const token = escapeHtmlAttr(args.token);
  const next = escapeHtmlAttr(args.next);
  const csrf = escapeHtmlAttr(args.csrfToken);
  // Minimal inline CSS keeps the page presentable without coupling to the
  // design system; F-3 can replace this with an in-app component if needed.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Sign in to wcdraft</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <style>
    :root { color-scheme: light dark; }
    body { font: 16px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0d1117; color: #f0f6fc; }
    main { max-width: 32rem; padding: 2rem; text-align: center; }
    h1 { margin: 0 0 1rem; font-size: 1.75rem; }
    p { margin: 0 0 1.5rem; opacity: 0.85; }
    button { font: inherit; padding: 0.75rem 1.5rem; border: 0; border-radius: 0.5rem; background: #2ea043; color: white; cursor: pointer; }
    button:hover { background: #2c974b; }
    .meta { margin-top: 1.5rem; font-size: 0.875rem; opacity: 0.65; }
  </style>
</head>
<body>
  <main>
    <h1>Sign in to wcdraft</h1>
    <p>Click below to complete sign-in. The link is single-use and expires in 15 minutes.</p>
    <form method="POST" action="${escapeHtmlAttr(action)}">
      <input type="hidden" name="token" value="${token}">
      <input type="hidden" name="next" value="${next}">
      <input type="hidden" name="csrf" value="${csrf}">
      <button type="submit">Sign in</button>
    </form>
    <p class="meta">If you didn't request this link, close this page — no account is created.</p>
  </main>
</body>
</html>
`;
}

// ── GET prepare (ensure session, return data for the interstitial) ─────────

export interface PrepareInterstitialArgs {
  readonly existingSessionCookie: string | null | undefined;
  readonly token: string;
  readonly next: string;
}

export interface PrepareInterstitialResult {
  readonly html: string;
  readonly sessionCookieValue: string;
  readonly csrfSecret: string;
  /** True when a fresh anon session was minted (caller MUST set the cookie). */
  readonly setSessionCookie: boolean;
}

/**
 * GET path: ensure an anon session exists so we have a CSRF secret to bind
 * to the form, and render the read-only interstitial. Crucially does NOT
 * touch `magic_link_tokens` — a prefetcher's GET cannot consume the token.
 *
 * The `next` parameter is NOT validated here (the POST handler revalidates
 * via `safeNextPath`); we just round-trip it through the form.
 */
export async function prepareVerifyInterstitial(
  args: PrepareInterstitialArgs,
  deps: SessionDeps,
): Promise<PrepareInterstitialResult> {
  const { session, fresh, cookieValue } = await ensureSession(
    args.existingSessionCookie,
    deps,
  );
  const html = renderVerifyInterstitialHtml({
    token: args.token,
    next: args.next,
    csrfToken: session.csrfSecret,
  });
  return {
    html,
    sessionCookieValue: cookieValue,
    csrfSecret: session.csrfSecret,
    setSessionCookie: fresh,
  };
}

// ── POST consume (CSRF + Origin/Host required; token consumed atomically) ─

export interface ConsumeAndIssueSessionArgs {
  readonly token: string;
  readonly next: string;
  /** Same value the GET embedded in the hidden form field. */
  readonly csrfFromForm: string | null | undefined;
  /** The `wcdraft_csrf` cookie value the browser echoes back. */
  readonly csrfFromCookie: string | null | undefined;
  /** The session cookie (signed) — present unless the browser dropped it. */
  readonly sessionCookieValue: string | null | undefined;
  readonly origin: string | null | undefined;
  readonly referer: string | null | undefined;
  readonly host: string | null | undefined;
}

export interface ConsumeAndIssueSessionResult {
  /** Already-validated same-origin path the caller should 303 to. */
  readonly redirectTo: string;
  /** Updated session cookie (always set on success — covers rotated id OR fresh mint). */
  readonly sessionCookieValue: string;
  /** Updated csrf cookie value. */
  readonly csrfSecret: string;
}

/**
 * Whitelist `?next=` (or the form's `next` field) to same-origin pathnames
 * so a malicious link can't redirect through us cross-origin.
 *
 *   "/play"        ✓
 *   "/play?x=1"    ✓
 *   "//evil/"      ✗ — protocol-relative
 *   "https://…"    ✗ — absolute
 *   "" or null     ✗ — default to "/play"
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/play";
  if (!/^\/[A-Za-z0-9_\-./?&=%]*$/.test(raw)) return "/play";
  if (raw.startsWith("//")) return "/play";
  return raw;
}

/**
 * POST path: enforce CSRF + Origin/Host, atomically consume the token,
 * rotate the anon session to authenticated (preserving the session row so
 * F-4 ranked-attempt bindings survive sign-in), and produce the redirect
 * directive.
 *
 * SESSION FIXATION THREAT MODEL — why in-place rotation is safe here:
 *   - Session ids are server-minted via `generateOpaqueToken()` (32 bytes
 *     of CSPRNG, base64url). There is NO input path — query string, body,
 *     header, cookie value setter — that lets an attacker propose an id.
 *   - The cookie is `<id>.<hmac(id, AUTH_COOKIE_SECRET)>`. An attacker
 *     cannot forge a valid signature without the server secret, so cannot
 *     plant a session id in the victim's cookie jar that would survive
 *     `validateSessionCookie`'s timing-safe HMAC check.
 *   - `ensureSession` validates against the LIVE DB row before reuse;
 *     a tampered/expired/deleted session can't be rotated.
 *   - On rotation we also mint a FRESH `csrfSecret`, invalidating any
 *     CSRF token an attacker may have observed in the anon phase.
 *
 * Together these mean an attacker cannot pre-position a session id, then
 * trick the victim into clicking a magic link to "promote" that id to the
 * victim's account — the rotation only succeeds for a session the server
 * minted for THIS browser, validated against THIS HMAC secret, and
 * confirmed by a live DB row.
 *
 * If F-3 ever introduces a path that accepts a session id from input
 * (e.g. for a cross-device claim flow), the rotation site MUST switch to
 * minting a fresh id instead of reusing the existing one.
 */
export async function consumeAndIssueSession(
  args: ConsumeAndIssueSessionArgs,
  deps: MagicLinkDeps & SessionDeps,
): Promise<ConsumeAndIssueSessionResult> {
  // 1) Same-origin gate. Cheap, catches drive-by mutations.
  verifyOriginHost({
    origin: args.origin,
    referer: args.referer,
    host: args.host,
  });

  // 2) Ensure a session exists. Required for CSRF double-submit:
  //    the GET handler set the csrf cookie to session.csrfSecret;
  //    the form's hidden `csrf` field carries the same value.
  let anonSession: Session;
  try {
    if (!args.sessionCookieValue) {
      throw new AuthError("SESSION_INVALID");
    }
    anonSession = await validateSessionCookie(args.sessionCookieValue, deps);
  } catch (e) {
    // No valid session means we can't do double-submit CSRF. Surface a
    // discriminating reason so the UI can prompt the user to retry.
    if (e instanceof AuthError) throw e;
    throw new AuthError("SESSION_INVALID");
  }

  // 3) CSRF double-submit — cookie value + form value must BOTH equal
  //    the session's stored csrf_secret. Timing-safe comparisons.
  verifyCsrfDoubleSubmit({
    cookieValue: args.csrfFromCookie,
    headerValue: args.csrfFromForm, // form body acts as the "header" channel here
    sessionCsrfSecret: anonSession.csrfSecret,
  });

  // 4) Atomic token consume + user upsert.
  const { user } = await verifyMagicLink({ token: args.token }, deps);

  // 5) Rotate the anon session in place (see threat-model comment above).
  const newCsrf = generateOpaqueToken();
  const rotated = await deps.db
    .update(sessionsTable)
    .set({
      userId: user.id,
      csrfSecret: newCsrf,
      expiresAt: new Date(deps.now() + SESSION_TTL_MS),
    })
    .where(eq(sessionsTable.id, anonSession.id))
    .returning();
  let sessionCookieValue: string;
  let csrfSecret: string;
  if (rotated[0]) {
    sessionCookieValue = signCookie(anonSession.id, deps.cookieSecret);
    csrfSecret = newCsrf;
  } else {
    // The session row vanished between validate and update (sweeper race).
    // Mint a fresh one rather than fail the whole sign-in.
    const fresh = await createSession({ userId: user.id }, deps);
    sessionCookieValue = fresh.cookieValue;
    csrfSecret = fresh.session.csrfSecret;
  }

  return {
    redirectTo: safeNextPath(args.next),
    sessionCookieValue,
    csrfSecret,
  };
}
