import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestTimeoutError } from "@wcdraft/data/client";

import { fetchAccountRunsPage } from "@/lib/account/client";
import { readServerProgressSummary } from "@/components/game/local-progress-band";
import type { GameData } from "../data";
import { createServerRunHistoryProvider } from "../server-history-provider";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function heldOpenBodyFetcher(): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    json: () => new Promise<unknown>(() => undefined),
  })) as unknown as typeof fetch;
}

describe("account/history/progress first-load budgets", () => {
  it.each([
    [
      "account history",
      (fetcher: typeof fetch) => fetchAccountRunsPage({ limit: 25, offset: 0 }, fetcher),
    ],
    [
      "history provider",
      (fetcher: typeof fetch) =>
        createServerRunHistoryProvider({ fetcher }).listCompletedRuns({} as GameData),
    ],
    ["progress", (fetcher: typeof fetch) => readServerProgressSummary(undefined, fetcher)],
  ])("settles a held-open %s read at 12s", async (_label, start) => {
    vi.useFakeTimers();
    const fetcher = heldOpenBodyFetcher();
    const pending = start(fetcher).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(12_000);
    const error = await pending;

    expect(error).toBeInstanceOf(RequestTimeoutError);
    expect(error).toMatchObject({ retrySafe: true, timeoutMs: 12_000 });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
