// F-2 — session create/validate/delete + tamper rejection (pglite-backed).
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { setupTestDb, testCookieSecret } from "./_test-db";
import {
  createSession,
  validateSessionCookie,
  deleteSession,
  signCookie,
  SESSION_TTL_MS,
} from "@/lib/auth/sessions";

let env: Awaited<ReturnType<typeof setupTestDb>>;
const SECRET = testCookieSecret("sessions");

beforeAll(async () => {
  env = await setupTestDb();
});

afterEach(async () => {
  await env.reset();
});

function depsAt(nowMs: number) {
  return { db: env.db, now: () => nowMs, cookieSecret: SECRET };
}

describe("createSession + validateSessionCookie", () => {
  it("round-trip: created cookie validates back to the same row", async () => {
    const now = Date.UTC(2026, 5, 1);
    const { session, cookieValue } = await createSession({ userId: null }, depsAt(now));
    expect(session.userId).toBeNull();
    expect(session.csrfSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const validated = await validateSessionCookie(cookieValue, depsAt(now + 1));
    expect(validated.id).toBe(session.id);
    expect(validated.csrfSecret).toBe(session.csrfSecret);
  });

  it("SESSION_INVALID when cookie is empty", async () => {
    await expect(validateSessionCookie(undefined, depsAt(0))).rejects.toMatchObject({
      code: "SESSION_INVALID",
    });
  });

  it("SESSION_TAMPERED when cookie format is broken", async () => {
    await expect(validateSessionCookie("notasignedcookie", depsAt(0))).rejects.toMatchObject({
      code: "SESSION_TAMPERED",
    });
  });

  it("SESSION_TAMPERED when signature was forged with the wrong secret", async () => {
    const now = Date.UTC(2026, 5, 1);
    const { session } = await createSession({ userId: null }, depsAt(now));
    const forged = signCookie(session.id, "different-secret-of-equal-length-padding-xxxxx");
    await expect(validateSessionCookie(forged, depsAt(now + 1))).rejects.toMatchObject({
      code: "SESSION_TAMPERED",
    });
  });

  it("SESSION_INVALID when session row was deleted (revocation works)", async () => {
    const now = Date.UTC(2026, 5, 1);
    const { session, cookieValue } = await createSession({ userId: null }, depsAt(now));
    await deleteSession(session.id, depsAt(now + 1));
    await expect(validateSessionCookie(cookieValue, depsAt(now + 2))).rejects.toMatchObject({
      code: "SESSION_INVALID",
    });
  });

  it("SESSION_EXPIRED when now >= expiresAt", async () => {
    const start = Date.UTC(2026, 5, 1);
    const { cookieValue } = await createSession({ userId: null, ttlMs: 1_000 }, depsAt(start));
    await expect(validateSessionCookie(cookieValue, depsAt(start + 1_001))).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
    });
  });

  it("SESSION_TAMPERED when payload was edited but signature was not", async () => {
    const now = Date.UTC(2026, 5, 1);
    const { session, cookieValue } = await createSession({ userId: null }, depsAt(now));
    // Replace the payload with another valid-looking but unrelated id.
    const [, sig] = cookieValue.split(".");
    const otherId = "A".repeat(43);
    const tampered = `${otherId}.${sig ?? ""}`;
    await expect(validateSessionCookie(tampered, depsAt(now + 1))).rejects.toMatchObject({
      code: "SESSION_TAMPERED",
    });
    // Original is unaffected.
    const ok = await validateSessionCookie(cookieValue, depsAt(now + 1));
    expect(ok.id).toBe(session.id);
  });

  it("default TTL is 30 days", async () => {
    const start = Date.UTC(2026, 5, 1);
    const { session } = await createSession({ userId: null }, depsAt(start));
    expect(session.expiresAt.getTime() - start).toBe(SESSION_TTL_MS);
  });
});
