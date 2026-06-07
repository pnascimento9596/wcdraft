// F-2 — anon session + role gate.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { setupTestDb, testCookieSecret } from "./_test-db";
import {
  ensureSession,
  requireAuthenticatedSession,
} from "@/lib/auth/anon-session";
import { createSession, signCookie, validateSessionCookie } from "@/lib/auth/sessions";
import { users } from "@wcdraft/db";

let env: Awaited<ReturnType<typeof setupTestDb>>;
const SECRET = testCookieSecret("anon");

beforeAll(async () => {
  env = await setupTestDb();
});
afterEach(async () => {
  await env.reset();
});

function deps(now: number) {
  return { db: env.db, now: () => now, cookieSecret: SECRET };
}

describe("ensureSession", () => {
  it("issues a fresh anonymous session when no cookie is present", async () => {
    const r = await ensureSession(null, deps(Date.UTC(2026, 5, 1)));
    expect(r.fresh).toBe(true);
    expect(r.session.userId).toBeNull();
    expect(r.cookieValue).toMatch(/\./);
  });

  it("returns the existing session when the cookie is valid", async () => {
    const now = Date.UTC(2026, 5, 1);
    const created = await createSession({ userId: null }, deps(now));
    const r = await ensureSession(created.cookieValue, deps(now + 1));
    expect(r.fresh).toBe(false);
    expect(r.session.id).toBe(created.session.id);
  });

  it("issues a fresh session when the cookie was tampered (does not throw)", async () => {
    const r = await ensureSession("badcookie.value", deps(Date.UTC(2026, 5, 1)));
    expect(r.fresh).toBe(true);
    expect(r.session.userId).toBeNull();
  });
});

describe("requireAuthenticatedSession (role gate)", () => {
  it("ANON_FORBIDDEN when the session has no user_id", async () => {
    const now = Date.UTC(2026, 5, 1);
    const anon = await createSession({ userId: null }, deps(now));
    await expect(
      requireAuthenticatedSession(anon.cookieValue, deps(now + 1)),
    ).rejects.toMatchObject({ code: "ANON_FORBIDDEN" });
  });

  it("returns the session when user_id is set", async () => {
    const now = Date.UTC(2026, 5, 1);
    const [user] = await env.db
      .insert(users)
      .values({ email: "real@example.com" })
      .returning();
    const auth = await createSession({ userId: user!.id }, deps(now));
    const session = await requireAuthenticatedSession(
      auth.cookieValue,
      deps(now + 1),
    );
    expect(session.userId).toBe(user!.id);
  });

  it("SESSION_INVALID when cookie is missing entirely", async () => {
    await expect(
      requireAuthenticatedSession(null, deps(Date.UTC(2026, 5, 1))),
    ).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });
});

describe("cross-user isolation", () => {
  it("user A's session cookie validates only to user A's row", async () => {
    const now = Date.UTC(2026, 5, 1);
    const [a] = await env.db
      .insert(users)
      .values({ email: "a@example.com" })
      .returning();
    const [b] = await env.db
      .insert(users)
      .values({ email: "b@example.com" })
      .returning();
    const sa = await createSession({ userId: a!.id }, deps(now));
    const sb = await createSession({ userId: b!.id }, deps(now));
    expect(sa.session.id).not.toBe(sb.session.id);
    const va = await validateSessionCookie(sa.cookieValue, deps(now + 1));
    const vb = await validateSessionCookie(sb.cookieValue, deps(now + 1));
    expect(va.userId).toBe(a!.id);
    expect(vb.userId).toBe(b!.id);
  });

  it("user A's cookie signature does NOT validate against user B's session id", async () => {
    const now = Date.UTC(2026, 5, 1);
    const [a] = await env.db
      .insert(users)
      .values({ email: "ax@example.com" })
      .returning();
    const [b] = await env.db
      .insert(users)
      .values({ email: "bx@example.com" })
      .returning();
    const sa = await createSession({ userId: a!.id }, deps(now));
    const sb = await createSession({ userId: b!.id }, deps(now));
    // Swap signatures across session ids.
    const [, sigA] = sa.cookieValue.split(".");
    const forged = `${sb.session.id}.${sigA ?? ""}`;
    await expect(
      validateSessionCookie(forged, deps(now + 1)),
    ).rejects.toMatchObject({ code: "SESSION_TAMPERED" });
  });

  it("re-signing user A's session id with a wrong secret is rejected", async () => {
    const now = Date.UTC(2026, 5, 1);
    const [a] = await env.db
      .insert(users)
      .values({ email: "ay@example.com" })
      .returning();
    const sa = await createSession({ userId: a!.id }, deps(now));
    const wrongSecret = `${SECRET.slice(0, -1)}Z`;
    const forged = signCookie(sa.session.id, wrongSecret);
    await expect(
      validateSessionCookie(forged, deps(now + 1)),
    ).rejects.toMatchObject({ code: "SESSION_TAMPERED" });
  });
});
