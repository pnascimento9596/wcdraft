import type { DailySeedSaltMap, DraftPoolBundle, RuntimeDataManifest } from "@wcdraft/data";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearServiceWorkerRegistrationForTests,
  registerWcdraftServiceWorker,
  type ServiceWorkerContainerLike,
  type ServiceWorkerRegistrationLike,
  waitForRuntimeDataServiceWorkerHandoff,
} from "../../service-worker";
import {
  loadDraftPoolAfterServiceWorkerHandoff,
  loadRuntimeDataAfterServiceWorkerHandoff,
} from "../data";

const TEST_MANIFEST = {} as RuntimeDataManifest;

class FakeServiceWorkerContainer implements ServiceWorkerContainerLike {
  controller: unknown | null = null;
  readonly ready: Promise<ServiceWorkerRegistrationLike>;
  private resolveReady: (registration: ServiceWorkerRegistrationLike) => void = () => undefined;
  private readonly controllerListeners = new Set<() => void>();

  constructor() {
    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  readonly register = vi.fn(
    async (
      scriptURL: string,
      options: { updateViaCache: "none" },
    ): Promise<ServiceWorkerRegistrationLike> => ({
      installing: { scriptURL, updateViaCache: options.updateViaCache },
    }),
  );

  addEventListener(type: "controllerchange", listener: () => void): void {
    if (type === "controllerchange") this.controllerListeners.add(listener);
  }

  removeEventListener(type: "controllerchange", listener: () => void): void {
    if (type === "controllerchange") this.controllerListeners.delete(listener);
  }

  claim(): void {
    this.controller = {};
    this.resolveReady({ active: {} });
    for (const listener of [...this.controllerListeners]) listener();
  }

  listenerCount(): number {
    return this.controllerListeners.size;
  }
}

afterEach(() => {
  vi.useRealTimers();
  clearServiceWorkerRegistrationForTests();
});

describe("cold-page service-worker data handoff", () => {
  it("shares one cache-bypassing registration between the layout and data loader", async () => {
    const serviceWorker = new FakeServiceWorkerContainer();
    const [first, second] = await Promise.all([
      registerWcdraftServiceWorker({ nodeEnv: "production", serviceWorker }),
      registerWcdraftServiceWorker({ nodeEnv: "production", serviceWorker }),
    ]);

    expect(first).toBe(second);
    expect(serviceWorker.register).toHaveBeenCalledOnce();
    expect(serviceWorker.register).toHaveBeenCalledWith("/sw.js", {
      updateViaCache: "none",
    });
  });

  it("does not start the uncontrolled page's pool fetch before activation claims it", async () => {
    const serviceWorker = new FakeServiceWorkerContainer();
    const register = vi.fn(async () => ({ installing: {} }));
    const pool = { schema_version: "test-pool" } as unknown as DraftPoolBundle;
    const loadDraftPool = vi.fn(async () => pool);

    const pending = loadDraftPoolAfterServiceWorkerHandoff({
      manifest: TEST_MANIFEST,
      waitForHandoff: () =>
        waitForRuntimeDataServiceWorkerHandoff({
          nodeEnv: "production",
          serviceWorker,
          register,
          timeoutMs: 1_000,
        }),
      loadDraftPool,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(register).toHaveBeenCalledOnce();
    expect(loadDraftPool).not.toHaveBeenCalled();
    expect(serviceWorker.listenerCount()).toBe(1);

    serviceWorker.claim();
    await expect(pending).resolves.toBe(pool);
    expect(loadDraftPool).toHaveBeenCalledOnce();
    expect(serviceWorker.listenerCount()).toBe(0);
  });

  it("waits for a pending update to replace an existing controller before pool demand", async () => {
    const serviceWorker = new FakeServiceWorkerContainer();
    serviceWorker.controller = { version: "old" };
    const pool = { schema_version: "updated-pool" } as unknown as DraftPoolBundle;
    const loadDraftPool = vi.fn(async () => pool);

    const pending = loadDraftPoolAfterServiceWorkerHandoff({
      manifest: TEST_MANIFEST,
      waitForHandoff: () =>
        waitForRuntimeDataServiceWorkerHandoff({
          nodeEnv: "production",
          serviceWorker,
          register: async () => ({ active: {}, installing: {} }),
          timeoutMs: 1_000,
        }),
      loadDraftPool,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(loadDraftPool).not.toHaveBeenCalled();

    serviceWorker.claim();
    await expect(pending).resolves.toBe(pool);
    expect(loadDraftPool).toHaveBeenCalledOnce();
  });

  it("does not delay an already-controlled page when registration finds no update", async () => {
    const serviceWorker = new FakeServiceWorkerContainer();
    serviceWorker.controller = { version: "current" };

    await expect(
      waitForRuntimeDataServiceWorkerHandoff({
        nodeEnv: "production",
        serviceWorker,
        register: async () => ({ active: {}, installing: null, waiting: null }),
        timeoutMs: 1_000,
      }),
    ).resolves.toBe("controlled");
    expect(serviceWorker.listenerCount()).toBe(0);
  });

  it("falls through immediately when registration rejects", async () => {
    const serviceWorker = new FakeServiceWorkerContainer();
    const pool = { schema_version: "registration-fallback" } as unknown as DraftPoolBundle;
    const loadDraftPool = vi.fn(async () => pool);

    await expect(
      loadDraftPoolAfterServiceWorkerHandoff({
        manifest: TEST_MANIFEST,
        waitForHandoff: () =>
          waitForRuntimeDataServiceWorkerHandoff({
            nodeEnv: "production",
            serviceWorker,
            register: () => Promise.reject(new Error("registration unavailable")),
            timeoutMs: 1_000,
          }),
        loadDraftPool,
      }),
    ).resolves.toBe(pool);
    expect(loadDraftPool).toHaveBeenCalledOnce();
    expect(serviceWorker.listenerCount()).toBe(0);
  });

  it("bounds a stalled install without starting duplicate direct pool work", async () => {
    vi.useFakeTimers();
    const serviceWorker = new FakeServiceWorkerContainer();
    const pool = { schema_version: "timeout-fallback" } as unknown as DraftPoolBundle;
    const loadDraftPool = vi.fn(async () => pool);

    const pending = loadDraftPoolAfterServiceWorkerHandoff({
      manifest: TEST_MANIFEST,
      waitForHandoff: () =>
        waitForRuntimeDataServiceWorkerHandoff({
          nodeEnv: "production",
          serviceWorker,
          register: async () => ({ installing: {} }),
          timeoutMs: 25,
        }),
      loadDraftPool,
    });
    const rejected = expect(pending).rejects.toThrow(/promotion timed out/u);
    await Promise.resolve();
    expect(loadDraftPool).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    expect(loadDraftPool).not.toHaveBeenCalled();
    expect(serviceWorker.listenerCount()).toBe(0);
  });

  it("starts manifest, pool, and Daily map only after one controller revision is selected", async () => {
    const serviceWorker = new FakeServiceWorkerContainer();
    serviceWorker.controller = { version: "old" };
    const manifest = {
      bundles: { daily_seed_salt_map: {} },
    } as unknown as RuntimeDataManifest;
    const pool = { schema_version: "new-pool" } as unknown as DraftPoolBundle;
    const daily = { schema_version: "new-daily" } as unknown as DailySeedSaltMap;
    const loadManifest = vi.fn(async () => manifest);
    const loadDraftPool = vi.fn(async () => pool);
    const loadDailyMap = vi.fn(async () => daily);

    const pending = loadRuntimeDataAfterServiceWorkerHandoff({
      waitForHandoff: () =>
        waitForRuntimeDataServiceWorkerHandoff({
          nodeEnv: "production",
          serviceWorker,
          register: async () => ({ active: {}, installing: {} }),
          timeoutMs: 1_000,
        }),
      loadManifest,
      loadDraftPool,
      loadDailyMap,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(loadManifest).not.toHaveBeenCalled();
    expect(loadDraftPool).not.toHaveBeenCalled();
    expect(loadDailyMap).not.toHaveBeenCalled();

    serviceWorker.claim();
    await expect(pending).resolves.toEqual({
      manifest,
      draftPool: pool,
      dailySeedSaltMap: daily,
    });
    expect(loadManifest).toHaveBeenCalledOnce();
    expect(loadDraftPool).toHaveBeenCalledOnce();
    expect(loadDailyMap).toHaveBeenCalledOnce();
  });

  it("bypasses coordination outside production and never leaves the pool loader waiting", async () => {
    const serviceWorker = new FakeServiceWorkerContainer();
    await expect(
      waitForRuntimeDataServiceWorkerHandoff({ nodeEnv: "test", serviceWorker }),
    ).resolves.toBe("bypassed");
  });
});
