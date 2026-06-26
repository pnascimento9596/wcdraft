// Regression — the runtime data client must NOT detach the global `fetch`
// from its receiver. Storing `fetch` on a plain object and invoking it as
// `obj.fetchImpl(url)` makes Chrome throw
//
//   TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation
//
// (Webpack prod + Turbopack dev both reproduce.) The fix in
// `packages/data/src/client.ts` binds the global to `globalThis`.
//
// This test installs a strict global fetch that throws when invoked with a
// receiver other than `globalThis` (mirroring Chrome's check) and asserts the
// real loaders complete without illegal-invocation errors.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_RUNTIME_DATA_BASE_PATH,
  DRAFT_POOL_BROTLI_PATH,
  loadDataManifest,
  loadDraftPoolBundle,
  loadRuntimeData,
  loadScenario2026Bundle,
} from "../src/client.js";
import { DRAFT_POOL_BUNDLE, RUNTIME_DATA_MANIFEST, SCENARIO_2026_BUNDLE } from "../src/index.js";

// ─── Strict global-fetch harness ─────────────────────────────────────────────

const ORIGINAL_FETCH = (globalThis as { fetch?: typeof fetch }).fetch;

interface FetchCall {
  url: string;
  receiver: unknown;
}

let calls: FetchCall[] = [];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Install a global `fetch` that:
 *   (a) throws `TypeError("Illegal invocation")` when its receiver is not
 *       `globalThis` (this is the Chrome behaviour the bug hits),
 *   (b) records every receiver for assertions, and
 *   (c) routes the known manifest / bundle URLs to the in-memory committed
 *       fixtures so we exercise the real code path end-to-end.
 */
function installStrictFetch(): void {
  function strictFetch(this: unknown, ...args: unknown[]): Promise<Response> {
    if (this !== globalThis) {
      // Match Chrome's exact error class + phrasing.
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    const url = String(args[0]);
    calls.push({ url, receiver: this });
    if (url.endsWith("/manifest.json")) {
      return Promise.resolve(jsonResponse(RUNTIME_DATA_MANIFEST));
    }
    if (url.endsWith(`/${DRAFT_POOL_BROTLI_PATH}`)) {
      return Promise.resolve(jsonResponse(DRAFT_POOL_BUNDLE));
    }
    if (url.endsWith("/scenario-2026.compact.json")) {
      return Promise.resolve(jsonResponse(SCENARIO_2026_BUNDLE));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  }
  Object.defineProperty(globalThis, "fetch", {
    value: strictFetch,
    configurable: true,
    writable: true,
  });
}

function restoreFetch(): void {
  if (ORIGINAL_FETCH === undefined) {
    delete (globalThis as { fetch?: typeof fetch }).fetch;
  } else {
    Object.defineProperty(globalThis, "fetch", {
      value: ORIGINAL_FETCH,
      configurable: true,
      writable: true,
    });
  }
}

beforeEach(() => {
  calls = [];
  installStrictFetch();
});

afterEach(() => {
  restoreFetch();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("client.ts — global fetch binding regression", () => {
  it("the strict-fetch harness rejects detached invocations (sanity check)", () => {
    const detached = (globalThis as { fetch: typeof fetch }).fetch;
    const carrier: { call?: typeof fetch } = { call: detached };
    // Plain-object call site reproduces Chrome's TypeError when `this !==
    // globalThis`. If this assertion ever fires "passed when it shouldn't",
    // the harness is broken — not the client.
    expect(() => carrier.call!("/manifest.json")).toThrow(/Illegal invocation/u);
  });

  it("loadDataManifest invokes the global fetch with globalThis as receiver", async () => {
    const manifest = await loadDataManifest();
    expect(manifest.schema_version).toBe(RUNTIME_DATA_MANIFEST.schema_version);
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe(`${DEFAULT_RUNTIME_DATA_BASE_PATH}/manifest.json`);
    expect(calls[0]!.receiver).toBe(globalThis);
  });

  it("loadDraftPoolBundle invokes the global fetch with globalThis as receiver", async () => {
    const pool = await loadDraftPoolBundle();
    expect(pool.schema_version).toBe(DRAFT_POOL_BUNDLE.schema_version);
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe(`${DEFAULT_RUNTIME_DATA_BASE_PATH}/${DRAFT_POOL_BROTLI_PATH}`);
    expect(calls[0]!.receiver).toBe(globalThis);
  });

  it("loadScenario2026Bundle invokes the global fetch with globalThis as receiver", async () => {
    const scenario = await loadScenario2026Bundle();
    expect(scenario.schema_version).toBe(SCENARIO_2026_BUNDLE.schema_version);
    expect(calls.length).toBe(1);
    expect(calls[0]!.receiver).toBe(globalThis);
  });

  it("loadRuntimeData makes all three calls with globalThis as receiver", async () => {
    const { manifest, draftPool, scenario2026 } = await loadRuntimeData();
    expect(manifest.schema_version).toBe(RUNTIME_DATA_MANIFEST.schema_version);
    expect(draftPool.schema_version).toBe(DRAFT_POOL_BUNDLE.schema_version);
    expect(scenario2026.schema_version).toBe(SCENARIO_2026_BUNDLE.schema_version);
    expect(calls.length).toBe(3);
    for (const c of calls) {
      expect(c.receiver).toBe(globalThis);
    }
  });

  it("an explicit opts.fetch is invoked verbatim (caller controls its receiver)", async () => {
    const explicit: FetchCall[] = [];
    const explicitFetch: typeof fetch = ((url: unknown) => {
      explicit.push({ url: String(url), receiver: undefined });
      return Promise.resolve(jsonResponse(RUNTIME_DATA_MANIFEST));
    }) as typeof fetch;
    const manifest = await loadDataManifest({ fetch: explicitFetch });
    expect(manifest.schema_version).toBe(RUNTIME_DATA_MANIFEST.schema_version);
    expect(explicit.length).toBe(1);
    // No call should have escaped to the strict global fetch.
    expect(calls.length).toBe(0);
  });

  it("rejects a malformed fetched draft-pool bundle instead of blind-casting it", async () => {
    const malformedFetch: typeof fetch = (() =>
      Promise.resolve(
        jsonResponse({ schema_version: RUNTIME_DATA_MANIFEST.schema_version }),
      )) as typeof fetch;

    await expect(loadDraftPoolBundle({ fetch: malformedFetch })).rejects.toThrow(
      /malformed draft pool bundle at player_cards/u,
    );
  });
});
