// CSRF bootstrap route — production 500 diagnosis regression.
//
// Live signature (www.wcdraft.com @ 2a3253e): every GET /api/auth/csrf returned
// 500 INTERNAL_ERROR with Vercel log
//   [security] {"code":"AUTH_UNEXPECTED_ERROR","error_class":"unexpected"}
// The only always-on side effect before cookie-less bootstrap was the lazy
// expiry sweep. Correctness never depends on the sweep; a substrate/driver
// error on that path must not abort bootstrap minting or mint a durable
// session. These tests pin that contract plus neighbour shapes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  buildRuntimeDeps: vi.fn(),
  sweepExpiredSessions: vi.fn(),
  validateSessionCookie: vi.fn(),
  createBootstrapCsrf: vi.fn(),
  createSession: vi.fn(),
}));

vi.mock("@/lib/auth/handler-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/handler-helpers")>(
    "@/lib/auth/handler-helpers",
  );
  return {
    ...actual,
    buildRuntimeDeps: mocks.buildRuntimeDeps,
  };
});

vi.mock("@/lib/auth/sessions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/sessions")>("@/lib/auth/sessions");
  return {
    ...actual,
    sweepExpiredSessions: mocks.sweepExpiredSessions,
    validateSessionCookie: mocks.validateSessionCookie,
  };
});

vi.mock("@/lib/auth/bootstrap-csrf", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/bootstrap-csrf")>(
    "@/lib/auth/bootstrap-csrf",
  );
  return {
    ...actual,
    createBootstrapCsrf: mocks.createBootstrapCsrf,
  };
});

import { GET as csrfGet } from "@/app/api/auth/csrf/route";
import { AuthError } from "@/lib/auth/errors";
import { SESSION_COOKIE_NAME } from "@/lib/auth/sessions";
import { BOOTSTRAP_CSRF_COOKIE_NAME } from "@/lib/auth/bootstrap-csrf";
import { CSRF_COOKIE_NAME } from "@/lib/auth/csrf";

const COOKIE_SECRET = Buffer.alloc(32, 0x42).toString("base64url");
const NOW = Date.UTC(2026, 7, 7, 12, 0, 0);

const BOOTSTRAP = {
  cookieValue: "b1.nonce.csrf.9999999999999.sig",
  sessionCookieValue: "nonce.sig",
  csrfSecret: "csrf-token-value-aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  expiresAt: NOW + 5 * 60 * 1000,
};

function depsBag() {
  return {
    db: { execute: vi.fn(), select: vi.fn(), insert: vi.fn(), delete: vi.fn() },
    now: () => NOW,
    cookieSecret: COOKIE_SECRET,
    sender: { kind: "log" as const, sendMagicLink: vi.fn() },
    verifyBaseUrl: "https://www.wcdraft.com",
    fromAddress: "wcdraft <onboarding@resend.dev>",
  };
}

function req(init?: {
  readonly cookie?: string;
  readonly origin?: string | null;
  readonly referer?: string | null;
  readonly contentType?: string | null;
  readonly method?: string;
  readonly body?: string;
}): NextRequest {
  const headers = new Headers();
  if (init?.cookie) headers.set("cookie", init.cookie);
  if (init?.origin) headers.set("origin", init.origin);
  if (init?.referer) headers.set("referer", init.referer);
  if (init?.contentType) headers.set("content-type", init.contentType);
  headers.set("accept", "application/json");
  return new NextRequest("https://www.wcdraft.com/api/auth/csrf", {
    method: init?.method ?? "GET",
    headers,
    body: init?.body,
  });
}

function setCookieNames(response: Response): string[] {
  // NextResponse may surface multiple Set-Cookie via getSetCookie().
  const anyHeaders = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") {
    return anyHeaders.getSetCookie().map((line) => line.split("=", 1)[0] ?? line);
  }
  const single = response.headers.get("set-cookie");
  return single ? [single.split("=", 1)[0] ?? single] : [];
}

beforeEach(() => {
  mocks.buildRuntimeDeps.mockReset();
  mocks.sweepExpiredSessions.mockReset();
  mocks.validateSessionCookie.mockReset();
  mocks.createBootstrapCsrf.mockReset();
  mocks.createSession.mockReset();
  mocks.buildRuntimeDeps.mockReturnValue(depsBag());
  mocks.sweepExpiredSessions.mockResolvedValue(0);
  mocks.createBootstrapCsrf.mockReturnValue(BOOTSTRAP);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/auth/csrf — cookie-less bootstrap", () => {
  it("returns bootstrap token and bootstrap cookies, never a durable session mint", async () => {
    const res = await csrfGet(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      csrfToken: string;
      csrfCookieName: string;
      isAuthenticated: boolean;
    };
    expect(body).toEqual({
      csrfToken: BOOTSTRAP.csrfSecret,
      csrfCookieName: CSRF_COOKIE_NAME,
      isAuthenticated: false,
    });
    const names = setCookieNames(res);
    expect(names).toEqual(
      expect.arrayContaining([BOOTSTRAP_CSRF_COOKIE_NAME, SESSION_COOKIE_NAME, CSRF_COOKIE_NAME]),
    );
    // createBootstrapCsrf is the only mint path; createSession must not run.
    expect(mocks.createBootstrapCsrf).toHaveBeenCalledTimes(1);
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.validateSessionCookie).not.toHaveBeenCalled();
  });

  it("still bootstraps when the expiry sweep throws (class b/c degradation)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      mocks.sweepExpiredSessions.mockRejectedValueOnce(
        Object.assign(new Error("NeonDbError: connection terminated"), {
          name: "NeonDbError",
          code: "57P01",
        }),
      );
      const res = await csrfGet(req({ origin: "https://www.wcdraft.com" }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { csrfToken: string; isAuthenticated: boolean };
      expect(body.csrfToken).toBe(BOOTSTRAP.csrfSecret);
      expect(body.isAuthenticated).toBe(false);
      expect(mocks.createBootstrapCsrf).toHaveBeenCalledTimes(1);
      // Structured, message-free security log with correlation id — no PII.
      expect(spy).toHaveBeenCalledWith(
        "[security]",
        expect.stringContaining("AUTH_UNEXPECTED_ERROR"),
      );
      const logged = String(spy.mock.calls[0]?.[1] ?? "");
      expect(logged).toMatch(/correlation_id/);
      expect(logged).not.toMatch(/connection terminated|victim@|57P01/i);
    } finally {
      spy.mockRestore();
    }
  });

  it.each([
    {
      label: "missing Origin",
      init: {},
    },
    {
      label: "mismatched Origin",
      init: { origin: "https://evil.example" },
    },
    {
      label: "missing cookie",
      init: { origin: "https://www.wcdraft.com" },
    },
    {
      label: "wrong content type",
      init: {
        origin: "https://www.wcdraft.com",
        contentType: "text/plain",
      },
    },
    {
      label: "empty cookie header",
      init: { origin: "https://www.wcdraft.com", cookie: "" },
    },
  ] as const)("neighbour shape ($label) still returns typed bootstrap 200", async ({ init }) => {
    const res = await csrfGet(req(init));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { error?: string; csrfToken?: string };
    expect(body.error).toBeUndefined();
    expect(body.csrfToken).toBe(BOOTSTRAP.csrfSecret);
    // No durable session materialization path.
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("invalid session cookie falls through to bootstrap without minting a durable row", async () => {
    mocks.validateSessionCookie.mockRejectedValueOnce(
      new AuthError("SESSION_TAMPERED", "cookie format invalid"),
    );
    const res = await csrfGet(
      req({
        origin: "https://www.wcdraft.com",
        cookie: `${SESSION_COOKIE_NAME}=deadbeef.invalid`,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { csrfToken: string; isAuthenticated: boolean };
    expect(body.isAuthenticated).toBe(false);
    expect(body.csrfToken).toBe(BOOTSTRAP.csrfSecret);
    expect(mocks.createBootstrapCsrf).toHaveBeenCalledTimes(1);
  });

  it("existing durable session returns its csrf secret without re-bootstrap", async () => {
    mocks.validateSessionCookie.mockResolvedValueOnce({
      id: "sess-1",
      userId: null,
      csrfSecret: "existing-csrf-secret",
      createdAt: new Date(NOW - 1000),
      expiresAt: new Date(NOW + 60_000),
    });
    const res = await csrfGet(
      req({
        origin: "https://www.wcdraft.com",
        cookie: `${SESSION_COOKIE_NAME}=sess-1.sig`,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { csrfToken: string; isAuthenticated: boolean };
    expect(body.csrfToken).toBe("existing-csrf-secret");
    expect(body.isAuthenticated).toBe(false);
    expect(mocks.createBootstrapCsrf).not.toHaveBeenCalled();
  });
});

describe("GET /api/auth/csrf — misconfiguration stays typed", () => {
  it("returns scrubbed 503 SECRET_MISCONFIGURED when deps refuse to build", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      mocks.buildRuntimeDeps.mockImplementationOnce(() => {
        throw new AuthError("SECRET_MISCONFIGURED", "AUTH_COOKIE_SECRET is not set.");
      });
      const res = await csrfGet(req());
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string; message: string };
      expect(body.error).toBe("SECRET_MISCONFIGURED");
      expect(body.message).toBe("Server configuration error.");
      expect(JSON.stringify(body)).not.toMatch(/AUTH_COOKIE_SECRET|randomBytes/i);
      expect(mocks.createBootstrapCsrf).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
