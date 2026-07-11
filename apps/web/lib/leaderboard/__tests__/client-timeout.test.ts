import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BOARD_FILTER } from "../config";
import { fetchBoardPage, requestRankedAttempt, submitRun } from "../client";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

    const pending = requestRankedAttempt({
      formationId: "4-3-3",
      draftMode: "classic",
      draftOrder: "squad_first",
      era: "all_time",
      ratingBasis: "career",
    });
    await vi.advanceTimersByTimeAsync(12_000);

    await expect(pending).resolves.toMatchObject({
      ok: false,
      status: null,
      timedOut: true,
      outcomeUnknown: true,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
