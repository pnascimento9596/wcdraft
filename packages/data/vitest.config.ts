import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Belt-and-suspenders: a path-selected golden job must FAIL if the target
    // file is missing/renamed, never pass vacuously.
    passWithNoTests: false,
    // The compact-data golden test re-runs the deterministic builder against
    // the full ETL output in a `beforeAll` hook — that load + brotli pass
    // takes ~10-15s on a warm cache (more on cold CI runners), so the
    // default 10s hook timeout is too tight.
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
