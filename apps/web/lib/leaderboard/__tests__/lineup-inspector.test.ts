import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { leaderboardEntries, users } from "@wcdraft/db";
import { eq } from "drizzle-orm";

import { allowAllExpensiveVerifyRateLimiter } from "../../game/expensive-verify-rate-limiter-db";
import { decodeRunToken, encodeRunToken, type RunTokenV3Body } from "../../game/run-token";
import { verifyRunTokenForOg } from "../../game/run-og-server";
import { setupTestDb } from "../../auth/__tests__/_test-db";
import {
  buildOriginRecord,
  buildServerGameData,
  encodeBody,
  serverScenarioBundle,
} from "./_harness";
import fixtureJson from "./fixtures/leaderboard-validate-golden.json" with { type: "json" };
import skewFixtures from "../../game/__tests__/fixtures/run-token-skew.json" with { type: "json" };
import {
  deriveAndCacheLineupInspector,
  resetLineupInspectorCacheForTests,
} from "../lineup-inspector";
import { handleLeaderboardLineupGet, handleLeaderboardLineupPost } from "../lineup-route";
import type { LeaderboardLineupWire } from "../lineup-view";
import type { ValidationData } from "../validate";

const fixture = fixtureJson as {
  season_key: string;
  classic: {
    token: string;
    expected: { verified_score: number; score_breakdown: unknown[]; draft_mode: "classic" };
  };
};

const { db, pg, reset } = await setupTestDb();
afterAll(async () => pg.close());

const validationData: ValidationData = {
  gameData: buildServerGameData(),
  scenario: serverScenarioBundle(),
  seasonKey: fixture.season_key,
};

beforeEach(async () => {
  await reset();
  resetLineupInspectorCacheForTests();
});

function deps() {
  return {
    db,
    now: () => Date.parse("2026-06-30T12:00:00.000Z"),
    getValidationData: () => validationData,
    getRateLimiter: () => allowAllExpensiveVerifyRateLimiter,
  };
}

function postReq(token: string): Request {
  return new Request("http://localhost/api/leaderboard/lineup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

async function read(res: Response): Promise<LeaderboardLineupWire> {
  return (await res.json()) as LeaderboardLineupWire;
}

async function seedVisibleEntry(token = fixture.classic.token): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ email: "lineup-owner@example.com", username: "lineup_owner" })
    .returning();
  const [row] = await db
    .insert(leaderboardEntries)
    .values({
      seasonKey: fixture.season_key,
      challengeType: "season",
      challengeDate: null,
      ratingVersion: "wc-perf-6.6.0+proj-career-5.6.0",
      mode: "casual",
      draftMode: "classic",
      draftOrder: "squad_first",
      era: "all_time",
      ratingBasis: "career",
      userId: user!.id,
      sessionId: null,
      displayAlias: null,
      token,
      verifiedScore: fixture.classic.expected.verified_score,
      scoreBreakdown: fixture.classic.expected.score_breakdown,
      attemptId: null,
      hiddenAt: null,
      createdAt: new Date("2026-06-30T12:00:00.000Z"),
    })
    .returning();
  return row!.id;
}

function decodeV3(token: string): RunTokenV3Body {
  const decoded = decodeRunToken(token);
  if (decoded?.v !== 3) throw new Error("expected t3 token");
  return decoded;
}

function foreignBuildToken(): string {
  const body = { ...decodeV3(fixture.classic.token), hv: "foreign-build-hash" };
  return encodeBody(body);
}

function illegalPickToken(): string {
  const body = decodeV3(fixture.classic.token);
  const first = body.pl.find((pick) => pick.k === "p");
  if (!first || first.k !== "p") throw new Error("expected player pick");
  first.ci = 99;
  return encodeBody(body);
}

function legacyT1Token(): string {
  const record = buildOriginRecord(validationData.gameData, "wcdraft:lineup-inspector:legacy");
  const current = decodeV3(encodeRunToken(record));
  return encodeBody({
    v: 1,
    rid: current.rid,
    fid: current.fid,
    ps: current.ps,
    tn: current.tn,
    md: current.md,
    pl: [...record.draft.spins]
      .sort((a, b) => a.index - b.index)
      .map((spin) => {
        if (spin.picked_kind === "manager") return { k: "m" as const };
        if (spin.picked_card_id === null || spin.assigned_slot_id === null) {
          throw new Error(`spin ${spin.index} is missing player pick fields`);
        }
        return { k: "p" as const, c: spin.picked_card_id as string, s: spin.assigned_slot_id };
      }),
    sv: current.sv,
    dv: current.dv,
    rv: current.rv,
    ev: current.ev,
    uv: current.uv,
    hv: current.hv,
  });
}

describe("leaderboard lineup inspector model", () => {
  it("uses the OG verification result for the same token-derived XI and score", () => {
    const og = verifyRunTokenForOg(fixture.classic.token, validationData);
    expect(og.status).toBe("accepted");
    if (og.status !== "accepted") return;

    const inspected = deriveAndCacheLineupInspector(fixture.classic.token, validationData);
    expect(inspected.status).toBe("accepted");
    if (inspected.status !== "accepted") return;

    expect(inspected.view.result.score).toBe(og.run.score);
    expect(inspected.view.result.record).toBe(`${og.run.wins}-${og.run.losses}`);
    expect(inspected.view.starters.map((slot) => slot.card?.name)).toEqual(
      og.model.lineup.map((slot) => slot.name),
    );
    expect(inspected.view.bench).toHaveLength(5);
    expect(inspected.view.manager?.name).toBeTruthy();
  });
});

describe("GET /api/leaderboard/lineup", () => {
  it("re-derives a visible entry by id without echoing token or account email", async () => {
    const id = await seedVisibleEntry();
    const req = new NextRequest(`http://localhost/api/leaderboard/lineup?entry_id=${id}`);
    const res = await handleLeaderboardLineupGet(req, deps());
    const body = await read(res);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-WCDraft-Lineup-Cache")).toBe("miss");
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    expect(body.lineup.formation).toEqual({ id: "4-3-3", name: "4-3-3" });
    expect(body.lineup.result.score).toBe(fixture.classic.expected.verified_score);
    expect(body.lineup.starters).toHaveLength(11);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(fixture.classic.token);
    expect(serialized).not.toContain("lineup-owner@example.com");

    const second = await handleLeaderboardLineupGet(req, deps());
    expect(second.status).toBe(200);
    expect(second.headers.get("X-WCDraft-Lineup-Cache")).toBe("hit");
  });

  it("does not inspect hidden entries", async () => {
    const id = await seedVisibleEntry();
    await db
      .update(leaderboardEntries)
      .set({ hiddenAt: new Date("2026-06-30T12:01:00.000Z") })
      .where(eq(leaderboardEntries.id, id));

    const req = new NextRequest(`http://localhost/api/leaderboard/lineup?entry_id=${id}`);
    const res = await handleLeaderboardLineupGet(req, deps());
    const body = await read(res);
    expect(res.status).toBe(404);
    expect(body).toMatchObject({ ok: false, error: "ENTRY_NOT_FOUND" });
  });

  it("does not accept raw tokens in the GET query string", async () => {
    const req = new NextRequest(
      `http://localhost/api/leaderboard/lineup?token=${encodeURIComponent(fixture.classic.token)}`,
    );
    const res = await handleLeaderboardLineupGet(req, deps());
    const body = await read(res);
    expect(res.status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: "INVALID_QUERY" });
  });
});

describe("POST /api/leaderboard/lineup token classes", () => {
  it("accepts a current valid t3 token", async () => {
    const res = await handleLeaderboardLineupPost(postReq(fixture.classic.token), deps());
    const body = await read(res);
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    expect(body.lineup.result.score).toBe(fixture.classic.expected.verified_score);
  });

  it.each([
    ["malformed", "not-a-token", 400, "MALFORMED_TOKEN"],
    ["legacy t1", legacyT1Token(), 422, "UNSUPPORTED_TOKEN"],
    ["foreign build", foreignBuildToken(), 404, "DIFFERENT_BUILD"],
    ["immediate pre-basis build", skewFixtures.shipped_pre_basis_t3.token, 404, "DIFFERENT_BUILD"],
    ["out-of-range t3 pick", illegalPickToken(), 422, "ILLEGAL_PICK"],
  ])("%s returns an honest error", async (_label, token, status, code) => {
    const res = await handleLeaderboardLineupPost(postReq(token), deps());
    const body = await read(res);
    expect(res.status).toBe(status);
    expect(body).toMatchObject({ ok: false, error: code });
  });
});
