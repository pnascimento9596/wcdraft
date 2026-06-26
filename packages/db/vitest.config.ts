import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Belt-and-suspenders: a path-selected golden job must FAIL if the target
    // file is missing/renamed, never pass vacuously. Matches packages/core and
    // packages/data convention.
    passWithNoTests: false,
    // pglite runtime tests boot an in-memory Postgres and apply all committed
    // migrations; cold CI runners can exceed Vitest's default 5s timeout.
    testTimeout: 30_000,
  },
});
