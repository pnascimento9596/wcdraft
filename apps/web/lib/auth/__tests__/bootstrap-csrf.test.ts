import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { leaderboardEntries, sessions, users } from "@wcdraft/db";
import { eq, sql } from "drizzle-orm";

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

  it("still reaps safe expired sessions when one id is blocked by pre-binding ranked SET NULL", async () => {
    // Production shape: a pre-0012 ranked row with NULL attempt_id still
    // references an expired session. ON DELETE SET NULL re-validates
    // leaderboard_entries_ranked_attempt_binding_chk and aborts the batch.
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

    // Seed a NOT VALID-shaped legacy ranked row (cannot INSERT under the live
    // CHECK). Drop/re-add the binding check the same way production migration
    // 0012 did so the row can exist while remaining non-updatable via SET NULL.
    await env.db.execute(sql`
      ALTER TABLE leaderboard_entries
        DROP CONSTRAINT IF EXISTS leaderboard_entries_ranked_attempt_binding_chk
    `);
    await env.db.execute(sql`
      ALTER TABLE leaderboard_entries
        DROP CONSTRAINT IF EXISTS leaderboard_entries_ranked_attempt_chk
    `);
    await env.db.insert(leaderboardEntries).values({
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
    await env.db.execute(sql`
      ALTER TABLE leaderboard_entries
        ADD CONSTRAINT leaderboard_entries_ranked_attempt_chk
        CHECK (mode <> 'ranked' OR attempt_id IS NOT NULL) NOT VALID
    `);
    await env.db.execute(sql`
      ALTER TABLE leaderboard_entries
        ADD CONSTRAINT leaderboard_entries_ranked_attempt_binding_chk
        CHECK (
          mode <> 'ranked'
          OR (
            attempt_id IS NOT NULL
            AND user_id IS NOT NULL
            AND attempt_formation_id IS NOT NULL
            AND draft_order IS NOT NULL
            AND era IS NOT NULL
            AND rating_basis IS NOT NULL
            AND attempt_consumed_at IS NOT NULL
          )
        ) NOT VALID
    `);

    // Prove the cascade is still poison: deleting the blocked session alone fails.
    let poisonMessage = "";
    try {
      await env.db.delete(sessions).where(eq(sessions.id, "poison-expired"));
      throw new Error("expected poison session delete to fail");
    } catch (error) {
      poisonMessage = error instanceof Error ? error.message : String(error);
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
      const combined = `${poisonMessage}\n${cause}`;
      expect(combined).toMatch(/ranked_attempt_binding_chk|check constraint|Failed query/i);
    }

    const deleted = await sweepExpiredSessions({ db: env.db, now: () => now }, 250);
    expect(deleted).toBe(1);
    const remaining = (await env.db.select({ id: sessions.id }).from(sessions))
      .map((row) => row.id)
      .sort();
    expect(remaining).toEqual(["live-ok", "poison-expired"]);
    // Poison message must not leak into the returned count path (best-effort).
    expect(poisonMessage.length).toBeGreaterThan(0);
  });
});
