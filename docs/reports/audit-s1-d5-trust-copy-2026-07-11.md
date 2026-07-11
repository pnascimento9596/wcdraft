# Audit Season 1 D5 trust copy and UTC rollover

## Outcome

D5 is complete locally on `ws-ux/audit-s1-trust-copy`, rebased as one isolated
commit onto shipped D4 main `c90d87e853a61756676421edff2e9d6064d42988`.
The branch is intentionally not pushed; PR, independent review, merge,
deployment, and live verification remain.

## What changed

- Settings has a five-line `Your data` panel explaining device-local runs,
  optional server mirroring, signed-in Account history, public leaderboard
  permanence, and what clearing browser data does not delete. It links directly
  to Privacy and Account.
- Leaderboard stays in desktop and mobile navigation while the feature flag is
  dark. `/leaderboard` renders an explained `Leaderboard is closed` state with
  Play and History routes instead of a generic 404. It does not create the board
  container or evaluate the season key while dark. Board APIs and results-page
  submission remain server-gated and unchanged.
- Selecting Current under Rating basis displays the exact consequence `Current
ratings play as a tougher board — expect lower scores`.
- Board rows, submit outcomes, and Daily share captions use one standing-copy
  formatter. Fields of 1–19 show exact rank and field size plus `Ties share a
rank`; percentile copy begins at 20. Zero-field and missing-rank inputs stay
  literal instead of emitting `#x of 0` or an invented percentile.
- ModeSelect owns a date-keyed Daily availability state. It rechecks the UTC day
  on window focus, visible-tab return, and a bounded 60-second interval. A date
  change immediately returns the Daily card to checking, and cleanup removes
  both listeners and the timer. The request lifetime/date guards prevent a late
  prior-day response from restoring stale availability.

## Preserved contracts

- D1 remains the request-budget authority inside `loadDailyAvailability`; D5
  adds no fetch wrapper or mutation path.
- D2's 44px controls and reduced-motion rules are unchanged. The two new
  Settings links use a 44px minimum inline-flex target.
- D3's five-mode hierarchy, compact board, and Casual/Ranked setup remain
  unchanged.
- D4's immediate replay sharing and independent signed-preview lifecycle remain
  unchanged except that sparse Daily standing copy now follows the shared
  threshold rule.
- Leaderboard route handlers, storage, ranking SQL, validation, submission, and
  feature-flag checks were not edited.

## Regression evidence

Pure formatter tests pin field-size boundaries 0, 1, 19, and 20, the sparse
tie note, percentile suppression below 20, the exact percentile threshold, and
missing-rank honesty. Component renders cover the dark Leaderboard page and
nav, five Settings data statements and link targets, board-row copy, submit
states, Daily caption copy, and the exact Current-rating consequence.

Mounted ModeSelect tests cross UTC midnight with the prior card available while
the next request is held open, proving the screen shows checking rather than
yesterday's card. They separately exercise visible-tab and focus rechecks,
ignore a late prior-day success after the new day is unavailable, and verify
listener plus interval cleanup on unmount.

## Validation

- Focused component, copy, contract, and mounted lifecycle tests: 7 files
  passed; 90 tests passed.
- Final post-rebase changed-file set: 5 files, 68 tests passed.
- Complete direct web Vitest: 103 files passed / 1 skipped; 1,092 tests passed /
  1 skipped.
- Complete data Vitest: 16 files passed / 1 skipped; 168 tests passed / 9
  skipped.
- Root typecheck: 8/8 tasks passed; changed web task executed.
- Root lint: 5/5 tasks passed; changed web task executed.
- Root build: 4/4 tasks passed; changed web task executed; Next generated 40/40
  pages. Existing circular-chunk and Edge static-generation warnings remained
  non-failing.
- Game-flow Playwright: passed.
- Responsive shell: 204 metrics / 0 failures — desktop 84/0, mobile 56/0,
  interaction targets 40/0, mode/setup 24/0.
- Targeted Prettier and `git diff --check`: passed.

## Risk and carryover

The change is display/client-lifecycle only. No schema, migration,
authentication, rating values, simulation, draft semantics, runtime-data,
leaderboard ranking/storage/validation, API response, or ETL behavior changed.
Automatic Daily revalidation is capped at once per 60 seconds plus explicit
focus/visibility signals. PR, merge, deployment, and live verification have not
occurred.
