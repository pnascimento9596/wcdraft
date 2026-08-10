import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { leaderboardEntries, sessions, users } from "@wcdraft/db";
import type { Db } from "@wcdraft/db";

import { setupTestDb, testCookieSecret } from "./_test-db";
import {
  BOOTSTRAP_CSRF_TTL_MS,
  createBootstrapCsrf,
  materializeBootstrapSession,
  verifyBootstrapCsrf,
} from "@/lib/auth/bootstrap-csrf";
import { sweepExpiredSessions } from "@/lib/auth/sessions";

let env: Awaited<ReturnType<typeof setupTestDb>>;
const COOKIE_SECRET = testCookieSecret("bootstrap-csrf");

beforeAll(async () => {
  env = await setupTestDb();
});
afterEach(async () => {
  await env.reset();
});

describe("stateless CSRF bootstrap", () => {
  it("creates no durable sessions for 50 cookie-less bootstrap reads", async () => {
    const now = Date.UTC(2026, 6, 11);
    for (let index = 0; index < 50; index += 1) {
      const bootstrap = createBootstrapCsrf({ now: now + index, cookieSecret: COOKIE_SECRET });
      expect(
        verifyBootstrapCsrf(bootstrap.cookieValue, {
          now: now + index,
          cookieSecret: COOKIE_SECRET,
        }).csrfSecret,
      ).toBe(bootstrap.csrfSecret);
    }
    expect(await env.db.select().from(sessions)).toHaveLength(0);
  });

  it("materializes concurrent replays into exactly one durable session", async () => {
    const now = Date.UTC(2026, 6, 11);
    const bootstrap = createBootstrapCsrf({ now, cookieSecret: COOKIE_SECRET });
    const args = {
      bootstrapCookieValue: bootstrap.cookieValue,
      csrfCookieValue: bootstrap.csrfSecret,
      csrfHeaderValue: bootstrap.csrfSecret,
    };
    const deps = { db: env.db, now: () => now + 1, cookieSecret: COOKIE_SECRET };
    const results = await Promise.all([
      materializeBootstrapSession(args, deps),
      materializeBootstrapSession(args, deps),
    ]);
    expect(results[0]?.session.id).toBe(results[1]?.session.id);
    expect(await env.db.select().from(sessions)).toHaveLength(1);
  });

  it("rejects tampering and expiry before any row is written", async () => {
    const now = Date.UTC(2026, 6, 11);
    const bootstrap = createBootstrapCsrf({ now, cookieSecret: COOKIE_SECRET });
    const tamperedParts = bootstrap.cookieValue.split(".");
    const signature = tamperedParts[4];
    if (!signature) throw new Error("bootstrap signature missing");
    // Mutate the first base64url sextet, whose bits are all significant. The
    // previous last-character mutation could change only unused padding bits
    // and therefore decode to the original HMAC for some random signatures.
    tamperedParts[4] = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    const tamperedCookieValue = tamperedParts.join(".");
    expect(tamperedCookieValue).not.toBe(bootstrap.cookieValue);
    await expect(
      materializeBootstrapSession(
        {
          bootstrapCookieValue: tamperedCookieValue,
          csrfCookieValue: bootstrap.csrfSecret,
          csrfHeaderValue: bootstrap.csrfSecret,
        },
        { db: env.db, now: () => now + 1, cookieSecret: COOKIE_SECRET },
      ),
    ).rejects.toMatchObject({ code: "CSRF_MISMATCH" });
    expect(() =>
      verifyBootstrapCsrf(bootstrap.cookieValue, {
        now: now + BOOTSTRAP_CSRF_TTL_MS,
        cookieSecret: COOKIE_SECRET,
      }),
    ).toThrow(expect.objectContaining({ code: "CSRF_MISMATCH" }));
    expect(await env.db.select().from(sessions)).toHaveLength(0);
  });
});

describe("expired-session sweep", () => {
  it("deletes only the bounded expired set", async () => {
    const now = Date.UTC(2026, 6, 11);
    await env.db.insert(sessions).values([
      { id: "expired-a", csrfSecret: "csrf-a", expiresAt: new Date(now - 2) },
      { id: "expired-b", csrfSecret: "csrf-b", expiresAt: new Date(now - 1) },
      { id: "live", csrfSecret: "csrf-live", expiresAt: new Date(now + 1) },
    ]);
    expect(await sweepExpiredSessions({ db: env.db, now: () => now }, 1)).toBe(1);
    expect((await env.db.select().from(sessions)).map((row) => row.id).sort()).toEqual([
      "expired-b",
      "live",
    ]);
  });

  it("reaps the exact exempt pre-binding session and the safe session in one batch", async () => {
    const now = Date.UTC(2026, 6, 21);
    const userRows = await env.db
      .insert(users)
      .values({
        email: "ranked-legacy@example.invalid",
        username: "chezwizz_test",
      })
      .returning({ id: users.id });
    const userId = userRows[0]?.id;
    if (!userId) throw new Error("user insert failed");

    await env.db.insert(sessions).values([
      {
        id: "poison-expired",
        userId,
        csrfSecret: "csrf-poison",
        expiresAt: new Date(now - 10),
      },
      {
        id: "safe-expired",
        csrfSecret: "csrf-safe",
        expiresAt: new Date(now - 5),
      },
      {
        id: "live-ok",
        csrfSecret: "csrf-live",
        expiresAt: new Date(now + 60_000),
      },
    ]);

    await env.db.insert(leaderboardEntries).values({
      id: "4dc1df8e-530d-47c3-9364-5e6beea571a2",
      seasonKey: "engine-legacy-pre-binding",
      mode: "ranked",
      draftMode: "classic",
      draftOrder: "squad_first",
      era: "all_time",
      ratingBasis: "career",
      userId,
      sessionId: "poison-expired",
      attemptId: null,
      displayAlias: null,
      token: "legacy-ranked-token",
      verifiedScore: 23,
      scoreBreakdown: [],
    });

    let deleteCalls = 0;
    const observedDb = new Proxy(env.db, {
      get(target, property, receiver) {
        if (property !== "delete") return Reflect.get(target, property, receiver);
        return (...args: Parameters<Db["delete"]>) => {
          deleteCalls += 1;
          return target.delete(...args);
        };
      },
    });
    const deleted = await sweepExpiredSessions({ db: observedDb, now: () => now }, 250);
    expect(deleted).toBe(2);
    expect(deleteCalls).toBe(1);
    const remaining = (await env.db.select({ id: sessions.id }).from(sessions))
      .map((row) => row.id)
      .sort();
    expect(remaining).toEqual(["live-ok"]);
    const legacy = await env.db
      .select({
        id: leaderboardEntries.id,
        sessionId: leaderboardEntries.sessionId,
        userId: leaderboardEntries.userId,
        token: leaderboardEntries.token,
        verifiedScore: leaderboardEntries.verifiedScore,
      })
      .from(leaderboardEntries);
    expect(legacy).toEqual([
      {
        id: "4dc1df8e-530d-47c3-9364-5e6beea571a2",
        sessionId: null,
        userId,
        token: "legacy-ranked-token",
        verifiedScore: 23,
      },
    ]);
  });
});
