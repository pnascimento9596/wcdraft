/**
 * Ambient typings for the build-time SW version generator.
 *
 * The generator itself is a plain .mjs (no TS) because it must be runnable
 * by `node` during `prebuild` / `pretest` without any compile step. Tests
 * under `lib/game/__tests__` import the pure helpers, so this sibling
 * declaration gives `tsc` the shapes it needs.
 */

export interface SwManifestInput {
  schema_version: string;
  dataset_version: string;
  bundles: Record<string, { sha256: string }>;
}

export interface SwCacheNames {
  readonly data: string;
  readonly shell: string;
}

export interface SwConfig {
  deploy_revision: string;
  data_revision: string;
  schema_version: string;
  dataset_version: string;
  runtime_data_base_path: string;
  precache_data_urls: string[];
  bundle_hashes: Record<string, string>;
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

export function deriveDataRevision(manifest: SwManifestInput): string;

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
}): { outPath: string; config: SwConfig };
