// Browser-side loaders. Fetches the compact bundles from a runtime path
// (defaults to `/data/wcdraft/`, where the apps/web copy step lands them)
// and validates the loaded manifest's `schema_version` matches the version
// this package was compiled against.
//
// IMPORTANT: this module performs NO Zod validation of the bundle bodies —
// the compact JSON is treated as trusted because it ships from the same
// site origin and is hash-pinned by the manifest. Consumers that need a
// strict boundary should call `validateBundleHashes(manifest, ...)` after
// loading.

import {
  RUNTIME_DATA_SCHEMA_VERSION,
  type DraftPoolBundle,
  type RuntimeDataManifest,
  type Scenario2026Bundle,
} from "./types.js";

/**
 * Default site-relative directory where `scripts/copy-web-assets.mjs` lands
 * the compact bundles.
 */
export const DEFAULT_RUNTIME_DATA_BASE_PATH = "/data/wcdraft" as const;

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
  const fetchImpl = opts?.fetch ?? (typeof fetch === "function" ? fetch : undefined);
  if (typeof fetchImpl !== "function") {
    throw new Error(
      "@wcdraft/data/client: no `fetch` is available — pass `opts.fetch` explicitly.",
    );
  }
  return { basePath, fetchImpl, signal: opts?.signal };
}

async function fetchJson<T>(url: string, opts: ResolvedOptions): Promise<T> {
  const res = await opts.fetchImpl(url, { signal: opts.signal });
  if (!res.ok) {
    throw new Error(`@wcdraft/data/client: failed to load ${url} (HTTP ${res.status}).`);
  }
  return (await res.json()) as T;
}

/** Load the top-level `RuntimeDataManifest`. */
export async function loadDataManifest(opts?: LoaderOptions): Promise<RuntimeDataManifest> {
  const resolved = resolveOptions(opts);
  const manifest = await fetchJson<RuntimeDataManifest>(
    `${resolved.basePath}/manifest.json`,
    resolved,
  );
  if (manifest.schema_version !== RUNTIME_DATA_SCHEMA_VERSION) {
    throw new Error(
      `@wcdraft/data/client: manifest schema_version mismatch — got "${manifest.schema_version}", expected "${RUNTIME_DATA_SCHEMA_VERSION}". Clear the runtime cache and reload.`,
    );
  }
  return manifest;
}

/** Load the draft-pool compact bundle (1930–2026). */
export async function loadDraftPoolBundle(opts?: LoaderOptions): Promise<DraftPoolBundle> {
  const resolved = resolveOptions(opts);
  return fetchJson<DraftPoolBundle>(`${resolved.basePath}/draft-pool.compact.json`, resolved);
}

/** Load the 2026 scenario compact bundle (teams + bracket). */
export async function loadScenario2026Bundle(opts?: LoaderOptions): Promise<Scenario2026Bundle> {
  const resolved = resolveOptions(opts);
  return fetchJson<Scenario2026Bundle>(`${resolved.basePath}/scenario-2026.compact.json`, resolved);
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
