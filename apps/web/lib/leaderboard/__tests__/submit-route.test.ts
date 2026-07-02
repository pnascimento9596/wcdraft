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
import { leaderboardEntries, rankedAttempts, users } from "@wcdraft/db";

import { createSession } from "../../auth/sessions";
import { setupTestDb, testCookieSecret } from "../../auth/__tests__/_test-db";
import { dailyChallengeForDate } from "../../game/daily";
import {
  buildRunTokenBody,
  decodeRunToken,
  tokenDraftConfig,
  type RunTokenV3Body,
} from "../../game/run-token";
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
import { buildOriginRecord, expectedRunFor } from "./_harness";
import fixtureJson from "./fixtures/leaderboard-validate-golden.json" with { type: "json" };

const GOLDEN = fixtureJson as unknown as {
  season_key: string;
  classic: { token: string; expected: { verified_score: number } };
  hidden: { token: string; expected: { verified_score: number } };
};

const SECRET = testCookieSecret("f4-u3-routes");
const data: ValidationData = getValidationData();
let attemptSeq = 0;

const { db, pg, reset } = await setupTestDb();
afterAll(async () => pg.close());
beforeEach(async () => {
  attemptSeq = 0;
  await reset();
});

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

type PlayerPickV3 = Extract<RunTokenV3Body["pl"][number], { k: "p" }>;

function playerPicks(body: RunTokenV3Body): Array<{ p: PlayerPickV3; i: number }> {
  return body.pl
    .map((p, i) => ({ p, i }))
    .filter((x): x is { p: PlayerPickV3; i: number } => x.p.k === "p");
}

function tamperedToken(mutate: (b: RunTokenV3Body) => void): string {
  const decoded = decodeRunToken(GOLDEN.classic.token);
  if (!decoded || decoded.v !== 3) throw new Error("fixture token failed to decode as t3");
  const body = JSON.parse(JSON.stringify(decoded)) as RunTokenV3Body;
  mutate(body);
  return encodeBody(body);
}

function bodyForRecord(
  seed: string,
  config: Parameters<typeof buildOriginRecord>[4],
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  const record = buildOriginRecord(data.gameData, seed, "classic", "Config XI", config);
  const expected = expectedRunFor(data.gameData, data.scenario, record);
  return {
    token: encodeBody(buildRunTokenBody(record)),
    claimed_score: expected.score,
    draft_mode: record.draft.mode,
    display_alias: "config_tester",
    ...over,
  };
}

function dailyBody(
  date = "2026-06-29",
  over: Record<string, unknown> = {},
): { body: Record<string, unknown>; expectedScore: number; challengeDate: string } {
  const challenge = dailyChallengeForDate(date);
  const record = {
    ...buildOriginRecord(data.gameData, challenge.seed, "classic", "Daily XI"),
    challenge,
  };
  const expected = expectedRunFor(data.gameData, data.scenario, record);
  return {
    body: {
      token: encodeBody(buildRunTokenBody(record)),
      claimed_score: expected.score,
      draft_mode: "classic",
      display_alias: "daily_tester",
      challenge: "daily",
      challenge_date: challenge.date,
      ...over,
    },
    expectedScore: expected.score,
    challengeDate: challenge.date,
  };
}

function dailyBodyForConfig(
  config: Parameters<typeof buildOriginRecord>[4],
  date = "2026-06-29",
): { body: Record<string, unknown>; expectedScore: number; challengeDate: string } {
  const challenge = dailyChallengeForDate(date);
  const record = {
    ...buildOriginRecord(data.gameData, challenge.seed, "classic", "Daily XI", config),
    challenge,
  };
  const expected = expectedRunFor(data.gameData, data.scenario, record);
  return {
    body: {
      token: encodeBody(buildRunTokenBody(record)),
      claimed_score: expected.score,
      draft_mode: "classic",
      display_alias: "daily_tester",
      challenge: "daily",
      challenge_date: challenge.date,
    },
    expectedScore: expected.score,
    challengeDate: challenge.date,
  };
}

async function allRows() {
  return db.select().from(leaderboardEntries);
}

async function allAttempts() {
  return db.select().from(rankedAttempts);
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

async function issueRankedAttemptForBody(args: {
  userId: string;
  sessionId: string | null;
  body: Record<string, unknown>;
  parentSeed?: string;
  issuedAt?: Date;
  expiresAt?: Date;
}) {
  if (typeof args.body.token !== "string") {
    throw new Error("cannot issue attempt for non-string test token");
  }
  const token = decodeRunToken(args.body.token);
  if (token === null) throw new Error("cannot issue attempt for malformed test token");
  const config = tokenDraftConfig(token);
  return db
    .insert(rankedAttempts)
    .values({
      userId: args.userId,
      sessionId: args.sessionId,
      seasonKey: data.seasonKey ?? GOLDEN.season_key,
      formationId: token.fid,
      draftMode: token.md,
      draftOrder: config.draft_flow,
      era: config.era_preset,
      ratingBasis: config.rating_basis,
      issuedParentSeed: args.parentSeed ?? token.ps,
      nonce: `nonce-${(++attemptSeq).toString().padStart(16, "0")}`,
      issuedAt: args.issuedAt ?? new Date(Date.now() - 1000),
      windowExpiresAt: args.expiresAt ?? new Date(Date.now() + 60_000),
    })
    .returning();
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

  it("daily ranked mode → 400 INVALID_BODY before auth or validation, no row", async () => {
    const res = await handleLeaderboardSubmit(
      makeReq({ body: dailyBody("2026-06-29", { mode: "ranked" }).body }),
      makeDeps({
        getValidation: () => {
          throw new Error("daily ranked must not reach validation");
        },
      }),
    );
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatchObject({
      error: "INVALID_BODY",
      message: "daily submissions are casual only",
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

  it("NON_CANONICAL_CONFIG daily setup → 422, no row", async () => {
    const { body } = dailyBodyForConfig({ ratingBasis: "current" });
    const res = await handleLeaderboardSubmit(makeReq({ body }), makeDeps());
    expect(res.status).toBe(422);
    expect((await errorOf(res)).error).toBe("NON_CANONICAL_CONFIG");
    expect(await allRows()).toHaveLength(0);
  });

  it("ILLEGAL_PICK (out-of-range choice index) → 422, no row", async () => {
    const token = tamperedToken((b) => {
      const [first] = playerPicks(b);
      if (!first) throw new Error("fixture token has no player picks");
      first.p.ci = 99;
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
    expect(body.entry.draft_order).toBe("squad_first");
    expect(body.entry.era).toBe("all_time");
    expect(body.entry.rating_basis).toBe("career");
    expect(body.entry.display_name).toBe("route_tester");
    expect(body.entry.verified_score).toBe(GOLDEN.classic.expected.verified_score);

    const rows = await allRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBeNull();
    expect(rows[0]!.sessionId).toBeNull();
    expect(rows[0]!.token).toBe(GOLDEN.classic.token);
    expect(rows[0]!.draftOrder).toBe("squad_first");
    expect(rows[0]!.era).toBe("all_time");
    expect(rows[0]!.ratingBasis).toBe("career");
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

  it("non-canonical casual config → 201, exact config persisted", async () => {
    const res = await handleLeaderboardSubmit(
      makeReq({
        body: bodyForRecord("wcdraft:f4-u3:any-config:casual", {
          draftFlow: "position_first",
          eraPreset: "modern",
          ratingBasis: "current",
        }),
      }),
      makeDeps(),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { entry: Record<string, unknown>; rank: number | null };
    expect(body.rank).toBe(1);
    expect(body.entry).toMatchObject({
      mode: "casual",
      draft_mode: "classic",
      draft_order: "position_first",
      era: "modern",
      rating_basis: "current",
    });
    const rows = await allRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      mode: "casual",
      draftMode: "classic",
      draftOrder: "position_first",
      era: "modern",
      ratingBasis: "current",
    });
  });

  it("duplicate hidden season row keeps rank context honest nulls", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: "hidden-duplicate@example.com", username: "hidden_duplicate" })
      .returning();
    const { opts } = await sessionReqOpts(user!.id);
    await db.insert(leaderboardEntries).values({
      seasonKey: GOLDEN.season_key,
      challengeType: "season",
      challengeDate: null,
      ratingVersion: data.gameData.versions.rating_version,
      mode: "casual",
      draftMode: "classic",
      draftOrder: "squad_first",
      era: "all_time",
      ratingBasis: "career",
      userId: user!.id,
      sessionId: null,
      displayAlias: "hidden_dupe",
      token: GOLDEN.classic.token,
      verifiedScore: GOLDEN.classic.expected.verified_score,
      scoreBreakdown: [],
      createdAt: new Date(Date.now() - 1000),
      hiddenAt: new Date(Date.now() - 500),
    });

    const res = await handleLeaderboardSubmit(makeReq({ ...opts, body: validBody() }), makeDeps());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      duplicate: boolean;
      rank: number | null;
      percentile: number | null;
      field_size: number | null;
    };
    expect(body.duplicate).toBe(true);
    expect(body.rank).toBeNull();
    expect(body.percentile).toBeNull();
    expect(body.field_size).toBeNull();
  });

  it("cross-mode token mismatch → 400 INVALID_BODY, no row", async () => {
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
    expect(hiddenAsClassic.status).toBe(400);
    expect((await errorOf(hiddenAsClassic)).error).toBe("INVALID_BODY");

    const classicAsHidden = await handleLeaderboardSubmit(
      makeReq({ body: validBody({ draft_mode: "hidden" }) }),
      makeDeps(),
    );
    expect(classicAsHidden.status).toBe(400);
    expect((await errorOf(classicAsHidden)).error).toBe("INVALID_BODY");
    expect(await allRows()).toHaveLength(0);
  });

  it("anonymous daily submit accepted today with rank and percentile", async () => {
    const daily = dailyBody();
    const res = await handleLeaderboardSubmit(
      makeReq({ body: daily.body }),
      makeDeps({ todayUtcDate: () => daily.challengeDate }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      duplicate: boolean;
      rank: number | null;
      percentile: number | null;
      field_size: number;
      entry: Record<string, unknown>;
    };
    expect(body.duplicate).toBe(false);
    expect(body.rank).toBe(1);
    expect(body.percentile).toBe(100);
    expect(body.field_size).toBe(1);
    expect(body.entry).toMatchObject({
      mode: "casual",
      draft_mode: "classic",
      rating_version: data.gameData.versions.rating_version,
      verified_score: daily.expectedScore,
    });
    const rows = await allRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      challengeType: "daily",
      challengeDate: daily.challengeDate,
      mode: "casual",
      draftOrder: "squad_first",
      era: "all_time",
      ratingBasis: "career",
    });
  });

  it("past daily submit is read-only and rejected after verification", async () => {
    const daily = dailyBody("2026-06-28");
    const res = await handleLeaderboardSubmit(
      makeReq({ body: daily.body }),
      makeDeps({ todayUtcDate: () => "2026-06-29" }),
    );
    expect(res.status).toBe(403);
    expect((await errorOf(res)).error).toBe("BAD_ATTEMPT");
    expect(await allRows()).toHaveLength(0);
  });

  it("same daily identity updates an existing lower score instead of adding a row", async () => {
    const daily = dailyBody();
    const { sessionId, opts } = await sessionReqOpts();
    await db.insert(leaderboardEntries).values({
      seasonKey: GOLDEN.season_key,
      challengeType: "daily",
      challengeDate: daily.challengeDate,
      ratingVersion: data.gameData.versions.rating_version,
      mode: "casual",
      draftMode: "classic",
      draftOrder: "squad_first",
      era: "all_time",
      ratingBasis: "career",
      userId: null,
      sessionId,
      displayAlias: "daily_tester",
      token: "old-lower-daily-token",
      verifiedScore: daily.expectedScore - 1,
      scoreBreakdown: [],
      createdAt: new Date(Date.now() - 1000),
    });

    const res = await handleLeaderboardSubmit(
      makeReq({ ...opts, body: daily.body }),
      makeDeps({ todayUtcDate: () => daily.challengeDate }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { duplicate: boolean; rank: number | null };
    expect(body.duplicate).toBe(false);
    expect(body.rank).toBe(1);
    const rows = await allRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.verifiedScore).toBe(daily.expectedScore);
    expect(rows[0]!.token).toBe(daily.body.token);
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

  it("mode:null keeps the legacy omitted-mode casual default", async () => {
    const res = await handleLeaderboardSubmit(
      makeReq({ body: validBody({ mode: null }) }),
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

  it("account-bound ranked with a client-chosen seed and no issued attempt → 403 BAD_ATTEMPT", async () => {
    const inserted = await db
      .insert(users)
      .values({ email: "no-attempt-ranked@example.com", username: "no_attempt" })
      .returning();
    const { opts } = await sessionReqOpts(inserted[0]!.id);
    const res = await handleLeaderboardSubmit(
      makeReq({
        ...opts,
        body: validBody({ mode: "ranked", display_alias: undefined, display_name: undefined }),
      }),
      makeDeps(),
    );
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({
      error: "BAD_ATTEMPT",
      message: "ranked submissions require a valid unexpired server-issued attempt",
    });
    expect(await allRows()).toHaveLength(0);
  });

  it("account-bound ranked with a mismatched issued seed → 403 BAD_ATTEMPT", async () => {
    const inserted = await db
      .insert(users)
      .values({ email: "wrong-seed-ranked@example.com", username: "wrong_seed" })
      .returning();
    const { sessionId, opts } = await sessionReqOpts(inserted[0]!.id);
    const body = validBody({ mode: "ranked", display_alias: undefined, display_name: undefined });
    await issueRankedAttemptForBody({
      userId: inserted[0]!.id,
      sessionId,
      body,
      parentSeed: "wcdraft:ranked:v1:not-this-token-seed",
    });
    const res = await handleLeaderboardSubmit(makeReq({ ...opts, body }), makeDeps());
    expect(res.status).toBe(403);
    expect((await errorOf(res)).error).toBe("BAD_ATTEMPT");
    expect(await allRows()).toHaveLength(0);
    expect((await allAttempts())[0]!.consumedAt).toBeNull();
  });

  it("account-bound ranked with username fallback → 201 ranked row, no email", async () => {
    const inserted = await db
      .insert(users)
      .values({ email: "ranked-user@example.com", username: "ranked_user" })
      .returning();
    const { sessionId, opts } = await sessionReqOpts(inserted[0]!.id);
    const body = validBody({ mode: "ranked", display_alias: undefined, display_name: undefined });
    await issueRankedAttemptForBody({ userId: inserted[0]!.id, sessionId, body });
    const res = await handleLeaderboardSubmit(
      makeReq({
        ...opts,
        body,
      }),
      makeDeps(),
    );
    expect(res.status).toBe(201);
    const responseBody = (await res.json()) as {
      rank: number | null;
      entry: Record<string, unknown>;
    };
    expect(responseBody.rank).toBe(1);
    expect(responseBody.entry.mode).toBe("ranked");
    expect(responseBody.entry.display_name).toBe("ranked_user");
    expect(JSON.stringify(responseBody)).not.toContain("ranked-user@example.com");
    const rows = await allRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.mode).toBe("ranked");
    expect(rows[0]!.userId).toBe(inserted[0]!.id);
    expect(rows[0]!.attemptId).toBe((await allAttempts())[0]!.id);
    expect((await allAttempts())[0]!.consumedAt).toBeInstanceOf(Date);
  });

  it("account-bound ranked alias overrides username per entry", async () => {
    const inserted = await db
      .insert(users)
      .values({ email: "alias-ranked@example.com", username: "real_user" })
      .returning();
    const { sessionId, opts } = await sessionReqOpts(inserted[0]!.id);
    const body = validBody({ mode: "ranked", display_alias: "alias_user" });
    await issueRankedAttemptForBody({ userId: inserted[0]!.id, sessionId, body });
    const res = await handleLeaderboardSubmit(makeReq({ ...opts, body }), makeDeps());
    expect(res.status).toBe(201);
    const responseBody = (await res.json()) as { entry: Record<string, unknown> };
    expect(responseBody.entry.display_name).toBe("alias_user");
    expect(JSON.stringify(responseBody)).not.toContain("alias-ranked@example.com");
  });

  it("account-bound ranked non-canonical config → 201 ranked row under exact config", async () => {
    const inserted = await db
      .insert(users)
      .values({ email: "ranked-config@example.com", username: "ranked_config" })
      .returning();
    const { sessionId, opts } = await sessionReqOpts(inserted[0]!.id);
    const body = bodyForRecord(
      "wcdraft:f4-u3:any-config:ranked",
      {
        draftFlow: "position_first",
        eraPreset: "post_2010",
        ratingBasis: "current",
      },
      { mode: "ranked", display_alias: undefined, display_name: undefined },
    );
    await issueRankedAttemptForBody({ userId: inserted[0]!.id, sessionId, body });
    const res = await handleLeaderboardSubmit(
      makeReq({
        ...opts,
        body,
      }),
      makeDeps(),
    );
    expect(res.status).toBe(201);
    const responseBody = (await res.json()) as {
      entry: Record<string, unknown>;
      rank: number | null;
    };
    expect(responseBody.rank).toBe(1);
    expect(responseBody.entry).toMatchObject({
      mode: "ranked",
      draft_order: "position_first",
      era: "post_2010",
      rating_basis: "current",
      display_name: "ranked_config",
    });
    const rows = await allRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      mode: "ranked",
      userId: inserted[0]!.id,
      draftOrder: "position_first",
      era: "post_2010",
      ratingBasis: "current",
    });
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
    const rivalAttempt = await db
      .insert(rankedAttempts)
      .values({
        userId: rival[0]!.id,
        sessionId: null,
        seasonKey: GOLDEN.season_key,
        formationId: "4-3-3",
        draftMode: "hidden",
        draftOrder: "squad_first",
        era: "all_time",
        ratingBasis: "career",
        issuedParentSeed: "memory-rival-seed",
        nonce: "nonce-rival-000000",
        windowExpiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    await db.insert(leaderboardEntries).values({
      seasonKey: GOLDEN.season_key,
      mode: "ranked",
      draftMode: "hidden",
      draftOrder: "squad_first",
      era: "all_time",
      ratingBasis: "career",
      userId: rival[0]!.id,
      sessionId: null,
      displayAlias: null,
      token: "t1.memory-rival",
      verifiedScore: -10,
      scoreBreakdown: [],
      attemptId: rivalAttempt[0]!.id,
      createdAt: new Date(Date.now() - 1000),
    });
    const { sessionId, opts } = await sessionReqOpts(player[0]!.id);
    const classicBody = validBody({
      mode: "ranked",
      display_alias: undefined,
      display_name: undefined,
    });
    await issueRankedAttemptForBody({ userId: player[0]!.id, sessionId, body: classicBody });
    const classic = await handleLeaderboardSubmit(
      makeReq({
        ...opts,
        body: classicBody,
      }),
      makeDeps(),
    );
    expect(classic.status).toBe(201);

    const hiddenBody = {
      token: GOLDEN.hidden.token,
      claimed_score: GOLDEN.hidden.expected.verified_score,
      draft_mode: "hidden",
      mode: "ranked",
      display_alias: undefined,
      display_name: undefined,
    };
    await issueRankedAttemptForBody({ userId: player[0]!.id, sessionId, body: hiddenBody });
    const hidden = await handleLeaderboardSubmit(
      makeReq({
        ...opts,
        body: hiddenBody,
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

describe("rate-limit seam (step 6: after cheap preflight, before replay)", () => {
  it("malformed anonymous submissions return before the limiter bucket is touched", async () => {
    let limiterCalls = 0;
    const res = await handleLeaderboardSubmit(
      makeReq({ body: validBody({ token: "t3.!!!not-base64!!!" }) }),
      makeDeps({
        rateLimiter: {
          checkSubmit: () => {
            limiterCalls += 1;
            return Promise.resolve({ allowed: true });
          },
        },
      }),
    );
    expect(res.status).toBe(400);
    expect((await errorOf(res)).error).toBe("MALFORMED_TOKEN");
    expect(limiterCalls).toBe(0);
    expect(await allRows()).toHaveLength(0);
  });

  it("denying limiter → 429 + Retry-After, replay NEVER invoked, no row", async () => {
    const res = await handleLeaderboardSubmit(
      makeReq({ body: validBody({ claimed_score: 999_999 }) }),
      makeDeps({
        rateLimiter: {
          checkSubmit: () => Promise.resolve({ allowed: false, retryAfterSeconds: 42 }),
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
