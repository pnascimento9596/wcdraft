# Daily fronting / OG craft — local implementation report

Date: 2026-06-29
Branch: `ws-ux/daily-fronting-og-craft-20260629`
Base after rebase: `33fff71c437c2d64eddddf9c956da8341f7c51fe`
Scope: Yellow `apps/web` PWA/UI lane

## Outcome

Implemented locally. Not shipped yet at the time this report was written.

## What changed

- Fronted Daily Draft across the home hero, mobile/desktop nav, `/play` mode selection, and `how-to-play`.
- Removed the interrupting daily upsell banner from the regular `/play` setup path.
- Refined daily leaderboard copy with a UTC reset note, daily CTA, empty-state cross-links, and daily rows that lead with `Top X%` while keeping raw points visible.
- Extended submit success/duplicate client state to display already-returned `rank`, `percentile`, and `field_size` values without changing submit-route or board-route contracts.
- Updated daily share copy to include raw score and, only when uniquely recoverable from the public daily board after a known local submission, rank/percentile standing.
- Shared the run card palette between in-app share preview and OG rendering; lineup shapes still encode position while fills now use provenance hues.
- Added a shared game Suspense/loading fallback with status semantics, hardened global error theming, and removed fabricated null fallbacks for missing champion state / primary position.
- Capped the `apps/web` Vitest fork pool at 4 workers after proving unbounded fork startup could starve unrelated PGlite/route tests on a loaded runner.

## Scope guard

- No leaderboard server route, submit route, store, season, migration, engine, ETL, compact data, or rating contract changes.
- `apps/web/lib/leaderboard/submit-state.ts` reads fields already present in the existing successful submit response body.
- Daily share standing lookup is intentionally conservative: if the board score match is not unique, standing copy is omitted instead of inferred.

## Visual proof

Browser proof file:
`docs/reports/daily-fronting-og-craft-2026-06-29/local-browser-proof.json`

Screenshot set:
`docs/reports/daily-fronting-og-craft-2026-06-29/screenshots/`

Recorded proof:

- 28 mobile screenshots: light/dark × 360x800/390x844 × home, home menu, mode select, daily setup, daily leaderboard empty, daily leaderboard populated, how-to-play daily.
- 1 OG image screenshot: `screenshots/og-card-provenance.png`.
- axe violations: 0.
- contrast failures: 0.
- overflow failures: 0.
- page errors: 0.
- console errors: 0.
- HTTP errors: 0.

## Fresh-context review

Report:
`docs/reports/daily-fronting-og-craft-2026-06-29/fresh-context-review.md`

Result: no blockers found.

Reviewer fresh-cloned the repo, checked out base `acc0a82f4b768f7938e2cd4d116109d15d8809ce`, applied `/tmp/wcdraft-daily-fronting-og-craft-apps-web.patch`, inspected the actual diff, and re-ran focused gates.

Note: this review was performed before rebasing onto `33fff71c437c2d64eddddf9c956da8341f7c51fe`; the rebase conflict was isolated to `STATE.md`, and final local gates were rerun after the rebase.

Fresh-review gates:

- `pnpm exec turbo run build --filter=@wcdraft/core --filter=@wcdraft/data --filter=@wcdraft/db`: PASS, 3/3 tasks.
- `pnpm --filter @wcdraft/web typecheck`: PASS.
- Focused Vitest set including leaderboard UI/submit state, share adapters, OG, PWA fallback, server history, and contrast tokens: PASS, 7 files / 106 tests.

## Local gates

Completed:

- `pnpm exec turbo run build --filter=@wcdraft/core --filter=@wcdraft/data --filter=@wcdraft/db`: PASS, 3/3 tasks.
- `pnpm --filter @wcdraft/web typecheck`: PASS.
- Focused web Vitest after final scope fix: PASS, 2 files / 50 tests.
- `pnpm run format:check`: PASS.
- Root `pnpm typecheck`: PASS, 8/8 tasks.
- Root `pnpm lint`: PASS, 5/5 tasks.
- Root `pnpm test`: PASS, 8/8 tasks; web Vitest 71 files passed / 1 skipped, 776 tests passed / 1 skipped; `game-flow-playwright` PASS.
- Root `pnpm build`: PASS, 4/4 tasks. Existing Next chunk circular-dependency warnings and edge-runtime static-generation warning were observed.
- `pnpm exec turbo run test:golden:leaderboard --filter=@wcdraft/web`: PASS, 4/4 tasks; golden file 1 passed / 6 tests.
- Browser screenshot/axe/contrast/overflow proof: PASS, zero failures.
- `git diff --check`: PASS.

Pending before ship:

- PR creation, CI, merge, production deploy wait, and live production verification.

## Risks / carryovers

- Daily share standing can be omitted for valid submitted runs if the public board has multiple entries with the same score. This is intentional: it preserves honest copy rather than guessing identity from public data.
- `is_champion` and primary-position missing data are now represented as null at the view boundary where the upstream state is genuinely unknown. Components were updated to render those states explicitly.
