import { afterEach, describe, expect, it, vi } from "vitest";

import { unsafeMutationResponseDisposition } from "@/lib/unsafe-mutation";

import { DEFAULT_BOARD_FILTER } from "../config";
import { fetchBoardPage, requestRankedAttempt, submitRun } from "../client";

const RANKED_INPUT = {
  formationId: "4-3-3",
  draftMode: "classic",
  draftOrder: "squad_first",
  era: "all_time",
  ratingBasis: "career",
} as const;

function validRankedAttemptBody(): Record<string, string> {
  return {
    attempt_id: "attempt-1",
    parent_seed: "seed-1",
    expires_at: "2026-07-11T05:00:00.000Z",
    season_key: "2026-s1",
    formation_id: "4-3-3",
    draft_mode: "classic",
    draft_order: "squad_first",
    era: "all_time",
    rating_basis: "career",
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("unsafe mutation HTTP acknowledgement classification", () => {
  it.each([
    [400, "definitive"],
    [401, "definitive"],
    [403, "definitive"],
    [409, "definitive"],
    [429, "definitive"],
    [408, "outcome-unknown"],
    [500, "outcome-unknown"],
    [502, "outcome-unknown"],
    [503, "outcome-unknown"],
    [504, "outcome-unknown"],
  ] as const)("classifies HTTP %i as %s", (status, expected) => {
    expect(unsafeMutationResponseDisposition(status)).toBe(expected);
  });
});

describe("leaderboard client request budgets", () => {
  it("turns a held-open first board response into a retryable timeout state", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: () => new Promise<unknown>(() => undefined),
    }));
    vi.stubGlobal("fetch", fetcher);

    const pending = fetchBoardPage({ filter: DEFAULT_BOARD_FILTER, cursor: null });
    await vi.advanceTimersByTimeAsync(12_000);

    await expect(pending).resolves.toEqual({ ok: false, reason: "timeout" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("maps a held-open submit to an ambiguous timeout without replaying", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", { cookie: "wcdraft_csrf=test-token" });
    const fetcher = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetcher);

    const pending = submitRun({
      token: "run-token",
      claimedScore: 10,
      mode: "casual",
      draftMode: "classic",
      displayName: "manager_10",
    });
    await vi.advanceTimersByTimeAsync(12_000);

    await expect(pending).resolves.toEqual({ kind: "timeout" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("types a held-open ranked seed request as outcome-unknown", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", { cookie: "wcdraft_csrf=test-token" });
    const fetcher = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetcher);

    const pending = requestRankedAttempt(RANKED_INPUT);
    await vi.advanceTimersByTimeAsync(12_000);

    await expect(pending).resolves.toMatchObject({
      ok: false,
      status: null,
      timedOut: true,
      outcomeUnknown: true,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    ["an unreadable body", "not-json"],
    ["a malformed body", JSON.stringify({ attempt_id: "incomplete-attempt" })],
    ["an empty issued id", JSON.stringify({ ...validRankedAttemptBody(), attempt_id: "" })],
    [
      "an invalid expiry",
      JSON.stringify({ ...validRankedAttemptBody(), expires_at: "not-a-timestamp" }),
    ],
  ])("types committed HTTP 201 with %s as outcome-unknown", async (_label, responseBody) => {
    vi.stubGlobal("document", { cookie: "wcdraft_csrf=test-token" });
    const fetcher = vi.fn(
      async () =>
        new Response(responseBody, {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(requestRankedAttempt(RANKED_INPUT)).resolves.toEqual({
      ok: false,
      status: 201,
      message: "The ranked seed response could not be verified. The attempt may have been issued.",
      timedOut: false,
      outcomeUnknown: true,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    [200, null, true],
    [204, null, true],
    [299, JSON.stringify({ attempt_id: "incomplete-attempt" }), true],
    [400, JSON.stringify({ message: "Bad request." }), false],
    [401, JSON.stringify({ message: "Sign in first." }), false],
    [403, JSON.stringify({ message: "Verify email first." }), false],
    [409, JSON.stringify({ message: "Attempt already exists." }), false],
    [429, JSON.stringify({ message: "Slow down." }), false],
    [408, JSON.stringify({ message: "Request timeout." }), true],
    [500, "not-json", true],
    [502, JSON.stringify({ message: "Bad gateway." }), true],
    [503, JSON.stringify({ message: "Unavailable." }), true],
    [504, JSON.stringify({ message: "Gateway timeout." }), true],
  ] as const)(
    "classifies HTTP %i with no usable attempt as outcomeUnknown=%s",
    async (status, responseBody, outcomeUnknown) => {
      vi.stubGlobal("document", { cookie: "wcdraft_csrf=test-token" });
      const fetcher = vi.fn(
        async () =>
          new Response(responseBody, {
            status,
            headers: { "Content-Type": "application/json" },
          }),
      );
      vi.stubGlobal("fetch", fetcher);

      await expect(requestRankedAttempt(RANKED_INPUT)).resolves.toMatchObject({
        ok: false,
        status,
        timedOut: false,
        outcomeUnknown,
      });
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it("still accepts a valid committed HTTP 201 attempt", async () => {
    vi.stubGlobal("document", { cookie: "wcdraft_csrf=test-token" });
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(validRankedAttemptBody()), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(requestRankedAttempt(RANKED_INPUT)).resolves.toMatchObject({
      ok: true,
      attempt: { attempt_id: "attempt-1", parent_seed: "seed-1" },
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
