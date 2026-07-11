# Audit Season 1 Wave D — cross-model review fix-forward

Date: 2026-07-11

Branch: `ws-ux/audit-s1-wave-d-review-fixes`

Base: `7f25ee45d88701830b73f300132c731c423db733` (`origin/main`)

Risk: Red, responsive interaction behavior

## Outcome

This candidate closes the two blocking findings from the Wave D boundary review.
It does not change game semantics, persistence, schema, runtime data, or API
contracts.

## Finding 1 — opened mobile navigation was unmeasured

The compact rule reduced `.mobile-menu__link` padding but the link itself had no
explicit interaction-height floor. Existing responsive interaction surfaces never
opened the menu, so hidden links were excluded from browser target measurement.

The base link now has `min-height: 44px`; the compact rule only changes padding and
cannot reduce that floor. A dedicated `mobile-menu-open` surface waits for client
hydration, clicks the real menu toggle, requires `#mobile-menu` to lose `hidden`,
then runs the standard target, overflow, axe, console, and navigation checks. CI
executes it at 360x800, 390x844, 667x375, and 768x1024 in light and dark themes.

## Finding 2 — two-action timeout dock could cover mode cards

The shared mode-grid reserve is sized for a single sticky action. The Daily timeout
state renders two full-width buttons, so its dock can be taller than the reserve at
360x800 and 390x844. Only that timeout recovery state now uses the existing
`modeDockInFlow` and `modeGridDockInFlow` pattern already used by the taller Daily
unavailable notice. This removes overlap by construction while preserving the
sticky one-action dock for checking, available Daily, and other selected modes.

The browser harness now has a deterministic `mode-select-timeout` fixture, waits
for both recovery actions, and measures initial and terminal card-to-dock clearance
at 360x800, 390x844, and 667x375 in both themes.

## Validation

- Focused source contracts: 2 files, 22 tests passed.
- Opened mobile-menu browser proof after hydration fix: 8 metrics, 0 failures.
- First full responsive attempt: invalid environment, Next could not resolve an
  unbuilt local `@wcdraft/data/client`; this attempt was not persisted separately
  and is not release evidence.
- Second full responsive attempt: all phases through the new timeout surface ran,
  then the new menu surface exposed a pre-hydration click in the harness. The
  failed log remains preserved at `/tmp/audit-s1-wave-d-fixes-responsive.log`; it
  is not release evidence.
- Final expanded responsive adjudication: 218 metrics, 0 failures (84 desktop,
  56 mobile shell, 40 interaction, 30 mode/setup, 8 opened mobile navigation).
  Receipt: `/tmp/audit-s1-wave-d-fixes-responsive-final.log`.
- Complete web gate: 103 test files passed with 1 expected skip; 1,103 tests
  passed with 1 expected skip; game-flow Playwright passed; responsive passed
  218/0. Receipt: `/tmp/audit-s1-wave-d-fixes-web-test.log`.
- Forced root typecheck: 8/8 tasks passed, 0 cached.
- Forced root lint: 5/5 tasks passed, 0 cached.
- Forced root build: 4/4 tasks passed, 0 cached; web generated 40/40 pages.
- Prettier and `git diff --check` pass after the final harness normalization.

## Risk and rollback

The behavior change is limited to mobile/tablet layout: timeout recovery actions
scroll in normal flow rather than sticking. Rollback is the single candidate commit.
There is no data migration or compatibility impact.
