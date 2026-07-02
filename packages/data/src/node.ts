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
  type DailySeedSaltMap,
  type DraftPoolBundle,
  type RuntimeDataManifest,
  type Scenario2026Bundle,
} from "./types.js";
import {
  parseDailySeedSaltMap,
  parseDraftPoolBundle,
  parseRuntimeDataManifest,
  parseScenario2026Bundle,
} from "./validation.js";

export interface NodeLoaderOptions {
  /** Directory containing `manifest.json` + the compact bundles. */
  dir: string;
}

async function readJson<T>(filePath: string, parse: (value: unknown) => T): Promise<T> {
  const text = await readFile(filePath, "utf8");
  return parse(JSON.parse(text));
}

export async function loadDataManifestFromDisk(
  opts: NodeLoaderOptions,
): Promise<RuntimeDataManifest> {
  return readJson<RuntimeDataManifest>(
    path.join(opts.dir, "manifest.json"),
    parseRuntimeDataManifest,
  );
}

export async function loadDraftPoolBundleFromDisk(
  opts: NodeLoaderOptions,
): Promise<DraftPoolBundle> {
  return readJson<DraftPoolBundle>(
    path.join(opts.dir, "draft-pool.compact.json"),
    parseDraftPoolBundle,
  );
}

export async function loadScenario2026BundleFromDisk(
  opts: NodeLoaderOptions,
): Promise<Scenario2026Bundle> {
  return readJson<Scenario2026Bundle>(
    path.join(opts.dir, "scenario-2026.compact.json"),
    parseScenario2026Bundle,
  );
}

export async function loadDailySeedSaltMapFromDisk(
  opts: NodeLoaderOptions,
): Promise<DailySeedSaltMap> {
  return readJson<DailySeedSaltMap>(
    path.join(opts.dir, "daily-seed-salt-map.compact.json"),
    parseDailySeedSaltMap,
  );
}

export async function loadRuntimeDataFromDisk(opts: NodeLoaderOptions): Promise<{
  manifest: RuntimeDataManifest;
  draftPool: DraftPoolBundle;
  scenario2026: Scenario2026Bundle;
  dailySeedSaltMap: DailySeedSaltMap | null;
}> {
  const manifest = await loadDataManifestFromDisk(opts);
  const [draftPool, scenario2026, dailySeedSaltMap] = await Promise.all([
    loadDraftPoolBundleFromDisk(opts),
    loadScenario2026BundleFromDisk(opts),
    manifest.bundles.daily_seed_salt_map === undefined
      ? Promise.resolve(null)
      : loadDailySeedSaltMapFromDisk(opts),
  ]);
  return { manifest, draftPool, scenario2026, dailySeedSaltMap };
}
