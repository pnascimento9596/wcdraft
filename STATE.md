# STATE.md — measured ground truth

> Update rule: every lane updates this file in the SAME change that merges.
> Numbers below were MEASURED by running the commands, not assumed — re-measure
> whatever your change touches.

Last measured: 2026-06-11 · web count re-measured on ws-ux/tap-stability-2
rebased onto main `a640fb7` (pitch-realism): 548 passed (+8 tap-stability/
build-stamp tests on top of pitch-realism's 540). Other counts from the
2026-06-11 forced full gate on ws-ux/pitch-realism (16/16 tasks green).
Club-at-tournament backfill remains staged for MV2-12b
(`docs/reports/club-backfill-manifest-2026-06-10.md`).

## Lanes in flight at last measurement

- F-4 U1–U6 all MERGED on main (U5 = PR #72, this change). Remaining F-4: U7 ranked
  lane (dark, blocked on plan §10 Q2) + the HUMAN-gated light-up checklist
  (`docs/queue/q-003-f4-remaining.md`).
- MV2-12 audits: Audit-1 (`docs/reports/mv212-ratings-audit-2026-06-10.md`) +
  Audit-2 face-validity sweep (`docs/reports/mv212-face-validity-2026-06-10.md`,
  this change — report-only, zero runtime change; reproduction re-proven
  12,219/12,219 at `b4f8651`). Audit-2 surfaces a P0 data defect: 17 minted-2026
  identity link misses (Neymar/Rodri live distortion) — fix unit pending dispatch.
- Draft config deep plan (`docs/plans/draft-config-2026-06-10.md`) + queue mirror
  (`docs/queue/q-006-draft-config.md`) staged on `ws-plan/draft-config` off
  `dbc1f0a` — docs-only, zero runtime change. Plan default: `t2` token schema,
  v1 era presets only, `Current` rating basis gated on MV2-12b, and a future
  `engine-draft-config` integration branch for implementation.
- UX: `ws-ux/pitch-realism` is Yellow/display-only (realistic pitch markings +
  low-ink formation mini-pitches), with before/after 390×844 screenshots under
  `docs/validation/ws-ux-pitch-realism/`.

## Shipped versions (repo pins — `packages/data/src/generated/manifest.json`)

| Field                       | Value              |
| --------------------------- | ------------------ |
| schema_version              | runtime-data-1.1.0 |
| dataset_version             | 2026-06-04         |
| ruleset_version             | ruleset-2026.06.04 |
| engine_version              | engine-2026.06.09  |
| rating_version (historical) | wc-perf-4.2.1      |
| rating_version (projected)  | proj-career-3.0.0  |

## Test counts (run 2026-06-11; forced Turbo gate on `ws-ux/pitch-realism`)

| Suite                                                   | Result                      |
| ------------------------------------------------------- | --------------------------- |
| @wcdraft/core `test`                                    | 302 passed, 3 skipped (305) |
| @wcdraft/core `test:golden` (RNG)                       | 3 passed                    |
| @wcdraft/core `test:golden:draft`                       | 37 passed                   |
| @wcdraft/data `test`                                    | 50 passed, 7 skipped (57)   |
| @wcdraft/data `test:golden:data`                        | 28 passed                   |
| @wcdraft/data `test:golden:integration`                 | 10 passed                   |
| @wcdraft/db `test`                                      | 74 passed                   |
| @wcdraft/web `test`                                     | 548 passed, 1 skipped (549) |
| @wcdraft/web `test:golden:leaderboard`                  | 5 passed                    |
| etl `pytest -q`                                         | 159 passed                  |
| `pnpm exec turbo run typecheck lint test build --force` | 16/16 tasks green, 0 cached |

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
