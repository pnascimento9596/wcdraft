# Blind Open closeout rider — 2026-07-03

Outcome: PR #214 merged to `main` as
`7b497c9422672bedea578e926e005712951fa143` and is live on
`www.wcdraft.com`. This is a Green documentation rider for the missed closeout
entry; it does not reopen the merged RED implementation.

## Scope Recorded

- PR: #214, `feat(web): add Blind Open draft mode`.
- Branch: `ws-ux/blind-open-20260703`.
- Merge time: 2026-07-03T20:10:21Z.
- Merge commit: `7b497c9422672bedea578e926e005712951fa143`.
- Product scope: Blind Open is the fourth draft mode. It keeps Open Draft's
  full-roster choice density while hiding ratings and rating-derived signals
  until simulation.
- Contract scope: the mode is threaded through draft predicates, run-token
  replay, setup/draft UI, review blinding, post-sim reveal, share/OG labels,
  and leaderboard exclusion.

## PR Validation Record

The merged PR recorded these gates:

- `pnpm install --frozen-lockfile`.
- Focused core checks for open draft and run-token behavior; the core test
  script ran all core tests: 26 files, 391 tests passed.
- Core/data/web prerequisite builds before web tests.
- Focused web Vitest: memory hidden mode, run-token, share-adapter intent, and
  leaderboard validation: 4 files, 108 tests passed.
- `@wcdraft/marketing-x` tests: 8 files, 68 tests passed.
- Root gates: typecheck 8 tasks, lint 5 tasks, test 8 tasks, build 4 tasks.
  The PR body recorded web at 83 files passed / 902 tests passed / 1 skipped
  and core at 26 files passed / 391 tests passed.
- Golden gates: core RNG/narrative + draft goldens, data compact/integration
  goldens, and web leaderboard golden.
- Fresh detached review clone re-ran focused core/web checks, marketing tests,
  full web tests, and the game-flow Playwright smoke.

Heavy realism was not run for PR #214 because the diff did not change
`packages/data`, ETL, rating, sim, engine, scoring, or runtime-data artifacts.

## Live Verification

Live check date: 2026-07-03.

Commands/evidence:

- `curl -fsSLI https://www.wcdraft.com/play` returned `HTTP/2 200` from Vercel
  with `x-matched-path: /play`.
- A Playwright mobile check at 390x844 opened
  `https://www.wcdraft.com/play`, waited for `Blind Open`, found three visible
  `Blind Open` text matches, and captured the mode-card text:
  `04 Casual Blind Open Pick any player from the drawn nation, ratings hidden.
Casual, not ranked. BLIND OPEN · CASUAL Full roster Ratings hidden Shareable
Blind Open ->`.
- The same browser check opened the mobile menu and read
  `build 7b497c9 · 2026-07-03`.
- Browser errors during that check: none.

## Risks / Carryovers

- This rider is documentation-only. It does not modify the shipped Blind Open
  implementation.
- The public page exposes the short build stamp, not a full commit SHA. The
  full SHA is anchored by the merged PR metadata; the live surface proves the
  deployed build stamp is the merged short SHA.
- Blind Open remains leaderboard-ineligible by design, matching the PR's review
  focus and validation record.
