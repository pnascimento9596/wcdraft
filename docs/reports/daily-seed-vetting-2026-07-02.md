# Daily Seed Vetting + ENG-08 Invariant - 2026-07-02

Status: local RED implementation passed the local gate set on branch
`ws-core/daily-seed-vetting-20260702`. Not shipped until fresh-context review,
SHA-pinned merge, deploy observation, and live verification complete.

## Scope

- Added a committed, versioned `daily-seed-salt-map-1.0.0` artifact:
  `packages/data/src/generated/daily-seed-salt-map.compact.json`.
- Stamped the salt-map fingerprint into `manifest.json` and
  `packages/data/reports/compact-size.json` like `score_distribution`.
- Wired browser and leaderboard-server daily seed derivation to the same shipped
  map. Absent date means salt `0`; salt `2` resolves to
  `wcdraft:daily:v1:<date>#2`.
- Kept the cost firewall: runtime code only reads the artifact; the reference
  simulation runs in package tests or scheduled CI.
- Added the ENG-08 `choice_overall` invariant comment and static guard.
- Added a nightly freshness job that runs the full regeneration order against
  the current UTC start date and fails on tracked artifact diff.

## Metrics Block

| Metric                         | Measured value                                                                                                                                                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Window                         | 14 UTC days, `2026-07-02` through `2026-07-15`                                                                                                                                                                                                                          |
| Reference policy               | `greedyOverallAutoDraft` from the realism harness                                                                                                                                                                                                                       |
| Candidate population           | 128 sampled child seeds per candidate, plus the exact shipped daily seed                                                                                                                                                                                                |
| Salt attempts                  | 8 candidates per date max: unsalted, then `#2` through `#8`                                                                                                                                                                                                             |
| Initial salted dates           | none (`salts: {}`)                                                                                                                                                                                                                                                      |
| Daily generator runtime        | 9.6s for the committed artifact run; 10.8s for a temp `--out-dir` rerun                                                                                                                                                                                                 |
| Score distribution calibration | `strategicAutoDraft` N=2000, qualifying 1329/2000 (66.45%), mean 14.4785, median 9, q10 -8, p95 62, min -24, max 126                                                                                                                                                    |
| Final easy band                | perfect-run rate >= 0.10 or qualifying rate >= 0.95                                                                                                                                                                                                                     |
| Final cruel band               | qualifying rate <= 0.10 or median score <= score-distribution q10 (-8)                                                                                                                                                                                                  |
| Salt-map fingerprint           | 9084 bytes raw / 1345 gzip / 1152 brotli; sha256 `6dcb7042eca6b529abe231cb57823d392beda21f15e7742f74c8ab38bb5ae1bf`                                                                                                                                                     |
| Added CI sim cost              | Nightly freshness adds the existing compact/score-distribution chain plus daily vetting. No-salt local daily vetting was 14 _ (128 sampled + 1 exact) = 1806 reference runs, measured ~10s. Worst-case cap is 14 _ 8 \* (128 sampled + 1 exact) = 14448 reference runs. |

Initial date metrics:

| Date       | Salt | Reason | Qualifying rate | Perfect rate | Median | Exact score | Exact qualified |
| ---------- | ---: | ------ | --------------: | -----------: | -----: | ----------: | --------------- |
| 2026-07-02 |    0 | normal |        0.281250 |            0 |   -4.0 |          19 | true            |
| 2026-07-03 |    0 | normal |        0.335938 |            0 |   -5.5 |         -17 | false           |
| 2026-07-04 |    0 | normal |        0.234375 |            0 |   -5.0 |           5 | false           |
| 2026-07-05 |    0 | normal |        0.312500 |            0 |   -4.5 |           4 | false           |
| 2026-07-06 |    0 | normal |        0.242188 |            0 |   -6.5 |          -2 | false           |
| 2026-07-07 |    0 | normal |        0.304688 |            0 |   -4.0 |          96 | true            |
| 2026-07-08 |    0 | normal |        0.273438 |            0 |   -6.0 |         -15 | false           |
| 2026-07-09 |    0 | normal |        0.281250 |            0 |   -5.5 |         -17 | false           |
| 2026-07-10 |    0 | normal |        0.226563 |            0 |   -7.0 |          -7 | false           |
| 2026-07-11 |    0 | normal |        0.273438 |            0 |   -5.0 |         -13 | false           |
| 2026-07-12 |    0 | normal |        0.218750 |            0 |   -6.0 |           2 | false           |
| 2026-07-13 |    0 | normal |        0.289063 |            0 |   -5.5 |         -11 | false           |
| 2026-07-14 |    0 | normal |        0.218750 |            0 |   -7.0 |          10 | true            |
| 2026-07-15 |    0 | normal |        0.242188 |            0 |   -6.0 |         -19 | false           |

## Regeneration Order

The salt-map artifact joins the existing data regeneration sequence after the
score-distribution table:

1. `pnpm --filter @wcdraft/data run build:compact`
2. `pnpm --filter @wcdraft/data run build:score-distribution`
3. `pnpm --filter @wcdraft/data run build:compact`
4. `pnpm --filter @wcdraft/data run build:daily-seed-salt-map`
5. `pnpm --filter @wcdraft/data run build:compact`

The committed run used `--start-date 2026-07-02`. The package script was also
validated with a temp output directory after fixing the generator to create
`--out-dir` recursively.

## Board Coherence Proof

- `apps/web/lib/game/daily.ts` is the shared derivation point for client,
  replay, and leaderboard validation.
- Browser game data loads `manifest.json` first, then fetches
  `daily-seed-salt-map.compact.json` only when the manifest advertises it.
- Leaderboard server data reads the same public runtime asset from
  `apps/web/public/data/wcdraft`.
- Daily submit validation requires token date, token parent seed, token daily
  seed metadata, and server-derived salted seed to agree exactly.
- Artificial salted fixtures prove both directions even though the initial
  shipped map has no salted dates: salted date accepts `#2` and rejects the
  stale unsalted seed; unsalted date rejects an invented `#2` seed.

## ENG-08 Proof

- `packages/core/src/draft.ts` now pins the invariant at the only production
  `choice_overall` read: display values are permitted for offer tiering only,
  never scoring, sim, best-XI, or team strength.
- `packages/core/src/choice-overall-invariant.guard.test.ts` scans production
  core source outside `draft.ts` and fixtures. A future `choice_overall` read in
  scoring, sim, best-XI, or team-strength source fails the guard.

## Validation

| Gate                                                                                                                           | Result                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                               | PASS                                                                                                                                                |
| Regen chain through daily salt map and final compact                                                                           | PASS; score distribution N=2000 in 12.3s; daily salt map N=128/date in 9.6s                                                                         |
| `pnpm --filter @wcdraft/data run build:daily-seed-salt-map --out-dir /tmp/wcdraft-daily-salt-cli-test --start-date 2026-07-02` | PASS; 10.8s                                                                                                                                         |
| `pnpm run check:generated`                                                                                                     | PASS before report update and PASS again after report update                                                                                        |
| `pnpm run check:agent-contracts`                                                                                               | PASS                                                                                                                                                |
| `git diff --check`                                                                                                             | PASS                                                                                                                                                |
| Focused daily/data golden                                                                                                      | PASS; data daily/score distribution files 14 tests                                                                                                  |
| Focused ENG-08/manager guard                                                                                                   | PASS; 2 files / 4 tests                                                                                                                             |
| Focused web daily/leaderboard suite                                                                                            | PASS; 5 files / 143 tests                                                                                                                           |
| `pnpm typecheck`                                                                                                               | PASS; 8/8 Turbo tasks, 1m32.202s                                                                                                                    |
| `pnpm lint`                                                                                                                    | PASS after replacing an empty marker interface with a type alias; 5/5 Turbo tasks, 3.331s                                                           |
| `pnpm test`                                                                                                                    | PASS; 8/8 Turbo tasks, 3m01.899s; core 389, data 101 passed / 9 skipped, db 106, marketing 68, web 867 passed / 1 skipped plus game-flow Playwright |
| `pnpm build`                                                                                                                   | PASS; 4/4 Turbo tasks, 1m43.793s; existing Next circular chunk and edge-runtime warnings only                                                       |
| `pnpm exec turbo run test:golden test:golden:draft --filter=@wcdraft/core`                                                     | PASS; RNG/narrative 69 tests, draft family 42 tests                                                                                                 |
| `pnpm exec turbo run test:golden:data test:golden:integration --filter=@wcdraft/data`                                          | PASS; data golden 47 tests, integration 22 tests                                                                                                    |
| `pnpm exec turbo run test:golden:leaderboard --filter=@wcdraft/web`                                                            | PASS; 6 tests                                                                                                                                       |
| `pnpm --filter @wcdraft/data run test:realism:heavy`                                                                           | PASS; 1 file / 9 tests, 37.98s                                                                                                                      |

## Risks And Carryovers

- The initial artifact salted no dates. That is acceptable under the pinned
  band: all 14 dates were inside the wide "normal variance ships" range.
- A stale client map fails honestly at daily submit because the server
  re-derives from the deployed salt map. Local run-record parsing remains
  permissive for same-date salted syntax so stored records do not become
  unloadable before server validation.
- The nightly freshness job detects a stale rolling window by diff, but it does
  not auto-commit or auto-merge a refreshed map. That avoids bypassing the
  repo's merge-is-ship safety contract.
