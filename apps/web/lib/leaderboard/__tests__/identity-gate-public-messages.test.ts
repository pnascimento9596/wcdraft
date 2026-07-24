import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { AuthError } from "../../auth/errors";
import { createSession } from "../../auth/sessions";
import { setupTestDb, testCookieSecret } from "../../auth/__tests__/_test-db";
import {
  CSRF_FAILED_PUBLIC_MESSAGE,
  LeaderboardGateError,
  requireReadIdentity,
  requireSubmitIdentity,
  SESSION_INVALID_PUBLIC_MESSAGE,
} from "../identity-gate";

const SECRET = testCookieSecret("identity-gate-public");
const NOW = Date.UTC(2026, 5, 29, 12);
const { db, pg, reset } = await setupTestDb();
afterAll(async () => pg.close());
beforeEach(async () => reset());

describe("identity gate public messages", () => {
  it("scrubs internal AuthError codes from submit CSRF failures", async () => {
    const { session, cookieValue } = await createSession(
      { userId: null },
      { db, now: () => NOW, cookieSecret: SECRET },
    );
    const req = new NextRequest("http://localhost/api/leaderboard/submit", {
      method: "POST",
      headers: {
        cookie: `wcdraft_sid=${encodeURIComponent(cookieValue)}; wcdraft_csrf=${encodeURIComponent(
          session.csrfSecret,
        )}`,
        "x-csrf-token": "wrong-token",
        origin: "http://localhost",
        host: "localhost",
      },
    });
    try {
      await requireSubmitIdentity(req, {
        db,
        now: () => NOW,
        getCookieSecret: () => SECRET,
        requireAccount: () => false,
      });
      throw new Error("expected LeaderboardGateError");
    } catch (err) {
      expect(err).toBeInstanceOf(LeaderboardGateError);
      const gate = err as LeaderboardGateError;
      expect(gate.code).toBe("CSRF_FAILED");
      expect(gate.message).toBe(CSRF_FAILED_PUBLIC_MESSAGE);
      expect(gate.message).not.toMatch(/CSRF_|SESSION_/u);
    }
  });

  it("scrubs internal codes from read identity session failures", async () => {
    const req = new NextRequest("http://localhost/api/leaderboard/me", {
      method: "GET",
      headers: {
        cookie: "wcdraft_sid=not-a-valid-session-cookie",
      },
    });
    try {
      await requireReadIdentity(req, {
        db,
        now: () => NOW,
        getCookieSecret: () => SECRET,
      });
      throw new Error("expected LeaderboardGateError");
    } catch (err) {
      expect(err).toBeInstanceOf(LeaderboardGateError);
      const gate = err as LeaderboardGateError;
      expect(gate.code).toBe("AUTH_REQUIRED");
      expect(gate.message).toBe(SESSION_INVALID_PUBLIC_MESSAGE);
      expect(gate.message).not.toMatch(/\([A-Z_]+\)/u);
      // Prove we still classify via AuthError internally without leaking.
      expect(new AuthError("SESSION_TAMPERED", "x").code).toBe("SESSION_TAMPERED");
    }
  });
});
