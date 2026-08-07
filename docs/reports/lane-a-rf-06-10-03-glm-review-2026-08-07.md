# Lane A RF-06/10/03 — GLM 5.2 MAX adversarial review

- Model: `ollama-cloud/glm-5.2` via OpenCode CLI (`--variant max`)
- Session: `ses_023f3cd47ffea1KKF7IDLJiSaO`
- Base: `origin/main` @ `2632b4c`
- Date: 2026-08-07

## Structured verdict

STATUS: PASS

BLOCKERS: none

WARNINGS: none. All three dispatch items verified by re-execution:

- A1: unified `readBoundedText` superset (`bytes` field) consumed by lineup + OG sign + challenge verify + `requireJsonObject`; deleted private twin was byte-identical in logic, so `CONTENT_LENGTH_MISMATCH` (`declaredBytes !== read.bytes`) behavior is unchanged. New test (bounded-body.test.ts:80-101) proves both former call sites reject over-limit pre-decode — confirmed the Node `Request` constructor does NOT auto-set `content-length` for string bodies, so the `requireJsonObject` path genuinely hits the streaming byte ceiling, not the header pre-check. 9/9 bounded-body tests pass; typecheck clean.
- A2: `test:unit` exclude verified empirically (1424 tests, zero playwright imports in unit lane); `test:browser` explicit-include verified (exactly the 2 browser tests + 3 tsx scripts); aggregate `test` chains both. Contract test at one-screen-device-matrix.test.ts:199-209 guards the script shape. CI installs Playwright browsers before `pnpm run test` (ci.yml:333-345). 29/29 contract tests pass.
- A3: `packages/data test` excludes exactly the 2 full-regen goldens; verified empirically (161 passed, 9 skipped, 4.6s wall — under 12s target). Both excluded files are in `test:golden:data` (package.json:33) which is registered in turbo.json:142 and run by CI at ci.yml:445. `passWithNoTests:false` + path-selected golden lane means a renamed/missing golden fails closed. Fast fingerprint/manifest assertions (`compact-data.integrity`, `score-distribution.golden`) correctly remain in unit. Data typecheck clean.

NITS:

1. The `test:unit` exclude relies on a bare relative path (`lib/game/__tests__/responsive-layout-browser.contract.test.ts`) rather than a directory-based include split. Works in Vitest 4.1.10 (empirically confirmed) but is mildly brittle: if the file is moved/renamed, the exclude silently no-ops and the browser file would launch browsers in the unit lane. Mitigated by the contract test guarding `test:browser` script contents, but a future-proof fix would co-locate browser tests under a dedicated directory excluded by the vitest config `include` globs.
2. The contract test assertion `expect(scripts.test).toContain("test:unit")` is substring-loose (would match `test:unitfoo`); practically safe given the exact script value `"pnpm run test:unit && pnpm run test:browser"`.

COVERAGE_GAPS: none. Unification covered (both call sites, over-limit + at-cap); test split covered (contract test + empirical `vitest list`); golden exclusion covered (CI line 445 + turbo.json:142 + empirical exclude verification). Standing invariants hold: no runtime behavior change (private twin was byte-identical logic), CI aggregate coverage unchanged, regen coverage preserved in golden lane.

RECOMMENDED_FIXES:

1. (optional, NIT) Harden the unit/browser split by moving browser-contract tests into a dedicated subdirectory (e.g. `lib/game/__tests__/browser/`) and adding `!lib/game/__tests__/browser/**` to the vitest config `include` globs, so the split survives file renames without relying on CLI `--exclude` matching.

CONFIDENCE: high — re-executed the bounded-body suite (9/9), both responsive contract tests (29/29), web typecheck (exit 0), data typecheck (exit 0), and the data unit suite (161 passed / 9 skipped / 4.6s); empirically verified vitest `--exclude` and explicit-include behavior for both packages; confirmed CI golden lane (ci.yml:445) and turbo.json registration (turbo.json:142) still run both excluded regen goldens.

## Implementer triage

- **STATUS accepted: PASS.** No blockers; no required fixes.
- NIT1 (bare relative `--exclude` path): acknowledged; deferred. Empirical `vitest list` + unit green without Playwright binaries; contract test guards `test:browser` membership. Directory-split is polish, not ship-blocking.
- NIT2 (substring `toContain('test:unit')`): accepted as low practical risk given exact script value.
- Early false-positive (requireJsonObject header vs stream): GLM self-corrected after re-check that Node Request does not expose content-length for string bodies — both call sites hit streaming ceiling. Confirmed.
- Gates re-run by implementer: web test:unit 1424 pass; data test 161 pass / 7.24s then 4.6s; eslint clean on touched files; packages built.
