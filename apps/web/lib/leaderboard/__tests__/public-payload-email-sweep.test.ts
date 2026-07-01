// L4 privacy sweep — public payloads may expose username/alias, never email.
//
// This deliberately exercises route-level adapters where they have injectable
// seams, plus the leaderboard submit/read handlers directly where the Next
// route wrappers only build production deps. The invariant is payload-level:
// a real private email exists in the backing DB and in the magic-link request,
// but no public response body or header is allowed to contain it.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { leaderboardEntries, magicLinkTokens, rankedAttempts, savedRuns, users } from "@wcdraft/db";

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

import { DELETE as accountDelete } from "@/app/api/account/route";
import { PUT as accountPasswordPut } from "@/app/api/account/password/route";
import { GET as accountRunsGet } from "@/app/api/account/runs/route";
import { GET as authConfigGet } from "@/app/api/auth/config/route";
import { GET as csrfGet } from "@/app/api/auth/csrf/route";
import { POST as magicLinkPost } from "@/app/api/auth/magic-link/route";
import { POST as passwordLoginPost } from "@/app/api/auth/password-login/route";
import { DELETE as sessionDelete, GET as sessionGet } from "@/app/api/auth/session/route";
import { GET as verifyGet, POST as verifyPost } from "@/app/api/auth/verify/route";
import { POST as cspReportPost } from "@/app/api/csp-report/route";
import { GET as ogHealthGet } from "@/app/api/og/health/route";
import { POST as ogSignPost } from "@/app/api/og/sign/route";
import { GET as profileGet, PUT as profilePut } from "@/app/api/profile/route";
import { GET as runsGet, POST as runsPost } from "@/app/api/runs/route";
import { DELETE as runDelete, GET as runDetailGet } from "@/app/api/runs/[id]/route";
import { POST as runsClaimPost } from "@/app/api/runs/claim/route";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/lib/auth/csrf";
import { LogEmailSender } from "@/lib/auth/email";
import { createSession, SESSION_COOKIE_NAME } from "@/lib/auth/sessions";
import { allowAllRunOgSignRateLimiter } from "../../game/run-og-sign-rate-limiter-db";
import { testCookieSecret, setupTestDb } from "../../auth/__tests__/_test-db";
import { hashPassword } from "../../auth/passwords";
import { handleLeaderboardBoardGet, handleLeaderboardMeGet } from "../board-route";
import { handleLeaderboardLineupGet, handleLeaderboardLineupPost } from "../lineup-route";
import { handleRankedAttemptPost } from "../ranked-attempt-route";
import { handleLeaderboardSubmit } from "../submit-route";
import { buildServerGameData, serverScenarioBundle } from "./_harness";
import { decodeRunToken, tokenDraftConfig } from "../../game/run-token";
import fixtureJson from "./fixtures/leaderboard-validate-golden.json" with { type: "json" };

const { db, pg, reset } = await setupTestDb();
afterAll(async () => pg.close());

const NOW = Date.parse("2026-06-12T12:00:00.000Z");
const COOKIE_SECRET = testCookieSecret("l4-public-payload-sweep");
const PRIVATE_EMAIL = "private-route-sweep@example.com";
const OTHER_PRIVATE_EMAIL = "other-route-sweep@example.com";
const MAGIC_EMAIL = "magic-route-sweep@example.com";
const SEASON = "season-route-sweep";
const API_ROOT = fileURLToPath(new URL("../../../app/api", import.meta.url));
const ROUTE_EXPORT_RE =
  /\bexport\s+(?:(?:async\s+)?function|const)\s+(GET|POST|PUT|DELETE|PATCH)\b/g;
const PUBLIC_API_METHODS = [
  "DELETE /api/account",
  "DELETE /api/auth/session",
  "DELETE /api/runs/[id]",
  "GET /api/account/runs",
  "GET /api/auth/config",
  "GET /api/auth/csrf",
  "GET /api/auth/session",
  "GET /api/auth/verify",
  "GET /api/leaderboard",
  "GET /api/leaderboard/lineup",
  "GET /api/leaderboard/me",
  "GET /api/og/health",
  "GET /api/profile",
  "GET /api/runs",
  "GET /api/runs/[id]",
  "POST /api/auth/magic-link",
  "POST /api/auth/password-login",
  "POST /api/auth/verify",
  "POST /api/csp-report",
  "POST /api/leaderboard/submit",
  "POST /api/leaderboard/lineup",
  "POST /api/og/sign",
  "POST /api/ranked/attempt",
  "POST /api/runs",
  "POST /api/runs/claim",
  "PUT /api/account/password",
  "PUT /api/profile",
] as const;
type PublicApiMethod = (typeof PUBLIC_API_METHODS)[number];
const SELF_EMAIL_ALLOWED_ROUTES = new Set<PublicApiMethod>(["GET /api/account/runs"]);
interface CapturedResponse {
  readonly route: PublicApiMethod;
  readonly label: string;
  readonly res: Response;
  readonly statusLessThan: number;
}
const GOLDEN = fixtureJson as unknown as {
  season_key: string;
  classic: { token: string; expected: { verified_score: number } };
};

let sender: LogEmailSender;
let authEnv: Record<string, string | undefined> = snapshotAuthEnv();

function snapshotAuthEnv(): Record<string, string | undefined> {
  return {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    AUTH_EMAIL_FROM: process.env.AUTH_EMAIL_FROM,
    AUTH_BASE_URL: process.env.AUTH_BASE_URL,
    WCDRAFT_OG_SIGNING_SECRET: process.env.WCDRAFT_OG_SIGNING_SECRET,
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
  process.env.WCDRAFT_OG_SIGNING_SECRET = "public-payload-sweep-og-secret-32-bytes-minimum";
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

async function payloadOf(res: Response): Promise<string> {
  const body = await res.text();
  const headers = Array.from(res.headers.entries())
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return `${res.status}\n${body}\n${headers}`;
}

function expectNoEmail(label: string, payload: string): void {
  expect(payload, label).not.toContain(PRIVATE_EMAIL);
  expect(payload, label).not.toContain(OTHER_PRIVATE_EMAIL);
  expect(payload, label).not.toContain(MAGIC_EMAIL);
  expect(payload, label).not.toContain('"email"');
}

function expectOnlyCallerEmail(label: string, payload: string): void {
  expect(payload, label).toContain(PRIVATE_EMAIL);
  expect(payload, label).toContain('"email"');
  expect(payload, label).not.toContain(OTHER_PRIVATE_EMAIL);
  expect(payload, label).not.toContain(MAGIC_EMAIL);
}

function routeCapture(
  route: PublicApiMethod,
  res: Response,
  label: string = route,
  statusLessThan = 400,
): CapturedResponse {
  return { route, label, res, statusLessThan };
}

function expectedPublicApiMethods(): string[] {
  return [...PUBLIC_API_METHODS].sort();
}

function discoverExportedApiMethods(dir = API_ROOT): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...discoverExportedApiMethods(path));
      continue;
    }
    if (!entry.isFile() || entry.name !== "route.ts") continue;
    const routeDir = relative(API_ROOT, dirname(path)).split(sep).join("/");
    const route = routeDir === "" ? "/api" : `/api/${routeDir}`;
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(ROUTE_EXPORT_RE)) {
      found.push(`${match[1]} ${route}`);
    }
  }
  return found.sort();
}

describe("public route payload email sweep", () => {
  it("never serializes email across auth/profile/runs/leaderboard public responses", async () => {
    expect(discoverExportedApiMethods()).toEqual(expectedPublicApiMethods());

    const [user] = await db
      .insert(users)
      .values({
        email: PRIVATE_EMAIL,
        username: "route_user",
        passwordHash: await hashPassword("Route-Secure-42!"),
      })
      .returning();
    const [otherUser] = await db.insert(users).values({ email: OTHER_PRIVATE_EMAIL }).returning();
    const session = await createSession({ userId: user!.id }, runtime.deps!);
    const authHeaders = signedHeaders(session.cookieValue, session.session.csrfSecret);
    const verifySession = await createSession({ userId: null }, runtime.deps!);
    const verifyHeaders = signedHeaders(
      verifySession.cookieValue,
      verifySession.session.csrfSecret,
    );
    const signoutSession = await createSession({ userId: user!.id }, runtime.deps!);
    const signoutHeaders = signedHeaders(
      signoutSession.cookieValue,
      signoutSession.session.csrfSecret,
    );
    const passwordLoginSession = await createSession({ userId: null }, runtime.deps!);
    const passwordLoginHeaders = signedHeaders(
      passwordLoginSession.cookieValue,
      passwordLoginSession.session.csrfSecret,
    );
    const deleteSessionForAccount = await createSession({ userId: otherUser!.id }, runtime.deps!);
    const deleteAccountHeaders = signedHeaders(
      deleteSessionForAccount.cookieValue,
      deleteSessionForAccount.session.csrfSecret,
    );

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
      ownerUserId: otherUser!.id,
      sessionId: null,
      token: "t1.other-account-route-sweep",
      versionAnchors: { dataset_version: "route-sweep" },
      runId: "run-other-route-sweep",
      parentSeed: "seed-other-route-sweep",
      summary: {
        team_name: "Other Private XI",
        display_record: "0-0",
        formation_name: "4-3-3",
        key_picks: [],
        is_champion: false,
        seed: "seed-other-route-sweep",
      },
      claimState: "claimed",
      createdAt: new Date(NOW - 45_000),
    });

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

    const [classicAttempt, memoryAttempt] = await db
      .insert(rankedAttempts)
      .values([
        {
          userId: user!.id,
          sessionId: null,
          seasonKey: SEASON,
          formationId: "4-3-3",
          draftMode: "classic",
          draftOrder: "squad_first",
          era: "all_time",
          ratingBasis: "career",
          issuedParentSeed: "seed-classic-route-board",
          nonce: "nonce-classic-route",
          issuedAt: new Date(NOW),
          windowExpiresAt: new Date(NOW + 60_000),
        },
        {
          userId: user!.id,
          sessionId: null,
          seasonKey: SEASON,
          formationId: "4-3-3",
          draftMode: "hidden",
          draftOrder: "squad_first",
          era: "all_time",
          ratingBasis: "career",
          issuedParentSeed: "seed-memory-route-board",
          nonce: "nonce-memory-route0",
          issuedAt: new Date(NOW),
          windowExpiresAt: new Date(NOW + 60_000),
        },
      ])
      .returning();

    await db.insert(leaderboardEntries).values([
      {
        seasonKey: SEASON,
        mode: "ranked",
        draftMode: "classic",
        draftOrder: "squad_first",
        era: "all_time",
        ratingBasis: "career",
        userId: user!.id,
        sessionId: null,
        displayAlias: null,
        token: "t1.classic-route-board",
        verifiedScore: 88,
        scoreBreakdown: [],
        attemptId: classicAttempt!.id,
        createdAt: new Date(NOW - 5_000),
      },
      {
        seasonKey: SEASON,
        mode: "ranked",
        draftMode: "hidden",
        draftOrder: "squad_first",
        era: "all_time",
        ratingBasis: "career",
        userId: user!.id,
        sessionId: null,
        displayAlias: "memory_alias",
        token: "t1.memory-route-board",
        verifiedScore: 77,
        scoreBreakdown: [],
        attemptId: memoryAttempt!.id,
        createdAt: new Date(NOW - 4_000),
      },
      {
        seasonKey: SEASON,
        mode: "casual",
        draftMode: "classic",
        draftOrder: "squad_first",
        era: "all_time",
        ratingBasis: "career",
        userId: null,
        sessionId: session.session.id,
        displayAlias: "anon_route",
        token: "t1.claim-route-board",
        verifiedScore: 11,
        scoreBreakdown: [],
        createdAt: new Date(NOW - 3_000),
      },
    ]);
    const [lineupEntry] = await db
      .insert(leaderboardEntries)
      .values({
        seasonKey: SEASON,
        mode: "casual",
        draftMode: "classic",
        draftOrder: "squad_first",
        era: "all_time",
        ratingBasis: "career",
        userId: user!.id,
        sessionId: null,
        displayAlias: null,
        token: GOLDEN.classic.token,
        verifiedScore: GOLDEN.classic.expected.verified_score,
        scoreBreakdown: [],
        createdAt: new Date(NOW - 2_000),
      })
      .returning();

    const captures: CapturedResponse[] = [];
    captures.push(routeCapture("GET /api/auth/config", await authConfigGet()));
    captures.push(
      routeCapture(
        "GET /api/auth/csrf",
        await csrfGet(req("/api/auth/csrf", { headers: authHeaders })),
      ),
    );
    captures.push(
      routeCapture(
        "GET /api/auth/session",
        await sessionGet(req("/api/auth/session", { headers: authHeaders })),
      ),
    );
    captures.push(
      routeCapture(
        "POST /api/auth/magic-link",
        await magicLinkPost(
          req("/api/auth/magic-link", {
            method: "POST",
            headers: {
              ...verifyHeaders,
              "content-type": "application/json",
              "x-forwarded-for": "127.0.0.1",
            },
            body: JSON.stringify({ email: MAGIC_EMAIL }),
          }),
        ),
      ),
    );
    captures.push(
      routeCapture(
        "POST /api/csp-report",
        await cspReportPost(
          req("/api/csp-report", {
            method: "POST",
            headers: { "content-type": "application/csp-report" },
            body: JSON.stringify({
              "csp-report": {
                "document-uri": "http://localhost/",
                "violated-directive": "script-src",
                "blocked-uri": "inline",
              },
            }),
          }),
        ),
      ),
    );
    captures.push(routeCapture("GET /api/og/health", await ogHealthGet()));
    captures.push(
      routeCapture(
        "POST /api/og/sign",
        await ogSignPost(
          req("/api/og/sign", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({}),
          }),
        ),
        "POST /api/og/sign validation error",
        500,
      ),
    );

    const tokenHashRow = await db.select().from(magicLinkTokens).limit(1);
    expect(tokenHashRow).toHaveLength(1);
    const verifyToken = new URL(sender.lastSent!.magicLinkUrl).searchParams.get("token")!;
    captures.push(
      routeCapture(
        "GET /api/auth/verify",
        await verifyGet(
          req(`/api/auth/verify?token=${verifyToken}&next=/play`, { headers: verifyHeaders }),
        ),
      ),
    );
    captures.push(
      routeCapture(
        "GET /api/profile",
        await profileGet(req("/api/profile", { headers: authHeaders })),
      ),
    );
    captures.push(
      routeCapture(
        "PUT /api/profile",
        await profilePut(
          req("/api/profile", {
            method: "PUT",
            headers: { ...authHeaders, "content-type": "application/json" },
            body: JSON.stringify({ username: "route_user" }),
          }),
        ),
      ),
    );
    captures.push(
      routeCapture(
        "POST /api/ranked/attempt",
        await handleRankedAttemptPost(
          req("/api/ranked/attempt", {
            method: "POST",
            headers: { ...authHeaders, "content-type": "application/json" },
            body: JSON.stringify({
              formation_id: "4-3-3",
              draft_mode: "classic",
              draft_order: "squad_first",
              era: "all_time",
              rating_basis: "career",
            }),
          }),
          {
            db,
            now: () => NOW,
            getCookieSecret: () => COOKIE_SECRET,
            currentSeasonKey: () => SEASON,
            randomBytes: (size) => new Uint8Array(size).fill(11),
          },
        ),
      ),
    );
    captures.push(
      routeCapture("GET /api/runs", await runsGet(req("/api/runs", { headers: authHeaders }))),
    );
    captures.push(
      routeCapture(
        "GET /api/account/runs",
        await accountRunsGet(req("/api/account/runs?limit=25", { headers: authHeaders })),
      ),
    );

    const saveRunRes = await runsPost(
      req("/api/runs", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          token: "t1.post-route-sweep",
          versionAnchors: { dataset_version: "route-sweep" },
          runId: "run-post-route-sweep",
          parentSeed: "seed-post-route-sweep",
          summary: {
            team_name: "Post XI",
            display_record: "1-0",
            formation_name: "4-3-3",
            key_picks: [],
            is_champion: false,
            seed: "seed-post-route-sweep",
          },
        }),
      }),
    );
    const saveRunBody = (await saveRunRes.clone().json()) as { run?: { id?: unknown } };
    expect(typeof saveRunBody.run?.id).toBe("string");
    const savedRouteRunId = saveRunBody.run!.id as string;
    captures.push(routeCapture("POST /api/runs", saveRunRes));

    captures.push(
      routeCapture(
        "GET /api/runs/[id]",
        await runDetailGet(req(`/api/runs/${accountRun!.id}`, { headers: authHeaders }), {
          params: Promise.resolve({ id: accountRun!.id }),
        }),
      ),
    );
    captures.push(
      routeCapture(
        "DELETE /api/runs/[id]",
        await runDelete(
          req(`/api/runs/${savedRouteRunId}`, { method: "DELETE", headers: authHeaders }),
          {
            params: Promise.resolve({ id: savedRouteRunId }),
          },
        ),
      ),
    );
    captures.push(
      routeCapture(
        "POST /api/runs/claim",
        await runsClaimPost(req("/api/runs/claim", { method: "POST", headers: authHeaders })),
      ),
    );
    captures.push(
      routeCapture(
        "PUT /api/account/password",
        await accountPasswordPut(
          req("/api/account/password", {
            method: "PUT",
            headers: { ...authHeaders, "content-type": "application/json" },
            body: JSON.stringify({
              currentPassword: "Route-Secure-42!",
              newPassword: "Route-Secure-43!",
            }),
          }),
        ),
      ),
    );
    captures.push(
      routeCapture(
        "POST /api/auth/password-login",
        await passwordLoginPost(
          req("/api/auth/password-login", {
            method: "POST",
            headers: {
              ...passwordLoginHeaders,
              "content-type": "application/json",
              "x-forwarded-for": "127.0.0.2",
            },
            body: JSON.stringify({
              email: PRIVATE_EMAIL,
              password: "Route-Secure-43!",
              next: "/account",
            }),
          }),
        ),
      ),
    );

    captures.push(
      routeCapture(
        "GET /api/leaderboard",
        await handleLeaderboardBoardGet(
          req(`/api/leaderboard?season=${SEASON}&draft_mode=classic`),
          {
            db,
            now: () => NOW,
            getCookieSecret: () => COOKIE_SECRET,
            currentSeasonKey: () => SEASON,
          },
        ),
        "GET /api/leaderboard classic",
      ),
    );
    captures.push(
      routeCapture(
        "GET /api/leaderboard",
        await handleLeaderboardBoardGet(
          req(`/api/leaderboard?season=${SEASON}&draft_mode=hidden`),
          {
            db,
            now: () => NOW,
            getCookieSecret: () => COOKIE_SECRET,
            currentSeasonKey: () => SEASON,
          },
        ),
        "GET /api/leaderboard hidden",
      ),
    );
    captures.push(
      routeCapture(
        "GET /api/leaderboard/me",
        await handleLeaderboardMeGet(
          req(`/api/leaderboard/me?season=${SEASON}&draft_mode=classic`, {
            headers: authHeaders,
          }),
          {
            db,
            now: () => NOW,
            getCookieSecret: () => COOKIE_SECRET,
            currentSeasonKey: () => SEASON,
          },
        ),
      ),
    );
    const lineupDeps = {
      db,
      now: () => NOW,
      getValidationData: () => ({
        gameData: buildServerGameData(),
        scenario: serverScenarioBundle(),
        seasonKey: GOLDEN.season_key,
      }),
      getRateLimiter: () => allowAllRunOgSignRateLimiter,
    };
    captures.push(
      routeCapture(
        "GET /api/leaderboard/lineup",
        await handleLeaderboardLineupGet(
          req(`/api/leaderboard/lineup?entry_id=${lineupEntry!.id}`),
          lineupDeps,
        ),
      ),
    );
    captures.push(
      routeCapture(
        "POST /api/leaderboard/lineup",
        await handleLeaderboardLineupPost(
          req("/api/leaderboard/lineup", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token: GOLDEN.classic.token }),
          }),
          lineupDeps,
        ),
      ),
    );
    const submitToken = decodeRunToken(GOLDEN.classic.token);
    if (submitToken === null) throw new Error("golden submit token failed to decode");
    const submitConfig = tokenDraftConfig(submitToken);
    await db.insert(rankedAttempts).values({
      userId: user!.id,
      sessionId: session.session.id,
      seasonKey: GOLDEN.season_key,
      formationId: submitToken.fid,
      draftMode: submitToken.md,
      draftOrder: submitConfig.draft_flow,
      era: submitConfig.era_preset,
      ratingBasis: submitConfig.rating_basis,
      issuedParentSeed: submitToken.ps,
      nonce: "nonce-submit-route",
      issuedAt: new Date(NOW),
      windowExpiresAt: new Date(NOW + 60_000),
    });
    captures.push(
      routeCapture(
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
      ),
    );
    captures.push(
      routeCapture(
        "POST /api/auth/verify",
        await verifyPost(
          req("/api/auth/verify", {
            method: "POST",
            headers: {
              ...verifyHeaders,
              "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              token: verifyToken,
              next: "/play",
              csrf: verifySession.session.csrfSecret,
            }),
          }),
        ),
      ),
    );
    captures.push(
      routeCapture(
        "DELETE /api/auth/session",
        await sessionDelete(
          req("/api/auth/session", { method: "DELETE", headers: signoutHeaders }),
        ),
      ),
    );
    captures.push(
      routeCapture(
        "DELETE /api/account",
        await accountDelete(
          req("/api/account", {
            method: "DELETE",
            headers: { ...deleteAccountHeaders, "content-type": "application/json" },
            body: JSON.stringify({ confirm: "delete my account" }),
          }),
        ),
      ),
    );

    const coveredRoutes = Array.from(new Set(captures.map((capture) => capture.route))).sort();
    expect(coveredRoutes).toEqual(expectedPublicApiMethods());

    for (const { route, label, res, statusLessThan } of captures) {
      expect(res.status, label).toBeLessThan(statusLessThan);
      const payload = await payloadOf(res);
      if (SELF_EMAIL_ALLOWED_ROUTES.has(route)) {
        expectOnlyCallerEmail(label, payload);
      } else {
        expectNoEmail(label, payload);
      }
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
