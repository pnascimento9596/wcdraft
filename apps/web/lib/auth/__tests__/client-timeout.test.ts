import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestTimeoutError } from "@wcdraft/data/client";

import { fetchSession, postJson } from "../client";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("auth client request budgets", () => {
  it("settles a held-open session read at 12s and marks an explicit retry safe", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: () => new Promise<unknown>(() => undefined),
    }));
    vi.stubGlobal("fetch", fetcher);

    const pending = fetchSession().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(12_000);

    await expect(pending).resolves.toMatchObject({
      name: "RequestTimeoutError",
      timeoutMs: 12_000,
      retrySafe: true,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("never auto-replays a timed-out authenticated mutation", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", { cookie: "wcdraft_csrf=test-token" });
    const fetcher = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetcher);

    const pending = postJson("/api/test-mutation", { value: 1 }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(12_000);

    const error = await pending;
    expect(error).toBeInstanceOf(RequestTimeoutError);
    expect(error).toMatchObject({ retrySafe: false, timeoutMs: 12_000 });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
