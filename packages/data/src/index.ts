// Public surface of `@wcdraft/data`.
//
// Layers:
//   1. Runtime data CONTRACTS (types) — bridge between ETL output and
//      `@wcdraft/core` / `@wcdraft/web`.
//   2. The committed compact BUNDLES (read-only JSON in `src/generated/`),
//      re-exported as typed values.
//
// Loaders for production code live in subpath entry points:
//   - `@wcdraft/data/client` — browser fetch-based loaders.
//   - `@wcdraft/data/node`   — file-system loaders (tests, scripts).
//
// The top-level barrel exports types + the committed bundles as static
// imports, which is convenient for golden tests and dev tooling but NOT for
// `apps/web` runtime code (every page would pull the full pool into its
// initial bundle). Web code MUST use `@wcdraft/data/client`.

export * from "./types.js";

import draftPoolJson from "./generated/draft-pool.compact.json" with { type: "json" };
import scenario2026Json from "./generated/scenario-2026.compact.json" with { type: "json" };
import manifestJson from "./generated/manifest.json" with { type: "json" };
import type { DraftPoolBundle, Scenario2026Bundle, RuntimeDataManifest } from "./types.js";

/**
 * Statically-imported draft pool. Use only in tests, scripts, and
 * server-rendered surfaces that want the full pool in-process. Web pages
 * MUST lazy-load via `@wcdraft/data/client`.
 */
export const DRAFT_POOL_BUNDLE = draftPoolJson as unknown as DraftPoolBundle;
export const SCENARIO_2026_BUNDLE = scenario2026Json as unknown as Scenario2026Bundle;
export const RUNTIME_DATA_MANIFEST = manifestJson as unknown as RuntimeDataManifest;
