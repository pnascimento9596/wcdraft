import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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
import { CSRF_HEADER_NAME } from "@/lib/auth/csrf";
import { LogEmailSender } from "@/lib/auth/email";
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
});

function req(path: string, init: RequestInit = {}): NextRequest {
  return new NextRequest(new Request(`https://www.wcdraft.test${path}`, init));
}

function sessionHeaders(cookieValue: string, csrfSecret: string): Record<string, string> {
  return {
    cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(cookieValue)}`,
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
