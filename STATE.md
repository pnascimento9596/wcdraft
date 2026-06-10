# STATE.md — measured ground truth

> Update rule: every lane updates this file in the SAME change that merges.
> Numbers below were MEASURED by running the commands, not assumed — re-measure
> whatever your change touches.

Last measured: 2026-06-10 · main @ `06cca91` (F-4 U3, #70) — branch point of
`ws-meta/train-protocol`.

## Lanes in flight at branch point

- PR #71 `ws-f4/u6-claim` — F-4 U6 anon→account claim bridge (open, in review).
- PR #72 `ws-f4/u5-abuse` — F-4 U5 SubmitRateLimiter + blocklist (open).
- F-4 U4 (leaderboard UI) — lane in progress, no PR yet.

## Shipped versions (repo pins — `packages/data/src/generated/manifest.json`)

| Field                       | Value              |
| --------------------------- | ------------------ |
| schema_version              | runtime-data-1.1.0 |
| dataset_version             | 2026-06-04         |
| ruleset_version             | ruleset-2026.06.04 |
| engine_version              | engine-2026.06.09  |
| rating_version (historical) | wc-perf-4.2.1      |
| rating_version (projected)  | proj-career-3.0.0  |

## Test counts (run 2026-06-10 at `06cca91`)

| Suite                                   | Result                      |
| --------------------------------------- | --------------------------- |
| @wcdraft/core `test`                    | 302 passed, 3 skipped (305) |
| @wcdraft/core `test:golden` (RNG)       | 3 passed                    |
| @wcdraft/core `test:golden:draft`       | 37 passed                   |
| @wcdraft/data `test`                    | 50 passed, 7 skipped (57)   |
| @wcdraft/data `test:golden:data`        | 28 passed                   |
| @wcdraft/data `test:golden:integration` | 10 passed                   |
| @wcdraft/db `test`                      | 74 passed                   |
| @wcdraft/web `test`                     | 422 passed, 1 skipped (423) |
| @wcdraft/web `test:golden:leaderboard`  | 5 passed                    |
| etl `pytest -q`                         | 159 passed                  |
| `pnpm build`                            | 4/4 tasks green             |

## CI (`.github/workflows/`)

- `ci.yml` jobs: **verify** (typecheck·lint·test·build) · **golden** (RNG + draft) ·
  **realism** (heavy asymmetric gate, N=2000 × 3 policies) · **db-gate → db-rollback-check**
  (path-filtered to `packages/db/**`+workflow+lockfile+turbo.json; ephemeral Neon branch,
  never prod) · **etl-rating** (ruff · rating tests · ratings.json byte-determinism).
- `etl.yml`: ingest · identity-QA · determinism, path-filtered to `etl/**`; upstream
  Fjelstul pinned `f41e9437`.
- Triggers (both): PR + push on `main`, `engine-*`, `merit-*`, `season-*`.
- Branch protection requires PR CI; repo auto-merge DISABLED (checks ~7 min; realism ~4 min).

## Deploy reality

Vercel project `wcdraft-web` (team `pnascimento9596s-projects`) → www.wcdraft.com.
**Push/merge to `main` = automatic production deploy.** Build runs
`pnpm turbo run build --filter=@wcdraft/web...` (apps/web/vercel.json).

## Prod env (names only — never record values here)

- SET: `DATABASE_URL`, `AUTH_COOKIE_SECRET` (do NOT rotate) — verified via
  `vercel env ls production` 2026-06-10.
- UNSET (dark by design): `LEADERBOARD_ENABLED`, `LEADERBOARD_REQUIRE_ACCOUNT`,
  `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, `AUTH_BASE_URL` — leaderboard routes 404,
  accounts email path dark (Resend activation is HUMAN-ONLY).
- Neon prod DB: migrations 0000–0004 applied (provisioned + verified live 2026-06-10;
  re-verify with `pnpm --filter @wcdraft/db db:migrate` status before relying on it).

## Branch / merge convention (from git history)

`ws-<area>/<topic>` task branches; long-lived integration branches `engine-*`/`merit-*`
(CI-watched); PRs squash-merge to `main` (one commit per PR); Red merges pinned with
`--match-head-commit`.
