import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Belt-and-suspenders: a path-selected golden job must FAIL if the target
    // file is missing/renamed, never pass vacuously. Matches packages/core and
    // packages/data convention.
    passWithNoTests: false,
  },
});
