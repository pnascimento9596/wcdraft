# Leaderboard profiles L4 — board display + privacy sweep

Branch: `ws-leaderboard/privacy-sweep`
Base: `origin/leaderboard-profiles` `d6569175ac5256a61df5a6e1dd731c317b4f11a4`
Risk tier: Red

## Scope result

L4 is test/proof-only on top of the L1-L3 integration branch. No schema,
migration, core engine, data bundle, or golden fixture files were modified or
regenerated. The board UI already rendered rank, public name, score, lane, and
relative date from server rows; this unit pins the privacy and rendering
contracts with broader negative coverage.

## Changes

- Added `public-payload-email-sweep.test.ts`, which seeds real private email
  addresses and verifies public payloads do not serialize them across:
  - auth config / csrf / session
  - magic-link request response
  - verify interstitial
  - profile GET
  - saved-run list/detail/claim responses
  - leaderboard Classic and Memory board reads
  - leaderboard `/me`
  - ranked submit response
- Extended the UI render tests to prove username/alias text is React-escaped
  and that the profile/leaderboard identity surfaces do not use
  `dangerouslySetInnerHTML`.
- Captured deterministic local Playwright screenshots with mocked board API
  responses so the images prove rows without touching any database.

## Validation

- Focused L4 suite:
  - `pnpm --filter @wcdraft/web exec vitest run lib/leaderboard/__tests__/public-payload-email-sweep.test.ts lib/leaderboard/__tests__/ui-gating.test.ts`
  - Result: 2 files, 37 tests passed.
- Full web package:
  - `pnpm --filter @wcdraft/web test`
  - Result: 57 files passed, 1 skipped; 653 passed, 1 skipped.
  - `pnpm --filter @wcdraft/web typecheck` passed.
  - `pnpm --filter @wcdraft/web lint` passed.
  - `pnpm --filter @wcdraft/web build` passed; only the existing
    Next/Webpack circular chunk warnings appeared.
- Leaderboard golden:
  - `pnpm --filter @wcdraft/web test:golden:leaderboard`
  - Result: 1 file, 6 tests passed.
  - No golden fixtures were regenerated.
- Formatting / whitespace:
  - `pnpm exec prettier --check apps/web/lib/leaderboard/__tests__/public-payload-email-sweep.test.ts apps/web/lib/leaderboard/__tests__/ui-gating.test.ts`
  - `git diff --check`
  - Both passed.

## Screenshots

Local app: `LEADERBOARD_ENABLED=1 pnpm --filter @wcdraft/web exec next dev --webpack --hostname 127.0.0.1 --port 3107`

Playwright used route interception for `/api/leaderboard` and
`/api/leaderboard/me` because this worktree has no `DATABASE_URL`; the
intercepted payloads contained username/alias board rows and no email addresses.

- `output/playwright/l4-board-classic-light-390x844.png`
- `output/playwright/l4-board-hidden-light-360x800.png`
- `output/playwright/l4-board-classic-dark-360x800.png`
- `output/playwright/l4-board-hidden-dark-390x844.png`

The Playwright result returned `hasExpectedName: true` and `hasEmail: false`
for all four captures. Console output contained only dev-mode React/HMR info and
preload warnings for fonts/logo assets.

## Pending before integration merge

Fresh-context Red review for L4 must re-execute the privacy/UI gates from an
isolated clone, inspect the diff, and either PASS or drive fix-forward before
this PR is squash-merged into `leaderboard-profiles` with a SHA pin.
