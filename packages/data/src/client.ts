// Browser-side loaders. Fetches the compact bundles from a runtime path
// (defaults to `/data/wcdraft/`, where the apps/web copy step lands them)
// and validates loaded payloads have the expected runtime bundle shape.

import {
  RUNTIME_DATA_SCHEMA_VERSION,
  type DailySeedSaltMap,
  type DraftPoolBundle,
  type RuntimeDataManifest,
  type Scenario2026Bundle,
  type ScoreDistribution,
} from "./types.js";
import {
  parseDailySeedSaltMap,
  parseDraftPoolBundle,
  parseRuntimeDataManifest,
  parseScenario2026Bundle,
  parseScoreDistribution,
} from "./validation.js";

export * from "./score-distribution.js";
export type { DailySeedSaltMap, ScoreDistribution, ScoreDistributionAnchors } from "./types.js";

/**
 * Default site-relative directory where `scripts/copy-web-assets.mjs` lands the
 * compact bundles for THIS compiled runtime-data schema. Versioning the path is
 * the mid-deploy atomicity contract: old and new manifests/bundles can coexist
 * at the edge instead of racing over `/data/wcdraft/manifest.json`.
 */
export const DEFAULT_RUNTIME_DATA_BASE_PATH =
  `/data/wcdraft/${RUNTIME_DATA_SCHEMA_VERSION}` as const;

/** Draft-pool payload URL inside the versioned runtime data directory. */
export const DRAFT_POOL_BROTLI_PATH = "draft-pool.compact.json.br" as const;

/** Options accepted by all client loaders. */
export interface LoaderOptions {
  /** Override the base path (defaults to `/data/wcdraft`). */
  basePath?: string;
  /** Override `fetch` (tests); falls back to the global `fetch`. */
  fetch?: typeof fetch;
  /** `AbortSignal` propagated into the underlying `fetch`. */
  signal?: AbortSignal;
}

interface ResolvedOptions {
  basePath: string;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
}

function resolveOptions(opts: LoaderOptions | undefined): ResolvedOptions {
  const basePath = (opts?.basePath ?? DEFAULT_RUNTIME_DATA_BASE_PATH).replace(/\/+$/u, "");
  // IMPORTANT: when falling back to the global `fetch`, we must NOT detach it
  // from its receiver (window / globalThis). Storing the bare `fetch`
  // reference on a plain object and invoking it as `obj.fetchImpl(...)` calls
  // it with `this = obj`, which Chrome rejects with
  //   `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`.
  // Binding to `globalThis` makes the call site safe regardless of how the
  // fetch impl is later stored or passed around. When the caller provides
  // `opts.fetch` explicitly, we use it verbatim — they control its receiver.
  const fetchImpl: typeof fetch | undefined =
    opts?.fetch ??
    (typeof globalThis !== "undefined" &&
    typeof (globalThis as { fetch?: typeof fetch }).fetch === "function"
      ? (globalThis as { fetch: typeof fetch }).fetch.bind(globalThis)
      : undefined);
  if (typeof fetchImpl !== "function") {
    throw new Error(
      "@wcdraft/data/client: no `fetch` is available — pass `opts.fetch` explicitly.",
    );
  }
  return { basePath, fetchImpl, signal: opts?.signal };
}

async function fetchJson<T>(
  url: string,
  opts: ResolvedOptions,
  parse: (value: unknown) => T,
): Promise<T> {
  // `opts.fetchImpl` is either an explicitly provided fetch (caller-bound) or
  // the global fetch bound to globalThis in `resolveOptions` — invoking it
  // off `opts` is safe in both cases.
  const res = await opts.fetchImpl(url, { signal: opts.signal });
  if (!res.ok) {
    throw new Error(`@wcdraft/data/client: failed to load ${url} (HTTP ${res.status}).`);
  }
  return parse(await res.json());
}

/** Load the top-level `RuntimeDataManifest`. */
export async function loadDataManifest(opts?: LoaderOptions): Promise<RuntimeDataManifest> {
  const resolved = resolveOptions(opts);
  return fetchJson<RuntimeDataManifest>(
    `${resolved.basePath}/manifest.json`,
    resolved,
    parseRuntimeDataManifest,
  );
}

/** Load the draft-pool compact bundle (1930–2026). */
export async function loadDraftPoolBundle(opts?: LoaderOptions): Promise<DraftPoolBundle> {
  const resolved = resolveOptions(opts);
  return fetchJson<DraftPoolBundle>(
    `${resolved.basePath}/${DRAFT_POOL_BROTLI_PATH}`,
    resolved,
    parseDraftPoolBundle,
  );
}

/** Load the 2026 scenario compact bundle (teams + bracket). */
export async function loadScenario2026Bundle(opts?: LoaderOptions): Promise<Scenario2026Bundle> {
  const resolved = resolveOptions(opts);
  return fetchJson<Scenario2026Bundle>(
    `${resolved.basePath}/scenario-2026.compact.json`,
    resolved,
    parseScenario2026Bundle,
  );
}

/**
 * Load the reference score-distribution artifact. Throws on HTTP failure or
 * malformed payload — callers that render an OPTIONAL standing line must
 * catch and degrade to "standing unknown" (omit), never fabricate. Older
 * deployed data directories legitimately lack this file (HTTP 404).
 */
export async function loadScoreDistribution(opts?: LoaderOptions): Promise<ScoreDistribution> {
  const resolved = resolveOptions(opts);
  return fetchJson<ScoreDistribution>(
    `${resolved.basePath}/score-distribution.compact.json`,
    resolved,
    parseScoreDistribution,
  );
}

/** Load the Daily Draft salt map advertised by the manifest. */
export async function loadDailySeedSaltMap(opts?: LoaderOptions): Promise<DailySeedSaltMap> {
  const resolved = resolveOptions(opts);
  return fetchJson<DailySeedSaltMap>(
    `${resolved.basePath}/daily-seed-salt-map.compact.json`,
    resolved,
    parseDailySeedSaltMap,
  );
}

/**
 * Convenience: load manifest + both bundles in parallel. Resolves the manifest
 * first (so a `schema_version` mismatch fails fast without paying for the
 * larger bundles), then resolves the two bundles in parallel.
 */
export async function loadRuntimeData(opts?: LoaderOptions): Promise<{
  manifest: RuntimeDataManifest;
  draftPool: DraftPoolBundle;
  scenario2026: Scenario2026Bundle;
}> {
  const manifest = await loadDataManifest(opts);
  const [draftPool, scenario2026] = await Promise.all([
    loadDraftPoolBundle(opts),
    loadScenario2026Bundle(opts),
  ]);
  return { manifest, draftPool, scenario2026 };
}
