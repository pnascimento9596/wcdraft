import type { RuntimeDataManifest } from "@wcdraft/data";

/** Version-anchor bundle written into every `RunRecordV1`. */
export interface RunRecordVersions {
  schema_version: string;
  dataset_version: string;
  /** Combined `historical+projected` per the e2e golden convention. */
  rating_version: string;
  engine_version: string;
  ruleset_version: string;
  /** Composite `draft_pool.sha256+scenario_2026.sha256`. */
  data_bundle_hash: string;
}

/** Compose the eviction-key version bundle from the manifest. */
export function composeVersions(manifest: RuntimeDataManifest): RunRecordVersions {
  return {
    schema_version: manifest.schema_version,
    dataset_version: manifest.dataset_version,
    rating_version: `${manifest.rating_version_historical}+${manifest.rating_version_projected}`,
    engine_version: manifest.engine_version,
    ruleset_version: manifest.ruleset_version,
    data_bundle_hash: `${bundleSha256(manifest, "draftpool")}+${bundleSha256(
      manifest,
      "scenario2026",
    )}`,
  };
}

function bundleSha256(manifest: RuntimeDataManifest, normalizedKey: string): string {
  for (const [key, bundle] of Object.entries(manifest.bundles)) {
    if (key.replace(/_/gu, "") === normalizedKey) return bundle.sha256;
  }
  throw new Error(`runtime manifest is missing bundle key ${normalizedKey}`);
}

export function runRecordVersionsEqual(a: RunRecordVersions, b: RunRecordVersions): boolean {
  return (
    a.schema_version === b.schema_version &&
    a.dataset_version === b.dataset_version &&
    a.rating_version === b.rating_version &&
    a.engine_version === b.engine_version &&
    a.ruleset_version === b.ruleset_version &&
    a.data_bundle_hash === b.data_bundle_hash
  );
}
