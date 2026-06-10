# STATE.md — measured ground truth

> Update rule: every lane updates this file in the SAME change that merges.
> Numbers below were MEASURED by running the commands, not assumed — re-measure
> whatever your change touches.

Last measured: 2026-06-10 · counts run at `9c71219` (= U5 rebased onto main
`63a403d`, #73) in a fresh clone; merged with a docs-only delta — counts unaffected.

## Lanes in flight at last measurement

- F-4 U1–U6 all MERGED on main (U5 = PR #72). LIGHT-UP EXECUTED 2026-06-10Z (dispatched):
  casual leaderboard LIVE on www.wcdraft.com behind `LEADERBOARD_ENABLED=1` + turbo build-env
  fix #75 (`48d87c0`); live verification 10/10 PASS
  (`docs/reports/f4-lightup-verification-2026-06-10.md`). Remaining F-4: U7 ranked lane
  (dark, blocked on plan §10 Q2).

## Shipped versions (repo pins — `packages/data/src/generated/manifest.json`)

| Field                       | Value              |
| --------------------------- | ------------------ |
| schema_version              | runtime-data-1.1.0 |
| dataset_version             | 2026-06-04         |
| ruleset_version             | ruleset-2026.06.04 |
| engine_version              | engine-2026.06.09  |
| rating_version (historical) | wc-perf-4.2.1      |
| rating_version (projected)  | proj-career-3.0.0  |

## Test counts (run 2026-06-10 at `9c71219`)

| Suite                                   | Result                      |
| --------------------------------------- | --------------------------- |
| @wcdraft/core `test`                    | 302 passed, 3 skipped (305) |
| @wcdraft/core `test:golden` (RNG)       | 3 passed                    |
| @wcdraft/core `test:golden:draft`       | 37 passed                   |
| @wcdraft/data `test`                    | 50 passed, 7 skipped (57)   |
| @wcdraft/data `test:golden:data`        | 28 passed                   |
| @wcdraft/data `test:golden:integration` | 10 passed                   |
| @wcdraft/db `test`                      | 74 passed                   |
| @wcdraft/web `test`                     | 526 passed, 1 skipped (527) |
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
- SET: `LEADERBOARD_ENABLED=1` (casual leaderboard LIVE 2026-06-10Z, light-up report
  `docs/reports/f4-lightup-verification-2026-06-10.md`). Stored as a PLAIN (non-sensitive)
  var ON PURPOSE: the flag must be visible at build time (static layout nav gating +
  prerenders) and sensitive vars are runtime-only. It must also stay declared in root
  `turbo.json` `build.env` (PR #75) or Vercel's strict turbo env strips it from the build.
- UNSET (dark by design): `LEADERBOARD_REQUIRE_ACCOUNT` (anonymous-first casual posture),
  `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, `AUTH_BASE_URL` — ranked lane dark (U7 unbuilt,
  submit `mode:"ranked"` → 403), accounts email path dark (Resend activation is HUMAN-ONLY).
- Neon prod DB: migrations 0000–0004 applied (provisioned + verified live 2026-06-10;
  re-verify with `pnpm --filter @wcdraft/db db:migrate` status before relying on it).

## Branch / merge convention (from git history)

`ws-<area>/<topic>` task branches; long-lived integration branches `engine-*`/`merit-*`
(CI-watched); PRs squash-merge to `main` (one commit per PR); Red merges pinned with
`--match-head-commit`.
