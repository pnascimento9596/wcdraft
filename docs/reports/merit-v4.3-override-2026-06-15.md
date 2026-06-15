# merit-v4.3 Owner Override - ship report

Branch: `ws-merit/v4.3-owner-overrides`
Date: 2026-06-15
Status: pre-merge RED candidate. Merge/deploy/live verification remain blocked on
the owner approval checkpoint.

## Outcome

- Candidate runtime: `runtime-data-2.5.0` / `wc-perf-6.3.0` /
  `proj-career-5.3.0` / `engine-2026.06.15-merit-v4.3`.
- Leaderboard season key:
  `engine-2026.06.15-merit-v4.3_wc-perf-6.3.0+proj-career-5.3.0_2026-06-04_ruleset-2026.06.04_923c4a93`.
- Manual source: `etl/overrides/manual-ratings-v4.3.csv`.
- Manual source sha256:
  `f121d0f768fe70cfc6d699559bf78dc25d356ccea33ca0aa5e8ded11c65d9da6`.
- Resolution: 2,300 / 2,516 source rows matched (`91.4149%`); 216 honest
  misses; 2,246 effective canonical card pins after duplicate consolidation.
- HUMAN ACTIONS: owner approval is still required before merge.

## Source Integrity

The committed override CSV was copied verbatim from
`/Users/paulo/Projects/wcdraft/merit-v4.3-merged-overrides.csv` into
`etl/overrides/manual-ratings-v4.3.csv`.

| Check | Result |
|---|---:|
| data rows | 2,516 |
| sha256 | `f121d0f768fe70cfc6d699559bf78dc25d356ccea33ca0aa5e8ded11c65d9da6` |
| `agree` | 1,055 |
| `avg` | 455 |
| `f2-only` | 811 |
| `f1-only` | 190 |
| `f1-corrupt->f2` | 5 |

Spot rows from the source hold: Morocco 2022 Achraf Dari = 69; Morocco 2022
Yassine Bounou = 84.

Source correction note: the owner curation detected six source-one ratings
corrupted to `39` by HTML-encoded apostrophes. Five had a source-two value and
are present as `f1-corrupt->f2`; one had no usable source-two replacement and is
not applied. Player names are decoded with `html.unescape` before resolution.

Merge rule: exact agreement uses the agreed value; differing dual-source rows use
the arithmetic mean rounded half-up; single-source rows use that source. When two
source rows resolve to the same canonical card with different strong matches, the
effective card pin uses the half-up average and records the source lines in
`etl/output/manual-ratings-v4.3-effective.csv`.

## Resolution

Authoritative resolution artifacts:

- Full match table: `etl/output/manual-ratings-v4.3-resolution.csv` (2,300 rows
  plus header).
- Full honest-miss table: `etl/output/manual-ratings-v4.3-unmatched.csv` (216
  rows plus header).
- Effective applied pins: `etl/output/manual-ratings-v4.3-effective.csv` (2,246
  rows plus header).
- Summary JSON: `etl/output/manual-ratings-v4.3-summary.json`.

All 225 source nation/year blocks exist in the canonical dataset. Iran 2026 has
five override-source rows but zero applied pins because all five source strings
are source hints (`Likely ...` / `strong: ...`), not canonical player names.
Those rows are honest misses, not an absent-block contradiction.

Honest-miss reasons:

| Reason | Rows |
|---|---:|
| `no_unambiguous_match` | 145 |
| `duplicate_conflict_weaker_match` | 37 |
| `source_hint_not_player_name` | 19 |
| `ambiguous_unapplied` | 11 |
| `duplicate_conflict_weak_only` | 4 |

Top honest-miss countries: Brazil 20, Cameroon 15, Costa Rica 13, South Korea
13, Mexico 12, Saudi Arabia 12, Iran 9, Portugal 9, Nigeria 8, Senegal 7,
Uruguay 7.

Representative honest misses: Algeria 2010 Medhi Lacen; Argentina 2022 Nicolas
Gonzalo; Argentina 2022 Nahuel Lucero; Brazil 2010 Julio de Espindola; Brazil
2010 Daniel da Silva; Brazil 2018 Cassio Ramos; Cameroon 2022 Nicolas Ndoubena;
Costa Rica 2006 Likely Hernandez; Iran 2026 Likely Ghorbani; Iran 2026 strong:
Hosseini; United States 2010 Bradley Guzan; Wales 2022 Benjamin Davies. The full
216-row name list is in `etl/output/manual-ratings-v4.3-unmatched.csv`.

## Application Contract

Manual overrides are applied in `etl/src/wcdraft_etl/manual_overrides.py` after
the merit model has built internal rows and before display/channel
materialization. For each resolved card:

- `score_0_100` and `current_score_0_100` are pinned to the effective owner
  value.
- Display `overall` is returned from the rounded pinned internal score, with a
  guard that fails if the internal score drifts from the source target.
- ATT/MID/DEF/GK channels are rematerialized from the same pinned score through
  the existing positional channel spread.
- Best-XI selection and runtime sim consume the compact runtime channels and
  overall produced from that same pin.

The pooled display curve remains the non-manual mapping path and is fit with
`apply_manual_overrides=False`. This keeps non-overridden rows byte-stable while
letting owner pins below the non-manual display floor remain authoritative.

Measured v4.2 -> v4.3 movement:

- Compared runtime cards: 12,219 / 12,219.
- Effective manual pins: 2,246.
- Non-manual movement: 0 cards changed.
- Manual movement: 1,261 down, 863 up, 122 unchanged.
- Average OVERALL: 75.2619 -> 75.0147 (delta -0.2472).
- 90+ share: 2.5043% -> 2.6516% (delta +0.1473pp).

The override is net-downward by average and down/up count. The 90+ share still
rises slightly because several high owner pins move formerly sub-90 players into
the 90+ band. That is distribution shape, not non-manual drift.

Spot checks from generated artifacts:

| Card | Player | Source target | Runtime OVERALL | Channels |
|---|---|---:|---:|---|
| `P-52013:WC-2022` | Achraf Dari | 69 | 69 | ATT 37 / MID 49 / DEF 69 / GK 20 |
| `P-50688:WC-2022` | Bounou | 84 | 84 | GK 84 |
| `P-45288:WC-2022` | Hakimi | 84 | 84 | DEF 84 |
| `P-13354:WC-2010` | Robinho | 83 effective from 85/81 | 83 | duplicate half-up average |
| `P-89971:WC-2002` | Kerzhakov | 72 | 72 | applied historical pin |

## Version Bump

| Anchor | v4.2 | v4.3 |
|---|---|---|
| runtime data | `runtime-data-2.4.0` | `runtime-data-2.5.0` |
| engine | `engine-2026.06.15-merit-v4.2` | `engine-2026.06.15-merit-v4.3` |
| historical rating | `wc-perf-6.2.0` | `wc-perf-6.3.0` |
| projected rating | `proj-career-5.2.0` | `proj-career-5.3.0` |
| leaderboard season | `..._f8de3452` | `..._923c4a93` |

`runtime-data-2.4.0` is retained under
`packages/data/src/retained-runtime-data/runtime-data-2.4.0/` so the immediately
previous version remains resolvable during N+1 propagation.

Runtime bundle anchors:

- Draft-pool raw bytes: 129,249,025.
- Draft-pool manifest Brotli bucket: 2,209,280.
- Copied draft-pool `.br` bytes: 2,209,180.
- Draft-pool sha256:
  `e9d3a20b7d5cc1dab239bd54c07e45f3f1ccff137b29ca85f3a6176959d8a448`.
- Scenario raw bytes: 108,775.
- Scenario sha256:
  `4e8752ed14c3cd8842e7b8e3f409dddd4a7bb6fa2cd7a10e206ae614fd760d83`.
- Manifest sha256:
  `9c51eea804b537b3772756673b54fc3caffd99ca23498a3b7529918949dd81a0`.
- Ratings lock: 78,403,016 bytes, sha256
  `f8989adbe7271f14c1c142814cd48539c5d68e88ae3731bb30023a5b9a688bd7`.

## Canary And Realism

Strategic canary pick flips are expected for this change. The full explained
artifact is `docs/reports/merit-v4.3-pick-flips-2026-06-15.md`.

- Canary slots compared: 85 picks across 5 fixed seeds.
- Changed picks: 34 / 85.
- Changed player picks: 34.
- Changed manager picks: 0.
- Per-seed changed picks: 2, 8, 8, 7, 9.

Lambda was refit before realism re-lock. Accepted tuple:

- `LAMBDA.BASE = 0.95`
- `LAMBDA.SPREAD = 5.5`
- `LAMBDA.MIN = 0.80`
- `LAMBDA.MAX = 3.40`
- `LAMBDA.W_DEF = 0.70`
- `LAMBDA.W_GK = 0.30`
- `LAMBDA.GAMMA_MID = 0.70`
- `LAMBDA.KO_LAMBDA_FACTOR = 0.82`
- `CHANCES.REGULATION = 50`
- `CHANCES.EXTRA_TIME = 17`
- `LAMBDA_DISP.OUTER_PROB = 0.20`
- `LAMBDA_DISP.A = 0.75`
- `GROUP_OUTER_PROB = 0.04`
- `GROUP_A = 0.40`

Fitter landing: goals 2.514, group draw 25.27%, margin >=4 4.99%, KO->ET
32.67%, shootout 21.73%.

## Gate Log

This table is updated from actual command output before the owner approval
checkpoint. Rows marked PENDING are not claimed as passed.

| Gate | Result |
|---|---|
| `PYTHONPATH=etl/src python3 -m wcdraft_etl.manual_overrides` | PASS: 2,300 / 2,516 matched; 216 unmatched |
| `PYTHONPATH=etl/src python3 -m wcdraft_etl.rating` | PASS: 10,973 historical ratings; null overall 0; baseline estimates 386; RSSSF appearances 1,578 |
| `PYTHONPATH=etl/src python3 -m wcdraft_etl.ingest_2026` | PASS: 1,246 cards; 48 teams; 62 knockout slots |
| `cd etl && ruff check src tests && pytest -q` | PASS: ruff clean; 297 passed |
| `pnpm --filter @wcdraft/data build:compact` | PASS: runtime-data-2.5.0; 12,219 ratings; draft-pool brotli bucket 2,209,280 bytes |
| `pnpm --filter @wcdraft/data test:golden:data` | PASS: 2 files / 31 tests |
| `pnpm --filter @wcdraft/data test:golden:integration` | PASS after fix-forwarding stale e2e seed constant to `...:105`: 2 files / 22 tests |
| `pnpm --filter @wcdraft/data exec vitest run test/realism/strategic-pick-canary.golden.test.ts test/realism-modern-norms.golden.test.ts` | PASS: 2 files / 6 tests; realism landing goals 2.514, draw 25.27%, margin>=4 4.99%, KO->ET 32.67%, shootout 21.73% |
| `pnpm --filter @wcdraft/data test:realism:heavy` | PASS: 1 file / 7 tests |
| `pnpm --filter @wcdraft/web gen:leaderboard-golden` | PASS during artifact regen: season key `..._923c4a93` |
| `pnpm --filter @wcdraft/web test:golden:leaderboard` | PASS: 1 file / 6 tests |
| `pnpm exec turbo run test:golden test:golden:draft --filter=@wcdraft/core --force` | PASS with cache bypass: 2 tasks; 107 tests |
| `pnpm --filter @wcdraft/data test` | PASS after fix-forwarding acceptance semantics for manual pins: 9 files passed / 1 skipped; 74 passed / 7 skipped |
| `pnpm typecheck && pnpm lint && pnpm test && pnpm build` | PASS: typecheck 8 tasks; lint 5 tasks; test 8 tasks (core 366, data 74 + 7 skipped, db 79, marketing-x 64, web 694 + 1 skipped); build 4 tasks |
| `git diff --check` | PASS |
| Fresh-context independent review | PASS fallback: RepoPromptCE worktree binding was unavailable, so `/tmp/wcdraft-merit-v43-review-20260615163949` was created as a detached fresh worktree at the implementation candidate; it re-executed manual override resolution, rating generation, 2026 ingest, contract spot checks, ETL ruff + 297 tests, compact rebuild, data goldens 31 + integration 22, realism/canary 6 + heavy realism 7, web leaderboard golden 6, core RNG/draft goldens 107, OG sign/render 17, and `git diff --check`. A cold-review first web-leaderboard attempt failed before assertions because `@wcdraft/data/dist` was absent; after `pnpm --filter @wcdraft/data build`, the rerun passed. |
| CI | PENDING |
| Merge / deploy / live verify | PENDING owner approval |

## Ship Closeout

- Candidate SHA: see the owner approval checkpoint; not embedded here to avoid
  self-referential SHA churn on a report-only closeout amend.
- PR: PENDING.
- Merge SHA: PENDING owner approval.
- Deploy id: PENDING owner approval.
- Live verify: PENDING owner approval.
- Revert status: PENDING; no merge has happened.
