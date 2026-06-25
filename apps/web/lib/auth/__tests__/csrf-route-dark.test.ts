// accounts-activation — ship-dark posture for the session-substrate routes.
//
// /api/auth/csrf is intentionally NOT gated by isAuthEnabled(): the F-4
// leaderboard needs anonymous sessions + csrf while accounts stay dark.
// But in a deploy where the substrate env (AUTH_COOKIE_SECRET and/or
// DATABASE_URL) is absent, the route previously answered 500
// SECRET_MISCONFIGURED / INTERNAL_ERROR — a crash-shaped response for an
// expected configuration state. These tests pin the honest degrade:
// every auth route with missing env answers a clean, typed, scrubbed
// non-500 — the dark posture is itself a contract.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as csrfGet } from "@/app/api/auth/csrf/route";
import { GET as sessionGet, DELETE as sessionDelete } from "@/app/api/auth/session/route";
import { GET as configGet } from "@/app/api/auth/config/route";

const ENV_KEYS = [
  "RESEND_API_KEY",
  "AUTH_EMAIL_FROM",
  "AUTH_BASE_URL",
  "AUTH_COOKIE_SECRET",
  "DATABASE_URL",
] as const;

type Snapshot = Record<(typeof ENV_KEYS)[number], string | undefined>;

let originals: Snapshot;

beforeEach(() => {
  originals = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as Snapshot;
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

function silenceConsoleError(): () => void {
  const orig = console.error;
  console.error = () => undefined;
  return () => {
    console.error = orig;
  };
}

const SCRUB_PATTERN = /AUTH_COOKIE_SECRET|DATABASE_URL|randomBytes|base64url|neon/i;

describe("/api/auth/csrf — env-unset honest degrade", () => {
  it("returns a scrubbed 503 (never 500) when ALL auth env is unset", async () => {
    const restore = silenceConsoleError();
    try {
      const res = await csrfGet(new NextRequest("http://localhost/api/auth/csrf"));
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string; message: string };
      expect(body.error).toBe("SECRET_MISCONFIGURED");
      expect(body.message).toBe("Server configuration error.");
      expect(JSON.stringify(body)).not.toMatch(SCRUB_PATTERN);
    } finally {
      restore();
    }
  });

  it("returns a scrubbed 503 when the cookie secret is set but DATABASE_URL is absent", async () => {
    const restore = silenceConsoleError();
    try {
      process.env.AUTH_COOKIE_SECRET = Buffer.alloc(32, 0x41).toString("base64url");
      const res = await csrfGet(new NextRequest("http://localhost/api/auth/csrf"));
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string };
      // Typed substrate error, NOT the generic INTERNAL_ERROR crash shape.
      expect(body.error).toBe("SECRET_MISCONFIGURED");
      expect(JSON.stringify(body)).not.toMatch(SCRUB_PATTERN);
    } finally {
      restore();
    }
  });
});

describe("/api/auth/session — env-unset honest degrade", () => {
  it("GET answers 200 {session:null} with all env unset", async () => {
    const res = await sessionGet(new NextRequest("http://localhost/api/auth/session"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: unknown };
    expect(body.session).toBeNull();
  });

  it("DELETE answers 503 AUTH_DISABLED with all env unset", async () => {
    const req = new NextRequest("http://localhost/api/auth/session", {
      method: "DELETE",
      headers: { origin: "http://localhost", host: "localhost" },
    });
    const res = await sessionDelete(req);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("AUTH_DISABLED");
  });
});

describe("/api/auth/config — env-unset", () => {
  it("reports authEnabled:false and nothing else", async () => {
    const res = await configGet();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ authEnabled: false });
  });
});
