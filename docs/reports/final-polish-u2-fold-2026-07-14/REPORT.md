# Final Polish U2: 360px landing fold closure

- Date: 2026-07-14
- Branch: `ws-ux/final-polish-u2-fold`
- Gate 0 base: `origin/main` at `037c45159c32a58a4b302862160873b1da296c15`
- Risk: Yellow (mobile display density only)

## Outcome

Exact fit and bottom-safe-area protection achieved. The landing page now has zero document
overflow at 360×800 and 390×844 in light and dark themes with both full and reduced motion. A
controlled 34px bottom unsafe inset also keeps all important hero content above the safe boundary
in the same matrix. No fallback threshold or Architect-delegated exception was required.

For rectangular viewports, the change remains limited to the decorative full-motion spin preview
at the existing ≤380px breakpoint. It reduces that preview from 289.53px to 260.23px by tightening
grid gaps, outer and card padding, and decorative flag/position scale. Under a nonzero bottom safe
area, the hero reserves the real `env(safe-area-inset-bottom)` and proportionally tightens only
mobile vertical rhythm; the 360px animated preview becomes 250.61px at the controlled 34px inset.
It does not change hero copy, CTA target dimensions, colors, data,
draft/simulation/rating/synergy semantics, or any U1/U3–U5 surface.

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

The strict after evidence adds the same 8 rows with a controlled 34px bottom unsafe inset. Before
the fix-forward, fresh review measured the 360×800 full-motion important-content edge at 790.83px:
24.83px inside a 34px unsafe region whose safe boundary is 766px. After the fix-forward:

| Viewport | Motion | Bottom inset | Important-content bottom | Safe boundary | Clearance | Scroll/client |
| -------- | ------ | -----------: | -----------------------: | ------------: | --------: | ------------: |
| 360×800  | Full   |         34px |                 761.67px |         766px |    4.33px |       800/800 |
| 360×800  | Reduce |         34px |                 675.06px |         766px |   90.94px |       800/800 |
| 390×844  | Full   |         34px |                 792.80px |         810px |   17.20px |       844/844 |
| 390×844  | Reduce |         34px |                 677.83px |         810px |  132.17px |       844/844 |

Values are identical across light and dark themes. Across all 16 after rows, there are zero
vertical or horizontal overflows, zero important-content safe-area crossings, zero targets below
44px, zero WCAG A/AA Axe violations, and zero console/page errors.

The mobile hero continues to use the existing URL-bar-aware and top-safe-area-aware minimum:
`calc(100svh - 3.35rem - 1px - env(safe-area-inset-top, 0px))`. The global shell retains
horizontal safe-area padding and `viewport-fit=cover`. The hero now maps
`env(safe-area-inset-bottom, 0px)` to `--home-safe-area-bottom`, reserves it with `max()`-based
bottom padding, and uses that injectable property for the rendered regression scenario. This unit
does not replace `svh` with legacy `vh` or add fixed viewport assumptions.

## Evidence

- `before/home-fold-before.json`: 8 baseline measurement rows.
- `after/home-fold-after.json`: 16 strict after measurement rows, including the controlled 34px
  safe-area scenario, important-content boundary data, Axe, target, and console data.
- `before/screenshots/`: 8 exact-viewport PNGs (both viewports, themes, and motion modes).
- `after/screenshots/`: 16 PNGs: 8 rectangular-viewport captures and 8 controlled 34px bottom-safe
  captures.
- `apps/web/scripts/verify-home-fold-browser.mts`: reproducible matrix capture and strict gate.

The baseline capture reproduced the surfaced defect before CSS was edited. The failed initial
browser attempt is excluded: the fresh worktree had not yet materialized workspace package build
outputs, so Next returned module-resolution errors before rendering the page. Dependencies were
built directly, and the untouched baseline was then captured successfully.

A fresh exact-head review at `bc336688ef66c9c58ca9c5debcb0af016e146c2a` returned FAIL on the
bottom-safe-area acceptance condition. Its report, `/tmp/finalpolish-fresh-review-u2.md`, had
SHA-256 `6ad230eb47b6ce7db42ca74185217947915d57e2f3f5483d3389540f63a8b805`. This
fix-forward treats that verdict as authoritative, adds real bottom-inset handling, and replaces
the verifier's former physical-edge-only assertion with an injected nonzero-inset boundary check.
Any final PASS remains SHA-pinned to the post-fix head and requires a new fresh-context review.

## Validation

- Focused source contract: 1 file, 5 tests passed.
- Strict home-fold browser matrix: 16 rows, 0 failures; 0 vertical/horizontal overflow, 0
  important-content safe-area crossings, 0 small targets, 0 Axe violations, and 0 console errors.
- Full responsive shell harness: 218 metrics, 0 failures (84 desktop, 56 mobile, 40 interaction,
  30 mode-setup, 8 mobile-nav).
- `pnpm check:generated`: passed; runtime-data `2.10.0` artifacts reproduced and matched.
- Root typecheck: 9/9 tasks passed.
- Root lint: 6/6 tasks passed.
- Root test: 9/9 tasks passed. The changed web package passed 126 test files with 1 skipped, 1,317
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

- The rectangular-viewport CSS delta is isolated to ≤380px and to the animated preview. The
  reduced-motion poster and 390px rectangular layout retain their exact pre-change sizes.
  Safe-area-only rhythm rules apply under ≤430px when the bottom inset is nonzero.
- Colors are unchanged, and the after matrix re-ran WCAG A/AA automation in both themes and motion
  modes.
- The hero remains exactly viewport-tall at 360×800, so reviewers should re-execute all 16 strict
  rows and inspect the 360px full-motion 34px-safe-area screenshots for visual density and final
  copy clearance.
- Playwright/Chromium evidence is not physical-device Safari evidence; U3 owns the separate WebKit
  engine gap and owner physical-iPhone residual.

## Out of scope

U1 OG hardening, U3 WebKit interaction verification, U4 copy cleanup, U5 restore rehearsal, all
core engine/data/codec semantics, and the lane's explicitly elective product backlog remain
untouched by this unit.
