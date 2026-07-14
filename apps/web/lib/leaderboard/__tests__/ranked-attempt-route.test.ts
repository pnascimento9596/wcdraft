import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { rankedAttempts, users } from "@wcdraft/db";

import { createSession } from "../../auth/sessions";
import { setupTestDb, testCookieSecret } from "../../auth/__tests__/_test-db";
import { handleRankedAttemptPost, type RankedAttemptRouteDeps } from "../ranked-attempt-route";
import {
  RANKED_ATTEMPT_RATE_LIMIT_STORE_RETRY_AFTER_SECONDS,
  RANKED_ATTEMPT_SWEEP_LIMIT,
  RANKED_ATTEMPT_TTL_MS,
} from "../ranked-attempts";

const SECRET = testCookieSecret("ranked-attempt-route");
const NOW = Date.UTC(2026, 5, 29, 12);
const CURRENT_SEASON = "season-2026-squad-depth";

const { db, pg, reset } = await setupTestDb();
afterAll(async () => pg.close());
beforeEach(async () => reset());

function makeDeps(overrides: Partial<RankedAttemptRouteDeps> = {}): RankedAttemptRouteDeps {
  return {
    db,
    now: () => NOW,
    getCookieSecret: () => SECRET,
    currentSeasonKey: () => CURRENT_SEASON,
    randomBytes: (size) => new Uint8Array(size).fill(7),
    ...overrides,
  };
}

async function accountReqOpts(): Promise<Record<string, string>> {
  const user = await db
    .insert(users)
    .values({
      email: "ranked-attempt@example.com",
      username: "ranked_attempt",
      emailVerifiedAt: new Date(NOW),
    })
    .returning();
  const { session, cookieValue } = await createSession(
    { userId: user[0]!.id },
    { db, now: () => NOW, cookieSecret: SECRET },
  );
  return {
    cookie: `wcdraft_sid=${encodeURIComponent(cookieValue)}; wcdraft_csrf=${encodeURIComponent(
      session.csrfSecret,
    )}`,
    "x-csrf-token": session.csrfSecret,
    origin: "http://localhost",
    host: "localhost",
  };
}

function makeReq(opts: { headers?: Record<string, string>; body?: unknown } = {}): NextRequest {
  return new NextRequest("http://localhost/api/ranked/attempt", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.headers ?? {}),
    },
    body: JSON.stringify(
      opts.body ?? {
        formation_id: "4-3-3",
        draft_mode: "classic",
        draft_order: "squad_first",
        era: "all_time",
        rating_basis: "career",
      },
    ),
  });
}

describe("POST /api/ranked/attempt", () => {
  it("requires an account-bound session and CSRF", async () => {
    const res = await handleRankedAttemptPost(makeReq(), makeDeps());
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("AUTH_REQUIRED");
    expect(await db.select().from(rankedAttempts)).toHaveLength(0);
  });

  it("requires verified email for account-bound ranked attempts", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: "unverified-attempt@example.com", username: "unverified_attempt" })
      .returning();
    const { session, cookieValue } = await createSession(
      { userId: user!.id },
      { db, now: () => NOW, cookieSecret: SECRET },
    );
    const res = await handleRankedAttemptPost(
      makeReq({
        headers: {
          cookie: `wcdraft_sid=${encodeURIComponent(cookieValue)}; wcdraft_csrf=${encodeURIComponent(
            session.csrfSecret,
          )}`,
          "x-csrf-token": session.csrfSecret,
          origin: "http://localhost",
          host: "localhost",
        },
      }),
      makeDeps(),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: "VERIFICATION_REQUIRED",
      resend_verification: "/api/auth/resend-verification",
    });
    expect(await db.select().from(rankedAttempts)).toHaveLength(0);
  });

  it("mints a server parent seed bound to user, season, formation, and board config", async () => {
    const headers = await accountReqOpts();
    const res = await handleRankedAttemptPost(makeReq({ headers }), makeDeps());
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      attempt_id: string;
      parent_seed: string;
      expires_at: string;
      season_key: string;
      formation_id: string;
      draft_mode: string;
      draft_order: string;
      era: string;
      rating_basis: string;
    };
    expect(body.parent_seed).toMatch(/^wcdraft:ranked:v1:/);
    expect(body.expires_at).toBe(new Date(NOW + RANKED_ATTEMPT_TTL_MS).toISOString());
    expect(body).toMatchObject({
      season_key: CURRENT_SEASON,
      formation_id: "4-3-3",
      draft_mode: "classic",
      draft_order: "squad_first",
      era: "all_time",
      rating_basis: "career",
    });

    const rows = await db.select().from(rankedAttempts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: body.attempt_id,
      issuedParentSeed: body.parent_seed,
      seasonKey: CURRENT_SEASON,
      formationId: "4-3-3",
      draftMode: "classic",
      draftOrder: "squad_first",
      era: "all_time",
      ratingBasis: "career",
      consumedAt: null,
    });
  });

  it("reuses the same live attempt for the same user, season, formation, and config", async () => {
    const headers = await accountReqOpts();
    let randomCalls = 0;
    const deps = makeDeps({
      randomBytes: (size) => new Uint8Array(size).fill(++randomCalls),
    });

    const first = await handleRankedAttemptPost(makeReq({ headers }), deps);
    const second = await handleRankedAttemptPost(makeReq({ headers }), deps);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(randomCalls).toBe(1);
    expect(await db.select().from(rankedAttempts)).toHaveLength(1);
  });

  it("returns the newest legacy attempt and retires every superseded live seed", async () => {
    const headers = await accountReqOpts();
    const [user] = await db.select().from(users);
    expect(user).toBeDefined();
    const legacyCount = RANKED_ATTEMPT_SWEEP_LIMIT + 5;
    await db.insert(rankedAttempts).values(
      Array.from({ length: legacyCount }, (_, index) => ({
        userId: user!.id,
        sessionId: null,
        seasonKey: CURRENT_SEASON,
        formationId: "4-3-3",
        draftMode: "classic",
        draftOrder: "squad_first",
        era: "all_time",
        ratingBasis: "career",
        issuedParentSeed: `wcdraft:ranked:v1:legacy-${index.toString().padStart(16, "0")}`,
        nonce: `legacy-nonce-${index.toString().padStart(16, "0")}`,
        issuedAt: new Date(NOW - (legacyCount - index) * 1_000),
        windowExpiresAt: new Date(NOW + RANKED_ATTEMPT_TTL_MS),
      })),
    );

    const response = await handleRankedAttemptPost(
      makeReq({ headers }),
      makeDeps({
        randomBytes: () => {
          throw new Error("legacy reuse must not mint");
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      parent_seed: `wcdraft:ranked:v1:legacy-${(legacyCount - 1).toString().padStart(16, "0")}`,
    });
    const rows = await db.select().from(rankedAttempts);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.issuedParentSeed).toBe(
      `wcdraft:ranked:v1:legacy-${(legacyCount - 1).toString().padStart(16, "0")}`,
    );
  });

  it("serializes concurrent same-config issuance so callers cannot farm seeds", async () => {
    const headers = await accountReqOpts();
    let randomCalls = 0;
    const deps = makeDeps({
      randomBytes: (size) => new Uint8Array(size).fill(++randomCalls),
    });

    const responses = await Promise.all(
      Array.from({ length: 8 }, () => handleRankedAttemptPost(makeReq({ headers }), deps)),
    );
    const bodies = await Promise.all(responses.map((response) => response.json()));

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 200, 200, 200, 200, 200, 200, 201,
    ]);
    expect(new Set(bodies.map((body) => JSON.stringify(body)))).toHaveLength(1);
    expect(randomCalls).toBe(1);
    expect(await db.select().from(rankedAttempts)).toHaveLength(1);
  });

  it("isolates live attempts by formation and full board config", async () => {
    const headers = await accountReqOpts();
    let randomCalls = 0;
    const deps = makeDeps({
      randomBytes: (size) => new Uint8Array(size).fill(++randomCalls),
    });
    const base = {
      formation_id: "4-3-3",
      draft_mode: "classic",
      draft_order: "squad_first",
      era: "all_time",
      rating_basis: "career",
    };
    const configs = [
      base,
      { ...base, formation_id: "4-4-2" },
      { ...base, draft_mode: "hidden" },
      { ...base, draft_order: "position_first" },
      { ...base, era: "post_2010" },
      { ...base, rating_basis: "current" },
    ];
    const bodies: Array<{ attempt_id: string; parent_seed: string }> = [];

    for (const body of configs) {
      const response = await handleRankedAttemptPost(makeReq({ headers, body }), deps);
      expect(response.status).toBe(201);
      bodies.push((await response.json()) as { attempt_id: string; parent_seed: string });
    }

    expect(new Set(bodies.map((body) => body.attempt_id))).toHaveLength(configs.length);
    expect(new Set(bodies.map((body) => body.parent_seed))).toHaveLength(configs.length);
    expect(randomCalls).toBe(configs.length);
    expect(await db.select().from(rankedAttempts)).toHaveLength(configs.length);
  });

  it("mints after expiry and lazily removes the expired unconsumed attempt", async () => {
    const headers = await accountReqOpts();
    let now = NOW;
    let randomCalls = 0;
    const deps = makeDeps({
      now: () => now,
      randomBytes: (size) => new Uint8Array(size).fill(++randomCalls),
    });

    const first = await handleRankedAttemptPost(makeReq({ headers }), deps);
    const firstBody = (await first.json()) as { attempt_id: string; parent_seed: string };
    now += RANKED_ATTEMPT_TTL_MS + 1;
    const second = await handleRankedAttemptPost(makeReq({ headers }), deps);
    const secondBody = (await second.json()) as { attempt_id: string; parent_seed: string };

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(secondBody.attempt_id).not.toBe(firstBody.attempt_id);
    expect(secondBody.parent_seed).not.toBe(firstBody.parent_seed);
    expect(randomCalls).toBe(2);
    const rows = await db.select().from(rankedAttempts);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(secondBody.attempt_id);
  });

  it("bounds the per-user lazy sweep while cleaning expired attempts across configs", async () => {
    const headers = await accountReqOpts();
    const [user] = await db.select().from(users);
    expect(user).toBeDefined();
    await db.insert(rankedAttempts).values(
      Array.from({ length: RANKED_ATTEMPT_SWEEP_LIMIT + 5 }, (_, index) => ({
        userId: user!.id,
        sessionId: null,
        seasonKey: CURRENT_SEASON,
        formationId: `expired-${index.toString()}`,
        draftMode: "classic",
        draftOrder: "squad_first",
        era: "all_time",
        ratingBasis: "career",
        issuedParentSeed: `expired-seed-${index.toString().padStart(16, "0")}`,
        nonce: `expired-nonce-${index.toString().padStart(16, "0")}`,
        issuedAt: new Date(NOW - RANKED_ATTEMPT_TTL_MS - 2_000 - index),
        windowExpiresAt: new Date(NOW - 1_000),
      })),
    );

    const response = await handleRankedAttemptPost(makeReq({ headers }), makeDeps());

    expect(response.status).toBe(201);
    const rows = await db.select().from(rankedAttempts);
    expect(rows).toHaveLength(6);
    expect(rows.filter((row) => row.windowExpiresAt.getTime() <= NOW)).toHaveLength(5);
  });

  it("rate-limits repeated idempotent requests without reminting the live attempt", async () => {
    const headers = await accountReqOpts();
    let randomCalls = 0;
    const deps = makeDeps({
      randomBytes: (size) => new Uint8Array(size).fill(++randomCalls),
    });
    const allowedBodies: unknown[] = [];

    for (let i = 0; i < 10; i += 1) {
      const response = await handleRankedAttemptPost(makeReq({ headers }), deps);
      expect(response.status).toBe(i === 0 ? 201 : 200);
      allowedBodies.push(await response.json());
    }

    expect(new Set(allowedBodies.map((body) => JSON.stringify(body)))).toHaveLength(1);
    const denied = await handleRankedAttemptPost(makeReq({ headers }), deps);
    expect(denied.status).toBe(429);
    expect(await denied.json()).toMatchObject({ error: "RATE_LIMITED" });
    expect(denied.headers.get("Retry-After")).toBe("3600");
    expect(randomCalls).toBe(1);
    expect(await db.select().from(rankedAttempts)).toHaveLength(1);
  });

  it("fails closed with typed 429 when the issuance limiter store errors", async () => {
    const headers = await accountReqOpts();
    const response = await handleRankedAttemptPost(
      makeReq({ headers }),
      makeDeps({
        consumeIssueRateLimit: () => Promise.reject(new Error("neon down")),
      }),
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: "RATE_LIMITED" });
    expect(response.headers.get("Retry-After")).toBe(
      String(RANKED_ATTEMPT_RATE_LIMIT_STORE_RETRY_AFTER_SECONDS),
    );
    expect(await db.select().from(rankedAttempts)).toHaveLength(0);
  });

  it("rate-limits new seeds per user across distinct configs", async () => {
    const headers = await accountReqOpts();
    let randomCalls = 0;
    const deps = makeDeps({
      randomBytes: (size) => new Uint8Array(size).fill(++randomCalls),
    });

    for (let i = 0; i < 10; i += 1) {
      const response = await handleRankedAttemptPost(
        makeReq({
          headers,
          body: {
            formation_id: `formation-${i.toString()}`,
            draft_mode: "classic",
            draft_order: "squad_first",
            era: "all_time",
            rating_basis: "career",
          },
        }),
        deps,
      );
      expect(response.status).toBe(201);
    }

    const denied = await handleRankedAttemptPost(
      makeReq({
        headers,
        body: {
          formation_id: "formation-10",
          draft_mode: "classic",
          draft_order: "squad_first",
          era: "all_time",
          rating_basis: "career",
        },
      }),
      deps,
    );
    expect(denied.status).toBe(429);
    expect(await denied.json()).toMatchObject({ error: "RATE_LIMITED" });
    expect(denied.headers.get("Retry-After")).toBe("3600");
    expect(randomCalls).toBe(10);
    expect(await db.select().from(rankedAttempts)).toHaveLength(10);
  });

  it("rejects invalid config before inserting", async () => {
    const headers = await accountReqOpts();
    const res = await handleRankedAttemptPost(
      makeReq({ headers, body: { formation_id: "4-3-3", draft_mode: "classic" } }),
      makeDeps(),
    );
    expect(res.status).toBe(400);
    expect(await db.select().from(rankedAttempts)).toHaveLength(0);
  });
});
