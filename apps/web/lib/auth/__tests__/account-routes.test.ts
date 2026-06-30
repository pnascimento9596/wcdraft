import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { users } from "@wcdraft/db";

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
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/lib/auth/csrf";
import { LogEmailSender } from "@/lib/auth/email";
import { hashPassword, verifyPasswordHash } from "@/lib/auth/passwords";
import { createRecentMagicCookieValue, RECENT_MAGIC_COOKIE_NAME } from "@/lib/auth/recent-magic";
import { createSession, SESSION_COOKIE_NAME } from "@/lib/auth/sessions";
import { setupTestDb, testCookieSecret } from "./_test-db";

const env = await setupTestDb();
const COOKIE_SECRET = testCookieSecret("account-routes");
const NOW = Date.UTC(2026, 5, 30, 12, 0, 0);

afterAll(async () => env.pg.close());
afterEach(async () => env.reset());

beforeEach(() => {
  runtime.deps = {
    db: env.db,
    now: () => NOW,
    cookieSecret: COOKIE_SECRET,
    sender: new LogEmailSender(() => {}),
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

async function expectAuthRequired(response: Response): Promise<void> {
  expect(response.status).toBe(401);
  await expect(response.json()).resolves.toMatchObject({
    error: "SESSION_INVALID",
  });
}
