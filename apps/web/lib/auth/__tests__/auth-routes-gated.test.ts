// F-3.6 — ship-dark gate for the mutating auth routes.
//
// `/api/auth/magic-link` and `/api/auth/verify` MUST short-circuit with an
// honest 503 AUTH_DISABLED response before building secret-dependent deps
// whenever `isAuthEnabled()` is false. Previously a manual POST in
// ship-dark prod would crash on missing AUTH_COOKIE_SECRET (INTERNAL_ERROR
// 500) or, worse, try to actually send a magic link via a misconfigured
// sender.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as magicLinkPost } from "@/app/api/auth/magic-link/route";
import { GET as verifyGet, POST as verifyPost } from "@/app/api/auth/verify/route";

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

function postJson(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      host: "localhost",
    },
    body: JSON.stringify(body),
  });
}

function postForm(url: string, fields: Record<string, string>): NextRequest {
  const params = new URLSearchParams(fields);
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "http://localhost",
      host: "localhost",
    },
    body: params.toString(),
  });
}

describe("/api/auth/magic-link — ship-dark", () => {
  it("returns 503 AUTH_DISABLED before building deps when auth is disabled", async () => {
    const req = postJson("http://localhost/api/auth/magic-link", {
      email: "user@example.com",
    });
    const res = await magicLinkPost(req);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("AUTH_DISABLED");
  });

  it("stays dark when sender env is set but AUTH_BASE_URL is missing", async () => {
    process.env.RESEND_API_KEY = "re_demo";
    process.env.AUTH_EMAIL_FROM = "wcdraft <noreply@wcdraft.com>";
    const req = postJson("http://localhost/api/auth/magic-link", {
      email: "user@example.com",
    });
    const res = await magicLinkPost(req);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("AUTH_DISABLED");
  });
});

describe("/api/auth/verify — ship-dark", () => {
  it("GET returns 503 AUTH_DISABLED before building deps when auth is disabled", async () => {
    const req = new NextRequest("http://localhost/api/auth/verify?token=abc&next=/play");
    const res = await verifyGet(req);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("AUTH_DISABLED");
  });

  it("POST returns 503 AUTH_DISABLED before building deps when auth is disabled", async () => {
    const req = postForm("http://localhost/api/auth/verify", {
      token: "abc",
      next: "/play",
      csrf: "x",
    });
    const res = await verifyPost(req);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("AUTH_DISABLED");
  });
});
