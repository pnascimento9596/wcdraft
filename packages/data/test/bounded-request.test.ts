import { afterEach, describe, expect, it, vi } from "vitest";

import {
  boundedRequest,
  isRequestTimeoutError,
  loadDataManifest,
  RequestTimeoutError,
} from "../src/client.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("boundedRequest", () => {
  it.each([
    ["safe-read", true],
    ["unsafe-mutation", false],
  ] as const)(
    "times out a held-open %s once and records retry safety",
    async (safety, retrySafe) => {
      vi.useFakeTimers();
      const signals: AbortSignal[] = [];
      const run = vi.fn((signal: AbortSignal) => {
        signals.push(signal);
        return new Promise<string>(() => undefined);
      });
      const pending = boundedRequest(run, {
        operation: "test request",
        timeoutMs: 250,
        safety,
      }).catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(249);
      expect(run).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);

      const error = await pending;
      expect(error).toBeInstanceOf(RequestTimeoutError);
      expect(error).toMatchObject({
        operation: "test request",
        timeoutMs: 250,
        retrySafe,
      });
      expect(signals[0]?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("composes an external signal and cleans its timeout/listener", async () => {
    vi.useFakeTimers();
    const external = new AbortController();
    const add = vi.spyOn(external.signal, "addEventListener");
    const remove = vi.spyOn(external.signal, "removeEventListener");
    const internalSignals: AbortSignal[] = [];
    const pending = boundedRequest(
      (signal) => {
        internalSignals.push(signal);
        return new Promise<string>(() => undefined);
      },
      {
        operation: "externally cancelled request",
        timeoutMs: 5_000,
        safety: "safe-read",
        signal: external.signal,
      },
    ).catch((error: unknown) => error);

    await Promise.resolve();
    const reason = new Error("caller navigation");
    external.abort(reason);
    await expect(pending).resolves.toBe(reason);
    expect(internalSignals[0]?.aborted).toBe(true);
    expect(add).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the timeout after success", async () => {
    vi.useFakeTimers();
    await expect(
      boundedRequest(async () => "ready", {
        operation: "successful request",
        timeoutMs: 1_000,
        safety: "safe-read",
      }),
    ).resolves.toBe("ready");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores late resolution without a second caller effect", async () => {
    vi.useFakeTimers();
    let resolveLate!: (value: string) => void;
    const late = new Promise<string>((resolve) => {
      resolveLate = resolve;
    });
    const fulfilled = vi.fn();
    const rejected = vi.fn();
    const pending = boundedRequest(() => late, {
      operation: "late request",
      timeoutMs: 10,
      safety: "safe-read",
    }).then(fulfilled, rejected);

    await vi.advanceTimersByTimeAsync(10);
    await pending;
    expect(fulfilled).not.toHaveBeenCalled();
    expect(rejected).toHaveBeenCalledOnce();
    expect(isRequestTimeoutError(rejected.mock.calls[0]?.[0])).toBe(true);

    resolveLate("too late");
    await Promise.resolve();
    expect(fulfilled).not.toHaveBeenCalled();
    expect(rejected).toHaveBeenCalledOnce();
  });
});

describe("runtime data request budget", () => {
  it("bounds held-open response parsing and never exposes the URL in the timeout", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: () => new Promise<unknown>(() => undefined),
    })) as unknown as typeof fetch;
    const pending = loadDataManifest({
      basePath: "https://user:secret@example.invalid/private",
      fetch: fetcher,
      timeoutMs: 20,
    }).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(20);
    const error = await pending;
    expect(error).toBeInstanceOf(RequestTimeoutError);
    expect(String(error)).toContain("runtime data manifest");
    expect(String(error)).not.toMatch(/user|secret|example\.invalid|private/u);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
