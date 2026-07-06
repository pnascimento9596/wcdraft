# Desktop responsive pass - 2026-07-06

Branch: `ws-ux/desktop-responsive-20260706`
Base: `origin/main` at `1274ff9b8cf3c36831be145fcff42e13d7bd48c5`

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
- visible target size
- axe `wcag2a`/`wcag2aa`
- console/page errors
- desktop layout signals for draft, review, results, leaderboard, and mode grid

## Results

| Phase | Server | Metrics | Failures | Output |
| --- | --- | ---: | ---: | --- |
| baseline | `next dev` | 80 | 10 | `docs/reports/desktop-responsive-2026-07-06/baseline/` |
| final | `next dev` | 80 | 0 | `docs/reports/desktop-responsive-2026-07-06/final/` |
| prod | `next start` from production build | 80 | 0 | `docs/reports/desktop-responsive-2026-07-06/prod/` |

Baseline failures were all the same home-page dev console warning from the JSON-LD script nonce hydration mismatch. The fix adds `suppressHydrationWarning` to that non-interactive structured-data script; the final strict run no longer filters that warning and passes with zero console errors.

Representative production `1440x900` dark signals:

| Surface | Max container | Desktop signal |
| --- | ---: | --- |
| mode-select | 1408px | 3-column mode grid |
| draft-lineup | 1408px | formation and candidates side by side |
| squad-review | 1408px | XI and review rail side by side |
| results | 1408px | outcome and narrative/context side by side |
| leaderboard | 1408px | lineup inspector wide layout |

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
- No live production verification has been run from this worktree yet.
