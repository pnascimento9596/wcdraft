// Flat ESLint config shared across the monorepo (found via upward search by
// each package's `eslint .` invocation). Non-type-checked preset keeps lint
// fast and avoids per-package project-service wiring.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

const FORBIDDEN_ENTROPY_MESSAGE =
  "wcdraft determinism: forbidden entropy API in packages/core/src — the seeded RNG in rng.ts is the ONLY allowed source of randomness/time.";

const FORBIDDEN_TRANSCENDENTAL_MESSAGE =
  "wcdraft determinism: Math.exp / Math.log / Math.pow are not allowed in packages/core/src — these calls are cross-engine non-deterministic at the last bits. Use integer arithmetic, a precomputed lookup table, or a documented fast-math helper in rng.ts. See WS-B S2-2.";

const FORBIDDEN_LOCALE_COMPARE_MESSAGE =
  "wcdraft determinism: String.prototype.localeCompare is forbidden in packages/core/src — use code-point ordering via compareCodePointStrings/canonicalSortBy.";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/next-env.d.ts",
      "apps/web/public/sw-version.js",
      "apps/mobile/ios/**",
      "apps/mobile/www/**",
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
        // ── Transcendental-math gate (WS-B S2-2) ─────────────────────────────
        // Math.exp / Math.log / Math.pow are not bit-stable across V8 / JSC /
        // SpiderMonkey at the last bits. They're banned in core/src so a
        // browser refresh on a different engine cannot diverge a replay. If a
        // calibrated path genuinely needs one, replace it with integer
        // arithmetic or a precomputed lookup table; the only allowed escape
        // hatch is documented fast-math helpers in rng.ts (exempted above).
        {
          selector: "MemberExpression[object.name='Math'][property.name='exp']",
          message: FORBIDDEN_TRANSCENDENTAL_MESSAGE,
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='log']",
          message: FORBIDDEN_TRANSCENDENTAL_MESSAGE,
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='pow']",
          message: FORBIDDEN_TRANSCENDENTAL_MESSAGE,
        },
        {
          selector: "CallExpression[callee.property.name='localeCompare']",
          message: FORBIDDEN_LOCALE_COMPARE_MESSAGE,
        },
      ],
    },
  },
  // ─── I3.10 — forbid the deleted mock layer from being re-imported ───────
  // The integration pass deletes `apps/web/lib/mock`. This rule prevents
  // anyone from re-introducing it (or `@/lib/mock` imports) from the web
  // app source tree.
  {
    files: ["apps/web/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/mock", "@/lib/mock/*", "**/lib/mock", "**/lib/mock/*"],
              message:
                "apps/web/lib/mock was deleted in I3.10 — wire to @wcdraft/core + @wcdraft/data instead.",
            },
          ],
        },
      ],
    },
  },
  // Disable stylistic rules that conflict with Prettier (keep last).
  prettier,
);
