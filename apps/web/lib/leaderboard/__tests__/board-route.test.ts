// F-4 U3 — GET /api/leaderboard (board) + GET /api/leaderboard/me tests over
// PGlite at the 0004 schema shape.
//
// Coverage per the Red gate:
//   - exact board order (verified_score DESC, created_at ASC, id ASC) + ranks
//   - best-entry-per-identity dedup (session / user / sessionless identities)
//   - hidden_at IS NULL always (moderated rows invisible, ranks close up)
//   - season defaulting (current derived key) + explicit season filter
//   - draft_mode filter
//   - keyset pagination: page walk with no overlap/skip across a score tie,
//     cursor strictness (400 BAD_CURSOR), limit clamp, typed query errors
//   - /me: 401 without session; best + rank + recent for anon and account
//     identities; honest nulls when boardless; no-store cache header

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { leaderboardEntries, sessions, users } from "@wcdraft/db";

import { createSession } from "../../auth/sessions";
import { setupTestDb, testCookieSecret } from "../../auth/__tests__/_test-db";
import {
  handleLeaderboardBoardGet,
  handleLeaderboardMeGet,
  type BoardResponseBody,
  type MeResponseBody,
  type ReadRouteDeps,
} from "../board-route";

const SECRET = testCookieSecret("f4-u3-board");
const CURRENT_SEASON = "season-current-test";
const BASE_MS = Date.parse("2026-06-10T12:00:00.000Z");

const { db, pg, reset } = await setupTestDb();
afterAll(async () => pg.close());

let seq = 0;
beforeEach(async () => {
  await reset();
  seq = 0;
});

function deps(): ReadRouteDeps {
  return {
    db,
    now: () => Date.now(),
    getCookieSecret: () => SECRET,
    currentSeasonKey: () => CURRENT_SEASON,
  };
}

interface SeedOpts {
  score: number;
  /** Seconds offset from BASE_MS for created_at (ms precision, keyset-exact). */
  at?: number;
  seasonKey?: string;
  challengeType?: "season" | "daily";
  challengeDate?: string | null;
  ratingVersion?: string | null;
  mode?: "casual" | "ranked";
  draftMode?: "classic" | "hidden";
  draftOrder?: "squad_first" | "position_first";
  era?: "all_time" | "post_2000" | "post_2010" | "modern";
  ratingBasis?: "career" | "current";
  userId?: string | null;
  sessionId?: string | null;
  displayAlias?: string | null;
  hiddenAt?: Date | null;
}

async function seed(opts: SeedOpts): Promise<string> {
  seq += 1;
  const mode = opts.mode ?? "ranked";
  let userId = opts.userId ?? null;
  if (mode === "ranked" && userId === null) {
    const [u] = await db
      .insert(users)
      .values({ email: `seed-${seq}@example.com`, username: `seed_user_${seq}` })
      .returning();
    userId = u!.id;
  }
  const inserted = await db
    .insert(leaderboardEntries)
    .values({
      seasonKey: opts.seasonKey ?? CURRENT_SEASON,
      challengeType: opts.challengeType ?? "season",
      challengeDate:
        opts.challengeDate === undefined
          ? opts.challengeType === "daily"
            ? "2026-06-29"
            : null
          : opts.challengeDate,
      ratingVersion: opts.ratingVersion ?? null,
      mode,
      draftMode: opts.draftMode ?? "classic",
      draftOrder: opts.draftOrder ?? "squad_first",
      era: opts.era ?? "all_time",
      ratingBasis: opts.ratingBasis ?? "career",
      userId,
      sessionId: opts.sessionId ?? null,
      displayAlias:
        opts.displayAlias === undefined
          ? `player_${String(seq).padStart(2, "0")}`
          : opts.displayAlias,
      token: `t1.seed-${seq}`,
      verifiedScore: opts.score,
      scoreBreakdown: [],
      hiddenAt: opts.hiddenAt ?? null,
      createdAt: new Date(BASE_MS + (opts.at ?? seq) * 1000),
    })
    .returning();
  return inserted[0]!.id;
}

/** Bare sessions row for FK-valid session-owned seeds (no cookie needed). */
async function seedSession(id: string, userId: string | null = null): Promise<string> {
  await db.insert(sessions).values({
    id,
    userId,
    csrfSecret: "seed-csrf",
    createdAt: new Date(BASE_MS),
    expiresAt: new Date(BASE_MS + 86_400_000),
  });
  return id;
}

function boardReq(params: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost/api/leaderboard");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

async function getBoard(params: Record<string, string> = {}): Promise<{
  status: number;
  body: BoardResponseBody;
  res: Response;
}> {
  const res = await handleLeaderboardBoardGet(boardReq(params), deps());
  return { status: res.status, body: (await res.json()) as BoardResponseBody, res };
}

// ─── Board reads ────────────────────────────────────────────────────────────

describe("GET /api/leaderboard — board page", () => {
  it("empty board → honest empty array, null cursor, current season", async () => {
    const { status, body, res } = await getBoard();
    expect(status).toBe(200);
    expect(body.entries).toEqual([]);
    expect(body.next_cursor).toBeNull();
    expect(body.season_key).toBe(CURRENT_SEASON);
    expect(body.current_season_key).toBe(CURRENT_SEASON);
    expect(body.mode).toBe("ranked");
    expect(body.draft_mode).toBe("classic");
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=30, stale-while-revalidate=120",
    );
  });

  it("orders by score DESC, created_at ASC (first-to-score wins ties), ranks 1..n", async () => {
    await seed({ score: 80, at: 20, displayAlias: "late_eighty" });
    await seed({ score: 90, at: 30, displayAlias: "ninety" });
    await seed({ score: 80, at: 10, displayAlias: "early_eighty" });
    await seed({ score: 70, at: 5, displayAlias: "seventy" });
    const { body } = await getBoard();
    expect(body.entries.map((e) => e.display_name)).toEqual([
      "ninety",
      "early_eighty",
      "late_eighty",
      "seventy",
    ]);
    expect(body.entries.map((e) => e.rank)).toEqual([1, 2, 3, 4]);
  });

  it("shows only the BEST entry per identity (session-keyed)", async () => {
    const sid = await seedSession("board-sess-1");
    await seed({ score: 60, mode: "casual", sessionId: sid, at: 1, displayAlias: "grinder" });
    await seed({ score: 95, mode: "casual", sessionId: sid, at: 2, displayAlias: "grinder" });
    await seed({ score: 70, mode: "casual", at: 3, displayAlias: "other" });
    const { body } = await getBoard({ mode: "casual" });
    expect(body.entries.map((e) => [e.display_name, e.verified_score, e.rank])).toEqual([
      ["grinder", 95, 1],
      ["other", 70, 2],
    ]);
  });

  it("user identity dedupes across sessions-then-claimed rows (user-keyed)", async () => {
    const u = await db
      .insert(users)
      .values({ email: "board@example.com", username: "board_user" })
      .returning();
    await seed({ score: 50, userId: u[0]!.id, at: 1 });
    await seed({ score: 88, userId: u[0]!.id, at: 2, displayAlias: null });
    const { body } = await getBoard();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]!.verified_score).toBe(88);
    expect(body.entries[0]!.display_name).toBe("board_user");
  });

  it("hidden_at rows never appear and ranks close over them", async () => {
    await seed({ score: 99, hiddenAt: new Date(BASE_MS), displayAlias: "moderated" });
    await seed({ score: 80, displayAlias: "clean" });
    const { body } = await getBoard();
    expect(body.entries.map((e) => e.display_name)).toEqual(["clean"]);
    expect(body.entries[0]!.rank).toBe(1);
  });

  it("defaults to the current season; explicit ?season= reads an old board", async () => {
    await seed({ score: 90, seasonKey: "season-old" });
    await seed({ score: 70 });
    const current = await getBoard();
    expect(current.body.entries.map((e) => e.verified_score)).toEqual([70]);
    const old = await getBoard({ season: "season-old" });
    expect(old.body.entries.map((e) => e.verified_score)).toEqual([90]);
    expect(old.body.season_key).toBe("season-old");
    expect(old.body.current_season_key).toBe(CURRENT_SEASON);
  });

  it("explicit ?mode=casual still reads casual entries", async () => {
    await seed({ score: 90, mode: "casual", displayAlias: "casual_entry" });
    await seed({ score: 70, mode: "ranked", displayAlias: "ranked_entry" });
    const ranked = await getBoard();
    expect(ranked.body.entries.map((e) => e.display_name)).toEqual(["ranked_entry"]);
    const casual = await getBoard({ mode: "casual" });
    expect(casual.body.entries.map((e) => e.display_name)).toEqual(["casual_entry"]);
    expect(casual.body.mode).toBe("casual");
  });

  it("daily board is public, casual-only, date-scoped, and includes percentile", async () => {
    await seed({
      score: 42,
      mode: "casual",
      challengeType: "daily",
      challengeDate: "2026-06-29",
      ratingVersion: "ratings-2026-06-29",
      displayAlias: "today_a",
      at: 1,
    });
    await seed({
      score: 84,
      mode: "casual",
      challengeType: "daily",
      challengeDate: "2026-06-29",
      ratingVersion: "ratings-2026-06-29",
      displayAlias: "today_b",
      at: 2,
    });
    await seed({
      score: 99,
      mode: "casual",
      challengeType: "daily",
      challengeDate: "2026-06-28",
      ratingVersion: "ratings-2026-06-28",
      displayAlias: "yesterday",
      at: 3,
    });

    const { status, body } = await getBoard({ challenge: "daily", date: "2026-06-29" });
    expect(status).toBe(200);
    expect(body.challenge_type).toBe("daily");
    expect(body.challenge_date).toBe("2026-06-29");
    expect(body.mode).toBe("casual");
    expect(body.draft_mode).toBe("classic");
    expect(body.entries.map((e) => [e.display_name, e.rank, e.percentile])).toEqual([
      ["today_b", 1, 100],
      ["today_a", 2, 50],
    ]);
    expect(body.entries.map((e) => e.rating_version)).toEqual([
      "ratings-2026-06-29",
      "ratings-2026-06-29",
    ]);
  });

  it("daily board rejects ranked and malformed dates", async () => {
    const ranked = await getBoard({ challenge: "daily", mode: "ranked" });
    expect(ranked.status).toBe(400);
    const badDate = await getBoard({ challenge: "daily", date: "2026-02-30" });
    expect(badDate.status).toBe(400);
  });

  it("full config filter splits the board with canonical config as the default", async () => {
    await seed({ score: 90, draftMode: "hidden", displayAlias: "blind" });
    await seed({ score: 80, draftMode: "classic", displayAlias: "sighted" });
    await seed({
      score: 95,
      draftMode: "classic",
      draftOrder: "position_first",
      era: "modern",
      ratingBasis: "current",
      displayAlias: "alt_config",
    });
    const hidden = await getBoard({ draft_mode: "hidden" });
    expect(hidden.body.entries.map((e) => e.display_name)).toEqual(["blind"]);
    expect(hidden.body.draft_mode).toBe("hidden");
    const classic = await getBoard();
    expect(classic.body.entries.map((e) => e.display_name)).toEqual(["sighted"]);
    expect(classic.body.draft_mode).toBe("classic");
    expect(classic.body.draft_order).toBe("squad_first");
    expect(classic.body.era).toBe("all_time");
    expect(classic.body.rating_basis).toBe("career");
    const alt = await getBoard({
      draft_order: "position_first",
      era: "modern",
      rating_basis: "current",
    });
    expect(alt.body.entries.map((e) => e.display_name)).toEqual(["alt_config"]);
  });

  it("legacy rows with NULL config are excluded from exact-config board reads", async () => {
    await db.insert(leaderboardEntries).values({
      seasonKey: CURRENT_SEASON,
      mode: "casual",
      draftMode: "classic",
      draftOrder: null,
      era: null,
      ratingBasis: null,
      userId: null,
      sessionId: null,
      displayAlias: "legacy_null",
      token: "t1.legacy-null-config",
      verifiedScore: 99,
      scoreBreakdown: [],
      hiddenAt: null,
      createdAt: new Date(BASE_MS + 1000),
    });
    await seed({ score: 80, mode: "casual", displayAlias: "canonical_config" });

    const { body } = await getBoard({ mode: "casual" });
    expect(body.entries.map((e) => e.display_name)).toEqual(["canonical_config"]);
  });

  it("keyset walk: no overlap, no skip, continuous ranks across a score tie", async () => {
    await seed({ score: 100, at: 1 });
    await seed({ score: 90, at: 10 });
    await seed({ score: 90, at: 20 });
    await seed({ score: 80, at: 30 });
    await seed({ score: 70, at: 40 });
    const seen: { rank: number; id: string }[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const params: Record<string, string> = { limit: "2" };
      if (cursor) params.cursor = cursor;
      const { status, body } = await getBoard(params);
      expect(status).toBe(200);
      seen.push(...body.entries.map((e) => ({ rank: e.rank, id: e.id })));
      cursor = body.next_cursor;
      pages += 1;
    } while (cursor !== null && pages < 10);
    expect(pages).toBe(3);
    expect(seen.map((s) => s.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(seen.map((s) => s.id)).size).toBe(5);
  });

  it("typed query errors: bad cursor, bad mode, bad config params, bad limit", async () => {
    const badCursor = await getBoard({ cursor: "@@@not-a-cursor@@@" });
    expect(badCursor.status).toBe(400);
    expect((badCursor.body as unknown as { error: string }).error).toBe("BAD_CURSOR");
    const badMode = await getBoard({ mode: "arcade" });
    expect(badMode.status).toBe(400);
    expect((badMode.body as unknown as { error: string }).error).toBe("INVALID_QUERY");
    const badDraft = await getBoard({ draft_mode: "blindfold" });
    expect(badDraft.status).toBe(400);
    const badOrder = await getBoard({ draft_order: "reverse" });
    expect(badOrder.status).toBe(400);
    const badEra = await getBoard({ era: "2026_only" });
    expect(badEra.status).toBe(400);
    const badBasis = await getBoard({ rating_basis: "prime" });
    expect(badBasis.status).toBe(400);
    const badLimit = await getBoard({ limit: "0" });
    expect(badLimit.status).toBe(400);
    const clamped = await getBoard({ limit: "999" });
    expect(clamped.status).toBe(200);
  });
});

// ─── /me ────────────────────────────────────────────────────────────────────

function meReq(params: Record<string, string> = {}, cookie?: string): NextRequest {
  const url = new URL("http://localhost/api/leaderboard/me");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = `wcdraft_sid=${encodeURIComponent(cookie)}`;
  return new NextRequest(url, { headers });
}

describe("GET /api/leaderboard/me", () => {
  it("no session cookie → 401 AUTH_REQUIRED", async () => {
    const res = await handleLeaderboardMeGet(meReq(), deps());
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("AUTH_REQUIRED");
  });

  it("anon session: best + same-snapshot rank + newest-first recent, uncached", async () => {
    const { session, cookieValue } = await createSession(
      { userId: null },
      { db, now: () => Date.now(), cookieSecret: SECRET },
    );
    await seed({ score: 50, mode: "casual", sessionId: session.id, at: 1 });
    const bestId = await seed({ score: 75, mode: "casual", sessionId: session.id, at: 2 });
    await seed({ score: 80, mode: "casual", at: 3, displayAlias: "rival" });
    const res = await handleLeaderboardMeGet(meReq({ mode: "casual" }, cookieValue), deps());
    expect(res.status).toBe(200);
    const body = (await res.json()) as MeResponseBody;
    expect(body.mode).toBe("casual");
    expect(body.draft_mode).toBe("classic");
    expect(body.best?.id).toBe(bestId);
    expect(body.rank).toBe(2);
    expect(body.recent.map((r) => r.verified_score)).toEqual([75, 50]);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("account-bound session keys ownership by user_id, not session_id", async () => {
    const u = await db.insert(users).values({ email: "me@example.com" }).returning();
    const { cookieValue } = await createSession(
      { userId: u[0]!.id },
      { db, now: () => Date.now(), cookieSecret: SECRET },
    );
    const otherSid = await seedSession("someone-else");
    await seed({ score: 92, mode: "casual", userId: u[0]!.id, at: 1 });
    await seed({ score: 99, mode: "casual", sessionId: otherSid, at: 2 });
    const res = await handleLeaderboardMeGet(meReq({ mode: "casual" }, cookieValue), deps());
    const body = (await res.json()) as MeResponseBody;
    expect(body.best?.verified_score).toBe(92);
    expect(body.rank).toBe(2);
    expect(body.recent).toHaveLength(1);
  });

  it("boardless caller: best null, rank null, recent empty — nulls stay null", async () => {
    const { cookieValue } = await createSession(
      { userId: null },
      { db, now: () => Date.now(), cookieSecret: SECRET },
    );
    const res = await handleLeaderboardMeGet(meReq({}, cookieValue), deps());
    const body = (await res.json()) as MeResponseBody;
    expect(body.best).toBeNull();
    expect(body.rank).toBeNull();
    expect(body.recent).toEqual([]);
  });

  it("/me scopes best, rank, and recent to the selected draft_mode lane", async () => {
    const { session, cookieValue } = await createSession(
      { userId: null },
      { db, now: () => Date.now(), cookieSecret: SECRET },
    );
    await seed({ score: 50, mode: "casual", sessionId: session.id, draftMode: "classic", at: 1 });
    const hiddenId = await seed({
      score: 90,
      mode: "casual",
      sessionId: session.id,
      draftMode: "hidden",
      at: 2,
    });
    await seed({
      score: 95,
      mode: "casual",
      draftMode: "hidden",
      at: 3,
      displayAlias: "memory_rival",
    });

    const classic = await handleLeaderboardMeGet(meReq({ mode: "casual" }, cookieValue), deps());
    const classicBody = (await classic.json()) as MeResponseBody;
    expect(classicBody.draft_mode).toBe("classic");
    expect(classicBody.best?.verified_score).toBe(50);
    expect(classicBody.rank).toBe(1);
    expect(classicBody.recent.map((r) => r.draft_mode)).toEqual(["classic"]);

    const hidden = await handleLeaderboardMeGet(
      meReq({ mode: "casual", draft_mode: "hidden" }, cookieValue),
      deps(),
    );
    const hiddenBody = (await hidden.json()) as MeResponseBody;
    expect(hiddenBody.draft_mode).toBe("hidden");
    expect(hiddenBody.best?.id).toBe(hiddenId);
    expect(hiddenBody.rank).toBe(2);
    expect(hiddenBody.recent.map((r) => r.draft_mode)).toEqual(["hidden"]);
  });

  it("hidden entries are excluded from best/recent (moderation honest-state)", async () => {
    const { session, cookieValue } = await createSession(
      { userId: null },
      { db, now: () => Date.now(), cookieSecret: SECRET },
    );
    await seed({
      score: 99,
      mode: "casual",
      sessionId: session.id,
      hiddenAt: new Date(BASE_MS),
      at: 1,
    });
    await seed({ score: 40, mode: "casual", sessionId: session.id, at: 2 });
    const res = await handleLeaderboardMeGet(meReq({ mode: "casual" }, cookieValue), deps());
    const body = (await res.json()) as MeResponseBody;
    expect(body.best?.verified_score).toBe(40);
    expect(body.recent).toHaveLength(1);
  });
});
