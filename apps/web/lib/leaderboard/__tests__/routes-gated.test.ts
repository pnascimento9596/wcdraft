// F-4 U3 — ship-dark gate: with LEADERBOARD_ENABLED absent (or anything but
// an explicit "1"/"true"), EVERY leaderboard route returns a bare 404 before
// any dependency is built. These tests run the REAL route exports with no
// DATABASE_URL / AUTH_COOKIE_SECRET in the environment — a 500 here means a
// dependency leaked ahead of the flag check (the F-3.6 bug class).
//
// Also locks the method surface: each route file exports exactly the
// methods in the plan §6 table, so Next rejects everything else at the
// framework layer.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import * as boardRoute from "@/app/api/leaderboard/route";
import * as lineupRoute from "@/app/api/leaderboard/lineup/route";
import * as meRoute from "@/app/api/leaderboard/me/route";
import * as submitRoute from "@/app/api/leaderboard/submit/route";
import * as rankedAttemptRoute from "@/app/api/ranked/attempt/route";
import { isLeaderboardAccountRequired, isLeaderboardEnabled } from "../enabled";

const ENV_KEYS = ["LEADERBOARD_ENABLED", "DATABASE_URL", "AUTH_COOKIE_SECRET"] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function submitReq(): NextRequest {
  return new NextRequest("http://localhost/api/leaderboard/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "t1.x", claimed_score: 1, display_name: "abc" }),
  });
}

describe("ship-dark — flag absent → 404 on every route, no deps touched", () => {
  it("POST /api/leaderboard/submit → 404 with empty body", async () => {
    const res = await submitRoute.POST(submitReq());
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  });

  it("GET /api/leaderboard → 404", async () => {
    const res = await boardRoute.GET(new NextRequest("http://localhost/api/leaderboard"));
    expect(res.status).toBe(404);
  });

  it("GET /api/leaderboard/me → 404", async () => {
    const res = await meRoute.GET(new NextRequest("http://localhost/api/leaderboard/me"));
    expect(res.status).toBe(404);
  });

  it("garbage flag values stay dark ('0', 'false', ' ', 'yes')", async () => {
    for (const v of ["0", "false", " ", "yes", "enabled"]) {
      process.env.LEADERBOARD_ENABLED = v;
      expect(isLeaderboardEnabled()).toBe(false);
      const res = await boardRoute.GET(new NextRequest("http://localhost/api/leaderboard"));
      expect(res.status).toBe(404);
    }
  });

  it("explicit '1' / 'true' (any case, padded) flips the flag", () => {
    for (const v of ["1", "true", "TRUE", " 1 "]) {
      process.env.LEADERBOARD_ENABLED = v;
      expect(isLeaderboardEnabled()).toBe(true);
    }
  });

  it("ranked submissions have no account-required OFF state", () => {
    expect(isLeaderboardAccountRequired()).toBe(true);
  });
});

describe("enabled but DB-unconfigured — typed availability failure", () => {
  beforeEach(() => {
    process.env.LEADERBOARD_ENABLED = "true";
    delete process.env.DATABASE_URL;
  });

  it("returns SERVICE_UNAVAILABLE before getDb on every leaderboard entrypoint", async () => {
    const responses = await Promise.all([
      boardRoute.GET(new NextRequest("http://localhost/api/leaderboard")),
      meRoute.GET(new NextRequest("http://localhost/api/leaderboard/me")),
      submitRoute.POST(submitReq()),
      lineupRoute.GET(new NextRequest("http://localhost/api/leaderboard/lineup?entry_id=x")),
      lineupRoute.POST(
        new Request("http://localhost/api/leaderboard/lineup", {
          method: "POST",
          body: JSON.stringify({ token: "t1.x" }),
        }),
      ),
      rankedAttemptRoute.POST(
        new NextRequest("http://localhost/api/ranked/attempt", { method: "POST" }),
      ),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "SERVICE_UNAVAILABLE" });
    }
  });
});

describe("method surface — only the plan §6 methods are exported", () => {
  it("submit exports POST only", () => {
    expect(typeof submitRoute.POST).toBe("function");
    expect((submitRoute as Record<string, unknown>).GET).toBeUndefined();
    expect((submitRoute as Record<string, unknown>).PUT).toBeUndefined();
    expect((submitRoute as Record<string, unknown>).DELETE).toBeUndefined();
  });

  it("board + me export GET only", () => {
    for (const mod of [boardRoute, meRoute] as Record<string, unknown>[]) {
      expect(typeof mod.GET).toBe("function");
      expect(mod.POST).toBeUndefined();
      expect(mod.PUT).toBeUndefined();
      expect(mod.DELETE).toBeUndefined();
    }
  });

  it("lineup exports GET + POST and ranked attempt exports POST only", () => {
    expect(typeof lineupRoute.GET).toBe("function");
    expect(typeof lineupRoute.POST).toBe("function");
    expect((lineupRoute as Record<string, unknown>).PUT).toBeUndefined();
    expect((lineupRoute as Record<string, unknown>).DELETE).toBeUndefined();
    expect(typeof rankedAttemptRoute.POST).toBe("function");
    expect((rankedAttemptRoute as Record<string, unknown>).GET).toBeUndefined();
    expect((rankedAttemptRoute as Record<string, unknown>).PUT).toBeUndefined();
    expect((rankedAttemptRoute as Record<string, unknown>).DELETE).toBeUndefined();
  });
});
