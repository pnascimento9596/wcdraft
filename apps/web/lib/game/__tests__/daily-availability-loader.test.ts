import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DailySeedVettingMetrics } from "@wcdraft/data";

const loaders = vi.hoisted(() => ({
  manifest: vi.fn(),
  saltMap: vi.fn(),
  draftPool: vi.fn(),
}));

vi.mock("@wcdraft/data/client", () => ({
  DAILY_SEED_MAX_SALT_ATTEMPTS: 8,
  REQUEST_BUDGET_MS: { dailyMetadata: 12_000, runtimeData: 30_000 },
  isRequestTimeoutError: (error: unknown) =>
    error instanceof Error && error.name === "RequestTimeoutError",
  boundedRequest: async (
    run: (signal: AbortSignal) => Promise<unknown>,
    options: { timeoutMs: number },
  ) => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error("timed out");
        error.name = "RequestTimeoutError";
        controller.abort(error);
        reject(error);
      }, options.timeoutMs);
    });
    try {
      return await Promise.race([run(controller.signal), timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  },
  loadDataManifest: loaders.manifest,
  loadDailySeedSaltMap: loaders.saltMap,
  loadDraftPoolBundle: loaders.draftPool,
}));

import { loadDailyAvailability } from "../data";

function dateEntry(date: string): DailySeedVettingMetrics {
  return {
    date,
    salt: 0,
    seed: `wcdraft:daily:v1:${date}`,
    sample_seed_prefix: `wcdraft:daily:v1:${date}:test`,
    selected: true,
    degenerate: false,
    reason: "normal",
    runs: 1,
    perfect_runs: 0,
    perfect_rate: 0,
    qualifying_runs: 1,
    qualifying_rate: 1,
    mean: 1,
    median: 1,
    min: 1,
    max: 1,
    exact_seed_score: 1,
    exact_seed_qualified: true,
    exact_seed_perfect: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("lightweight Daily availability loader", () => {
  it("loads only the manifest and salt map for a covered date", async () => {
    loaders.manifest.mockResolvedValue({ bundles: { daily_seed_salt_map: {} } });
    loaders.saltMap.mockResolvedValue({
      window: { start_date: "2026-07-03", days: 1, timezone: "UTC" },
      population: { max_salt_attempts: 8 },
      salts: {},
      dates: [dateEntry("2026-07-03")],
    });

    await expect(loadDailyAvailability("2026-07-03")).resolves.toBe(true);
    expect(loaders.manifest).toHaveBeenCalledOnce();
    expect(loaders.saltMap).toHaveBeenCalledOnce();
    expect(loaders.draftPool).not.toHaveBeenCalled();
  });

  it("fails closed without an advertised salt map and never loads the pool", async () => {
    loaders.manifest.mockResolvedValue({ bundles: {} });

    await expect(loadDailyAvailability("2026-07-03")).resolves.toBe(false);
    expect(loaders.saltMap).not.toHaveBeenCalled();
    expect(loaders.draftPool).not.toHaveBeenCalled();
  });

  it("bounds a held-open metadata request and exposes a translated timeout", async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      loaders.manifest.mockImplementation(
        ({ signal }: { signal: AbortSignal }) =>
          new Promise((_, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
      );

      const pending = loadDailyAvailability("2026-07-03").catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(12_000);

      await expect(pending).resolves.toMatchObject({
        name: "RuntimeDataLoadError",
        message: expect.stringContaining("too long"),
      });
      expect(loaders.saltMap).not.toHaveBeenCalled();
      expect(loaders.draftPool).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      vi.useRealTimers();
    }
  });
});
