// Browser-side loaders. Fetches the compact bundles from a schema-versioned
// runtime path (where the apps/web copy step lands them)
// and validates loaded payloads have the expected runtime bundle shape.

import {
  DAILY_SEED_MAX_SALT_ATTEMPTS,
  RUNTIME_DATA_SCHEMA_VERSION,
  type DailySeedSaltMap,
  type DraftPoolBundle,
  type RuntimeBundleFingerprint,
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
import { boundedRequest, REQUEST_BUDGET_MS } from "./bounded-request.js";

export * from "./score-distribution.js";
export * from "./bounded-request.js";
export { DAILY_SEED_MAX_SALT_ATTEMPTS };
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
  /** Override the base path (defaults to the compiled schema-versioned path). */
  basePath?: string;
  /** Override `fetch` (tests); falls back to the global `fetch`. */
  fetch?: typeof fetch;
  /** `AbortSignal` propagated into the underlying `fetch`. */
  signal?: AbortSignal;
  /** Elapsed fetch + parse budget; defaults to the 30s runtime-data budget. */
  timeoutMs?: number;
}

/** Options for a bundle whose decoded bytes must be bound to its manifest entry. */
export interface VerifiedBundleLoaderOptions extends LoaderOptions {
  manifest: RuntimeDataManifest;
}

export type RuntimeDataIntegrityFailure =
  | "missing_fingerprint"
  | "byte_length_mismatch"
  | "digest_mismatch"
  | "malformed_payload";

export class RuntimeDataIntegrityError extends Error {
  readonly failure: RuntimeDataIntegrityFailure;
  readonly bundleKey: string;

  constructor(failure: RuntimeDataIntegrityFailure, bundleKey: string, detail: string) {
    super(`@wcdraft/data/client: ${bundleKey} integrity failure (${failure}): ${detail}`);
    this.name = "RuntimeDataIntegrityError";
    this.failure = failure;
    this.bundleKey = bundleKey;
  }
}

interface ResolvedOptions {
  basePath: string;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
  timeoutMs: number;
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
  return {
    basePath,
    fetchImpl,
    signal: opts?.signal,
    timeoutMs: opts?.timeoutMs ?? REQUEST_BUDGET_MS.runtimeData,
  };
}

async function fetchJson<T>(
  url: string,
  opts: ResolvedOptions,
  parse: (value: unknown) => T,
  operation: string,
): Promise<T> {
  // `opts.fetchImpl` is either an explicitly provided fetch (caller-bound) or
  // the global fetch bound to globalThis in `resolveOptions` — invoking it
  // off `opts` is safe in both cases.
  return boundedRequest(
    async (signal) => {
      const res = await opts.fetchImpl(url, { signal });
      if (!res.ok) {
        throw new Error(`@wcdraft/data/client: ${operation} returned HTTP ${res.status}.`);
      }
      try {
        return parse(await res.json());
      } catch (cause) {
        throw new RuntimeDataIntegrityError(
          "malformed_payload",
          "manifest",
          cause instanceof Error ? cause.message : String(cause),
        );
      }
    },
    {
      operation,
      timeoutMs: opts.timeoutMs,
      safety: "safe-read",
      signal: opts.signal,
    },
  );
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("@wcdraft/data/client: Web Crypto SHA-256 is unavailable.");
  return toHex(await subtle.digest("SHA-256", bytes));
}

function expectedFingerprint(
  manifest: RuntimeDataManifest,
  bundleKey: keyof RuntimeDataManifest["bundles"],
): { bytes: number; sha256: string } {
  const fingerprint = manifest.bundles[bundleKey] as RuntimeBundleFingerprint | undefined;
  const sha256 = fingerprint?.raw_sha256 ?? fingerprint?.sha256;
  if (
    fingerprint === undefined ||
    !Number.isSafeInteger(fingerprint.bytes) ||
    fingerprint.bytes <= 0 ||
    typeof sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(sha256)
  ) {
    throw new RuntimeDataIntegrityError(
      "missing_fingerprint",
      String(bundleKey),
      "manifest does not contain a usable raw byte length and SHA-256",
    );
  }
  return { bytes: fingerprint.bytes, sha256 };
}

async function fetchVerifiedJson<T>(
  url: string,
  opts: ResolvedOptions,
  manifest: RuntimeDataManifest,
  bundleKey: keyof RuntimeDataManifest["bundles"],
  parse: (value: unknown) => T,
  operation: string,
): Promise<T> {
  const expected = expectedFingerprint(manifest, bundleKey);
  return boundedRequest(
    async (signal) => {
      const res = await opts.fetchImpl(url, { signal });
      if (!res.ok) {
        throw new Error(`@wcdraft/data/client: ${operation} returned HTTP ${res.status}.`);
      }
      const bytes = await res.arrayBuffer();
      if (bytes.byteLength !== expected.bytes) {
        throw new RuntimeDataIntegrityError(
          "byte_length_mismatch",
          String(bundleKey),
          `received ${bytes.byteLength} bytes; manifest requires ${expected.bytes}`,
        );
      }
      const actualSha256 = await sha256Hex(bytes);
      if (actualSha256 !== expected.sha256) {
        throw new RuntimeDataIntegrityError(
          "digest_mismatch",
          String(bundleKey),
          `received SHA-256 ${actualSha256}; manifest requires ${expected.sha256}`,
        );
      }
      try {
        return parse(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
      } catch (cause) {
        throw new RuntimeDataIntegrityError(
          "malformed_payload",
          String(bundleKey),
          cause instanceof Error ? cause.message : String(cause),
        );
      }
    },
    {
      operation,
      timeoutMs: opts.timeoutMs,
      safety: "safe-read",
      signal: opts.signal,
    },
  );
}

/** Load the top-level `RuntimeDataManifest`. */
export async function loadDataManifest(opts?: LoaderOptions): Promise<RuntimeDataManifest> {
  const resolved = resolveOptions(opts);
  return fetchJson<RuntimeDataManifest>(
    `${resolved.basePath}/manifest.json`,
    resolved,
    parseRuntimeDataManifest,
    "runtime data manifest",
  );
}

/** Load the draft-pool compact bundle (1930–2026). */
export async function loadDraftPoolBundle(
  opts: VerifiedBundleLoaderOptions,
): Promise<DraftPoolBundle> {
  const resolved = resolveOptions(opts);
  return fetchVerifiedJson<DraftPoolBundle>(
    `${resolved.basePath}/${DRAFT_POOL_BROTLI_PATH}`,
    resolved,
    opts.manifest,
    "draft_pool",
    parseDraftPoolBundle,
    "runtime draft pool",
  );
}

/** Load the 2026 scenario compact bundle (teams + bracket). */
export async function loadScenario2026Bundle(
  opts: VerifiedBundleLoaderOptions,
): Promise<Scenario2026Bundle> {
  const resolved = resolveOptions(opts);
  return fetchVerifiedJson<Scenario2026Bundle>(
    `${resolved.basePath}/scenario-2026.compact.json`,
    resolved,
    opts.manifest,
    "scenario_2026",
    parseScenario2026Bundle,
    "runtime scenario",
  );
}

/**
 * Load the reference score-distribution artifact. Throws on HTTP failure or
 * malformed payload — callers that render an OPTIONAL standing line must
 * catch and degrade to "standing unknown" (omit), never fabricate. Older
 * deployed data directories legitimately lack this file (HTTP 404).
 */
export async function loadScoreDistribution(
  opts: VerifiedBundleLoaderOptions,
): Promise<ScoreDistribution> {
  const resolved = resolveOptions(opts);
  return fetchVerifiedJson<ScoreDistribution>(
    `${resolved.basePath}/score-distribution.compact.json`,
    resolved,
    opts.manifest,
    "score_distribution",
    parseScoreDistribution,
    "runtime score distribution",
  );
}

/** Load the Daily Draft salt map advertised by the manifest. */
export async function loadDailySeedSaltMap(
  opts: VerifiedBundleLoaderOptions,
): Promise<DailySeedSaltMap> {
  const resolved = resolveOptions(opts);
  return fetchVerifiedJson<DailySeedSaltMap>(
    `${resolved.basePath}/daily-seed-salt-map.compact.json`,
    resolved,
    opts.manifest,
    "daily_seed_salt_map",
    parseDailySeedSaltMap,
    "Daily metadata",
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
    loadDraftPoolBundle({ ...opts, manifest }),
    loadScenario2026Bundle({ ...opts, manifest }),
  ]);
  return { manifest, draftPool, scenario2026 };
}
