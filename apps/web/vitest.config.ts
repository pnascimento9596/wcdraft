import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Vitest config for the web layer. Most tests use the default Node environment;
// the bounded-request mounted-container regressions opt into happy-dom per file
// and use ReactDOM directly (no broad testing-library stack). JSX still needs
// transforming for those mounts and the existing `renderToStaticMarkup` probes:
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
      "lib/health/__tests__/**/*.test.ts",
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
    // Linux ephemeral containers: default 1 worker to avoid fork-pool OOM
    // false reds; override via VITEST_MAX_WORKERS.
    maxWorkers: Number(process.env.VITEST_MAX_WORKERS ?? (process.platform === "linux" ? 1 : 4)),
    // Prefer threads on Linux when forced forks thrash under cgroup memory caps.
    pool: (process.env.VITEST_POOL ?? (process.platform === "linux" ? "threads" : "forks")) as
      | "threads"
      | "forks",
  },
});
