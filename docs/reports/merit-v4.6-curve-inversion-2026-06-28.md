# merit-v4.6 Curve-Inverted Owner Overrides

Date: 2026-06-28
Branch: `ws-merit/v45-curve-inversion-20260628`
Base: `origin/main` at `23056b3de5fdf72258c9061742a986ea6fcea18a`

## Outcome

Local RED-tier implementation and relock are complete. Not merged at report
creation time.

merit-v4.6 restores the manual override contract: owner-authored display
targets remain the displayed `overall`, while the internal sim score is set to
`display_curve^-1(owner_display)` before channel materialization. This removes
the v4.5 defect where override rows were pinned directly to the display scale
and therefore out-simmed natural cards at the same displayed strength.

## Fit Ordering

The display curve remains fit from the natural/internal distribution first.
Manual overrides are applied after that fit:

1. Build the frozen pooled monotone display curve.
2. For each resolved owner override target `T`, compute internal
   `score_0_100 = inverse_display_curve(T)`.
3. Materialize channels through the same score path natural cards use.
4. Preserve display `overall = T` through the manual display override path.

`etl/src/wcdraft_etl/rating_display.py` now exposes the inverse helper, and
`etl/src/wcdraft_etl/manual_overrides.py` uses it for both Career/default pins
and Current pins.

## Version Anchors

New runtime anchors:

- schema: `runtime-data-2.8.0`
- engine: `engine-2026.06.28-merit-v4.6`
- historical rating: `wc-perf-6.6.0`
- projected rating: `proj-career-5.6.0`
- dataset: `2026-06-04`
- ruleset: `ruleset-2026.06.04`
- season key:
  `engine-2026.06.28-merit-v4.6_wc-perf-6.6.0+proj-career-5.6.0_2026-06-04_ruleset-2026.06.04_aa7256a5`

Generated bundle fingerprints:

- draft pool sha256:
  `7d6d06b96084dd6ebf2a1eebc365662064d5ed55535a5825f8ce732210a6d48c`
- scenario sha256:
  `ad5c726772561b274b3b1446540a7e982c1d6cc01d942cd2d95d30a606c7cd2e`
- manifest sha256:
  `6d6f17eee85b38e7854a3a5d65fdbc7cd7cb586552e234183463003edc19c215`
- `ratings.lock.json` byte sha256:
  `bf4b75e58b8642833a863986d9191d739f3d2b652c0159e3014c005aaf09400c`
- ratings payload sha256 recorded inside `ratings.lock.json`:
  `896301819a2988e4e93b3038b35ffa44bcef4182b4a55ac82c7569241801cee0`

## Bundle Proof

Independent local comparison against the v4.5 baseline compact bundle:

| Metric                                                           |           v4.5 baseline |         v4.6 current |
| ---------------------------------------------------------------- | ----------------------: | -------------------: |
| total runtime ratings                                            |                  12,219 |               12,219 |
| close-to-display population `abs(score_0_100 - overall) <= 5`    | 2,358 / 12,219 = 19.30% |  94 / 12,219 = 0.77% |
| display `overall >= 90` share                                    |    324 / 12,219 = 2.65% | 324 / 12,219 = 2.65% |
| non-override rows compared after stripping only `rating_version` |                   9,528 |                9,528 |
| non-override normalized mismatches                               |                       0 |                    0 |

Same-display primary-channel gaps collapsed:

| Display OVR | v4.5 manual avg | v4.5 natural avg | v4.5 gap | v4.6 manual avg | v4.6 natural avg | v4.6 gap |
| ----------: | --------------: | ---------------: | -------: | --------------: | ---------------: | -------: |
|          70 |           70.00 |            34.67 |   +35.33 |           35.00 |            34.67 |    +0.33 |
|          74 |           74.00 |            42.94 |   +31.06 |           43.00 |            42.94 |    +0.06 |
|          80 |           80.00 |            49.89 |   +30.11 |           50.00 |            49.89 |    +0.11 |
|          88 |           63.70 |            61.47 |    +2.22 |           60.93 |            61.47 |    -0.54 |

The non-override normalized-after rows hash was:
`ad833fcca5c7b3337e2ededbd5b996481c09c47ad53290ccdf2ac31519aba153`.

## Lambda Refit

The v4.5 lambda seed under the corrected channel distribution was out of band:

- goals: 2.289, low
- group draw: 26.99%, high
- margin >= 4: 3.36%, low
- KO to extra time: 38.13%, high
- shootout: 24.67%, high

Accepted deterministic fitter result after 175 evaluations:

- `LAMBDA.BASE = 1.10`
- `LAMBDA.SPREAD = 5.5`
- `LAMBDA.MIN = 0.30`
- `LAMBDA.MAX = 3.4`
- `LAMBDA.W_DEF = 0.7`
- `LAMBDA.W_GK = 0.30`
- `LAMBDA.GAMMA_MID = 1.00`
- `LAMBDA.KO_LAMBDA_FACTOR = 0.82`
- `CHANCES.REGULATION = 50`
- `CHANCES.EXTRA_TIME = 17`
- `LAMBDA_DISP.OUTER_PROB = 0.20`
- `LAMBDA_DISP.A = 0.75`
- `LAMBDA_DISP.GROUP_OUTER_PROB = 0.14`
- `LAMBDA_DISP.GROUP_A = 0.40`

Symmetric realism landing:

- goals/game: 2.565, in [2.478, 2.594]
- group draw: 24.96%, in [22.88%, 26.52%]
- margin >= 4: 4.92%, in [4.12%, 5.70%]
- KO to extra time: 33.73%, in [29.61%, 36.48%]
- shootout: 21.87%, in [18.43%, 24.43%]

Heavy asymmetric relock, N=2000 x 3:

- strategicAutoDraft: 1,621 qualifying, 10,047 matches, goals/game 2.623,
  draw 24.27%, margin >= 4 4.85%, KO to extra time 31.23%, shootout 18.95%
- autoDraft telemetry: 120 qualifying, 6,142 matches, goals/game 2.779
- greedyOverall negative control: 637 qualifying, 7,047 matches,
  goals/game 3.071

The heavy gate passed after relock: 1 file, 7 tests.

## Canary

The strategic-pick canary was intentionally regenerated under
`WCDRAFT_CANARY_REGEN=1`. It changed 24 picked cards across the first five
strategic seeds. This is expected: override-heavy cards no longer carry display
scale channels, so best-of-spin slot-fit ordering changes where those cards
previously won by inflated channel values.

The normal canary gate then passed: 1 file, 1 test.

## Gates

Local gates run:

| Command                                                                                         | Result                                                                                                                           |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `cd etl && uv run ruff check src tests`                                                         | PASS, all checks passed                                                                                                          |
| `cd etl && uv run pytest -q`                                                                    | PASS, 310 passed                                                                                                                 |
| `pnpm --filter @wcdraft/core test:golden`                                                       | PASS, 2 files, 68 tests                                                                                                          |
| `pnpm --filter @wcdraft/core test:golden:draft`                                                 | PASS, 5 files, 40 tests                                                                                                          |
| `pnpm --filter @wcdraft/web test:golden:leaderboard`                                            | PASS, 1 file, 6 tests                                                                                                            |
| `pnpm --filter @wcdraft/data test:golden:data`                                                  | PASS, 2 files, 31 tests                                                                                                          |
| `pnpm --filter @wcdraft/data test:golden:integration`                                           | PASS after fixing stale e2e seed constant, 2 files, 22 tests                                                                     |
| `pnpm --filter @wcdraft/data exec vitest run test/realism/strategic-pick-canary.golden.test.ts` | PASS, 1 file, 1 test                                                                                                             |
| `pnpm --filter @wcdraft/data exec vitest run test/realism-modern-norms.golden.test.ts`          | PASS, 1 file, 5 tests                                                                                                            |
| `pnpm --filter @wcdraft/data test:realism:heavy`                                                | PASS, 1 file, 7 tests                                                                                                            |
| `pnpm typecheck`                                                                                | PASS, 8/8 tasks                                                                                                                  |
| `pnpm lint`                                                                                     | PASS, 5/5 tasks                                                                                                                  |
| `pnpm test`                                                                                     | PASS, 8/8 tasks: core 381, data 84 passed / 7 skipped, db 90, web 733 passed / 1 skipped, marketing-x 67, web Playwright flow OK |
| `pnpm build`                                                                                    | PASS, 4/4 tasks; existing Next circular-chunk and Edge-runtime warnings only                                                     |
| `git diff --check`                                                                              | PASS                                                                                                                             |

## Risks And Carryovers

- This is a new season key and will reset the current leaderboard season.
- Compact bundle size grew from the v4.5 draft-pool fingerprint to
  124.51 MiB raw / 4.46 MiB gzip / 2.12 MiB brotli. The updated
  `size-budget.json` keeps the measured-plus-headroom contract.
- A fresh-context reviewer still needs to re-execute before merge, per RED
  discipline and the lane prompt.
- Production merge, deploy READY, and live www.wcdraft.com verification are not
  yet complete at report creation time.
