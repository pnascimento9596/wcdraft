import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Belt-and-suspenders for the path-selected golden job: if the target file
    // is missing/renamed (e.g. rng.golden.test.ts), the run FAILS instead of
    // passing vacuously.
    passWithNoTests: false,
  },
});
