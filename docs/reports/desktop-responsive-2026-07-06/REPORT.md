# Desktop responsive pass - 2026-07-06

Branch: `ws-ux/desktop-responsive-20260706`
Initial baseline base: `origin/main` at `1274ff9b8cf3c36831be145fcff42e13d7bd48c5`
Final integration base after rebase: `origin/main` at `09e1769461b65a49839ea0da61f21f8ae55cafb9`

## Scope

Yellow layout-only pass to make wide viewports first-class while preserving the locked mobile work from the prior compact/mobile pass.

Changed surfaces:

- Home hero and wide container sizing.
- Mode select card grid and desktop CTA placement.
- Draft lineup, review, results, history, leaderboard, and account desktop layout.
- Responsive audit harness for the requested viewport/theme matrix.

No rating, sim, API, schema, persistence, or leaderboard scoring logic changed.

## Responsive matrix

Surfaces:

- `home`
- `mode-select`
- `draft-lineup`
- `squad-review`
- `results`
- `history`
- `leaderboard`
- `how-to-play`

Viewports:

- `1280x800`
- `1440x900`
- `1920x1080`
- `390x844`
- `360x800`

Themes:

- `light`
- `dark`

Checks per capture:

- screenshot
- horizontal overflow
- desktop nav wrapping
- axe `wcag2a`/`wcag2aa`
- console/page errors
- desktop layout signals for draft, review, results, leaderboard, and mode grid

Telemetry recorded per capture but not treated as a strict failure in this desktop pass:

- compact interactive target sizes

## Results

| Phase    | Server                             | Metrics | Failures | Output                                                 |
| -------- | ---------------------------------- | ------: | -------: | ------------------------------------------------------ |
| baseline | `next dev`                         |      80 |       10 | `docs/reports/desktop-responsive-2026-07-06/baseline/` |
| final    | `next dev`                         |      80 |        0 | `docs/reports/desktop-responsive-2026-07-06/final/`    |
| prod     | `next start` from production build |      80 |        0 | `docs/reports/desktop-responsive-2026-07-06/prod/`     |

The baseline captures were taken on the initial lane base before #217 landed. The final and prod
captures were refreshed after rebasing onto #217, so the shipped evidence includes the current globe
pennant logo/header system.

Baseline failures were all the same home-page dev console warning from the JSON-LD script nonce hydration mismatch. The fix adds `suppressHydrationWarning` to that non-interactive structured-data script; the final strict run no longer filters that warning and passes with zero console errors.

Representative production `1440x900` dark signals:

| Surface      | Max container | Desktop signal                             |
| ------------ | ------------: | ------------------------------------------ |
| mode-select  |        1408px | 3-column mode grid                         |
| draft-lineup |        1408px | formation and candidates side by side      |
| squad-review |        1408px | XI and review rail side by side            |
| results      |        1408px | outcome and narrative/context side by side |
| leaderboard  |        1408px | lineup inspector wide layout               |

## Gates

- `pnpm --filter @wcdraft/web typecheck` - pass
- `pnpm --filter @wcdraft/web lint` - pass
- `pnpm --filter @wcdraft/web test` - pass: 83 files passed, 1 skipped; 904 tests passed, 1 skipped; `game-flow-playwright` passed
- `pnpm typecheck` - pass: 8 tasks successful
- `pnpm lint` - pass: 5 tasks successful
- `pnpm test` - pass: 8 tasks successful
- `pnpm build` - pass: 4 tasks successful
- `WCDRAFT_RESPONSIVE_STRICT=1 ... next dev ... verify-responsive-layout-browser.mts` - pass: 80 metrics, 0 failures
- `WCDRAFT_RESPONSIVE_STRICT=1 WCDRAFT_HIDE_DEV_OVERLAY=0 ... next start ... verify-responsive-layout-browser.mts` - pass: 80 metrics, 0 failures
- After rebasing onto `09e1769461b65a49839ea0da61f21f8ae55cafb9`, reran `pnpm typecheck`,
  `pnpm lint`, `pnpm test`, `pnpm build`, final `next dev` responsive audit, and prod
  `next start` responsive audit - all pass

Build notes:

- `next build --webpack` emitted existing warnings about circular chunk dependencies and edge runtime disabling static generation for edge pages. The build completed successfully.

## Visual review notes

- Home now uses a wider two-column desktop hero with the next section visible below the fold.
- Mode select no longer has the sticky desktop CTA overlapping the lower cards; mobile retains the sticky CTA behavior.
- Draft lineup desktop now keeps the formation and candidate list visible together while preserving the mobile candidate-first reveal order.
- Review desktop now keeps the final XI visible with ratings, warnings, and simulate actions in a right rail.
- Results desktop now pairs the outcome with progress/narrative context, then lets match details, submit, and seed/actions use the full width.
- Leaderboard inspector now uses the wider board area for pitch/manager plus metrics/bench.
- How-to-play remains readable-width through `container--narrow`.

## Carryovers

- Account page desktop CSS was improved, but the responsive harness does not authenticate a local account session. Account remains covered by typecheck/build and CSS inspection, not seeded browser screenshots.
- The audit records compact interactive target sizes for follow-up triage, but this lane gates responsive regressions on horizontal overflow, nav wrapping, axe violations, console/page errors, and the desktop layout signals above.
- No live production verification has been run from this worktree yet.

## 2026-07-06 viewport-fit supplement

Branch: `ws-ux/desktop-viewport-fit-20260706`
Base: `origin/main` at `61f9905d6aecf33b2e59e542d61d4fba51b80088`
Worktree: `/tmp/wcdraft-desktop-viewport-fit-20260706`

### Scope

This supplement covers the owner-reported desktop/laptop no-scroll problem for in-run draft surfaces. It keeps the previous broad desktop responsive pass above intact, but extends the audit to the explicit shell surfaces and the additional requested pages. Changes remain layout-only: no core, rating, sim, schema, API, persistence, token, or leaderboard scoring code changed.

### What changed

- Added desktop-only shell markers for spin and review surfaces, with global shell height rules behind `@media (min-width: 64rem)`.
- Reworked desktop spin into a horizontal reel/result/CTA composition so the owner-reported 1440x900 stage no longer requires scrolling.
- Constrained pick/assign and roster lists to internal pane scrolling while keeping the page frame fixed at desktop sizes.
- Reworked squad review desktop grid rows so the pitch, metrics, warnings, and simulate CTA fit inside the shell with internal panel scroll where needed.
- Reworked the share-author content page into a desktop card/actions two-column layout so copy/share controls are above the 1280x800 fold.
- Fixed the auth-disabled sign-up heading so the long title wraps inside the desktop column instead of clipping.
- Extended `apps/web/scripts/verify-responsive-layout-browser.mts` with `1512x982`, route filters, seeded run states for all shell modes, desktop shell no-scroll assertions, primary-action measurements, and route-aware handling for the intentional 404 probe.
- Added `apps/web/scripts/test-responsive-shell-fit.mts` and wired it into `@wcdraft/web`'s `test` script so the desktop shell assertion runs in the same scripted gate family as the existing Playwright game-flow/mobile proof.

### Shell gate

Desktop shell rule: `documentHeight <= viewportHeight` and the configured primary action bounding box must be fully inside the viewport. The rule applies to desktop/laptop viewports (width >= 1024) and is recorded as `n-a` for mobile regression rows so the existing mobile lock remains covered by its own flow/tap gates.

| Surface                | Rows | Gate | Worst scroll delta | Primary fully visible |
| ---------------------- | ---: | ---- | -----------------: | --------------------- |
| daily-spin             |    8 | pass |                0px | yes                   |
| spin-stage             |    8 | pass |                0px | yes                   |
| position-target        |    8 | pass |                0px | yes                   |
| classic-pick           |    8 | pass |                0px | yes                   |
| open-roster-pick       |    8 | pass |                0px | yes                   |
| blind-open-roster-pick |    8 | pass |                0px | yes                   |
| squad-review           |    8 | pass |                0px | yes                   |

### Full triage table

Final strict desktop audit: `docs/reports/desktop-responsive-2026-07-06/desktop-fit-final/responsive-desktop-fit-final.json`

| Route                                              | Viewport  | No-scroll gate | Primary above fold | Wasted-space verdict | Fix applied                                              |
| -------------------------------------------------- | --------- | -------------- | ------------------ | -------------------- | -------------------------------------------------------- |
| home /                                             | 1280x800  | n-a            | y                  | ok                   | none; cleared                                            |
| home /                                             | 1440x900  | n-a            | y                  | ok                   | none; cleared                                            |
| home /                                             | 1512x982  | n-a            | y                  | ok                   | none; cleared                                            |
| home /                                             | 1920x1080 | n-a            | y                  | ok                   | none; cleared                                            |
| mode select /play                                  | 1280x800  | n-a            | y                  | ok                   | cleared: visible radio-card action measured above fold   |
| mode select /play                                  | 1440x900  | n-a            | y                  | ok                   | cleared: visible radio-card action measured above fold   |
| mode select /play                                  | 1512x982  | n-a            | y                  | ok                   | cleared: visible radio-card action measured above fold   |
| mode select /play                                  | 1920x1080 | n-a            | y                  | ok                   | cleared: visible radio-card action measured above fold   |
| setup /play/draft                                  | 1280x800  | n-a            | y                  | ok                   | none; cleared                                            |
| setup /play/draft                                  | 1440x900  | n-a            | y                  | ok                   | none; cleared                                            |
| setup /play/draft                                  | 1512x982  | n-a            | y                  | ok                   | none; cleared                                            |
| setup /play/draft                                  | 1920x1080 | n-a            | y                  | ok                   | none; cleared                                            |
| daily spin /play/daily                             | 1280x800  | pass           | y                  | ok                   | desktop shell marker + spin two-column composition       |
| daily spin /play/daily                             | 1440x900  | pass           | y                  | ok                   | desktop shell marker + spin two-column composition       |
| daily spin /play/daily                             | 1512x982  | pass           | y                  | ok                   | desktop shell marker + spin two-column composition       |
| daily spin /play/daily                             | 1920x1080 | pass           | y                  | ok                   | desktop shell marker + spin two-column composition       |
| spin stage /play/draft?run=classic                 | 1280x800  | pass           | y                  | ok                   | fixed: two-column reel/result/CTA shell                  |
| spin stage /play/draft?run=classic                 | 1440x900  | pass           | y                  | ok                   | fixed: two-column reel/result/CTA shell                  |
| spin stage /play/draft?run=classic                 | 1512x982  | pass           | y                  | ok                   | fixed: two-column reel/result/CTA shell                  |
| spin stage /play/draft?run=classic                 | 1920x1080 | pass           | y                  | ok                   | fixed: two-column reel/result/CTA shell                  |
| position target /play/draft?run=position_first     | 1280x800  | pass           | y                  | ok                   | fixed: desktop shell page frame                          |
| position target /play/draft?run=position_first     | 1440x900  | pass           | y                  | ok                   | fixed: desktop shell page frame                          |
| position target /play/draft?run=position_first     | 1512x982  | pass           | y                  | ok                   | fixed: desktop shell page frame                          |
| position target /play/draft?run=position_first     | 1920x1080 | pass           | y                  | ok                   | fixed: desktop shell page frame                          |
| classic pick /play/draft?run=classic               | 1280x800  | pass           | y                  | ok                   | fixed: page frame locked, candidate pane internal scroll |
| classic pick /play/draft?run=classic               | 1440x900  | pass           | y                  | ok                   | fixed: page frame locked, candidate pane internal scroll |
| classic pick /play/draft?run=classic               | 1512x982  | pass           | y                  | ok                   | fixed: page frame locked, candidate pane internal scroll |
| classic pick /play/draft?run=classic               | 1920x1080 | pass           | y                  | ok                   | fixed: page frame locked, candidate pane internal scroll |
| open roster pick /play/draft?run=open              | 1280x800  | pass           | y                  | ok                   | fixed: roster pane internal scroll                       |
| open roster pick /play/draft?run=open              | 1440x900  | pass           | y                  | ok                   | fixed: roster pane internal scroll                       |
| open roster pick /play/draft?run=open              | 1512x982  | pass           | y                  | ok                   | fixed: roster pane internal scroll                       |
| open roster pick /play/draft?run=open              | 1920x1080 | pass           | y                  | ok                   | fixed: roster pane internal scroll                       |
| blind-open roster pick /play/draft?run=open_hidden | 1280x800  | pass           | y                  | ok                   | fixed: roster pane internal scroll                       |
| blind-open roster pick /play/draft?run=open_hidden | 1440x900  | pass           | y                  | ok                   | fixed: roster pane internal scroll                       |
| blind-open roster pick /play/draft?run=open_hidden | 1512x982  | pass           | y                  | ok                   | fixed: roster pane internal scroll                       |
| blind-open roster pick /play/draft?run=open_hidden | 1920x1080 | pass           | y                  | ok                   | fixed: roster pane internal scroll                       |
| squad review /play/review                          | 1280x800  | pass           | y                  | ok                   | fixed: grid rows + internal panel scroll                 |
| squad review /play/review                          | 1440x900  | pass           | y                  | ok                   | fixed: grid rows + internal panel scroll                 |
| squad review /play/review                          | 1512x982  | pass           | y                  | ok                   | fixed: grid rows + internal panel scroll                 |
| squad review /play/review                          | 1920x1080 | pass           | y                  | ok                   | fixed: grid rows + internal panel scroll                 |
| results /play/results                              | 1280x800  | n-a            | y                  | ok                   | none; cleared                                            |
| results /play/results                              | 1440x900  | n-a            | y                  | ok                   | none; cleared                                            |
| results /play/results                              | 1512x982  | n-a            | y                  | ok                   | none; cleared                                            |
| results /play/results                              | 1920x1080 | n-a            | y                  | ok                   | none; cleared                                            |
| share author /play/share                           | 1280x800  | n-a            | y                  | ok                   | fixed: desktop card/actions two-column layout            |
| share author /play/share                           | 1440x900  | n-a            | y                  | ok                   | fixed: desktop card/actions two-column layout            |
| share author /play/share                           | 1512x982  | n-a            | y                  | ok                   | fixed: desktop card/actions two-column layout            |
| share author /play/share                           | 1920x1080 | n-a            | y                  | ok                   | fixed: desktop card/actions two-column layout            |
| history /play/history                              | 1280x800  | n-a            | y                  | ok                   | none; cleared                                            |
| history /play/history                              | 1440x900  | n-a            | y                  | ok                   | none; cleared                                            |
| history /play/history                              | 1512x982  | n-a            | y                  | ok                   | none; cleared                                            |
| history /play/history                              | 1920x1080 | n-a            | y                  | ok                   | none; cleared                                            |
| leaderboard /leaderboard?challenge=season          | 1280x800  | n-a            | y                  | ok                   | none; cleared                                            |
| leaderboard /leaderboard?challenge=season          | 1440x900  | n-a            | y                  | ok                   | none; cleared                                            |
| leaderboard /leaderboard?challenge=season          | 1512x982  | n-a            | y                  | ok                   | none; cleared                                            |
| leaderboard /leaderboard?challenge=season          | 1920x1080 | n-a            | y                  | ok                   | none; cleared                                            |
| how-to-play /how-to-play                           | 1280x800  | n-a            | y                  | ok                   | none; cleared                                            |
| how-to-play /how-to-play                           | 1440x900  | n-a            | y                  | ok                   | none; cleared                                            |
| how-to-play /how-to-play                           | 1512x982  | n-a            | y                  | ok                   | none; cleared                                            |
| how-to-play /how-to-play                           | 1920x1080 | n-a            | y                  | ok                   | none; cleared                                            |
| account /account                                   | 1280x800  | n-a            | n/a                | ok                   | none; cleared                                            |
| account /account                                   | 1440x900  | n-a            | n/a                | ok                   | none; cleared                                            |
| account /account                                   | 1512x982  | n-a            | n/a                | ok                   | none; cleared                                            |
| account /account                                   | 1920x1080 | n-a            | n/a                | ok                   | none; cleared                                            |
| sign-in /sign-in                                   | 1280x800  | n-a            | n/a                | ok                   | none; cleared                                            |
| sign-in /sign-in                                   | 1440x900  | n-a            | n/a                | ok                   | none; cleared                                            |
| sign-in /sign-in                                   | 1512x982  | n-a            | n/a                | ok                   | none; cleared                                            |
| sign-in /sign-in                                   | 1920x1080 | n-a            | n/a                | ok                   | none; cleared                                            |
| sign-up /sign-up                                   | 1280x800  | n-a            | n/a                | ok                   | fixed: long auth title wraps inside column               |
| sign-up /sign-up                                   | 1440x900  | n-a            | n/a                | ok                   | fixed: long auth title wraps inside column               |
| sign-up /sign-up                                   | 1512x982  | n-a            | n/a                | ok                   | fixed: long auth title wraps inside column               |
| sign-up /sign-up                                   | 1920x1080 | n-a            | n/a                | ok                   | fixed: long auth title wraps inside column               |
| settings /settings                                 | 1280x800  | n-a            | y                  | ok                   | none; cleared                                            |
| settings /settings                                 | 1440x900  | n-a            | y                  | ok                   | none; cleared                                            |
| settings /settings                                 | 1512x982  | n-a            | y                  | ok                   | none; cleared                                            |
| settings /settings                                 | 1920x1080 | n-a            | y                  | ok                   | none; cleared                                            |
| privacy /privacy                                   | 1280x800  | n-a            | n/a                | ok                   | none; cleared                                            |
| privacy /privacy                                   | 1440x900  | n-a            | n/a                | ok                   | none; cleared                                            |
| privacy /privacy                                   | 1512x982  | n-a            | n/a                | ok                   | none; cleared                                            |
| privacy /privacy                                   | 1920x1080 | n-a            | n/a                | ok                   | none; cleared                                            |
| 404 /definitely-not-a-wcdraft-route                | 1280x800  | n-a            | y                  | ok                   | cleared: route-aware expected 404 allow-list             |
| 404 /definitely-not-a-wcdraft-route                | 1440x900  | n-a            | y                  | ok                   | cleared: route-aware expected 404 allow-list             |
| 404 /definitely-not-a-wcdraft-route                | 1512x982  | n-a            | y                  | ok                   | cleared: route-aware expected 404 allow-list             |
| 404 /definitely-not-a-wcdraft-route                | 1920x1080 | n-a            | y                  | ok                   | cleared: route-aware expected 404 allow-list             |

### Screenshot evidence

| Surface                | Before                                                                                                                                         | After                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| spin stage             | owner screenshot on file; old harness did not directly capture spin-stage                                                                      | `docs/reports/desktop-responsive-2026-07-06/desktop-fit-final/screenshots/desktop-fit-final-spin-stage-1440x900-light.png`             |
| pick/assign            | prior generic draft-lineup capture: `docs/reports/desktop-responsive-2026-07-06/baseline/screenshots/baseline-draft-lineup-1440x900-light.png` | `docs/reports/desktop-responsive-2026-07-06/desktop-fit-final/screenshots/desktop-fit-final-classic-pick-1440x900-light.png`           |
| open roster pick       | prior generic draft-lineup capture: `docs/reports/desktop-responsive-2026-07-06/baseline/screenshots/baseline-draft-lineup-1440x900-light.png` | `docs/reports/desktop-responsive-2026-07-06/desktop-fit-final/screenshots/desktop-fit-final-open-roster-pick-1440x900-light.png`       |
| blind-open roster pick | prior generic draft-lineup capture: `docs/reports/desktop-responsive-2026-07-06/baseline/screenshots/baseline-draft-lineup-1440x900-light.png` | `docs/reports/desktop-responsive-2026-07-06/desktop-fit-final/screenshots/desktop-fit-final-blind-open-roster-pick-1440x900-light.png` |
| squad review           | `docs/reports/desktop-responsive-2026-07-06/baseline/screenshots/baseline-squad-review-1440x900-light.png`                                     | `docs/reports/desktop-responsive-2026-07-06/desktop-fit-final/screenshots/desktop-fit-final-squad-review-1440x900-light.png`           |
| share author           | `docs/reports/desktop-responsive-2026-07-06/viewport-fit-before/share-author-1280x800-light.png`                                               | `docs/reports/desktop-responsive-2026-07-06/desktop-fit-final/screenshots/desktop-fit-final-share-author-1280x800-light.png`           |
| sign-up auth-disabled  | previous final capture clipped the H1 at 1280x800                                                                                              | `docs/reports/desktop-responsive-2026-07-06/desktop-fit-final/screenshots/desktop-fit-final-sign-up-1280x800-light.png`                |

### Validation recorded so far

| Gate                              | Result | Evidence                                                                                                                                                      |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| package data/core/db build prereq | pass   | `pnpm exec turbo run build --filter=@wcdraft/core --filter=@wcdraft/data --filter=@wcdraft/db`                                                                |
| web typecheck                     | pass   | `pnpm --filter @wcdraft/web exec tsc --noEmit`                                                                                                                |
| desktop shell targeted audit      | pass   | `shell-iter1`: 56 metrics, 0 failures                                                                                                                         |
| desktop final strict audit        | pass   | `desktop-fit-final`: 168 metrics, 0 failures                                                                                                                  |
| mobile shell regression audit     | pass   | `mobile-shell-strict`: 28 metrics, 0 failures                                                                                                                 |
| responsive shell CI gate          | pass   | `pnpm --filter @wcdraft/web run test:responsive:shell`: desktop shell 56 metrics / 0 failures; mobile shell 28 metrics / 0 failures                           |
| format check                      | pass   | `pnpm run format:check`                                                                                                                                       |
| root typecheck                    | pass   | `pnpm typecheck`: 8 tasks successful                                                                                                                          |
| root lint                         | pass   | `pnpm lint`: 5 tasks successful                                                                                                                               |
| root test                         | pass   | `pnpm test`: 8 tasks successful; web Vitest 83 files passed, 1 skipped; 904 tests passed, 1 skipped; `game-flow-playwright` and `responsive-shell-fit` passed |
| root build                        | pass   | `pnpm build`: 4 tasks successful; existing Next circular chunk / edge static-generation warnings only                                                         |
| fresh-context review              | pass   | reviewer reran web typecheck, desktop shell audit 56 metrics / 0 failures, mobile shell audit 28 metrics / 0 failures, and visual inspection                  |

Remaining before ship: merge/deploy and live production verification.
