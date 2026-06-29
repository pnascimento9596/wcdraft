import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { rankedAttempts, users } from "@wcdraft/db";

import { createSession } from "../../auth/sessions";
import { setupTestDb, testCookieSecret } from "../../auth/__tests__/_test-db";
import { handleRankedAttemptPost, type RankedAttemptRouteDeps } from "../ranked-attempt-route";
import { RANKED_ATTEMPT_TTL_MS } from "../ranked-attempts";

const SECRET = testCookieSecret("ranked-attempt-route");
const NOW = Date.UTC(2026, 5, 29, 12);
const CURRENT_SEASON = "season-2026-summer";

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
    .values({ email: "ranked-attempt@example.com", username: "ranked_attempt" })
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
