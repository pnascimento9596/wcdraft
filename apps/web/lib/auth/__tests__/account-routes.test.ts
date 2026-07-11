import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { leaderboardEntries, magicLinkTokens, users } from "@wcdraft/db";

import type { RuntimeDeps } from "@/lib/auth/handler-helpers";

const runtime = vi.hoisted(() => ({ deps: null as RuntimeDeps | null }));

vi.mock("@/lib/auth/handler-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/handler-helpers")>();
  return {
    ...actual,
    buildRuntimeDeps: (): RuntimeDeps => {
      if (runtime.deps === null) throw new Error("test runtime deps not initialised");
      return runtime.deps;
    },
  };
});

import { DELETE as accountDelete } from "@/app/api/account/route";
import { PUT as accountPasswordPut } from "@/app/api/account/password/route";
import { GET as accountRunsGet } from "@/app/api/account/runs/route";
import { POST as passwordResetPost } from "@/app/api/auth/password-reset/route";
import { POST as resendVerificationPost } from "@/app/api/auth/resend-verification/route";
import { POST as signUpPost } from "@/app/api/auth/sign-up/route";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/lib/auth/csrf";
import { LogEmailSender, type EmailSender } from "@/lib/auth/email";
import { hashPassword, verifyPasswordHash } from "@/lib/auth/passwords";
import { createRecentMagicCookieValue, RECENT_MAGIC_COOKIE_NAME } from "@/lib/auth/recent-magic";
import { createSession, SESSION_COOKIE_NAME, validateSessionCookie } from "@/lib/auth/sessions";
import { setupTestDb, testCookieSecret } from "./_test-db";

const env = await setupTestDb();
const COOKIE_SECRET = testCookieSecret("account-routes");
const NOW = Date.UTC(2026, 5, 30, 12, 0, 0);
const AUTH_ENV_KEYS = ["RESEND_API_KEY", "AUTH_EMAIL_FROM", "AUTH_BASE_URL"] as const;

let sender: LogEmailSender;
let originalAuthEnv: Record<(typeof AUTH_ENV_KEYS)[number], string | undefined>;

afterAll(async () => env.pg.close());
afterEach(async () => {
  for (const key of AUTH_ENV_KEYS) {
    if (originalAuthEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalAuthEnv[key];
    }
  }
  await env.reset();
});

beforeEach(() => {
  originalAuthEnv = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    AUTH_EMAIL_FROM: process.env.AUTH_EMAIL_FROM,
    AUTH_BASE_URL: process.env.AUTH_BASE_URL,
  };
  process.env.RESEND_API_KEY = "re_test_auth_routes";
  process.env.AUTH_EMAIL_FROM = "verify@example.invalid";
  process.env.AUTH_BASE_URL = "https://www.wcdraft.test";
  sender = new LogEmailSender(() => {});
  runtime.deps = {
    db: env.db,
    now: () => NOW,
    cookieSecret: COOKIE_SECRET,
    sender,
    verifyBaseUrl: "https://www.wcdraft.test",
    fromAddress: "verify@example.invalid",
  };
});

describe("account route auth status", () => {
  it("returns 401, not 403, when an anonymous session reaches account endpoints", async () => {
    const anon = await createSession({ userId: null }, runtime.deps!);
    const headers = sessionHeaders(anon.cookieValue, anon.session.csrfSecret);

    const runs = await accountRunsGet(req("/api/account/runs", { headers }));
    await expectAuthRequired(runs);

    const password = await accountPasswordPut(
      req("/api/account/password", {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ newPassword: "Long-enough-42!" }),
      }),
    );
    await expectAuthRequired(password);

    const deleted = await accountDelete(
      req("/api/account", {
        method: "DELETE",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ confirm: "delete my account" }),
      }),
    );
    await expectAuthRequired(deleted);
  });

  it("sets a first password only with a recent magic-link proof", async () => {
    const userId = await insertUser("first-password@example.com");
    const auth = await createSession({ userId }, runtime.deps!);
    const headersWithoutProof = sessionHeaders(auth.cookieValue, auth.session.csrfSecret);
    const firstPassword = testCredential("first");

    const denied = await accountPasswordPut(
      req("/api/account/password", {
        method: "PUT",
        headers: { ...headersWithoutProof, "content-type": "application/json" },
        body: JSON.stringify({ newPassword: firstPassword }),
      }),
    );
    expect(denied.status).toBe(401);
    await expect(denied.json()).resolves.toMatchObject({ error: "INVALID_CREDENTIALS" });

    const headersWithProof = sessionHeaders(auth.cookieValue, auth.session.csrfSecret, {
      [RECENT_MAGIC_COOKIE_NAME]: createRecentMagicCookieValue({
        sessionId: auth.session.id,
        userId,
        now: NOW,
        cookieSecret: COOKIE_SECRET,
      }),
    });
    const allowed = await accountPasswordPut(
      req("/api/account/password", {
        method: "PUT",
        headers: { ...headersWithProof, "content-type": "application/json" },
        body: JSON.stringify({ newPassword: firstPassword }),
      }),
    );

    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toMatchObject({ ok: true, hasPassword: true });
    const user = await readUser(userId);
    expect(user?.passwordHash).toBeTruthy();
    expect(user?.passwordSetAt).toBeInstanceOf(Date);
    await expect(verifyPasswordHash(user?.passwordHash ?? null, firstPassword)).resolves.toBe(true);
  });

  it("changes an existing password with the current password", async () => {
    const oldPassword = testCredential("old");
    const newPassword = testCredential("new");
    const userId = await insertUser("change-password@example.com", oldPassword);
    const auth = await createSession({ userId }, runtime.deps!);
    const headers = sessionHeaders(auth.cookieValue, auth.session.csrfSecret);

    const response = await accountPasswordPut(
      req("/api/account/password", {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword: oldPassword,
          newPassword,
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, hasPassword: true });
    const user = await readUser(userId);
    await expect(verifyPasswordHash(user?.passwordHash ?? null, newPassword)).resolves.toBe(true);
  });

  it("resets an existing password with recent magic-link proof when current password is absent", async () => {
    const resetPassword = testCredential("reset");
    const userId = await insertUser("reset-password@example.com", testCredential("old"));
    const auth = await createSession({ userId }, runtime.deps!);
    const headers = sessionHeaders(auth.cookieValue, auth.session.csrfSecret, {
      [RECENT_MAGIC_COOKIE_NAME]: createRecentMagicCookieValue({
        sessionId: auth.session.id,
        userId,
        now: NOW,
        cookieSecret: COOKIE_SECRET,
      }),
    });

    const response = await accountPasswordPut(
      req("/api/account/password", {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ newPassword: resetPassword }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, hasPassword: true });
    const user = await readUser(userId);
    await expect(verifyPasswordHash(user?.passwordHash ?? null, resetPassword)).resolves.toBe(true);
  });

  it("deletes account-owned leaderboard rows through the user cascade", async () => {
    const userId = await insertUser("delete-cascade@example.com", testCredential("delete"));
    const auth = await createSession({ userId }, runtime.deps!);
    await env.db.insert(leaderboardEntries).values({
      seasonKey: "delete-season",
      mode: "casual",
      draftMode: "classic",
      draftOrder: "squad_first",
      era: "all_time",
      ratingBasis: "career",
      userId,
      displayAlias: "delete_me",
      token: "delete-token",
      verifiedScore: 1,
      scoreBreakdown: [],
    });
    const response = await accountDelete(
      req("/api/account", {
        method: "DELETE",
        headers: {
          ...sessionHeaders(auth.cookieValue, auth.session.csrfSecret),
          "content-type": "application/json",
        },
        body: JSON.stringify({ confirm: "delete my account" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await env.db.select().from(users)).toHaveLength(0);
    expect(await env.db.select().from(leaderboardEntries)).toHaveLength(0);
  });

  it("signs up with username/email/password, sends verification, and issues an authenticated session", async () => {
    const anon = await createSession({ userId: null }, runtime.deps!);
    const headers = sessionHeaders(anon.cookieValue, anon.session.csrfSecret);

    const response = await signUpPost(
      req("/api/auth/sign-up", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          username: "route_user",
          email: "RouteUser@Example.COM",
          password: testCredential("signup"),
          next: "/account",
        }),
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      redirectTo: "/account",
      emailVerificationSent: true,
    });
    expect(sender.lastSent).toMatchObject({
      toEmail: "routeuser@example.com",
      purpose: "verification",
    });
    expect(sender.lastSent?.magicLinkUrl).toContain("next=%2Faccount%3Fverify%3Dsent");
    const [user] = await env.db
      .select()
      .from(users)
      .where(eq(users.email, "routeuser@example.com"))
      .limit(1);
    expect(user).toMatchObject({
      username: "route_user",
      emailVerifiedAt: null,
    });
    const setCookie = response.headers.getSetCookie().join("; ");
    const sessionValue = cookieValue(setCookie, SESSION_COOKIE_NAME);
    expect(sessionValue).toBeTruthy();
    const session = await validateSessionCookie(sessionValue, runtime.deps!);
    expect(session.userId).toBe(user?.id);
  });

  it("password-reset returns the same success shape for unknown emails without sending", async () => {
    const anon = await createSession({ userId: null }, runtime.deps!);
    const headers = sessionHeaders(anon.cookieValue, anon.session.csrfSecret);

    const response = await passwordResetPost(
      req("/api/auth/password-reset", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ email: "missing@example.com" }),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(sender.lastSent).toBeNull();
    await expect(env.db.select().from(magicLinkTokens)).resolves.toHaveLength(1);
  });

  it("password-reset sends a reset-purpose link for existing accounts", async () => {
    const userId = await insertUser("reset-route@example.com", testCredential("old"));
    const auth = await createSession({ userId }, runtime.deps!);
    const headers = sessionHeaders(auth.cookieValue, auth.session.csrfSecret);

    const response = await passwordResetPost(
      req("/api/auth/password-reset", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ email: "reset-route@example.com" }),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(sender.lastSent).toMatchObject({
      toEmail: "reset-route@example.com",
      purpose: "reset",
    });
    expect(sender.lastSent?.magicLinkUrl).toContain("next=%2Faccount%3Fset_new_password%3D1");
  });

  it("password-reset keeps the generic 202 response when the sender fails for an existing account", async () => {
    const userId = await insertUser("reset-fail-route@example.com", testCredential("old"));
    const auth = await createSession({ userId }, runtime.deps!);
    const headers = sessionHeaders(auth.cookieValue, auth.session.csrfSecret);
    const throwingSender = new ThrowingEmailSender();
    runtime.deps = { ...runtime.deps!, sender: throwingSender };
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await passwordResetPost(
        req("/api/auth/password-reset", {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ email: "reset-fail-route@example.com" }),
        }),
      );

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toMatchObject({ ok: true });
      expect(throwingSender.calls).toBe(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        "[security]",
        expect.stringContaining("AUTH_EMAIL_DELIVERY_FAILED"),
      );
      expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain("reset provider down");
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("resend-verification sends only while the signed-in account is unverified", async () => {
    const unverifiedUserId = await insertUser("needs-verify@example.com", testCredential("pw"));
    const unverifiedAuth = await createSession({ userId: unverifiedUserId }, runtime.deps!);
    const unverifiedHeaders = sessionHeaders(
      unverifiedAuth.cookieValue,
      unverifiedAuth.session.csrfSecret,
    );

    const unverified = await resendVerificationPost(
      req("/api/auth/resend-verification", {
        method: "POST",
        headers: { ...unverifiedHeaders, "content-type": "application/json" },
      }),
    );

    expect(unverified.status).toBe(202);
    await expect(unverified.json()).resolves.toMatchObject({ ok: true });
    expect(sender.lastSent).toMatchObject({
      toEmail: "needs-verify@example.com",
      purpose: "verification",
    });

    sender.lastSent = null;
    const verifiedUserId = await insertUser("already-verified@example.com", testCredential("pw"));
    await env.db
      .update(users)
      .set({ emailVerifiedAt: new Date(NOW) })
      .where(eq(users.id, verifiedUserId));
    const verifiedAuth = await createSession({ userId: verifiedUserId }, runtime.deps!);
    const verifiedHeaders = sessionHeaders(
      verifiedAuth.cookieValue,
      verifiedAuth.session.csrfSecret,
    );

    const verified = await resendVerificationPost(
      req("/api/auth/resend-verification", {
        method: "POST",
        headers: { ...verifiedHeaders, "content-type": "application/json" },
      }),
    );

    expect(verified.status).toBe(202);
    await expect(verified.json()).resolves.toMatchObject({ ok: true });
    expect(sender.lastSent).toBeNull();
  });
});

function req(path: string, init: RequestInit = {}): NextRequest {
  return new NextRequest(new Request(`https://www.wcdraft.test${path}`, init));
}

async function insertUser(email: string, password?: string): Promise<string> {
  const passwordHash = password ? await hashPassword(password) : null;
  const [row] = await env.db
    .insert(users)
    .values({
      email,
      passwordHash,
      passwordSetAt: passwordHash ? new Date(NOW - 1_000) : null,
    })
    .returning({ id: users.id });
  if (!row) throw new Error("insertUser failed");
  return row.id;
}

async function readUser(userId: string): Promise<typeof users.$inferSelect | undefined> {
  const rows = await env.db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0];
}

function testCredential(label: string): string {
  return `fixture ${label} 42`;
}

function sessionHeaders(
  cookieValue: string,
  csrfSecret: string,
  extraCookies: Record<string, string> = {},
): Record<string, string> {
  const cookiePairs: Array<readonly [string, string]> = [
    [SESSION_COOKIE_NAME, cookieValue],
    [CSRF_COOKIE_NAME, csrfSecret],
    ...Object.entries(extraCookies),
  ];
  return {
    cookie: cookiePairs.map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; "),
    host: "www.wcdraft.test",
    origin: "https://www.wcdraft.test",
    [CSRF_HEADER_NAME]: csrfSecret,
  };
}

function cookieValue(setCookieHeader: string, name: string): string {
  const match = setCookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1] ?? "") : "";
}

async function expectAuthRequired(response: Response): Promise<void> {
  expect(response.status).toBe(401);
  await expect(response.json()).resolves.toMatchObject({
    error: "SESSION_INVALID",
  });
}

class ThrowingEmailSender implements EmailSender {
  readonly kind = "log" as const;
  calls = 0;

  async sendMagicLink(): Promise<void> {
    this.calls += 1;
    throw new Error("reset provider down");
  }
}
