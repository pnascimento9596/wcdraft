import { describe, it, expect } from "vitest";

import {
  createRecentMagicCookieValue,
  verifyRecentMagicCookieValue,
  RECENT_MAGIC_TTL_MS,
} from "../recent-magic";
import { testCookieSecret } from "./_test-db";

describe("recent magic-link proof cookie", () => {
  it("validates only for the same session and user inside the short window", () => {
    const secret = testCookieSecret("recent-magic");
    const now = Date.UTC(2026, 5, 30, 12, 0, 0);
    const value = createRecentMagicCookieValue({
      sessionId: "session-a",
      userId: "user-a",
      now,
      cookieSecret: secret,
    });

    expect(
      verifyRecentMagicCookieValue(value, {
        sessionId: "session-a",
        userId: "user-a",
        now: now + RECENT_MAGIC_TTL_MS - 1,
        cookieSecret: secret,
      }),
    ).toBe(true);
    expect(
      verifyRecentMagicCookieValue(value, {
        sessionId: "session-b",
        userId: "user-a",
        now,
        cookieSecret: secret,
      }),
    ).toBe(false);
    expect(
      verifyRecentMagicCookieValue(value, {
        sessionId: "session-a",
        userId: "user-a",
        now: now + RECENT_MAGIC_TTL_MS + 1,
        cookieSecret: secret,
      }),
    ).toBe(false);
  });
});
