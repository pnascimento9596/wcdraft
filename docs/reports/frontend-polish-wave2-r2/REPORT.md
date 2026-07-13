# Frontend Polish Wave 2 — R2 Mode-Picker Craft

Date: 2026-07-13

Branch: `ws-ux/mode-picker-craft-r2`

Base: `origin/main` at `2add71b2e5daf0e7305350e8144b9860e8cb67c2`

Risk: Yellow, bounded responsive CSS

## Outcome

The mode-picker ghost numerals and status pills no longer intersect at 360, 390, or 430 CSS pixels in either theme. The mobile composition keeps the existing 30px-high ghost numeral treatment and reserves only the pill's foreground track, so card titles retain their full width and all mode behavior is unchanged.

This report is pre-PR evidence. The lane is intentionally not merged.

## Gate 0 and collision boundary

- `git fetch --all --prune`: completed.
- `HEAD` and `origin/main`: both `2add71b2e5daf0e7305350e8144b9860e8cb67c2` before implementation.
- Self-hosted runner: `wcdraft-m4`, online and idle at Gate 0.
- `pnpm install --frozen-lockfile`: completed with 274 packages reused and 274 added to the isolated worktree.
- Season 2 comparison head: `origin/season/squad-depth` at `98c0e07abd992b624cf44e500ad6b2199c5a25d3`.
- Implementation target `apps/web/components/game/game-styles/shared.module.css` is not in the Season 2 diff.

The denylist generated from `git diff --name-only origin/main...origin/season/squad-depth` contained:

- `.github/workflows/ci.yml`, `.github/workflows/etl.yml`, `.github/workflows/nightly-heavy.yml`
- `STATE.md`
- `apps/web/lib/game/run-og-server.ts`, `run-record.ts`, `run-token.ts`, `simulate.ts`, and the associated run OG/record/token tests
- `apps/web/lib/leaderboard/validate.ts` and its golden fixture
- `docs/reports/season2-*`
- `packages/core/**`
- `packages/data/**`

No denylisted file and no player-facing draft, review, results, share, or team-sheet component was edited.

## Implementation

The defect came from the compact two-column composition: the `01` and `03` status pills were allowed to occupy the full card width while the numerals were absolutely painted in that same top-right region. At baseline the pill crossed 10px into the numeral's bounding box at 360 and 390px, and 5px at 430px.

The final rule reserves `40px` from the pill's maximum width at the mobile/short-landscape breakpoint. The reservation is scoped to `.modeTag`, not the whole `.modeCardTop`; this preserves the full width for the mode name below. The Daily card retains a separate `50px` header reservation for `00`.

An initial implementation reserved the entire non-featured header. Browser validation rejected it because the 360px ranked pill became three lines high, card height grew, and the sticky dock overlapped the cards by 6px. That iteration was not retained. The final pill-only reservation restores a two-line ranked pill and clears the strict dock gate.

## Browser geometry

The browser probe compared the `getBoundingClientRect()` values of each card's `.modeTag` and `.modeIndex` under Chromium at the required widths. Theme did not change geometry.

| Width | Baseline `01` / `03` | Final `01` / `03`   | Final `00` / `02` / `04` | Final ranked pill height | Final numeral height |
| ----: | -------------------- | ------------------- | ------------------------ | -----------------------: | -------------------: |
|   360 | overlap              | no overlap, 5px gap | no overlap               |                     28px |                 30px |
|   390 | overlap              | no overlap, 5px gap | no overlap               |                     28px |                 30px |
|   430 | overlap              | no overlap, 5px gap | no overlap               |                     28px |                 30px |

Counts:

- Baseline: 12 intersections across 30 card/width/theme checks, all on `01` and `03`.
- Final: 0 intersections across the same 30 checks.
- Daily `00` and casual `02`/`04`: 0 intersections before and after.

## Screenshot evidence

All files are real local browser captures of `/play` with the Daily-available fixture or the equivalent loaded Daily state.

Baseline, both themes:

- `before/screenshots/before-mode-select-available-360x800-light.png`
- `before/screenshots/before-mode-select-available-360x800-dark.png`
- `before/screenshots/before-mode-select-available-390x844-light.png`
- `before/screenshots/before-mode-select-available-390x844-dark.png`

Final, both themes:

- `after/screenshots/after-mode-select-available-360x800-light.png`
- `after/screenshots/after-mode-select-available-360x800-dark.png`
- `after/screenshots/after-mode-select-available-390x844-light.png`
- `after/screenshots/after-mode-select-available-390x844-dark.png`
- `after/screenshots/after-mode-select-available-430x844-light.png`
- `after/screenshots/after-mode-select-available-430x844-dark.png`

The committed `responsive-before.json` and `responsive-after.json` preserve the strict-harness measurements for the 360 and 390 captures. The final capture completed 4/4 metrics with zero failures, zero horizontal-overflow findings, zero undersized-target findings, zero accessibility findings, and zero console errors.

## Validation

| Gate                                                                                               | Result                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @wcdraft/web exec vitest run lib/game/__tests__/responsive-layout-contract.test.ts` | PASS, 1 file / 10 tests                                                                                                                                                                              |
| `pnpm --filter @wcdraft/web test`                                                                  | PASS at the final CSS head before the test-only guard was added: 111 files passed + 1 skipped; 1,168 tests passed + 1 skipped; `game-flow-playwright: ok`; responsive shell 218 metrics / 0 failures |
| `pnpm --filter @wcdraft/web exec vitest run` after adding the guard                                | PASS, 111 files passed + 1 skipped; 1,169 tests passed + 1 skipped                                                                                                                                   |
| Responsive shell breakdown                                                                         | PASS: desktop 84, mobile 56, interactions 40, mode/setup 30, mobile nav 8; 0 failures in every group                                                                                                 |
| `pnpm --filter @wcdraft/web typecheck`                                                             | PASS                                                                                                                                                                                                 |
| `pnpm --filter @wcdraft/web lint`                                                                  | PASS, zero warnings allowed                                                                                                                                                                          |
| `pnpm --filter @wcdraft/web build`                                                                 | PASS, 40/40 static pages generated                                                                                                                                                                   |
| Required focused capture, 360/390 × light/dark                                                     | PASS, 4 metrics / 0 failures                                                                                                                                                                         |
| Required geometry, 5 cards × 3 widths × 2 themes                                                   | PASS, 30 checks / 0 intersections                                                                                                                                                                    |
| `git diff --check`                                                                                 | PASS                                                                                                                                                                                                 |

The production build emitted Webpack circular-chunk warnings and an Edge Runtime/static-generation warning but completed successfully. This CSS-only lane did not change chunking or runtime selection.

## Files and artifacts

Runtime change:

- `apps/web/components/game/game-styles/shared.module.css`

Evidence:

- `docs/reports/frontend-polish-wave2-r2/REPORT.md`
- `docs/reports/frontend-polish-wave2-r2/before/responsive-before.json`
- `docs/reports/frontend-polish-wave2-r2/after/responsive-after.json`
- 10 PNG screenshots listed above

## Risk, rollback, and carryovers

- Blast radius is limited to mode-card headers at `max-width: 430px` and the existing short-landscape breakpoint below 52rem.
- Behavior, copy, accessibility roles, touch targets, navigation, Daily availability, and card selection code are unchanged.
- Rollback is one CSS declaration group in `shared.module.css`.
- The screenshot is full-page and remains slightly taller than the nominal viewport because overall mode-page fold compaction belongs to parallel Unit R1. R2 did not alter that page-height contract.
- Season 2 engine/data/token/game-surface work, all denylisted files, responsive-harness implementation, OG art, null placeholders, and native Capacitor work remain deferred and untouched.

Human actions: none expected for this bounded lane. The orchestrator still owns independent review and any merge decision.
