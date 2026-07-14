# Final Polish U2: 360px landing fold closure

- Date: 2026-07-14
- Branch: `ws-ux/final-polish-u2-fold`
- Gate 0 base: `origin/main` at `037c45159c32a58a4b302862160873b1da296c15`
- Risk: Yellow (mobile display density only)

## Outcome

Exact fit achieved. The landing page now has zero document overflow at 360×800 and 390×844
in light and dark themes with both full and reduced motion. No fallback threshold or
Architect-delegated exception was required.

The change is limited to the decorative full-motion spin preview at the existing ≤380px
breakpoint. It reduces that preview from 289.53px to 260.23px by tightening grid gaps, outer and
card padding, and decorative flag/position scale. It does not change hero copy, CTA layout,
colors, data, draft/simulation/rating/synergy semantics, or any U1/U3–U5 surface.

## Measured before and after

The committed Chromium evidence uses exact CSS viewports at DPR 1. Each result was captured only
after the expected full-motion loop or reduced-motion poster was rendered. Measurements are from
`document.documentElement.scrollHeight/clientHeight`; values are identical across light and dark
themes.

| Viewport | Motion | Before scroll/client | Before overflow | After scroll/client | After overflow | Required CTAs in viewport |
| -------- | ------ | -------------------: | --------------: | ------------------: | -------------: | ------------------------- |
| 360×800  | Full   |              828/800 |            28px |             800/800 |            0px | Yes                       |
| 360×800  | Reduce |              800/800 |             0px |             800/800 |            0px | Yes                       |
| 390×844  | Full   |              844/844 |             0px |             844/844 |            0px | Yes                       |
| 390×844  | Reduce |              844/844 |             0px |             844/844 |            0px | Yes                       |

Across the 8 after rows (2 viewports × 2 themes × 2 motion modes):

- 0 vertical overflows and 0 horizontal overflows.
- 0 CTA targets below 44px.
- 0 WCAG 2 A/AA Axe violations.
- 0 browser console/page errors.
- All three primary CTAs remained within the viewport. At 360×800 full motion, their maximum
  bottom edge moved from 636.67px to 607.38px; CTA sizes and copy were not changed.

The mobile hero continues to use the existing URL-bar-aware and top-safe-area-aware minimum:
`calc(100svh - 3.35rem - 1px - env(safe-area-inset-top, 0px))`. The global shell retains
horizontal safe-area padding and `viewport-fit=cover`. This unit does not replace `svh` with
legacy `vh` or add fixed viewport assumptions.

## Evidence

- `before/home-fold-before.json`: 8 baseline measurement rows.
- `after/home-fold-after.json`: 8 strict after measurement rows, including Axe and console data.
- `before/screenshots/`: 8 exact-viewport PNGs (both viewports, themes, and motion modes).
- `after/screenshots/`: 8 corresponding exact-viewport PNGs.
- `apps/web/scripts/verify-home-fold-browser.mts`: reproducible matrix capture and strict gate.

The baseline capture reproduced the surfaced defect before CSS was edited. The failed initial
browser attempt is excluded: the fresh worktree had not yet materialized workspace package build
outputs, so Next returned module-resolution errors before rendering the page. Dependencies were
built directly, and the untouched baseline was then captured successfully.

## Validation

- Focused source contract: 1 file, 4 tests passed.
- Strict home-fold browser matrix: 8 rows, 0 failures; 0 vertical/horizontal overflow, 0 small
  targets, 0 Axe violations, and 0 console errors.
- Full responsive shell harness: 218 metrics, 0 failures (84 desktop, 56 mobile, 40 interaction,
  30 mode-setup, 8 mobile-nav).
- `pnpm check:generated`: passed; runtime-data `2.10.0` artifacts reproduced and matched.
- Root typecheck: 9/9 tasks passed.
- Root lint: 6/6 tasks passed.
- Root test: 9/9 tasks passed. The changed web package passed 126 test files with 1 skipped, 1,316
  tests with 1 skipped, the game-flow Playwright suite, and a second
  218-metric responsive run with 0 failures.
- Root build: 5/5 tasks passed; Next generated 40/40 pages and runtime-data trace verification
  found 8/8 current-schema files in both traced routes.
- `git diff --check`: passed.

The first responsive-shell invocation was excluded because the harness correctly refused to start
beside the evidence dev server. A second invocation was excluded because a cached dependency build
had replayed logs without materializing the generated data bundle in the fresh worktree. After a
direct `@wcdraft/data` build, the authoritative responsive run passed all 218 metrics.

The build retained the repository's existing chunk-cycle and Edge-runtime static-generation
warnings. This unit does not touch the implicated bundling or runtime surfaces.

## Risk and review focus

- The CSS delta is isolated to ≤380px and to the animated preview. The reduced-motion poster and
  the 390px layout retain their exact pre-change sizes.
- Colors are unchanged, and the after matrix re-ran WCAG A/AA automation in both themes and motion
  modes.
- The hero remains exactly viewport-tall at 360×800, so reviewers should re-execute the strict
  browser matrix and inspect both 360px full-motion after screenshots for visual density.
- Playwright/Chromium evidence is not physical-device Safari evidence; U3 owns the separate WebKit
  engine gap and owner physical-iPhone residual.

## Out of scope

U1 OG hardening, U3 WebKit interaction verification, U4 copy cleanup, U5 restore rehearsal, all
core engine/data/codec semantics, and the lane's explicitly elective product backlog remain
untouched by this unit.
