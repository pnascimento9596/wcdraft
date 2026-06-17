# Per-config leaderboard candidate - 2026-06-17

Branch: `ws-f4/per-config-leaderboard`
Base: `origin/main` `03c83ec` (`merit-v4.4`)
Risk: Red - schema/migration, leaderboard submission route, board UI.

## Architecture §7 Update

Leaderboard rows now store the full replay-derived board config as first-class
filter columns:

- `draft_mode`: `classic | hidden`
- `draft_order`: `squad_first | position_first`
- `era`: `all_time | post_2000 | post_2010 | modern`
- `rating_basis`: `career | current`

`season_key` remains the six-version-anchor equivalence class. Config does not
join the season key; it partitions boards inside the season. Legacy rows whose
config cannot be derived from the stored token, or which belong to older
seasons, keep NULL config columns and are excluded from exact-config board
reads. New writes always persist the config from server replay, never from
untrusted body/query state.

The old canonical-config-only submit gate is removed. Both `casual` and
`ranked` accept every legal config. Ranked still requires a signed-in account.
Memory ranked is represented as `mode=ranked` and `draft_mode=hidden`; there is
no separate Memory-ranked endpoint or standalone ladder.

## Surface Inventory - Leaderboard

Surface: `/leaderboard`, `/api/leaderboard`, `/api/leaderboard/me`,
`/api/leaderboard/submit`.

- Board default: Ranked + Classic + Squad First + Career + All-time.
- Board filters: lane (`casual | ranked`), mode (`Classic | Memory`),
  draft order, era preset, and rating basis.
- Filters are visible by default; empty combinations render "No runs yet for
  this config" with no placeholder rows.
- `/api/leaderboard` and `/api/leaderboard/me` read exact season/lane/config
  boards and return entries only from the active filter.
- Submit success links from the results screen deep-link to the exact board for
  the submitted run.

## Gate Log

Implementation-phase gates run in `/tmp/wcdraft-per-config-leaderboard-20260617`:

- Ephemeral Neon migration apply + rollback: PASS. Created a non-primary branch,
  applied migrations through `0006_leaderboard_config_filters`, probed the new
  config checks and ranked account check, ran all down migrations through an
  empty public schema, then deleted the branch. Branch id and URLs were redacted
  from chat output.
- `pnpm --filter @wcdraft/db test`: PASS, 2 files, 83 tests.
- `pnpm --filter @wcdraft/web exec vitest run
lib/leaderboard/__tests__/board-route.test.ts
lib/leaderboard/__tests__/submit-route.test.ts
lib/leaderboard/__tests__/validate.test.ts`: PASS, 3 files, 95 tests.
- Root `pnpm typecheck`: PASS, 8 Turbo tasks.
- Root `pnpm lint`: PASS, 5 Turbo tasks.
- Root `pnpm test`: PASS, 8 Turbo tasks; web 62 passed / 1 skipped files, 703
  passed / 1 skipped tests; data 10 passed / 1 skipped files, 82 passed / 7
  skipped tests.
- Root `pnpm build`: PASS, 4 Turbo tasks. Next emitted pre-existing warning
  classes: workspace-root inference, circular chunk warnings, and edge-runtime
  static-generation warning.
- `pnpm exec turbo run test:golden test:golden:draft --filter=@wcdraft/core`:
  PASS, 2 + 5 files, 67 + 40 tests.
- `pnpm exec turbo run test:golden:data test:golden:integration
--filter=@wcdraft/data`: PASS, integration 2 files / 22 tests and data 2 files
  / 31 tests.
- `pnpm exec turbo run test:golden:leaderboard --filter=@wcdraft/web`: PASS, 1
  file, 6 tests. `pnpm --filter @wcdraft/web gen:leaderboard-golden` produced
  no fixture diff.
- Browser matrix: PASS. 390x844 and 360x800, light and dark, default filters,
  populated filtered board, and empty config. All cases had filters visible by
  default, no document scroll, and 0 axe violations.
- `git diff --check`: PASS.

Screenshot artifacts were written under `output/playwright/`:

- `leaderboard-default-{light,dark}-{390x844,360x800}.png`
- `leaderboard-filtered-populated-{light,dark}-{390x844,360x800}.png`
- `leaderboard-empty-config-{light,dark}-{390x844,360x800}.png`

Do not mark this candidate shipped until fresh-context review, owner SHA
approval, production migration, deploy, and live verification have all passed.
