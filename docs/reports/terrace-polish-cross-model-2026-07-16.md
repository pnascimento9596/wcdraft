# Terrace polish — independent GLM exact-head review

- Date: 2026-07-17 EDT
- Reviewer: OpenCode 1.17.10, `ollama-cloud/glm-5.2`, variant `max`, read-only `plan` agent
- Production base: `cc226371538b0717d538f86824643efd95af4d3c`
- Reviewed code head: `d20e12cac326f29b046b063664d61d08dd5917dd`
- Verdict: **PASS**
- Reviewer-executed gates: 64/64 focused tests; web typecheck; web lint

The receipt/report commit that adds this file is documentation-only. The reviewed application and
test code remains byte-identical to the code at `d20e12c`.

## Verbatim reviewer verdict

PASS

## Blocking findings

None. No correctness, regression, accessibility, contract, trust-boundary, or scope defects found.

## Verification summary

**Home disclosure (exact legal content + bottom anchoring):** `legal-disclosure.tsx` emits the two exact CC-BY-SA/attribution lines; `one-screen-compaction.test.ts:103-119` renders via `renderToStaticMarkup` and asserts them verbatim. `home-hero.module.css` makes `.hero` a flex column with `.disclosure { margin-block-start: auto }`, anchoring to shell bottom. Test gate rejects `position: fixed` and `disclosureBottomGapPx > 1`. `app/page.tsx:117-119` wires `heroStyles.disclosure`. ✓

**Mode recognition (five descriptors + five-column layout):** `mode-select.tsx:39,49,57,65,74` contains the five exact functional descriptors. `shared.module.css` short-landscape tier changes `repeat(4,…)` → `repeat(5,…)`; `game-flow-playwright.mts` updates `expectedColumns` 4→5 for 667x375. Descriptors use body typography (`font-weight: regular !important; letter-spacing: 0 !important; text-transform: none !important`). ✓

**Formation setup (duplicate app bar removal, 8 pitches, 10 dots + goal box, two-word descriptors, strict fit ≥360, no Position=SHAPE change):** `setup.tsx` removes `DraftAppBar` import/render (was `cc22637:368`) and `data-formation-select` added. `FORMATION_DESCRIPTORS` (lines 38-47) has all 8 two-word descriptors. `MiniPitch` filters `position_line !== "GK"` → 10 uniform dots + 1 outlined `miniGoalBox`. `positionShape`/`miniDotShape_`/`PitchMarkings` removed only here; `run-og-model.ts:143` and all player-identity surfaces retain Position=SHAPE. `draft-shell.module.css` 3-column grid at ≥360, 2-column at <360. STATE.md documents the owner-approved exception. ✓

**Integration with shipped narrow formation geometry:** `formation-layout.ts` unchanged (no diff); `getFormationVisualSlots` reused as-is. ✓

**320-only mode dock collision fix:** `shared.module.css` adds `@media (max-width: 359px) { .modeDock { position: static; } }`; dock bottom margin changed from `-8px` → `0` at the 430px tier. `tap-stability.test.ts` covers this. ✓

**Foreign-document collision handling:** `narrow-collision-scan.ts:314-315` filters `ownerDocument === document`; adversarial Playwright test (`responsive-layout-contract.test.ts:699-751`) proves a stale foreign-doc hit is discarded while a real current-page occluder still fails closed. ✓

**Next 16 dev-overlay suppression:** `dev-overlay-suppression.ts` requires exactly one `body > script[data-nextjs-dev-overlay="true"]` wrapper with one direct-child `nextjs-portal` (`verifiedPortal` at line 56-59). Bare portal → `portalProvenance: "unverified"` → fails closed. Request nonce via DOM property (`nonceElement.nonce`); style nonce mismatch rejected. CSS targets only the wrapper. Registry-only scanner trust (WeakMap populated only for verified portal). Live browser tests verify both pass and fail-closed paths. ✓

**No palette literals / core/data/ETL/rating/runtime/golden changes:** Diff confined to `apps/web/` + `STATE.md`. No `packages/core`, `packages/data`, `packages/db`, `etl/`, rating, runtime manifest, or golden test files touched. No hex/rgb/hsl literals in new CSS — all `var(--…)`, `color-mix`, `env()`, `currentColor`. ✓

**Test adversarialness:** Tests are genuinely adversarial — they construct real DOM (foreign documents, bare portals, nonce mismatches, shadow occluders) and assert both pass and fail-closed behavior. The `formationCardContentOverflowCount` uses `Range.getClientRects()` to verify descriptors stay inside card bounds. The `formationActiveMarkerColorsCorrect` resolves tokens on dedicated probes (avoiding WebKit transition-state bleed). ✓

**216-cell and 264-cell evidence:** 216 = 9 device descriptors × 2 themes × 2 motion × 3 routes × 2 engines (verified in `one-screen-device-matrix.ts` and `verify-home-fold-browser.mts`); 24 = 320x568 scroll-permitted; 192 strict-fit. 264 = 22 surfaces (groups [6,5,6,5]) × 2 engines × 3 viewports × 2 themes (verified in `responsive-layout-contract.ts:158-163,209-217` and test line 473). 36 screenshots present in `docs/reports/terrace-polish-2026-07-16/screenshots/`. Math is supported by code. ✓

**Validation run:** `vitest` 64/64 passed (including live Playwright browser tests); `tsc --noEmit` clean; `eslint --max-warnings=0` clean.

## Non-blocking risks

- The `disclosureBottomGapPx` gate uses a 1px tolerance; WebKit sub-pixel rounding could theoretically produce a false positive at exactly 1px, but `Math.abs` + the `<= 1` comparator absorbs this.
- The 320x568 tier remains scroll-permitted (not strict-fit); this is the documented, delegated decision and is not a regression.

## Gate verdict

All claimed properties verified against actual code and tests. Scope is clean (web-only, no core/data/ETL/rating/golden). Tests are adversarial with live browser proof. Cardinality claims (216/216, 264/264) are supported by the matrix definitions and evidence artifacts. No blocking defects. **PASS.**

Reviewed head: d20e12cac326f29b046b063664d61d08dd5917dd
