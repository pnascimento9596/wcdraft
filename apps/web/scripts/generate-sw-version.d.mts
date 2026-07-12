/** Ambient typings for the build-time SW version generator. */

export interface SwBundleFingerprint {
  path: string;
  sha256: string;
  raw_sha256: string;
  bytes: number;
  compressed_sha256: string;
  compressed_bytes: number;
  bytes_brotli: number;
  brotli_impl_version: string;
  options: { quality: 11; mode: "text"; size_hint: number };
}

export interface SwManifestInput {
  schema_version: string;
  dataset_version: string;
  bundles: Record<string, SwBundleFingerprint>;
  [key: string]: unknown;
}

export interface SwCacheNames {
  readonly data: string;
  readonly shell: string;
}

export interface SwPrecacheDataEntry {
  readonly key: string;
  readonly kind: "manifest" | "bundle";
  readonly url: string;
  readonly encoding: "identity" | "brotli";
  readonly expected_bytes: number;
  readonly expected_sha256: string;
  readonly transport_bytes: number;
  readonly transport_sha256: string;
}

export interface SwConfig {
  deploy_revision: string;
  data_revision: string;
  schema_version: string;
  dataset_version: string;
  runtime_data_base_path: string;
  required_bundle_keys: string[];
  precache_data_entries: readonly SwPrecacheDataEntry[];
  bundle_hashes: Record<
    string,
    {
      raw_sha256: string;
      raw_bytes: number;
      compressed_sha256: string;
      compressed_bytes: number;
    }
  >;
  cache_names: SwCacheNames;
}

export interface DeployRevisionSource {
  source:
    | "WCDRAFT_DEPLOY_REVISION"
    | "VERCEL_URL"
    | "VERCEL_DEPLOYMENT_ID"
    | "VERCEL_GIT_COMMIT_SHA";
  raw: string;
}

export const REQUIRED_RUNTIME_BUNDLE_PATHS: Readonly<Record<string, string>>;

export function derivePrecacheDataEntries(
  manifest: SwManifestInput,
  options?: { manifestBytes?: string | Uint8Array },
): readonly SwPrecacheDataEntry[];

export function deriveDataRevision(
  manifest: SwManifestInput,
  options?: { manifestBytes?: string | Uint8Array },
): string;

export function deriveCacheNames(args: {
  deployRevision: string;
  dataRevision: string;
}): SwCacheNames;

export function renderSwVersionScript(config: SwConfig): string;

export function resolveDeployRevisionFromEnv(
  env: Record<string, string | undefined>,
): DeployRevisionSource | null;

export function run(args?: {
  webRoot?: string;
  env?: Record<string, string | undefined>;
  repoRoot?: string;
  manifestOverride?: SwManifestInput;
  manifestBytesOverride?: string | Uint8Array;
}): { outPath: string; config: SwConfig };
