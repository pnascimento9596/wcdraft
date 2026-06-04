// Flat ESLint config shared across the monorepo (found via upward search by
// each package's `eslint .` invocation). Non-type-checked preset keeps lint
// fast and avoids per-package project-service wiring.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

const FORBIDDEN_ENTROPY_MESSAGE =
  "wcdraft determinism: forbidden entropy API in packages/core/src — the seeded RNG in rng.ts is the ONLY allowed source of randomness/time.";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
  {
    // Plain JS tooling/scripts (e.g. icon generators) run under Node.
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // Service workers run in their own global scope (self, clients, …).
    files: ["**/public/sw.js"],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
      },
    },
  },
  // ─── Determinism guard for packages/core/src ──────────────────────────────
  // The seeded RNG in `packages/core/src/rng.ts` is the single source of
  // randomness for the engine. Math.random / Date.now / performance.now /
  // crypto.getRandomValues / new Date() are forbidden everywhere else in
  // core/src. AST-based selectors (not text scanning) so comments mentioning
  // these APIs do not false-positive.
  {
    files: ["packages/core/src/**/*.{ts,tsx,mts,cts}"],
    ignores: [
      "packages/core/src/rng.ts",
      // Golden-fixture generator is dev-only tooling and may read the wall
      // clock. CI only enforces lint on the source tree; the script lives
      // alongside via package.json scripts.
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: FORBIDDEN_ENTROPY_MESSAGE,
        },
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message: FORBIDDEN_ENTROPY_MESSAGE,
        },
        {
          selector: "MemberExpression[object.name='performance'][property.name='now']",
          message: FORBIDDEN_ENTROPY_MESSAGE,
        },
        {
          selector: "MemberExpression[object.name='crypto'][property.name='getRandomValues']",
          message: FORBIDDEN_ENTROPY_MESSAGE,
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: FORBIDDEN_ENTROPY_MESSAGE,
        },
      ],
    },
  },
  // Disable stylistic rules that conflict with Prettier (keep last).
  prettier,
);
