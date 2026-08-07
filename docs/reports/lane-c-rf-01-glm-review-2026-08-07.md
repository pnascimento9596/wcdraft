# Lane C RF-01 — GLM 5.2 MAX adversarial review

- Model: `ollama-cloud/glm-5.2` via OpenCode CLI (`--variant max`) — Ollama Pro Cloud
- Branch: `ws-core/runtime-components-diet`
- Date: 2026-08-07

## Implementer triage

- Initial GLM STATUS: **FAIL** with two blockers.
- **B1 accepted and fixed:** restored `components: []` on `ManagerRating` fixture in `synergy.golden.test.ts` (out of scope accidental strip).
- **B2 accepted and fixed:** regenerated `leaderboard-validate-golden.json` via `gen:leaderboard-golden` after 2.11 bump; verified scores unchanged.
- W1: old-token skew (sv 2.10 vs 2.11) is intended honest-state; documented in PR.
- W2/N1–N3: deferred polish / pre-existing.

## GLM verdict (pre-fix-forward)

STATUS: FAIL

**CONFIDENCE: High** — both blockers independently reproduced and traced to CI gates (ci.yml:357 typecheck, ci.yml:448 golden:leaderboard). The implementer's "Verified" list omits `pnpm typecheck` and the leaderboard golden — both FAIL.

## BLOCKERS

### B1 — `@wcdraft/core` typecheck is RED (CI gate: ci.yml:357)
`packages/core/src/synergy.golden.test.ts:210` removed `components: []` from the `managerRating()` fixture, but `ManagerRating.components` remains a **required** field (`packages/core/src/types/manager.ts:237`). The intent scoped the drop to **player `Rating`** only (`ManagerRating` was out of scope), yet the fixture edit reached `managerRating()`.
```
src/synergy.golden.test.ts(210,3): error TS2741: Property 'components' is missing in type '...' but required in type 'ManagerRating'.
```
Fix: restore `components: []` in `synergy.golden.test.ts` `managerRating()`. The parallel edit in `manager-modifier-decoupling.guard.test.ts:121` is safe (uses `as unknown as Rating` cast on a player `Rating`, not `ManagerRating`).

### B2 — `test:golden:leaderboard` is RED (CI gate: ci.yml:448)
3 of 6 committed tokens in `apps/web/lib/leaderboard/__tests__/fixtures/leaderboard-validate-golden.json` are now **rejected** instead of accepted. Root cause: tokens carry `sv = "runtime-data-2.10.0"`; after the bump `current.schema_version = "runtime-data-2.11.0"`, so `versionsAgree` (run-token.ts:612, `token.sv === current.schema_version`) returns false → `versionSkew`. This is the intended honest-state skew on a schema-anchor bump — but the fixture was **not regenerated**. The test file header explicitly mandates the regen on any version-anchor bump:
> `pnpm build && pnpm --filter @wcdraft/web gen:leaderboard-golden` — regen in the same PR as the bump, inspect the diff (e2e-golden discipline).
Fix: run the regen, then diff the fixture — only `sv` (and the `data_bundle_hash`/`hv` anchor, since draft-pool bytes changed) should move; `verified_score`/`score_breakdown` must stay byte-equal (ratings/engine unchanged, canary 0-flips).

## WARNINGS

### W1 — Old-token replay skew not explicitly documented for this bump
STATE.md and the commit message record the schema bump + retention (2.11+2.10+2.9, 2.8 removed) but do NOT call out that the 2.10→2.11 schema-anchor bump causes in-flight 2.10 tokens to skew (`versionSkew`/`DIFFERENT_BUILD`/`WRONG_SEASON`). The behavior is correct, intended, and generically tested (`run-token.test.ts:356` pins that any anchor diff trips `versionsAgree`), but the lane should note the skew consequence. This is also the operational cause of B2.

### W2 — Strategic-pick canary is not in a registered `test:golden:*` script
`strategic-pick-canary.golden.test.ts` is a standalone golden file (not wired into any `test:golden:*` script in `packages/data/package.json` or `turbo.json`). It passed when run explicitly (0 flips, verified independently), and the golden fixture embeds `rating_version`/`engine_version`/`dataset_version` — all unchanged, so no regen was needed. But CI does not auto-run it on this lane. Pre-existing characteristic (not introduced by RF-01), but worth flagging since the canary is the primary 0-flips gate and AGENTS.md requires new golden scripts to be registered.

## NITS

### N1 — Orphaned JSDoc block
`packages/core/src/types/rating.ts:95-99` has two adjacent JSDoc blocks: the `TeamStrength` doc (lines 95-99) is now immediately followed by the `ProvenanceRating` doc (100-105), then `ProvenanceRating` (106). The `TeamStrength` JSDoc is detached from `TeamStrength` (now at line 111) by the inserted `ProvenanceRating` block. Cosmetic; reorder so each JSDoc sits above its interface.

### N2 — `RatingSchema` does not reject a stray `components` field
`RatingSchema` (rating.ts:30) uses `z.object(...)` without `.strict()`/`.catchall()`, so Zod **strips** unknown keys rather than rejecting them. Not a production concern — runtime data is parsed via plain `JSON.parse`, and the actual guard is the builder's `assertRuntimeRating` (`build-compact-data.mjs:315`, `if ("components" in rating) failBundle(...)`), which correctly **fails** on presence. The type surface is honest (`components` fully absent from `Rating`, not optional). Optional hardening: add a rejection test in `schemas.test.ts` that `RatingSchema.safeParse({...makeRating(), components:[...]})` does not carry `components` through, to match the builder's strictness.

### N3 — Integrity-probe skip path is behaviorally dead (pre-existing)
The rehomed `etlHasManualOverride` correctly returns >0 on the full ETL set (1868 historical + 397 projected rows), and all 386 `baseline_anchor_estimate` rows join 1:1 to ETL by normalized `card_id` (`:WC-YYYY`→`:YYYY`) with **0 unmatched** and all 386 in band [66,73]. However, **zero** `baseline_anchor_estimate` rows carry `manual_rating_override` (overrides live only on `measured_performance`/`career_stature_estimate` rows). So the `if (etl && etlHasManualOverride(etl)) continue;` skip in `compact-data.integrity.test.ts:160` and the builder's `!hasManualRatingOverride(rating)` gate (`build-compact-data.mjs:816`) are **never exercised** for baseline_anchor_estimate. This is pre-existing (the old `r.components.some(...)` path was equally dead for these rows), so it's behavior-preserving — but the probe's protective branch is untested on the very rows it guards. Consider a fixture that injects a manual override onto a baseline_anchor_estimate row to prove the skip path fires.

## VERIFIED PASS (adversarial re-check, independent of implementer)

- **Task 1 — production reads**: 0 reads of `.components` on runtime `Rating` in `apps/web` + `packages/core/src` + `packages/data/src` (only a comment in `data/src/types.ts:72`).
- **Task 5 — salt map runway**: 45-day window 2026-08-07→2026-09-20, schema `daily-seed-salt-map-1.0.0` unchanged, N=128/date. Matches STATE.md.
- **Task 6 — integrity probe coverage**: builder `hasManualRatingOverride(rating)` rehomed to read source ETL row (top-level + `basis_ratings.career` + `basis_ratings.current` components) — returns true for 1868 historical rows, matching ETL; 0 for baseline_anchor_estimate (honest). Test `etlHasManualOverride` returns >0 on full ETL. card_id normalization (`:WC-YYYY`→`:YYYY`) consistent across historical + 2026. All 386 estimates join + in-band.
- **Size (acceptance)**: decoded **-74.05%** (65.21 MiB→16.92 MiB, ≫15% bar), brotli **-45.57%** (1,311,661→713,942 bytes) — independently recomputed, byte-exact match to manifest.
- **Strategic-pick canary**: 0 flips (run explicitly; golden fixture untouched; rating/engine/dataset anchors all unchanged).
- **Retention**: 2.11 current + 2.10 + 2.9 retained (2.8 removed); `RETAINED_PRIOR_SCHEMA_COUNT=2` derivation correct; `web-assets-copy.test.ts` pins retained 2.10 bytes/sha (1,311,661 / `76a58337…`) — matches retained snapshot.
- **ETL byte-stability**: `etl/` untouched in the lane; ETL output still emits + validates `components` (`output_contracts.py:139,161`); runtime pool 0/12219 with components, retained 2.10 pool 12219/12219 with components.
- **Gates run**: data unit 162 pass/9 skip; golden:data 60 pass; core 429 pass; core golden+draft 69+42 pass; data integration golden 22 pass; merit-v42 7 pass; canary 1 pass; run-token 30 pass; web typecheck clean; runtime materializer "24 files across 2.11.0 + 2 retained". Ratings count unchanged 12219→12219.

## WHAT CHANGED
- `Rating` type: `components` removed; new `ProvenanceRating extends Rating` carries it (rating.ts). `RatingSchema` loses `components`; new `ProvenanceRatingSchema` keeps it (schemas/rating.ts). Both exported from core index.
- `build-compact-data.mjs`: `SCHEMA_VERSION` → `runtime-data-2.11.0`; `assertRuntimeRating` now **fails** if `components` present (`if ("components" in rating) failBundle`); `materializeBasisRating` stops emitting `components`; `hasManualRatingOverride` rehomed to read source ETL row + dual-basis rows instead of the stripped runtime rating.
- `data/src/types.ts`: `RUNTIME_DATA_SCHEMA_VERSION` → `2.11.0`; `RuntimeBasisRating extends Rating` no longer inherits `components`.
- Tests: `compact-data.integrity.test.ts` + `merit-v42.acceptance.test.ts` rehomed to read `components` from `etl/output/ratings.json` + `ratings_2026.json` via normalized card_id; test fixtures in core stripped of `components: []` (one incorrectly — B1); daily-seed-salt-map golden window dates updated.
- Generated: draft-pool + manifest + scenario + score-distribution + salt-map regenerated; 2.10.0 snapshot retained, 2.8.0 removed.
- STATE.md updated in the same change.

## RISKS / CARRYOVER
- B1 and B2 must be fixed forward before merge; both are mechanical (restore one `components: []`; regen one fixture + diff-inspect). On PASS, autonomous squash via `gh pr merge --squash --match-head-commit <sha>`.
- After regen of the leaderboard golden (B2), **re-run `test:golden:leaderboard`** and confirm only version/hash anchors moved, not `verified_score`.
- The schema bump 2.10→2.11 invalidates in-flight 2.10 run tokens in the wild (Daily/share/challenge/leaderboard) — by design (honest skew). No DB migration; retained 2.10 bundle keeps old replay readable for the retention window. This is the intended tradeoff and matches the standing version-anchor contract.
- No realism retune needed (canary 0-flips, λ unchanged).

