// F-4 U3 — POST /api/leaderboard/submit handler tests over PGlite at the
// 0004 schema shape + the REAL generated locked bundles (golden fixture tokens).
//
// Coverage per the Red gate:
//   - transport gates: content-type, declared/actual size, malformed JSON
//   - ranked lane requires signed-in account; anonymous casual stays open
//   - verdict → SUBMIT_ERROR_HTTP_STATUS mapping for every SubmitRejectionCode
//   - anonymous casual accepted (lead-architect ruling), honest rank
//   - dedupe conflict path (NULLS NOT DISTINCT, all three anon shapes)
//   - session identity + CSRF negatives (double-submit + origin)
//   - ranked account gate negatives (no cookie, anonymous, forged, expired)
//   - rate-limit seam: 429 + Retry-After, runs AFTER identity and BEFORE
//     the CPU-bound pipeline (throwing getValidation proves ordering)

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { leaderboardEntries, users } from "@wcdraft/db";

import { createSession } from "../../auth/sessions";
import { setupTestDb, testCookieSecret } from "../../auth/__tests__/_test-db";
import { decodeRunToken, type RunTokenV1Body } from "../../game/run-token";
import { getValidationData } from "../server-data";
import { RANKED_AUTH_REQUIRED_MESSAGE } from "../identity-gate";
import {
  handleLeaderboardSubmit,
  MAX_SUBMIT_BODY_BYTES,
  type SubmitRouteDeps,
} from "../submit-route";
import { allowAllSubmitRateLimiter } from "../submit-rate-limit";
import {
  createDbSubmitRateLimiter,
  STORE_ERROR_RETRY_AFTER_SECONDS,
} from "../submit-rate-limiter-db";
import type { ValidationData } from "../validate";
import { encodeBody } from "./_harness";
import fixtureJson from "./fixtures/leaderboard-validate-golden.json" with { type: "json" };

const GOLDEN = fixtureJson as unknown as {
  season_key: string;
  classic: { token: string; expected: { verified_score: number } };
  hidden: { token: string; expected: { verified_score: number } };
};

const SECRET = testCookieSecret("f4-u3-routes");
const data: ValidationData = getValidationData();

const { db, pg, reset } = await setupTestDb();
afterAll(async () => pg.close());
beforeEach(async () => reset());

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<SubmitRouteDeps> = {}): SubmitRouteDeps {
  return {
    db,
    now: () => Date.now(),
    getCookieSecret: () => SECRET,
    getValidation: () => data,
    rateLimiter: allowAllSubmitRateLimiter,
    ...overrides,
  };
}

interface ReqOpts {
  body?: unknown;
  rawBody?: string;
  contentType?: string;
  contentLength?: string;
  sessionCookie?: string;
  csrfCookie?: string;
  csrfHeader?: string;
  origin?: string;
  host?: string;
}

function makeReq(opts: ReqOpts = {}): NextRequest {
  const headers: Record<string, string> = {
    "content-type": opts.contentType ?? "application/json",
  };
  if (opts.contentLength !== undefined) headers["content-length"] = opts.contentLength;
  if (opts.origin !== undefined) headers.origin = opts.origin;
  if (opts.host !== undefined) headers.host = opts.host;
  if (opts.csrfHeader !== undefined) headers["x-csrf-token"] = opts.csrfHeader;
  const cookies: string[] = [];
  if (opts.sessionCookie) cookies.push(`wcdraft_sid=${encodeURIComponent(opts.sessionCookie)}`);
  if (opts.csrfCookie) cookies.push(`wcdraft_csrf=${encodeURIComponent(opts.csrfCookie)}`);
  if (cookies.length) headers.cookie = cookies.join("; ");
  return new NextRequest("http://localhost/api/leaderboard/submit", {
    method: "POST",
    headers,
    body: opts.rawBody ?? JSON.stringify(opts.body ?? validBody()),
  });
}

function validBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    token: GOLDEN.classic.token,
    claimed_score: GOLDEN.classic.expected.verified_score,
    draft_mode: "classic",
    display_alias: "route_tester",
    ...over,
  };
}

function tamperedToken(mutate: (b: RunTokenV1Body) => void): string {
  const decoded = decodeRunToken(GOLDEN.classic.token);
  if (!decoded) throw new Error("fixture token failed to decode");
  const body = JSON.parse(JSON.stringify(decoded)) as RunTokenV1Body;
  mutate(body);
  return encodeBody(body);
}

async function allRows() {
  return db.select().from(leaderboardEntries);
}

async function errorOf(res: Response): Promise<{ error?: string } & Record<string, unknown>> {
  return (await res.json()) as { error?: string } & Record<string, unknown>;
}

/** Anon session + matching CSRF material, ready to spread into ReqOpts. */
async function sessionReqOpts(
  userId: string | null = null,
  opts: { now?: number; ttlMs?: number } = {},
): Promise<{
  sessionId: string;
  opts: Pick<ReqOpts, "sessionCookie" | "csrfCookie" | "csrfHeader" | "origin" | "host">;
}> {
  const { session, cookieValue } = await createSession(
    { userId, ttlMs: opts.ttlMs },
    { db, now: () => opts.now ?? Date.now(), cookieSecret: SECRET },
  );
  return {
    sessionId: session.id,
    opts: {
      sessionCookie: cookieValue,
      csrfCookie: session.csrfSecret,
      csrfHeader: session.csrfSecret,
      origin: "http://localhost",
      host: "localhost",
    },
  };
}

// ─── Transport gates ────────────────────────────────────────────────────────

describe("transport gates (before any pipeline work)", () => {
  it("non-JSON content-type → 415, no row", async () => {
    const res = await handleLeaderboardSubmit(makeReq({ contentType: "text/plain" }), makeDeps());
    expect(res.status).toBe(415);
    expect((await errorOf(res)).error).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(await allRows()).toHaveLength(0);
  });

  it("declared content-length over the cap → 413", async () => {
    const res = await handleLeaderboardSubmit(
      makeReq({ contentLength: String(MAX_SUBMIT_BODY_BYTES + 1) }),
      makeDeps(),
    );
    expect(res.status).toBe(413);
    expect((await errorOf(res)).error).toBe("BODY_TOO_LARGE");
  });

  it("actual body over the cap → 413 even with a lying content-length", async () => {
    const res = await handleLeaderboardSubmit(
      makeReq({
        contentLength: "10",
        rawBody: JSON.stringify({ token: "x".repeat(MAX_SUBMIT_BODY_BYTES + 10) }),
      }),
      makeDeps(),
    );
    expect(res.status).toBe(413);
  });

  it("malformed JSON → 400 INVALID_BODY", async () => {
    const res = await handleLeaderboardSubmit(makeReq({ rawBody: "{nope" }), makeDeps());
    expect(res.status).toBe(400);
    expect((await errorOf(res)).error).toBe("INVALID_BODY");
  });

  it("JSON array body → 400 INVALID_BODY", async () => {
    const res = await handleLeaderboardSubmit(makeReq({ rawBody: "[1,2]" }), makeDeps());
    expect(res.status).toBe(400);
  });

  it("mode:'ranked' with no account → 401 AUTH_REQUIRED before validation, no row", async () => {
    const res = await handleLeaderboardSubmit(
      makeReq({ body: validBody({ mode: "ranked" }) }),
      makeDeps({
        getValidation: () => {
          throw new Error("validation must not run before ranked auth");
        },
      }),
    );
    expect(res.status).toBe(401);
    expect(await errorOf(res)).toMatchObject({
      error: "AUTH_REQUIRED",
      message: RANKED_AUTH_REQUIRED_MESSAGE,
    });
    expect(await allRows()).toHaveLength(0);
  });

  it("unknown mode → 400 INVALID_BODY", async () => {
    const res = await handleLeaderboardSubmit(
      makeReq({ body: validBody({ mode: "arcade" }) }),
      makeDeps(),
    );
    expect(res.status).toBe(400);
    expect((await errorOf(res)).message).toBe("mode must be 'casual' or 'ranked'");
  });
});

// ─── Verdict → HTTP mapping (every SubmitRejectionCode) ────────────────────

describe("verdict mapping — every SubmitRejectionCode through the route", () => {
  it("INVALID_BODY (non-string token) → 400", async () => {
    const res = await handleLeaderboardSubmit(
      makeReq({ body: validBody({ token: 7 }) }),
      makeDeps(),
    );
    expect(res.status).toBe(400);
    expect((await errorOf(res)).error).toBe("INVALID_BODY");
  });

  it("TOKEN_TOO_LARGE → 400", async () => {
    const res = await handleLeaderboardSubmit(
      makeReq({ body: validBody({ token: "t1." + "a".repeat(8200) }) }),
      makeDeps(),
    );
    expect(res.status).toBe(400);
    expect((await errorOf(res)).error).toBe("TOKEN_TOO_LARGE");
  });

  it("MALFORMED_TOKEN → 400", async () => {
    const res = await handleLeaderboardSubmit(
      makeReq({ body: validBody({ token: "t1.%%%not-base64url%%%" }) }),
      makeDeps(),
    );
    expect(res.status).toBe(400);
    expect((await errorOf(res)).error).toBe("MALFORMED_TOKEN");
  });

  it("WRONG_SEASON → 409 with the diverging anchor named", async () => {
    const res = await handleLeaderboardSubmit(
      makeReq({
        body: validBody({ token: tamperedToken((b) => (b.ev = "engine-9999.01.01")) }),
      }),
      makeDeps(),
    );
    expect(res.status).toBe(409);
    const body = await errorOf(res);
    expect(body.error).toBe("WRONG_SEASON");
    expect(body.mismatched_anchors).toEqual(["engine_version"]);
  });

  it("pre-V6 leaderboard token anchors → 409 WRONG_SEASON, never persisted", async () => {
    const preV6Token = tamperedToken((b) => {
      b.sv = "runtime-data-1.1.0";
      b.rv = "wc-perf-4.2.1+proj-career-3.0.0";
      b.hv =
        "58120edad54af5f7f137024675fe7d6faf8f08c5fa7ebafb69677468f44da45b+b8cffe3128a3bf659be2dadd3239a85f30505c336215819e75ab93f7f01e3a15";
    });
    const res = await handleLeaderboardSubmit(
      makeReq({ body: validBody({ token: preV6Token }) }),
      makeDeps(),
    );
    expect(res.status).toBe(409);
    const body = await errorOf(res);
    expect(body.error).toBe("WRONG_SEASON");
    expect(body.mismatched_anchors).toEqual([
      "schema_version",
      "rating_version",
      "data_bundle_hash",
    ]);
    expect(await allRows()).toHaveLength(0);
  });

  it("INVALID_NAME → 422 with category, raw value never echoed", async () => {
    const res = await handleLeaderboardSubmit(
      makeReq({ body: validBody({ display_alias: "xx" }) }),
      makeDeps(),
    );
    expect(res.status).toBe(422);
    const body = await errorOf(res);
    expect(body.error).toBe("INVALID_NAME");
    expect(body.name_reason).toBe("too_short");
    expect(JSON.stringify(body)).not.toContain("xx");
  });

  it("ILLEGAL_PICK (duplicate card across spins) → 422, no row", async () => {
    const token = tamperedToken((b) => {
      const picks = b.pl
        .map((p, i) => ({ p, i }))
        .filter((x): x is { p: { k: "p"; c: string; s: string }; i: number } => x.p.k === "p");
      const [first, , , second] = picks;
      (b.pl[second!.i] as { c: string }).c = first!.p.c;
    });
    const res = await handleLeaderboardSubmit(makeReq({ body: validBody({ token }) }), makeDeps());
    expect(res.status).toBe(422);
    expect((await errorOf(res)).error).toBe("ILLEGAL_PICK");
    expect(await allRows()).toHaveLength(0);
  });

  it("SCORE_MISMATCH (claimed+1) → 422, claimed value never persisted", async () => {
    const res = await handleLeaderboardSubmit(
      makeReq({
        body: validBody({ claimed_score: GOLDEN.classic.expected.verified_score + 1 }),
      }),
      makeDeps(),
    );
    expect(res.status).toBe(422);
    expect((await errorOf(res)).error).toBe("SCORE_MISMATCH");
    expect(await allRows()).toHaveLength(0);
  });

  it("SIM_FAILURE (broken server scenario after valid replay) → 500, no row", async () => {
    const broken: ValidationData = {
      gameData: data.gameData,
      scenario: { ...data.scenario, teams: [] } as ValidationData["scenario"],
    };
    const res = await handleLeaderboardSubmit(makeReq(), makeDeps({ getValidation: () => broken }));
    expect(res.status).toBe(500);
    expect((await errorOf(res)).error).toBe("SIM_FAILURE");
    expect(await allRows()).toHaveLength(0);
  });
});

// ─── Accept + dedupe ────────────────────────────────────────────────────────

describe("anonymous casual accept + NULLS-NOT-DISTINCT dedupe", () => {
  it("fully anonymous (no cookie) classic submission → 201, honest row", async () => {
    const res = await handleLeaderboardSubmit(makeReq(), makeDeps());
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      duplicate: boolean;
      rank: number | null;
      entry: Record<string, unknown>;
    };
    expect(body.duplicate).toBe(false);
    expect(body.rank).toBe(1);
    expect(body.entry.season_key).toBe(GOLDEN.season_key);
    expect(body.entry.mode).toBe("casual");
    expect(body.entry.draft_mode).toBe("classic");
    expect(body.entry.display_name).toBe("route_tester");
    expect(body.entry.verified_score).toBe(GOLDEN.classic.expected.verified_score);

    const rows = await allRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBeNull();
    expect(rows[0]!.sessionId).toBeNull();
    expect(rows[0]!.token).toBe(GOLDEN.classic.token);
    expect(rows[0]!.hiddenAt).toBeNull();
    // Transparent-score invariant survives the jsonb round-trip.
    const breakdown = rows[0]!.scoreBreakdown as { points: number }[];
    expect(breakdown.reduce((a, c) => a + c.points, 0)).toBe(rows[0]!.verifiedScore);
  });

  it("same token twice → 201 then 200 {duplicate:true}, single row", async () => {
    const first = await handleLeaderboardSubmit(makeReq(), makeDeps());
    expect(first.status).toBe(201);
    const second = await handleLeaderboardSubmit(makeReq(), makeDeps());
    expect(second.status).toBe(200);
    const body = (await second.json()) as { duplicate: boolean; rank: number | null };
    expect(body.duplicate).toBe(true);
    expect(body.rank).toBe(1);
    expect(await allRows()).toHaveLength(1);
  });

  it("same token from a DIFFERENT anon session → still duplicate (global dedupe)", async () => {
    const first = await handleLeaderboardSubmit(makeReq(), makeDeps());
    expect(first.status).toBe(201);
    const { opts } = await sessionReqOpts();
    const second = await handleLeaderboardSubmit(makeReq(opts), makeDeps());
    expect(second.status).toBe(200);
    expect(((await second.json()) as { duplicate: boolean }).duplicate).toBe(true);
    expect(await allRows()).toHaveLength(1);
  });

  it("hidden-mode fixture token inserts as its own entry (draft_mode dimension)", async () => {
    const first = await handleLeaderboardSubmit(makeReq(), makeDeps());
    expect(first.status).toBe(201);
    const res = await handleLeaderboardSubmit(
      makeReq({
        body: {
          token: GOLDEN.hidden.token,
          claimed_score: GOLDEN.hidden.expected.verified_score,
          draft_mode: "hidden",
          display_alias: "hidden_tester",
        },
      }),
      makeDeps(),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { entry: { draft_mode: string } };
    expect(body.entry.draft_mode).toBe("hidden");
    expect(await allRows()).toHaveLength(2);
  });

  it("cross-lane token mismatch → 422 NON_CANONICAL_CONFIG, no row", async () => {
    const hiddenAsClassic = await handleLeaderboardSubmit(
      makeReq({
        body: {
          token: GOLDEN.hidden.token,
          claimed_score: GOLDEN.hidden.expected.verified_score,
          draft_mode: "classic",
          display_alias: "hidden_tester",
        },
      }),
      makeDeps(),
    );
    expect(hiddenAsClassic.status).toBe(422);
    expect((await errorOf(hiddenAsClassic)).error).toBe("NON_CANONICAL_CONFIG");

    const classicAsHidden = await handleLeaderboardSubmit(
      makeReq({ body: validBody({ draft_mode: "hidden" }) }),
      makeDeps(),
    );
    expect(classicAsHidden.status).toBe(422);
    expect((await errorOf(classicAsHidden)).error).toBe("NON_CANONICAL_CONFIG");
    expect(await allRows()).toHaveLength(0);
  });
});

// ─── Session identity + CSRF ────────────────────────────────────────────────

describe("session identity + CSRF (plan §5.3 — like POST /api/runs)", () => {
  it("anon session with full CSRF material → 201, session attached", async () => {
    const { sessionId, opts } = await sessionReqOpts();
    const res = await handleLeaderboardSubmit(makeReq(opts), makeDeps());
    expect(res.status).toBe(201);
    const rows = await allRows();
    expect(rows[0]!.sessionId).toBe(sessionId);
    expect(rows[0]!.userId).toBeNull();
  });

  it("account-bound session → user_id persisted", async () => {
    const inserted = await db.insert(users).values({ email: "f4-u3@example.com" }).returning();
    const { opts } = await sessionReqOpts(inserted[0]!.id);
    const res = await handleLeaderboardSubmit(makeReq(opts), makeDeps());
    expect(res.status).toBe(201);
    const rows = await allRows();
    expect(rows[0]!.userId).toBe(inserted[0]!.id);
  });

  it("account-bound session with no alias → displays username fallback, never email", async () => {
    const inserted = await db
      .insert(users)
      .values({ email: "profile-fallback@example.com", username: "profile_user" })
      .returning();
    const { opts } = await sessionReqOpts(inserted[0]!.id);
    const res = await handleLeaderboardSubmit(
      makeReq({ ...opts, body: validBody({ display_alias: undefined, display_name: undefined }) }),
      makeDeps(),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      entry: Record<string, unknown>;
    };
    expect(body.entry.display_name).toBe("profile_user");
    expect(JSON.stringify(body)).not.toContain("profile-fallback@example.com");
  });

  it("missing x-csrf-token header → 403 CSRF_FAILED, no row", async () => {
    const { opts } = await sessionReqOpts();
    const res = await handleLeaderboardSubmit(
      makeReq({ ...opts, csrfHeader: undefined }),
      makeDeps(),
    );
    expect(res.status).toBe(403);
    expect((await errorOf(res)).error).toBe("CSRF_FAILED");
    expect(await allRows()).toHaveLength(0);
  });

  it("wrong csrf header value → 403 CSRF_FAILED", async () => {
    const { opts } = await sessionReqOpts();
    const res = await handleLeaderboardSubmit(
      makeReq({ ...opts, csrfHeader: "not-the-secret" }),
      makeDeps(),
    );
    expect(res.status).toBe(403);
  });

  it("cross-origin request → 403 CSRF_FAILED", async () => {
    const { opts } = await sessionReqOpts();
    const res = await handleLeaderboardSubmit(
      makeReq({ ...opts, origin: "https://evil.example" }),
      makeDeps(),
    );
    expect(res.status).toBe(403);
    expect((await errorOf(res)).error).toBe("CSRF_FAILED");
  });

  it("tampered session cookie → 401 AUTH_REQUIRED (never silent-anonymous)", async () => {
    const { opts } = await sessionReqOpts();
    const res = await handleLeaderboardSubmit(
      makeReq({ ...opts, sessionCookie: opts.sessionCookie!.slice(0, -2) + "xx" }),
      makeDeps(),
    );
    expect(res.status).toBe(401);
    expect((await errorOf(res)).error).toBe("AUTH_REQUIRED");
    expect(await allRows()).toHaveLength(0);
  });
});

// ─── Ranked requires account ────────────────────────────────────────────────

describe("ranked account gate", () => {
  it("anonymous casual remains accepted", async () => {
    const res = await handleLeaderboardSubmit(
      makeReq({ body: validBody({ mode: "casual" }) }),
      makeDeps(),
    );
    expect(res.status).toBe(201);
    const rows = await allRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.mode).toBe("casual");
    expect(rows[0]!.userId).toBeNull();
  });

  it("anonymous session ranked → 401 AUTH_REQUIRED, no row", async () => {
    const { opts } = await sessionReqOpts();
    const res = await handleLeaderboardSubmit(
      makeReq({ ...opts, body: validBody({ mode: "ranked" }) }),
      makeDeps(),
    );
    expect(res.status).toBe(401);
    expect(await errorOf(res)).toMatchObject({
      error: "AUTH_REQUIRED",
      message: RANKED_AUTH_REQUIRED_MESSAGE,
    });
    expect(await allRows()).toHaveLength(0);
  });

  it("forged ranked session → 401 AUTH_REQUIRED, never downgrades to anonymous", async () => {
    const { opts } = await sessionReqOpts();
    const res = await handleLeaderboardSubmit(
      makeReq({
        ...opts,
        sessionCookie: opts.sessionCookie!.slice(0, -2) + "xx",
        body: validBody({ mode: "ranked" }),
      }),
      makeDeps(),
    );
    expect(res.status).toBe(401);
    expect(await errorOf(res)).toMatchObject({
      error: "AUTH_REQUIRED",
      message: RANKED_AUTH_REQUIRED_MESSAGE,
    });
    expect(await allRows()).toHaveLength(0);
  });

  it("expired ranked session → 401 AUTH_REQUIRED, no row", async () => {
    const now = Date.UTC(2026, 5, 1);
    const inserted = await db
      .insert(users)
      .values({ email: "expired-ranked@example.com", username: "expired_ranked" })
      .returning();
    const { opts } = await sessionReqOpts(inserted[0]!.id, { now, ttlMs: 1 });
    const res = await handleLeaderboardSubmit(
      makeReq({ ...opts, body: validBody({ mode: "ranked" }) }),
      makeDeps({ now: () => now + 2 }),
    );
    expect(res.status).toBe(401);
    expect(await errorOf(res)).toMatchObject({
      error: "AUTH_REQUIRED",
      message: RANKED_AUTH_REQUIRED_MESSAGE,
    });
    expect(await allRows()).toHaveLength(0);
  });

  it("account-bound ranked with username fallback → 201 ranked row, no email", async () => {
    const inserted = await db
      .insert(users)
      .values({ email: "ranked-user@example.com", username: "ranked_user" })
      .returning();
    const { opts } = await sessionReqOpts(inserted[0]!.id);
    const res = await handleLeaderboardSubmit(
      makeReq({
        ...opts,
        body: validBody({ mode: "ranked", display_alias: undefined, display_name: undefined }),
      }),
      makeDeps(),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      rank: number | null;
      entry: Record<string, unknown>;
    };
    expect(body.rank).toBe(1);
    expect(body.entry.mode).toBe("ranked");
    expect(body.entry.display_name).toBe("ranked_user");
    expect(JSON.stringify(body)).not.toContain("ranked-user@example.com");
    const rows = await allRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.mode).toBe("ranked");
    expect(rows[0]!.userId).toBe(inserted[0]!.id);
  });

  it("account-bound ranked alias overrides username per entry", async () => {
    const inserted = await db
      .insert(users)
      .values({ email: "alias-ranked@example.com", username: "real_user" })
      .returning();
    const { opts } = await sessionReqOpts(inserted[0]!.id);
    const res = await handleLeaderboardSubmit(
      makeReq({ ...opts, body: validBody({ mode: "ranked", display_alias: "alias_user" }) }),
      makeDeps(),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { entry: Record<string, unknown> };
    expect(body.entry.display_name).toBe("alias_user");
    expect(JSON.stringify(body)).not.toContain("alias-ranked@example.com");
  });

  it("account-bound ranked Memory submit ranks inside the Memory lane only", async () => {
    const player = await db
      .insert(users)
      .values({ email: "memory-ranked@example.com", username: "memory_player" })
      .returning();
    const rival = await db
      .insert(users)
      .values({ email: "memory-rival@example.com", username: "memory_rival" })
      .returning();
    await db.insert(leaderboardEntries).values({
      seasonKey: GOLDEN.season_key,
      mode: "ranked",
      draftMode: "hidden",
      userId: rival[0]!.id,
      sessionId: null,
      displayAlias: null,
      token: "t1.memory-rival",
      verifiedScore: -10,
      scoreBreakdown: [],
      createdAt: new Date(Date.now() - 1000),
    });
    const { opts } = await sessionReqOpts(player[0]!.id);
    const classic = await handleLeaderboardSubmit(
      makeReq({
        ...opts,
        body: validBody({ mode: "ranked", display_alias: undefined, display_name: undefined }),
      }),
      makeDeps(),
    );
    expect(classic.status).toBe(201);

    const hidden = await handleLeaderboardSubmit(
      makeReq({
        ...opts,
        body: {
          token: GOLDEN.hidden.token,
          claimed_score: GOLDEN.hidden.expected.verified_score,
          draft_mode: "hidden",
          mode: "ranked",
          display_alias: undefined,
          display_name: undefined,
        },
      }),
      makeDeps(),
    );
    expect(hidden.status).toBe(201);
    const body = (await hidden.json()) as {
      rank: number | null;
      entry: Record<string, unknown>;
    };
    expect(body.entry.draft_mode).toBe("hidden");
    expect(body.rank).toBe(2);
  });
});

// ─── Rate-limit seam ────────────────────────────────────────────────────────

describe("rate-limit seam (step 5: after identity, before the pipeline)", () => {
  it("denying limiter → 429 + Retry-After, validation NEVER invoked, no row", async () => {
    const res = await handleLeaderboardSubmit(
      makeReq(),
      makeDeps({
        rateLimiter: {
          checkSubmit: () => Promise.resolve({ allowed: false, retryAfterSeconds: 42 }),
        },
        getValidation: () => {
          throw new Error("pipeline must not run for rate-limited callers");
        },
      }),
    );
    expect(res.status).toBe(429);
    expect((await errorOf(res)).error).toBe("RATE_LIMITED");
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(await allRows()).toHaveLength(0);
  });

  it("limiter runs AFTER the identity gate and receives the resolved identity", async () => {
    const seen: { sessionId: string | null; userId: string | null; ip: string }[] = [];
    const { sessionId, opts } = await sessionReqOpts();
    const res = await handleLeaderboardSubmit(
      makeReq(opts),
      makeDeps({
        rateLimiter: {
          checkSubmit: (ctx) => {
            seen.push(ctx);
            return Promise.resolve({ allowed: true });
          },
        },
      }),
    );
    expect(res.status).toBe(201);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.sessionId).toBe(sessionId);
  });

  it("CSRF failure means the limiter is never consulted (gate order lock)", async () => {
    const { opts } = await sessionReqOpts();
    let limiterCalls = 0;
    const res = await handleLeaderboardSubmit(
      makeReq({ ...opts, csrfHeader: "wrong" }),
      makeDeps({
        rateLimiter: {
          checkSubmit: () => {
            limiterCalls += 1;
            return Promise.resolve({ allowed: true });
          },
        },
      }),
    );
    expect(res.status).toBe(403);
    expect(limiterCalls).toBe(0);
  });
});

// ─── U5: the REAL limiter through the route (deps-builder swap) ─────────────
//
// Same deps shape the production route builds — only `now`/`random` pinned.
// Proves the swap needs zero route-logic changes and the 429 carries the
// limiter's honest window remainder.

describe("U5 — auth_rate_limits-backed limiter end-to-end", () => {
  // UTC midnight → hourly window starts exactly here; Retry-After is exact.
  const NOW = Date.UTC(2026, 5, 3);

  async function pinnedSessionOpts(): Promise<ReqOpts> {
    const { session, cookieValue } = await createSession(
      { userId: null },
      { db, now: () => NOW, cookieSecret: SECRET },
    );
    return {
      sessionCookie: cookieValue,
      csrfCookie: session.csrfSecret,
      csrfHeader: session.csrfSecret,
      origin: "http://localhost",
      host: "localhost",
    };
  }

  it("7th attempt in the hour → 429 RATE_LIMITED with honest Retry-After", async () => {
    const opts = await pinnedSessionOpts();
    const deps = makeDeps({
      now: () => NOW,
      rateLimiter: createDbSubmitRateLimiter({ db, now: () => NOW, random: () => 1 }),
    });
    const statuses: number[] = [];
    let last: Response | null = null;
    for (let i = 0; i < 7; i++) {
      last = await handleLeaderboardSubmit(makeReq(opts), deps);
      statuses.push(last.status);
    }
    // 1 insert + 5 honest duplicates (attempts still burn quota) + 1 deny.
    expect(statuses).toEqual([201, 200, 200, 200, 200, 200, 429]);
    expect((await errorOf(last!)).error).toBe("RATE_LIMITED");
    expect(last!.headers.get("Retry-After")).toBe("3600");
    expect(await allRows()).toHaveLength(1);
  });

  it("limiter-store failure → fail-closed 429 through the route, no row", async () => {
    const opts = await pinnedSessionOpts();
    const broken = {
      execute: () => Promise.reject(new Error("neon down")),
    } as unknown as typeof db;
    const deps = makeDeps({
      now: () => NOW,
      rateLimiter: createDbSubmitRateLimiter({ db: broken, now: () => NOW, random: () => 1 }),
    });
    const res = await handleLeaderboardSubmit(makeReq(opts), deps);
    expect(res.status).toBe(429);
    expect((await errorOf(res)).error).toBe("RATE_LIMITED");
    expect(res.headers.get("Retry-After")).toBe(String(STORE_ERROR_RETRY_AFTER_SECONDS));
    expect(await allRows()).toHaveLength(0);
  });
});
