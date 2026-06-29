import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Vitest config for the web layer. Tests target pure adapter modules under
// `lib/game/__tests__` and `lib/auth/__tests__` — no DOM environment.
// React components are exercised only via `renderToStaticMarkup` string
// renders (the Memory-mode digit probe). That needs JSX transformed:
// Next's tsconfig sets `jsx: "preserve"`, so esbuild must override it here.
// We keep the next-aware path aliases working so test imports mirror
// what the source files use.

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    include: [
      "lib/game/__tests__/**/*.test.ts",
      "lib/auth/__tests__/**/*.test.ts",
      "lib/leaderboard/__tests__/**/*.test.ts",
    ],
    // A path-selected golden job must FAIL if the target file is renamed /
    // missing — mirrors the policy in packages/data.
    passWithNoTests: false,
    // The full-path Final test exercises the real engine over the real
    // bundle (multi-MB JSON). Give it generous bounds for cold CI runners.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // The web suite starts several PGlite-backed DB tests and Next route/OG
    // tests. Unbounded fork pools can starve worker startup on loaded runners.
    maxWorkers: 4,
  },
});
