// F-3.6 — /api/auth/session ship-dark hardening
//
// The bug we are fixing: in production with auth disabled (RESEND_API_KEY,
// AUTH_EMAIL_FROM, and/or AUTH_BASE_URL unset) and AUTH_COOKIE_SECRET also unset, the previous
// GET handler called `buildRuntimeDeps()` before checking for the cookie,
// `readCookieSecret()` threw, and every page load saw an INTERNAL_ERROR 500.
//
// These tests pin the new contract:
//   * GET with auth disabled + no cookie         → 200 {session:null}, no throw
//   * GET with auth disabled + a cookie present  → 200 {session:null}, no throw
//   * DELETE with auth disabled                  → 503 AUTH_DISABLED, honest gate
//
// We deliberately clear AUTH_COOKIE_SECRET in each test to prove the
// anonymous path NEVER depends on it.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, DELETE } from "@/app/api/auth/session/route";
import { SESSION_COOKIE_NAME } from "@/lib/auth/sessions";

const ENV_KEYS = [
  "RESEND_API_KEY",
  "AUTH_EMAIL_FROM",
  "AUTH_BASE_URL",
  "AUTH_COOKIE_SECRET",
] as const;

type Snapshot = Record<(typeof ENV_KEYS)[number], string | undefined>;

function snap(): Snapshot {
  return {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    AUTH_EMAIL_FROM: process.env.AUTH_EMAIL_FROM,
    AUTH_BASE_URL: process.env.AUTH_BASE_URL,
    AUTH_COOKIE_SECRET: process.env.AUTH_COOKIE_SECRET,
  };
}

let originals: Snapshot;

beforeEach(() => {
  originals = snap();
  // ship-dark + go-live not yet performed.
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (originals[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = originals[k];
    }
  }
});

function makeReq(init: { cookie?: string } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (init.cookie) headers.cookie = init.cookie;
  return new NextRequest("http://localhost/api/auth/session", { headers });
}

describe("GET /api/auth/session — ship-dark", () => {
  it("returns 200 {session:null} when auth is disabled and no cookie is sent", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: unknown };
    expect(body).toEqual({ session: null });
  });

  it("returns 200 {session:null} when auth is disabled even if a session cookie IS present", async () => {
    // A stale cookie from a previous deploy must not cause a 500. The
    // route MUST NOT touch buildRuntimeDeps in ship-dark, so a missing
    // AUTH_COOKIE_SECRET cannot crash this path.
    const res = await GET(makeReq({ cookie: `${SESSION_COOKIE_NAME}=stale.cookie.value` }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: unknown };
    expect(body).toEqual({ session: null });
  });

  it("returns 200 {session:null} when auth is ENABLED but no cookie is sent (no deps built)", async () => {
    // The no-cookie branch must remain dep-free so a half-configured
    // deploy (flag flipped, secret not yet rotated) cannot 500 anon callers.
    process.env.RESEND_API_KEY = "re_demo";
    process.env.AUTH_EMAIL_FROM = "wcdraft <onboarding@resend.dev>";
    process.env.AUTH_BASE_URL = "https://www.wcdraft.com";
    // AUTH_COOKIE_SECRET still unset on purpose.
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: unknown };
    expect(body).toEqual({ session: null });
  });
});

describe("DELETE /api/auth/session — ship-dark", () => {
  it("returns 503 AUTH_DISABLED honestly without touching secret-dependent deps", async () => {
    const res = await DELETE(makeReq());
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("AUTH_DISABLED");
  });
});
