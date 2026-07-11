import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import type { DraftPoolBundle, RuntimeDataManifest } from "@wcdraft/data";
import { describe, expect, it, vi } from "vitest";

import {
  type ServiceWorkerContainerLike,
  type ServiceWorkerRegistrationLike,
  waitForRuntimeDataServiceWorkerHandoff,
} from "../../service-worker";
import { loadDraftPoolAfterServiceWorkerHandoff } from "../data";

const ORIGIN = "https://www.wcdraft.test";
const SCENARIO_BUNDLE_KEY = ["scenario", "2026"].join("_");
const SW_SOURCE = readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8");
const TEST_MANIFEST = {} as RuntimeDataManifest;

interface PrecacheEntry {
  key: string;
  kind: "manifest" | "bundle";
  url: string;
  encoding: "identity" | "brotli";
  expected_bytes: number;
  expected_sha256: string;
  transport_bytes: number;
  transport_sha256: string;
}

interface WorkerConfig {
  deploy_revision: string;
  data_revision: string;
  schema_version: string;
  dataset_version: string;
  runtime_data_base_path: string;
  required_bundle_keys: string[];
  precache_data_entries: PrecacheEntry[];
  bundle_hashes: Record<
    string,
    {
      raw_sha256: string;
      raw_bytes: number;
      compressed_sha256: string;
      compressed_bytes: number;
    }
  >;
  cache_names: { data: string; shell: string };
}

interface Fixture {
  config: WorkerConfig;
  bodies: Map<string, Uint8Array>;
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function responseBody(value: Uint8Array | string): BodyInit {
  return typeof value === "string" ? value : (Uint8Array.from(value).buffer as ArrayBuffer);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeRequest(input: RequestInfo | URL): string {
  const raw = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  return new URL(raw, ORIGIN).pathname;
}

function fixture({
  deployRevision,
  dataRevision,
  variant,
}: {
  deployRevision: string;
  dataRevision: string;
  variant: string;
}): Fixture {
  const base = "/data/wcdraft/runtime-data-9.9.9";
  const payloads = new Map<string, Uint8Array>([
    [`${base}/manifest.json`, bytes(`{"variant":"${variant}"}\n`)],
    [`${base}/daily-seed-salt-map.compact.json`, bytes(`daily:${variant}`)],
    [`${base}/draft-pool.compact.json.br`, bytes(`brotli-pool:${variant}`)],
    [`${base}/scenario-2026.compact.json`, bytes(`scenario:${variant}`)],
    [`${base}/score-distribution.compact.json`, bytes(`scores:${variant}`)],
  ]);
  const definitions: Array<Pick<PrecacheEntry, "key" | "kind" | "url" | "encoding">> = [
    { key: "manifest", kind: "manifest", url: `${base}/manifest.json`, encoding: "identity" },
    {
      key: "daily_seed_salt_map",
      kind: "bundle",
      url: `${base}/daily-seed-salt-map.compact.json`,
      encoding: "identity",
    },
    {
      key: "draft_pool",
      kind: "bundle",
      url: `${base}/draft-pool.compact.json.br`,
      encoding: "brotli",
    },
    {
      key: SCENARIO_BUNDLE_KEY,
      kind: "bundle",
      url: `${base}/scenario-2026.compact.json`,
      encoding: "identity",
    },
    {
      key: "score_distribution",
      kind: "bundle",
      url: `${base}/score-distribution.compact.json`,
      encoding: "identity",
    },
  ];
  const entries = definitions.map((definition) => {
    const body = payloads.get(definition.url);
    if (!body) throw new Error(`test fixture body missing for ${definition.url}`);
    return {
      ...definition,
      expected_bytes: body.byteLength,
      expected_sha256: sha256(body),
      transport_bytes:
        definition.encoding === "brotli" ? Math.max(1, body.byteLength - 1) : body.byteLength,
      transport_sha256:
        definition.encoding === "brotli" ? sha256(bytes(`wire:${variant}`)) : sha256(body),
    };
  });
  const requiredBundleKeys = definitions
    .filter((entry) => entry.kind === "bundle")
    .map((entry) => entry.key)
    .sort();
  const bundleHashes = Object.fromEntries(
    requiredBundleKeys.map((key) => {
      const entry = entries.find((candidate) => candidate.key === key);
      if (!entry) throw new Error(`test fixture entry missing for ${key}`);
      return [
        key,
        {
          raw_sha256: entry.expected_sha256,
          raw_bytes: entry.expected_bytes,
          compressed_sha256:
            entry.encoding === "brotli" ? entry.transport_sha256 : entry.expected_sha256,
          compressed_bytes:
            entry.encoding === "brotli" ? entry.transport_bytes : entry.expected_bytes,
        },
      ];
    }),
  );
  return {
    config: {
      deploy_revision: deployRevision,
      data_revision: dataRevision,
      schema_version: "runtime-data-9.9.9",
      dataset_version: "2099-01-01",
      runtime_data_base_path: base,
      required_bundle_keys: requiredBundleKeys,
      precache_data_entries: entries,
      bundle_hashes: bundleHashes,
      cache_names: {
        data: `wcdraft-data-b:${dataRevision}`,
        shell: `wcdraft-shell-d:${deployRevision}`,
      },
    },
    bodies: payloads,
  };
}

interface CacheFaults {
  throwPutPath?: string;
  discardPutPath?: string;
  throwDeleteName?: string;
}

class FakeCache {
  readonly entries = new Map<string, Response>();

  constructor(
    private readonly name: string,
    private readonly operations: string[],
    private readonly faults: CacheFaults,
  ) {}

  seed(path: string, body: Uint8Array | string): void {
    this.entries.set(
      normalizeRequest(path),
      new Response(responseBody(body), {
        headers: path.endsWith(".br")
          ? {
              "content-encoding": "br",
              "content-length": String(
                Math.max(1, (typeof body === "string" ? bytes(body) : body).byteLength - 1),
              ),
            }
          : undefined,
      }),
    );
  }

  async match(input: RequestInfo | URL): Promise<Response | undefined> {
    const path = normalizeRequest(input);
    this.operations.push(`match:${this.name}:${path}`);
    return this.entries.get(path)?.clone();
  }

  async put(input: RequestInfo | URL, response: Response): Promise<void> {
    const path = normalizeRequest(input);
    this.operations.push(`put:${this.name}:${path}`);
    if (this.faults.throwPutPath === path) throw new Error(`injected cache.put failure: ${path}`);
    if (this.faults.discardPutPath === path) return;
    this.entries.set(path, response.clone());
  }
}

class FakeCacheStorage {
  readonly stores = new Map<string, FakeCache>();
  readonly operations: string[] = [];
  readonly faults: CacheFaults = {};

  async open(name: string): Promise<FakeCache> {
    this.operations.push(`open:${name}`);
    let cache = this.stores.get(name);
    if (!cache) {
      cache = new FakeCache(name, this.operations, this.faults);
      this.stores.set(name, cache);
    }
    return cache;
  }

  async keys(): Promise<string[]> {
    this.operations.push("keys");
    return [...this.stores.keys()];
  }

  async delete(name: string): Promise<boolean> {
    this.operations.push(`delete:${name}`);
    if (this.faults.throwDeleteName === name) {
      throw new Error(`injected cache.delete failure: ${name}`);
    }
    return this.stores.delete(name);
  }

  seed(name: string, path: string, body: Uint8Array | string): void {
    let cache = this.stores.get(name);
    if (!cache) {
      cache = new FakeCache(name, this.operations, this.faults);
      this.stores.set(name, cache);
    }
    cache.seed(path, body);
  }

  async snapshot(name: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const [path, response] of this.stores.get(name)?.entries ?? []) {
      out[path] = sha256(new Uint8Array(await response.clone().arrayBuffer()));
    }
    return out;
  }
}

interface HeldRoute {
  started: Promise<void>;
  release: () => void;
}

class FakeNetwork {
  readonly counts = new Map<string, number>();
  private readonly bodies = new Map<string, Uint8Array>();
  private readonly statuses = new Map<string, number>();
  private readonly held = new Map<
    string,
    { started: () => void; released: Promise<void>; release: () => void }
  >();

  constructor(payloads: Map<string, Uint8Array>) {
    for (const [path, body] of payloads) this.bodies.set(path, body);
  }

  setStatus(path: string, status: number): void {
    this.statuses.set(path, status);
  }

  setBody(path: string, body: Uint8Array): void {
    this.bodies.set(path, body);
  }

  hold(path: string): HeldRoute {
    let markStarted: () => void = () => undefined;
    let release: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.held.set(path, { started: markStarted, released, release });
    return { started, release };
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = normalizeRequest(input);
    this.counts.set(path, (this.counts.get(path) ?? 0) + 1);
    const held = this.held.get(path);
    if (held) {
      held.started();
      await Promise.race([
        held.released,
        new Promise<never>((_resolve, reject) => {
          const signal = init?.signal;
          const rejectOnAbort = () => reject(signal?.reason ?? new Error("aborted"));
          if (signal?.aborted) rejectOnAbort();
          else signal?.addEventListener("abort", rejectOnAbort, { once: true });
        }),
      ]);
    }
    const status = this.statuses.get(path) ?? 200;
    const body = this.bodies.get(path);
    if (!body) throw new Error(`injected network miss: ${path}`);
    return new Response(responseBody(body), {
      status,
      headers: path.endsWith(".br")
        ? {
            "content-encoding": "br",
            "content-length": String(Math.max(1, body.byteLength - 1)),
          }
        : undefined,
    });
  };
}

class FakeLockManager {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly requestWaiters = new Map<string, () => void>();
  private readonly requested = new Set<string>();

  block(name: string): void {
    this.tails.set(name, new Promise<void>(() => undefined));
  }

  waitForRequest(name: string): Promise<void> {
    if (this.requested.has(name)) return Promise.resolve();
    return new Promise((resolve) => this.requestWaiters.set(name, resolve));
  }

  async request<T>(
    name: string,
    options: { signal: AbortSignal },
    callback: () => T | Promise<T>,
  ): Promise<T> {
    this.requested.add(name);
    this.requestWaiters.get(name)?.();
    this.requestWaiters.delete(name);
    const previous = this.tails.get(name) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => turn);
    this.tails.set(name, tail);
    await Promise.race([
      previous,
      new Promise<never>((_resolve, reject) => {
        const rejectOnAbort = () => reject(options.signal.reason);
        if (options.signal.aborted) rejectOnAbort();
        else options.signal.addEventListener("abort", rejectOnAbort, { once: true });
      }),
    ]);
    try {
      return await callback();
    } finally {
      release();
      if (this.tails.get(name) === tail) this.tails.delete(name);
    }
  }
}

class FakePageServiceWorkerContainer implements ServiceWorkerContainerLike {
  controller: unknown | null = null;
  readonly ready: Promise<ServiceWorkerRegistrationLike>;
  private resolveReady: (registration: ServiceWorkerRegistrationLike) => void = () => undefined;
  private readonly listeners = new Set<() => void>();

  constructor() {
    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  register(): Promise<ServiceWorkerRegistrationLike> {
    return Promise.resolve({ installing: {} });
  }

  addEventListener(_type: "controllerchange", listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "controllerchange", listener: () => void): void {
    this.listeners.delete(listener);
  }

  claim(): void {
    this.controller = {};
    this.resolveReady({ active: {} });
    for (const listener of [...this.listeners]) listener();
  }
}

type EventListener = (event: Record<string, unknown>) => void;

interface Harness {
  storage: FakeCacheStorage;
  network: FakeNetwork;
  install: () => Promise<void>;
  activate: () => Promise<void>;
  request: (path: string) => Promise<Response>;
  counters: { skipWaiting: number; claim: number };
}

interface SharedHarnessState {
  storage: FakeCacheStorage;
  network: FakeNetwork;
  locks: FakeLockManager;
}

function createHarness(
  config: unknown,
  payloads: Map<string, Uint8Array>,
  shared?: SharedHarnessState,
): Harness {
  const listeners = new Map<string, EventListener>();
  const storage = shared?.storage ?? new FakeCacheStorage();
  const network = shared?.network ?? new FakeNetwork(payloads);
  const locks = shared?.locks ?? new FakeLockManager();
  const counters = { skipWaiting: 0, claim: 0 };
  const selfObject = {
    location: { origin: ORIGIN },
    crypto: webcrypto,
    navigator: { locks },
    __WCDRAFT_SW_CONFIG__: undefined as unknown,
    addEventListener(type: string, listener: EventListener) {
      listeners.set(type, listener);
    },
    async skipWaiting() {
      counters.skipWaiting += 1;
    },
    clients: {
      async claim() {
        counters.claim += 1;
      },
    },
  };
  const importedConfig = JSON.parse(JSON.stringify(config));

  runInNewContext(
    SW_SOURCE,
    {
      self: selfObject,
      caches: storage,
      fetch: network.fetch,
      importScripts(path: string) {
        if (path !== "/sw-version.js") throw new Error(`unexpected importScripts path ${path}`);
        selfObject.__WCDRAFT_SW_CONFIG__ = importedConfig;
      },
      Response,
      Request,
      URL,
      AggregateError,
      AbortController,
      Error,
      JSON,
      Map,
      Set,
      Uint8Array,
      clearTimeout,
      console,
      setTimeout,
    },
    { filename: "apps/web/public/sw.js" },
  );

  function dispatchLifetime(type: "install" | "activate"): Promise<void> {
    const listener = listeners.get(type);
    if (!listener) throw new Error(`worker did not register ${type}`);
    let pending: Promise<void> | undefined;
    listener({
      waitUntil(value: Promise<void>) {
        pending = Promise.resolve(value);
      },
    });
    if (!pending) throw new Error(`${type} did not call waitUntil`);
    return pending;
  }

  function request(path: string): Promise<Response> {
    const listener = listeners.get("fetch");
    if (!listener) throw new Error("worker did not register fetch");
    let pending: Promise<Response> | undefined;
    listener({
      request: new Request(`${ORIGIN}${path}`),
      respondWith(value: Promise<Response>) {
        pending = Promise.resolve(value);
      },
    });
    if (!pending) throw new Error(`worker did not handle ${path}`);
    return pending;
  }

  return {
    storage,
    network,
    install: () => dispatchLifetime("install"),
    activate: () => dispatchLifetime("activate"),
    request,
    counters,
  };
}

function seedComplete(storage: FakeCacheStorage, data: Fixture, cacheName: string): void {
  for (const entry of data.config.precache_data_entries) {
    const body = data.bodies.get(entry.url);
    if (!body) throw new Error(`seed body missing for ${entry.url}`);
    storage.seed(cacheName, entry.url, body);
  }
}

describe("executed service-worker lifecycle", () => {
  it("retains the old complete worker caches when one new required fetch fails", async () => {
    const oldData = fixture({
      deployRevision: "1".repeat(16),
      dataRevision: "2".repeat(16),
      variant: "old",
    });
    const nextData = fixture({
      deployRevision: "3".repeat(16),
      dataRevision: "4".repeat(16),
      variant: "next",
    });
    const harness = createHarness(nextData.config, nextData.bodies);
    seedComplete(harness.storage, oldData, oldData.config.cache_names.data);
    harness.storage.seed(oldData.config.cache_names.shell, "/", "old shell");
    const failedPath = nextData.config.precache_data_entries.find(
      (entry) => entry.key === SCENARIO_BUNDLE_KEY,
    )?.url;
    if (!failedPath) throw new Error("scenario fixture missing");
    harness.network.setStatus(failedPath, 503);

    await expect(harness.install()).rejects.toThrow(/required data precache failed/u);

    expect(harness.counters.skipWaiting).toBe(0);
    expect(harness.storage.stores.has(oldData.config.cache_names.data)).toBe(true);
    expect(harness.storage.stores.has(oldData.config.cache_names.shell)).toBe(true);
    expect(harness.storage.stores.has(nextData.config.cache_names.data)).toBe(false);
  });

  it("promotes a healthy data change, verifies before deletion, then cleans and claims", async () => {
    const oldData = fixture({
      deployRevision: "1".repeat(16),
      dataRevision: "2".repeat(16),
      variant: "old",
    });
    const nextData = fixture({
      deployRevision: "3".repeat(16),
      dataRevision: "4".repeat(16),
      variant: "next",
    });
    const harness = createHarness(nextData.config, nextData.bodies);
    seedComplete(harness.storage, oldData, oldData.config.cache_names.data);
    harness.storage.seed(oldData.config.cache_names.shell, "/", "old shell");
    harness.storage.seed("other-app-cache", "/keep", "unrelated");

    await harness.install();
    expect(harness.counters.skipWaiting).toBe(1);
    harness.storage.operations.length = 0;
    await harness.activate();

    const firstDelete = harness.storage.operations.findIndex((operation) =>
      operation.startsWith("delete:"),
    );
    const proofMatchesBeforeDelete = harness.storage.operations
      .slice(0, firstDelete)
      .filter((operation) => operation.startsWith(`match:${nextData.config.cache_names.data}:`));
    expect(firstDelete).toBeGreaterThan(-1);
    expect(proofMatchesBeforeDelete).toHaveLength(nextData.config.precache_data_entries.length);
    expect(harness.storage.stores.has(nextData.config.cache_names.data)).toBe(true);
    expect(harness.storage.stores.has(oldData.config.cache_names.data)).toBe(false);
    expect(harness.storage.stores.has(oldData.config.cache_names.shell)).toBe(false);
    expect(harness.storage.stores.has("other-app-cache")).toBe(true);
    expect(harness.counters.claim).toBe(1);
  });

  it("leaves the data cache byte-for-byte untouched for a UI-only deploy", async () => {
    const data = fixture({
      deployRevision: "3".repeat(16),
      dataRevision: "4".repeat(16),
      variant: "same-data",
    });
    const harness = createHarness(data.config, data.bodies);
    seedComplete(harness.storage, data, data.config.cache_names.data);
    harness.storage.seed(`wcdraft-shell-d:${"1".repeat(16)}`, "/", "old shell");
    const before = await harness.storage.snapshot(data.config.cache_names.data);
    harness.storage.operations.length = 0;

    await harness.install();
    await harness.activate();

    expect([...harness.network.counts.values()].reduce((sum, count) => sum + count, 0)).toBe(0);
    expect(
      harness.storage.operations.some((operation) =>
        operation.startsWith(`put:${data.config.cache_names.data}:`),
      ),
    ).toBe(false);
    expect(harness.storage.operations.includes(`delete:${data.config.cache_names.data}`)).toBe(
      false,
    );
    expect(await harness.storage.snapshot(data.config.cache_names.data)).toEqual(before);
  });

  it.each([
    ["non-OK response", "http"],
    ["cache.put rejection", "throw-put"],
    ["missing entry after cache.put", "discard-put"],
  ])("fails installation on %s and removes the partial candidate", async (_label, fault) => {
    const data = fixture({
      deployRevision: "3".repeat(16),
      dataRevision: "4".repeat(16),
      variant: fault,
    });
    const harness = createHarness(data.config, data.bodies);
    const target = data.config.precache_data_entries.find(
      (entry) => entry.key === "draft_pool",
    )?.url;
    if (!target) throw new Error("pool fixture missing");
    if (fault === "http") harness.network.setStatus(target, 500);
    if (fault === "throw-put") harness.storage.faults.throwPutPath = target;
    if (fault === "discard-put") harness.storage.faults.discardPutPath = target;

    await expect(harness.install()).rejects.toThrow(/required data precache failed/u);
    expect(harness.counters.skipWaiting).toBe(0);
    expect(harness.storage.stores.has(data.config.cache_names.data)).toBe(false);
  });

  it.each(["draft_pool", SCENARIO_BUNDLE_KEY])(
    "rejects same-length %s corruption and never returns the unverified response",
    async (key) => {
      const data = fixture({
        deployRevision: "3".repeat(16),
        dataRevision: "4".repeat(16),
        variant: `corrupt-${key}`,
      });
      const harness = createHarness(data.config, data.bodies);
      const entry = data.config.precache_data_entries.find((candidate) => candidate.key === key);
      if (!entry) throw new Error(`fixture entry missing for ${key}`);
      const original = data.bodies.get(entry.url);
      if (!original) throw new Error(`fixture body missing for ${entry.url}`);
      const corrupted = Uint8Array.from(original);
      corrupted[0] = (corrupted[0] ?? 0) ^ 1;
      harness.network.setBody(entry.url, corrupted);

      await expect(harness.install()).rejects.toThrow(/required data precache failed/u);
      expect(harness.counters.skipWaiting).toBe(0);
      expect(harness.storage.stores.has(data.config.cache_names.data)).toBe(false);

      const response = await harness.request(entry.url);
      expect(response.status).toBe(504);
      await expect(response.json()).resolves.toMatchObject({ error: "offline-and-uncached" });
    },
  );

  it("returns a verified required response when only CacheStorage persistence fails", async () => {
    const data = fixture({
      deployRevision: "3".repeat(16),
      dataRevision: "4".repeat(16),
      variant: "verified-storage-failure",
    });
    const harness = createHarness(data.config, data.bodies);
    const entry = data.config.precache_data_entries.find(
      (candidate) => candidate.key === SCENARIO_BUNDLE_KEY,
    );
    if (!entry) throw new Error("scenario fixture missing");
    harness.storage.faults.throwPutPath = entry.url;

    const response = await harness.request(entry.url);
    expect(response.status).toBe(200);
    const body = new Uint8Array(await response.arrayBuffer());
    expect(sha256(body)).toBe(entry.expected_sha256);
  });

  it("bounds a never-settling required fetch and leaves no promotable partial cache", async () => {
    vi.useFakeTimers();
    const data = fixture({
      deployRevision: "3".repeat(16),
      dataRevision: "4".repeat(16),
      variant: "fetch-timeout",
    });
    const harness = createHarness(data.config, data.bodies);
    const poolPath = data.config.precache_data_entries.find(
      (entry) => entry.key === "draft_pool",
    )?.url;
    if (!poolPath) throw new Error("pool fixture missing");
    const held = harness.network.hold(poolPath);
    const install = harness.install();
    const rejected = expect(install).rejects.toThrow(/required data precache failed/u);
    await held.started;

    await vi.advanceTimersByTimeAsync(25_000);
    await rejected;
    expect(harness.counters.skipWaiting).toBe(0);
    expect(harness.storage.stores.has(data.config.cache_names.data)).toBe(false);
    vi.useRealTimers();
  });

  it("bounds a never-acquired origin lock before any duplicate pool fetch", async () => {
    vi.useFakeTimers();
    const data = fixture({
      deployRevision: "3".repeat(16),
      dataRevision: "4".repeat(16),
      variant: "lock-timeout",
    });
    const locks = new FakeLockManager();
    const lockName = `wcdraft-required-fill:${data.config.cache_names.data}:draft_pool`;
    locks.block(lockName);
    const shared = {
      storage: new FakeCacheStorage(),
      network: new FakeNetwork(data.bodies),
      locks,
    };
    const harness = createHarness(data.config, data.bodies, shared);
    const poolPath = data.config.precache_data_entries.find(
      (entry) => entry.key === "draft_pool",
    )?.url;
    if (!poolPath) throw new Error("pool fixture missing");
    const install = harness.install();
    const rejected = expect(install).rejects.toThrow(/required data precache failed/u);
    await locks.waitForRequest(lockName);
    await vi.advanceTimersByTimeAsync(25_000);

    await rejected;
    expect(harness.network.counts.get(poolPath) ?? 0).toBe(0);
    expect(harness.counters.skipWaiting).toBe(0);
    vi.useRealTimers();
  });

  it("rejects malformed generated config before registering lifecycle handlers", () => {
    const data = fixture({
      deployRevision: "3".repeat(16),
      dataRevision: "4".repeat(16),
      variant: "malformed",
    });
    const malformed = {
      ...data.config,
      required_bundle_keys: data.config.required_bundle_keys.filter(
        (key) => key !== "score_distribution",
      ),
    };
    expect(() => createHarness(malformed, data.bodies)).toThrow(/score_distribution missing/u);
  });

  it("activation with an incomplete candidate deletes nothing and never claims", async () => {
    const data = fixture({
      deployRevision: "3".repeat(16),
      dataRevision: "4".repeat(16),
      variant: "incomplete",
    });
    const harness = createHarness(data.config, data.bodies);
    for (const entry of data.config.precache_data_entries.slice(0, -1)) {
      const body = data.bodies.get(entry.url);
      if (!body) throw new Error(`fixture body missing for ${entry.url}`);
      harness.storage.seed(data.config.cache_names.data, entry.url, body);
    }
    harness.storage.seed(`wcdraft-data-b:${"2".repeat(16)}`, "/old", "old data");
    harness.storage.seed(`wcdraft-shell-d:${"1".repeat(16)}`, "/", "old shell");
    harness.storage.operations.length = 0;

    await expect(harness.activate()).rejects.toThrow(/missing/u);

    expect(harness.storage.operations.some((operation) => operation.startsWith("delete:"))).toBe(
      false,
    );
    expect(harness.counters.claim).toBe(0);
    expect(harness.storage.stores.has(`wcdraft-data-b:${"2".repeat(16)}`)).toBe(true);
  });

  it("never claims clients when old-cache cleanup rejects", async () => {
    const oldData = fixture({
      deployRevision: "1".repeat(16),
      dataRevision: "2".repeat(16),
      variant: "old-delete-failure",
    });
    const nextData = fixture({
      deployRevision: "3".repeat(16),
      dataRevision: "4".repeat(16),
      variant: "next-delete-failure",
    });
    const harness = createHarness(nextData.config, nextData.bodies);
    seedComplete(harness.storage, oldData, oldData.config.cache_names.data);
    harness.storage.faults.throwDeleteName = oldData.config.cache_names.data;

    await harness.install();
    await expect(harness.activate()).rejects.toThrow(/cache\.delete failure/u);
    expect(harness.counters.claim).toBe(0);
    expect(harness.storage.stores.has(nextData.config.cache_names.data)).toBe(true);
  });

  it("deduplicates pool fetch across separate active/installing worker globals", async () => {
    const activeData = fixture({
      deployRevision: "1".repeat(16),
      dataRevision: "4".repeat(16),
      variant: "concurrent",
    });
    const installingData = fixture({
      deployRevision: "3".repeat(16),
      dataRevision: "4".repeat(16),
      variant: "concurrent",
    });
    const shared = {
      storage: new FakeCacheStorage(),
      network: new FakeNetwork(installingData.bodies),
      locks: new FakeLockManager(),
    };
    const activeWorker = createHarness(activeData.config, activeData.bodies, shared);
    const installingWorker = createHarness(installingData.config, installingData.bodies, shared);
    const poolPath = installingData.config.precache_data_entries.find(
      (entry) => entry.key === "draft_pool",
    )?.url;
    if (!poolPath) throw new Error("pool fixture missing");
    const held = shared.network.hold(poolPath);

    const install = installingWorker.install();
    await held.started;
    const controlledPageRequest = activeWorker.request(poolPath);
    held.release();
    const [response] = await Promise.all([controlledPageRequest, install.then(() => undefined)]);

    expect(response.status).toBe(200);
    expect(shared.network.counts.get(poolPath)).toBe(1);
    expect(installingWorker.counters.skipWaiting).toBe(1);
  });

  it("hands an uncontrolled cold page to the promoted worker before its pool demand", async () => {
    const data = fixture({
      deployRevision: "3".repeat(16),
      dataRevision: "4".repeat(16),
      variant: "cold-page",
    });
    const harness = createHarness(data.config, data.bodies);
    const pageServiceWorker = new FakePageServiceWorkerContainer();
    const poolPath = data.config.precache_data_entries.find(
      (entry) => entry.key === "draft_pool",
    )?.url;
    if (!poolPath) throw new Error("pool fixture missing");
    const held = harness.network.hold(poolPath);
    const install = harness.install();
    await held.started;

    const pagePoolLoader = vi.fn(async () => {
      return (await harness.request(poolPath)) as unknown as DraftPoolBundle;
    });
    const pageLoad = loadDraftPoolAfterServiceWorkerHandoff({
      manifest: TEST_MANIFEST,
      waitForHandoff: () =>
        waitForRuntimeDataServiceWorkerHandoff({
          nodeEnv: "production",
          serviceWorker: pageServiceWorker,
          register: async () => ({ installing: {} }),
          timeoutMs: 1_000,
        }),
      loadDraftPool: pagePoolLoader,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(pagePoolLoader).not.toHaveBeenCalled();
    expect(harness.network.counts.get(poolPath)).toBe(1);

    held.release();
    await install;
    await harness.activate();
    pageServiceWorker.claim();
    const response = (await pageLoad) as unknown as Response;

    expect(response.status).toBe(200);
    expect(pagePoolLoader).toHaveBeenCalledOnce();
    expect(harness.network.counts.get(poolPath)).toBe(1);
  });
});
