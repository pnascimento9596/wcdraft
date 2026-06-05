// Node-side loaders. Reads the compact bundles from a directory on disk —
// typically the `src/generated/` directory inside the published package, but
// callable against any directory layout matching the manifest's relative
// paths.
//
// Used by:
//   - data golden tests (read the on-disk artifacts)
//   - `scripts/copy-web-assets.mjs` (sanity-check before copying)
//   - any future Node-side smoke tests in `apps/web` integration

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  RUNTIME_DATA_SCHEMA_VERSION,
  type DraftPoolBundle,
  type RuntimeDataManifest,
  type Scenario2026Bundle,
} from "./types.js";

export interface NodeLoaderOptions {
  /** Directory containing `manifest.json` + the compact bundles. */
  dir: string;
}

async function readJson<T>(filePath: string): Promise<T> {
  const text = await readFile(filePath, "utf8");
  return JSON.parse(text) as T;
}

export async function loadDataManifestFromDisk(
  opts: NodeLoaderOptions,
): Promise<RuntimeDataManifest> {
  const manifest = await readJson<RuntimeDataManifest>(path.join(opts.dir, "manifest.json"));
  if (manifest.schema_version !== RUNTIME_DATA_SCHEMA_VERSION) {
    throw new Error(
      `@wcdraft/data/node: manifest schema_version mismatch — got "${manifest.schema_version}", expected "${RUNTIME_DATA_SCHEMA_VERSION}".`,
    );
  }
  return manifest;
}

export async function loadDraftPoolBundleFromDisk(
  opts: NodeLoaderOptions,
): Promise<DraftPoolBundle> {
  return readJson<DraftPoolBundle>(path.join(opts.dir, "draft-pool.compact.json"));
}

export async function loadScenario2026BundleFromDisk(
  opts: NodeLoaderOptions,
): Promise<Scenario2026Bundle> {
  return readJson<Scenario2026Bundle>(path.join(opts.dir, "scenario-2026.compact.json"));
}

export async function loadRuntimeDataFromDisk(opts: NodeLoaderOptions): Promise<{
  manifest: RuntimeDataManifest;
  draftPool: DraftPoolBundle;
  scenario2026: Scenario2026Bundle;
}> {
  const manifest = await loadDataManifestFromDisk(opts);
  const [draftPool, scenario2026] = await Promise.all([
    loadDraftPoolBundleFromDisk(opts),
    loadScenario2026BundleFromDisk(opts),
  ]);
  return { manifest, draftPool, scenario2026 };
}
