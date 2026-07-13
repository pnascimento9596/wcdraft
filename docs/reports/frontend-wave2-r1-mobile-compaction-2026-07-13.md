# Frontend Wave 2 R1: mobile compaction evidence

- Date: 2026-07-13
- Branch: `ws-ux/mobile-compaction-r1`
- Base at Gate 0: `origin/main` at `2add71b2e5daf0e7305350e8144b9860e8cb67c2`
- Season collision reference: `origin/season/squad-depth` at
  `98c0e07abd992b624cf44e500ad6b2199c5a25d3`

## Outcome

The landing hero and available-mode selection now fit the full rendered mobile viewport at
390×844 and 360×800 in both light and dark themes. All landing content and all five mode
choices remain present; the implementation adds no accordion, disclosure step, or hidden
content. Existing full-card targets and the dock action remain at least 44px tall.

This is a scoped Yellow-tier implementation and evidence report. It is not a merge or a live
production verification. Independent fresh-context review remains required before merge.

## Scope and collision gate

Gate 0 used:

```sh
git fetch --all --prune
git diff --name-only origin/main...origin/season/squad-depth
```

The exact 58-path Season denylist is committed beside this report as
`frontend-wave2-r1-mobile-compaction-2026-07-13/collision-denylist.txt`. None of this unit's
changed paths intersects that denylist. In particular, this unit does not change `STATE.md`,
workflow configuration, simulation/runtime code, leaderboard validation, `packages/core`, or
`packages/data`.

Implemented scope:

- Mobile-only landing hero density and spin-poster density.
- Mobile-only mode-page heading, progress band, cards, grid, and safe-area-aware dock spacing.
- Safe small-viewport sizing based on `100svh`, the fixed masthead, and the top safe-area inset.
- A focused source contract test plus rendered responsive evidence.

Deliberately deferred:

- The R2 ghost-numeral/pill collision work.
- Global tap-target work, copy changes, logo work, desktop redesign, and any Season-lane path.
- Hardware iOS Safari and production checks; this branch must not merge as part of R1 delivery.

## Design decisions

Compaction is preferable to progressive disclosure here. Showing Daily plus all four repeatable
modes preserves instant comparison and the existing interaction model. The layout therefore
reduces internal padding, type size, decorative preview height, and inter-card gaps while keeping
each mode card as a large target.

The landing hero keeps every existing content block. Its statistics become one full-width item
plus a two-column row on mobile, which reduces vertical travel without losing information. The
spin poster is proportionally tightened rather than removed.

Both scoped surfaces use:

```css
calc(100svh - 3.35rem - 1px - env(safe-area-inset-top, 0px))
```

The expression accounts for the mobile masthead, its border, and the top safe area. The existing
site viewport configuration and masthead safe-area handling remain unchanged. The mode dock also
retains bottom-safe-area padding.

## Rendered before/after measurements

Measurements come from the repository's responsive-shell Playwright harness against a local
production-equivalent Next.js render. Screenshots are Chromium renders at the exact CSS viewport
dimensions and DPR 1; they are not claimed as physical-device Safari captures.

| Surface        | Viewport | Before scroll/client | After scroll/client | Vertical reduction | Horizontal overflow | Targets under 44px | Axe violations | Console errors |
| -------------- | -------: | -------------------: | ------------------: | -----------------: | ------------------- | -----------------: | -------------: | -------------: |
| Landing        |  390×844 |              990/844 |             844/844 |              146px | No                  |                  0 |              0 |              0 |
| Landing        |  360×800 |              972/800 |             800/800 |              172px | No                  |                  0 |              0 |              0 |
| Mode selection |  390×844 |              876/844 |             844/844 |               32px | No                  |                  0 |              0 |              0 |
| Mode selection |  360×800 |              874/800 |             800/800 |               74px | No                  |                  0 |              0 |              0 |

The figures are identical in light and dark themes. The mode dock improved from 56px/88px
initial/terminal clearance at 390×844 and 14px/88px at 360×800 to a stable 87px/87px at both
viewports and in both themes. The primary action remained in the viewport for all eight final
captures.

Machine-readable results and all 16 PNGs are committed under:

- `frontend-wave2-r1-mobile-compaction-2026-07-13/before/`
- `frontend-wave2-r1-mobile-compaction-2026-07-13/after/`

The final screenshots are exactly 390×844 or 360×800. The taller baseline files intentionally
preserve the pre-change full-page scroll height.

## Validation

Final clean gates:

- Focused responsive evidence: 8 metrics, 0 harness failures; 0 horizontal overflows, 0 targets
  under 44px, 0 Axe violations, and 0 console errors.
- `pnpm --filter @wcdraft/web test:responsive:shell`: 218 metrics, 0 failures
  (84 desktop, 56 mobile, 40 interaction, 30 mode-setup, 8 mobile-nav).
- Focused Vitest (`mobile-compaction` plus tap stability): 2 files, 16 tests passed.
- Full web Vitest: 112 files passed and 1 skipped; 1,171 tests passed and 1 skipped.
- Root typecheck: 9/9 tasks passed.
- Root lint: 6/6 tasks passed.
- Root build: 5/5 tasks passed; Next.js generated 40/40 pages.
- `git diff --check`: passed.

The root test command's first composite attempt was interrupted when an active responsive-harness
Chrome process was terminated during concurrent agent work. That produced a browser-closed error,
not an assertion failure. The affected responsive suite was then rerun cleanly and passed all 218
metrics; the remaining package and game-flow suites passed, and full web Vitest was also rerun
cleanly. This report does not represent the interrupted composite invocation as a green command.

The build retained pre-existing chunk-cycle and Edge-runtime static-generation warnings; this unit
does not touch the implicated bundling/runtime surfaces.

## Risks and review focus

- The compaction is intentionally concentrated under 430px. Review should compare 360px and 390px
  screenshots for readability as well as raw fit.
- Source-contract tests protect the `100svh`/safe-area and no-disclosure decisions, while the real
  responsive harness supplies the behavioral fit, target-size, overflow, accessibility, and
  console checks.
- Live iOS browser chrome can differ from Chromium emulation. A merge owner should perform the
  normal production mobile sanity after Yellow-tier approval and deployment.
