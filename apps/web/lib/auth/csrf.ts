// F-2 — CSRF: double-submit token + Origin/Host check.
//
// Pattern:
//   - Server stores csrf_secret per session row (F-1 schema column).
//   - On session issue we set:
//       wcdraft_csrf = <csrf_secret>     (non-httpOnly cookie; readable by JS)
//   - Mutating handlers verify ALL THREE:
//       1. Request cookie `wcdraft_csrf` equals stored session.csrfSecret
//       2. Header `x-csrf-token`         equals stored session.csrfSecret
//       3. Origin (or Referer fallback)  matches request Host
//
// (1)+(2) together mean an attacker needs BOTH a forged cookie AND a forged
// header to pass; same-origin policy ordinarily prevents reading the cookie
// to set the header, and CORS prevents setting `x-csrf-token` cross-origin
// without an explicit preflight grant.
//
// (3) is the belt against an attacker who has gotten an iframe/embed past
// (1)+(2). Origin is the most reliable header; we fall back to Referer
// only when Origin is genuinely absent (some browser internals).
//
// All comparisons use timing-safe equality.
import { AuthError } from "./errors";
import { timingSafeStringEqual } from "./tokens";

export const CSRF_COOKIE_NAME = "wcdraft_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

export interface CsrfCheckArgs {
  readonly cookieValue: string | undefined | null;
  readonly headerValue: string | undefined | null;
  readonly sessionCsrfSecret: string;
}

/** Throws AuthError on any mismatch; returns void on success. */
export function verifyCsrfDoubleSubmit(args: CsrfCheckArgs): void {
  if (!args.headerValue || !args.cookieValue) {
    throw new AuthError("CSRF_MISSING", "csrf header or cookie missing");
  }
  if (!timingSafeStringEqual(args.cookieValue, args.sessionCsrfSecret)) {
    throw new AuthError("CSRF_MISMATCH", "csrf cookie does not match session");
  }
  if (!timingSafeStringEqual(args.headerValue, args.sessionCsrfSecret)) {
    throw new AuthError("CSRF_MISMATCH", "csrf header does not match session");
  }
}

export interface OriginCheckArgs {
  readonly origin: string | null | undefined;
  readonly referer: string | null | undefined;
  readonly host: string | null | undefined;
}

/**
 * Verify the request's Origin (or Referer fallback) matches Host. Throws
 * AuthError("ORIGIN_MISMATCH") on any mismatch or missing input. Stricter
 * than necessary on purpose — same-origin requests always carry one of
 * Origin/Referer in modern browsers.
 */
export function verifyOriginHost(args: OriginCheckArgs): void {
  if (!args.host) {
    throw new AuthError("ORIGIN_MISMATCH", "missing host header");
  }
  const source = args.origin ?? args.referer;
  if (!source) {
    throw new AuthError("ORIGIN_MISMATCH", "missing origin and referer");
  }
  let sourceHost: string;
  try {
    sourceHost = new URL(source).host;
  } catch {
    throw new AuthError("ORIGIN_MISMATCH", "origin not a valid URL");
  }
  if (!timingSafeStringEqual(sourceHost, args.host)) {
    throw new AuthError("ORIGIN_MISMATCH", "origin host does not match request host");
  }
}
