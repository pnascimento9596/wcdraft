// F-2 — route-handler glue (the only Next.js-aware file in lib/auth).
//
// Keeps each `app/api/auth/*/route.ts` thin: build the dependency bag once
// from env, read cookies in a uniform way, set httpOnly/Secure cookies in a
// uniform way, and translate AuthError → NextResponse with the right
// status + JSON body.
//
// Cookie attributes:
//   Path=/                    — every request includes the cookie
//   HttpOnly                  — wcdraft_sid only; wcdraft_csrf must be JS-readable
//   Secure                    — only when running under HTTPS / production
//   SameSite=Lax              — standard for magic-link + first-party flows
//   Max-Age                   — session TTL in seconds; matches the DB row
import { NextResponse, type NextRequest } from "next/server";
import { getDb, type Db } from "@wcdraft/db";
import { AuthError } from "./errors";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  type SessionDeps,
} from "./sessions";
import { CSRF_COOKIE_NAME } from "./csrf";
import {
  getEmailSender,
  type EmailSender,
} from "./email";
import type { MagicLinkDeps } from "./magic-link";

export interface RuntimeDeps extends SessionDeps {
  readonly sender: EmailSender;
  readonly verifyBaseUrl: string;
  readonly fromAddress: string;
}

let cachedDb: Db | null = null;
function db(): Db {
  if (!cachedDb) cachedDb = getDb();
  return cachedDb;
}

/**
 * Validate a base64url-encoded secret has at least the required number of
 * decoded bytes. The previous `length >= 16` check let weak secrets like
 * a single 16-char ASCII string sneak past the gate even though the
 * generator emits 32 random bytes (43-char base64url). The new check
 * decodes and asserts on the BYTE length, matching the contract the
 * error message advertises.
 *
 * Exported so the unit tests in __tests__/cookie-secret.test.ts can
 * exercise it directly with no env coupling.
 */
export function validateCookieSecret(
  raw: string | undefined,
  varName = "AUTH_COOKIE_SECRET",
  minBytes = 32,
): string {
  const v = raw?.trim() ?? "";
  if (!v) {
    // Typed (q-001 carryover c) — same 500 status, but a clean typed JSON
    // body via jsonError instead of the generic INTERNAL_ERROR path.
    throw new AuthError(
      "SECRET_MISCONFIGURED",
      `${varName} is not set. Generate with ` +
        "`node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"`.",
    );
  }
  // Defensive — Buffer.from(<bad>, 'base64url') silently returns 0-byte
  // output on garbage input. We catch both "decodes to too few bytes" and
  // "isn't base64url at all" with the same byte-length check.
  let decoded: Buffer;
  try {
    decoded = Buffer.from(v, "base64url");
  } catch {
    decoded = Buffer.alloc(0);
  }
  if (decoded.length < minBytes) {
    throw new AuthError(
      "SECRET_MISCONFIGURED",
      `${varName} must be a base64url string of at least ${minBytes.toString()} ` +
        `decoded bytes (got ${decoded.length.toString()} bytes from a ` +
        `${v.length.toString()}-char string). Generate with ` +
        "`node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"`.",
    );
  }
  return v;
}

function readCookieSecret(): string {
  return validateCookieSecret(process.env.AUTH_COOKIE_SECRET);
}

export function buildRuntimeDeps(): RuntimeDeps {
  const verifyBaseUrl =
    process.env.AUTH_BASE_URL?.trim() ?? "http://localhost:3000";
  const fromAddress =
    process.env.AUTH_EMAIL_FROM?.trim() ?? "wcdraft <onboarding@resend.dev>";
  return {
    db: db(),
    now: () => Date.now(),
    cookieSecret: readCookieSecret(),
    sender: getEmailSender(process.env),
    verifyBaseUrl,
    fromAddress,
  };
}

export function buildMagicLinkDeps(rd: RuntimeDeps): MagicLinkDeps {
  return {
    db: rd.db,
    now: rd.now,
    sender: rd.sender,
    verifyBaseUrl: rd.verifyBaseUrl,
    fromAddress: rd.fromAddress,
  };
}

export function readRequestCookie(
  req: NextRequest,
  name: string,
): string | null {
  // NextRequest.cookies has typed `.get`. Fall back to header parse for
  // tests that mint a plain Request.
  const ck = req.cookies?.get(name)?.value;
  if (ck) return ck;
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq) === name) {
      return decodeURIComponent(part.slice(eq + 1));
    }
  }
  return null;
}

export function readClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() ?? "unknown";
}

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

export interface SetCookieArgs {
  readonly name: string;
  readonly value: string;
  readonly maxAgeSeconds: number;
  /** wcdraft_sid → true; wcdraft_csrf → false (client JS needs to read it). */
  readonly httpOnly: boolean;
}

export function buildSetCookieValue(args: SetCookieArgs): string {
  const parts = [
    `${args.name}=${encodeURIComponent(args.value)}`,
    `Path=/`,
    `Max-Age=${args.maxAgeSeconds.toString()}`,
    `SameSite=Lax`,
  ];
  if (args.httpOnly) parts.push("HttpOnly");
  if (isProd()) parts.push("Secure");
  return parts.join("; ");
}

export function setSessionCookie(
  response: NextResponse,
  cookieValue: string,
  maxAgeSeconds: number = SESSION_TTL_MS / 1000,
): void {
  response.headers.append(
    "Set-Cookie",
    buildSetCookieValue({
      name: SESSION_COOKIE_NAME,
      value: cookieValue,
      maxAgeSeconds,
      httpOnly: true,
    }),
  );
}

export function setCsrfCookie(
  response: NextResponse,
  csrfSecret: string,
  maxAgeSeconds: number = SESSION_TTL_MS / 1000,
): void {
  response.headers.append(
    "Set-Cookie",
    buildSetCookieValue({
      name: CSRF_COOKIE_NAME,
      value: csrfSecret,
      maxAgeSeconds,
      httpOnly: false,
    }),
  );
}

export function clearSessionCookie(response: NextResponse): void {
  // Max-Age=0 with the same Path expires the cookie.
  response.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax${isProd() ? "; Secure" : ""}; HttpOnly`,
  );
  response.headers.append(
    "Set-Cookie",
    `${CSRF_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax${isProd() ? "; Secure" : ""}`,
  );
}

export function jsonError(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    // q-003 — server-misconfiguration detail (env-var names, secret-generation
    // commands) must never reach the client. Log the full message server-side
    // and return a generic body; every other code's message is its code-level
    // copy and stays as-is.
    if (err.code === "SECRET_MISCONFIGURED") {
      console.error("[auth] secret misconfigured:", err.message);
      return NextResponse.json(
        { error: err.code, message: "Server configuration error." },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: err.code, message: err.message },
      { status: err.status },
    );
  }
  console.error("[auth] unexpected error", err);
  return NextResponse.json(
    { error: "INTERNAL_ERROR" },
    { status: 500 },
  );
}
