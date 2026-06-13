// L4 privacy sweep — public payloads may expose username/alias, never email.
//
// This deliberately exercises route-level adapters where they have injectable
// seams, plus the leaderboard submit/read handlers directly where the Next
// route wrappers only build production deps. The invariant is payload-level:
// a real private email exists in the backing DB and in the magic-link request,
// but no public response body or header is allowed to contain it.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { leaderboardEntries, magicLinkTokens, savedRuns, users } from "@wcdraft/db";

import type { RuntimeDeps } from "@/lib/auth/handler-helpers";

const runtime = vi.hoisted(() => ({ deps: null as RuntimeDeps | null }));

vi.mock("@/lib/auth/handler-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/handler-helpers")>();
  return {
    ...actual,
    buildRuntimeDeps: (): RuntimeDeps => {
      if (runtime.deps === null) throw new Error("test runtime deps not initialised");
      return runtime.deps;
    },
  };
});

import { GET as authConfigGet } from "@/app/api/auth/config/route";
import { GET as csrfGet } from "@/app/api/auth/csrf/route";
import { POST as magicLinkPost } from "@/app/api/auth/magic-link/route";
import { GET as sessionGet } from "@/app/api/auth/session/route";
import { GET as verifyGet } from "@/app/api/auth/verify/route";
import { GET as profileGet } from "@/app/api/profile/route";
import { GET as runsGet } from "@/app/api/runs/route";
import { GET as runDetailGet } from "@/app/api/runs/[id]/route";
import { POST as runsClaimPost } from "@/app/api/runs/claim/route";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/lib/auth/csrf";
import { LogEmailSender } from "@/lib/auth/email";
import { createSession, SESSION_COOKIE_NAME } from "@/lib/auth/sessions";
import { testCookieSecret, setupTestDb } from "../../auth/__tests__/_test-db";
import { handleLeaderboardBoardGet, handleLeaderboardMeGet } from "../board-route";
import { handleLeaderboardSubmit } from "../submit-route";
import { buildServerGameData, serverScenarioBundle } from "./_harness";
import fixtureJson from "./fixtures/leaderboard-validate-golden.json" with { type: "json" };

const { db, pg, reset } = await setupTestDb();
afterAll(async () => pg.close());

const NOW = Date.parse("2026-06-12T12:00:00.000Z");
const COOKIE_SECRET = testCookieSecret("l4-public-payload-sweep");
const PRIVATE_EMAIL = "private-route-sweep@example.com";
const MAGIC_EMAIL = "magic-route-sweep@example.com";
const SEASON = "season-route-sweep";
const GOLDEN = fixtureJson as unknown as {
  classic: { token: string; expected: { verified_score: number } };
};

let sender: LogEmailSender;
let authEnv: Record<string, string | undefined> = snapshotAuthEnv();

function snapshotAuthEnv(): Record<string, string | undefined> {
  return {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    AUTH_EMAIL_FROM: process.env.AUTH_EMAIL_FROM,
    AUTH_BASE_URL: process.env.AUTH_BASE_URL,
  };
}

function restoreAuthEnv(): void {
  for (const [k, v] of Object.entries(authEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(async () => {
  await reset();
  authEnv = snapshotAuthEnv();
  process.env.RESEND_API_KEY = "re_test_l4";
  process.env.AUTH_EMAIL_FROM = "wcdraft <onboarding@example.com>";
  process.env.AUTH_BASE_URL = "https://wcdraft.com";
  sender = new LogEmailSender(() => undefined);
  runtime.deps = {
    db,
    now: () => NOW,
    cookieSecret: COOKIE_SECRET,
    sender,
    verifyBaseUrl: "https://wcdraft.com",
    fromAddress: "wcdraft <onboarding@example.com>",
  };
});

afterEach(() => {
  restoreAuthEnv();
});

function req(path: string, init: ConstructorParameters<typeof NextRequest>[1] = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, init);
}

function signedHeaders(cookieValue: string, csrfSecret: string): Record<string, string> {
  return {
    cookie: `${SESSION_COOKIE_NAME}=${cookieValue}; ${CSRF_COOKIE_NAME}=${csrfSecret}`,
    [CSRF_HEADER_NAME]: csrfSecret,
    origin: "http://localhost",
    host: "localhost",
  };
}

async function payloadOf(res: NextResponse): Promise<string> {
  const body = await res.text();
  const headers = Array.from(res.headers.entries())
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return `${res.status}\n${body}\n${headers}`;
}

function expectNoEmail(label: string, payload: string): void {
  expect(payload, label).not.toContain(PRIVATE_EMAIL);
  expect(payload, label).not.toContain(MAGIC_EMAIL);
  expect(payload, label).not.toContain('"email"');
}

describe("public route payload email sweep", () => {
  it("never serializes email across auth/profile/runs/leaderboard public responses", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: PRIVATE_EMAIL, username: "route_user" })
      .returning();
    const session = await createSession({ userId: user!.id }, runtime.deps!);
    const authHeaders = signedHeaders(session.cookieValue, session.session.csrfSecret);

    const [accountRun] = await db
      .insert(savedRuns)
      .values({
        ownerUserId: user!.id,
        sessionId: null,
        token: "t1.account-route-sweep",
        versionAnchors: { dataset_version: "route-sweep" },
        runId: "run-route-sweep",
        parentSeed: "seed-route-sweep",
        summary: {
          team_name: "Route XI",
          display_record: "7-0",
          formation_name: "4-3-3",
          key_picks: [],
          is_champion: true,
          seed: "seed-route-sweep",
        },
        claimState: "claimed",
        createdAt: new Date(NOW - 60_000),
      })
      .returning();

    await db.insert(savedRuns).values({
      ownerUserId: null,
      sessionId: session.session.id,
      token: "t1.claim-route-sweep",
      versionAnchors: { dataset_version: "route-sweep" },
      runId: "run-claim-route-sweep",
      parentSeed: "seed-claim-route-sweep",
      summary: null,
      claimState: "anonymous",
      createdAt: new Date(NOW - 30_000),
    });

    await db.insert(leaderboardEntries).values([
      {
        seasonKey: SEASON,
        mode: "ranked",
        draftMode: "classic",
        userId: user!.id,
        sessionId: null,
        displayAlias: null,
        token: "t1.classic-route-board",
        verifiedScore: 88,
        scoreBreakdown: [],
        createdAt: new Date(NOW - 5_000),
      },
      {
        seasonKey: SEASON,
        mode: "ranked",
        draftMode: "hidden",
        userId: user!.id,
        sessionId: null,
        displayAlias: "memory_alias",
        token: "t1.memory-route-board",
        verifiedScore: 77,
        scoreBreakdown: [],
        createdAt: new Date(NOW - 4_000),
      },
      {
        seasonKey: SEASON,
        mode: "casual",
        draftMode: "classic",
        userId: null,
        sessionId: session.session.id,
        displayAlias: "anon_route",
        token: "t1.claim-route-board",
        verifiedScore: 11,
        scoreBreakdown: [],
        createdAt: new Date(NOW - 3_000),
      },
    ]);

    const captures: Array<[string, NextResponse]> = [];
    captures.push(["GET /api/auth/config", await authConfigGet()]);
    captures.push([
      "GET /api/auth/csrf",
      await csrfGet(req("/api/auth/csrf", { headers: authHeaders })),
    ]);
    captures.push([
      "GET /api/auth/session",
      await sessionGet(req("/api/auth/session", { headers: authHeaders })),
    ]);
    captures.push([
      "POST /api/auth/magic-link",
      await magicLinkPost(
        req("/api/auth/magic-link", {
          method: "POST",
          headers: {
            ...authHeaders,
            "content-type": "application/json",
            "x-forwarded-for": "127.0.0.1",
          },
          body: JSON.stringify({ email: MAGIC_EMAIL }),
        }),
      ),
    ]);

    const tokenHashRow = await db.select().from(magicLinkTokens).limit(1);
    expect(tokenHashRow).toHaveLength(1);
    const verifyToken = new URL(sender.lastSent!.magicLinkUrl).searchParams.get("token")!;
    captures.push([
      "GET /api/auth/verify",
      await verifyGet(
        req(`/api/auth/verify?token=${verifyToken}&next=/play`, { headers: authHeaders }),
      ),
    ]);
    captures.push([
      "GET /api/profile",
      await profileGet(req("/api/profile", { headers: authHeaders })),
    ]);
    captures.push(["GET /api/runs", await runsGet(req("/api/runs", { headers: authHeaders }))]);
    captures.push([
      "GET /api/runs/[id]",
      await runDetailGet(req(`/api/runs/${accountRun!.id}`, { headers: authHeaders }), {
        params: Promise.resolve({ id: accountRun!.id }),
      }),
    ]);
    captures.push([
      "POST /api/runs/claim",
      await runsClaimPost(req("/api/runs/claim", { method: "POST", headers: authHeaders })),
    ]);

    captures.push([
      "GET /api/leaderboard classic",
      await handleLeaderboardBoardGet(req(`/api/leaderboard?season=${SEASON}&draft_mode=classic`), {
        db,
        now: () => NOW,
        getCookieSecret: () => COOKIE_SECRET,
        currentSeasonKey: () => SEASON,
      }),
    ]);
    captures.push([
      "GET /api/leaderboard hidden",
      await handleLeaderboardBoardGet(req(`/api/leaderboard?season=${SEASON}&draft_mode=hidden`), {
        db,
        now: () => NOW,
        getCookieSecret: () => COOKIE_SECRET,
        currentSeasonKey: () => SEASON,
      }),
    ]);
    captures.push([
      "GET /api/leaderboard/me",
      await handleLeaderboardMeGet(
        req(`/api/leaderboard/me?season=${SEASON}&draft_mode=classic`, { headers: authHeaders }),
        {
          db,
          now: () => NOW,
          getCookieSecret: () => COOKIE_SECRET,
          currentSeasonKey: () => SEASON,
        },
      ),
    ]);
    captures.push([
      "POST /api/leaderboard/submit",
      await handleLeaderboardSubmit(
        req("/api/leaderboard/submit", {
          method: "POST",
          headers: { ...authHeaders, "content-type": "application/json" },
          body: JSON.stringify({
            token: GOLDEN.classic.token,
            claimed_score: GOLDEN.classic.expected.verified_score,
            mode: "ranked",
            draft_mode: "classic",
            display_alias: "route_alias",
          }),
        }),
        {
          db,
          now: () => NOW,
          getCookieSecret: () => COOKIE_SECRET,
          getValidation: () => ({
            gameData: buildServerGameData(),
            scenario: serverScenarioBundle(),
          }),
          rateLimiter: { checkSubmit: async () => ({ allowed: true }) },
        },
      ),
    ]);

    for (const [label, res] of captures) {
      expect(res.status, label).toBeLessThan(400);
      expectNoEmail(label, await payloadOf(res));
    }

    const classicPayload = await payloadOf(
      await handleLeaderboardBoardGet(req(`/api/leaderboard?season=${SEASON}&draft_mode=classic`), {
        db,
        now: () => NOW,
        getCookieSecret: () => COOKIE_SECRET,
        currentSeasonKey: () => SEASON,
      }),
    );
    expect(classicPayload).toContain("route_user");
    expect(classicPayload).not.toContain("memory_alias");

    const hiddenPayload = await payloadOf(
      await handleLeaderboardBoardGet(req(`/api/leaderboard?season=${SEASON}&draft_mode=hidden`), {
        db,
        now: () => NOW,
        getCookieSecret: () => COOKIE_SECRET,
        currentSeasonKey: () => SEASON,
      }),
    );
    expect(hiddenPayload).toContain("memory_alias");
    expect(hiddenPayload).not.toContain(PRIVATE_EMAIL);

    const claimed = await db
      .select()
      .from(leaderboardEntries)
      .where(eq(leaderboardEntries.token, "t1.claim-route-board"));
    expect(claimed[0]!.mode).toBe("casual");
  });
});
