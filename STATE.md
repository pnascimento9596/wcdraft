# STATE.md — measured ground truth

> Update rule: every lane updates this file in the SAME change that merges.
> Numbers below were MEASURED by running the commands, not assumed — re-measure
> whatever your change touches.

Last measured: 2026-06-12 · merit-v3 V8 prep on the rebased integration head.
`merit-v3` was rebased onto main after draft-config shipped
(`origin/main` `18cdbef`, prod manifest `runtime-data-1.2.0` /
`engine-2026.06.11`). Phase 3 revalidation at rebased head `00dc7e2` was green:
root `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, all core/data/web
goldens, ETL ruff + pytest, heavy realism, and token fuzz/skew. V8 then landed the
season's single engine stamp (`engine-2026.06.12`), regenerated compact manifest,
e2e/era/leaderboard/canary/asymmetric goldens, and refreshed the committed
production PREV skew fixture from the now-live draft-config manifest commit
`18cdbef10fa41debff396c398adf52f4639fd34b`.

merit-v3 as-built facts: U0 linked the 17 Audit-2 2026 identity misses; V1 emitted
`career-stature-3.0.0` with active-career source set
`active-career-source-set-2.0.0` and the club-season honors census; V2 emitted
`wc-perf-5.0.0`; V3 emitted `proj-career-4.0.0`; V4 re-fit the shared display curve
as `unified_pooled_piecewise_power_v2`; V5 backfilled historical club-at-tournament
coverage; V6 emitted `runtime-data-2.0.0` dual-basis compact data and locked the
source-derived legend census at 270; V7 refit lambda and realism bands; V8 owns the
single public engine stamp and season merge docs. Current shipped basis remains
Career; Current is materialized in `basis_ratings.current` for draft-config use.

Open acceptance items are not hidden: the §7 waiver ledger contains the pre-registered
misses (Yamal, Haaland, Valverde-2026, Neymar-2026, Lukaku, B. Fernandes, Kocsis card,
Cruyff-1974 card, pile-up, inversion, 9 pre-1967 coherence violations, legend census
302→270, and Dembélé non-material legend). Those require owner waiver or targeted
fix-forward before main merge.

## Lanes in flight at last measurement

- merit-v3 V8 is in final prep/review. Main merge is still blocked until the
  cumulative fresh-context review passes and the owner approves the exact SHA plus
  the waiver table.
- Draft-config is already shipped on main and production as
  `runtime-data-1.2.0` / `engine-2026.06.11`; it is now the committed PREV skew
  artifact for merit-v3.
- F-4 U1–U6 are live; remaining account/email light-up is still gated on owner-held
  Resend/auth secrets. Ranked leaderboard remains human-gated.
- Post-season backlog starts with the full archive re-research wave for unsung-role
  and pre-1967 legend-coherence gaps; this was deliberately ledgered out of merit-v3.

## Shipped versions (repo pins — `packages/data/src/generated/manifest.json`)

| Field                       | Value              |
| --------------------------- | ------------------ |
| schema_version              | runtime-data-2.0.0 |
| dataset_version             | 2026-06-04         |
| ruleset_version             | ruleset-2026.06.04 |
| engine_version              | engine-2026.06.12  |
| rating_version (historical) | wc-perf-5.0.0      |
| rating_version (projected)  | proj-career-4.0.0  |
| career_stature              | career-stature-3.0.0 |
| active source set           | active-career-source-set-2.0.0 |
| runtime legend census       | 270                |
| runtime ratings             | 12,219             |
| leaderboard season key      | engine-2026.06.12_wc-perf-5.0.0+proj-career-4.0.0_2026-06-04_ruleset-2026.06.04_03bc6434 |
| compact brotli total        | 1,216,305 bytes    |

## Test counts (latest measured on V8 final local diff)

| Suite                                                   | Result                      |
| ------------------------------------------------------- | --------------------------- |
| @wcdraft/core `test`                                    | 331 passed, 3 skipped (334) |
| @wcdraft/core `test:golden` (RNG)                       | 3 passed                    |
| @wcdraft/core `test:golden:draft`                       | 37 passed                   |
| @wcdraft/data `test`                                    | 65 passed, 7 skipped (72)   |
| @wcdraft/data `test:golden:data`                        | 31 passed                   |
| @wcdraft/data `test:golden:integration`                 | 22 passed                   |
| @wcdraft/db `test`                                      | 74 passed                   |
| @wcdraft/web `test`                                     | 595 passed, 1 skipped (596) |
| @wcdraft/web `test:golden:leaderboard`                  | 5 passed                    |
| etl V1 `ruff check src tests`                           | clean                       |
| etl V1 focused merit suite                              | 42 passed                   |
| etl V1 `pytest -q`                                      | 233 passed                  |
| merit-v3 V1 club-season citation verifier               | 14/14 rows verified         |
| merit-v3 V1 active/stature generation                   | two-run byte-identical hash match |
| merit-v3 V1 conservatism                                | ratings + compact generated artifacts unchanged |
| etl V2 `ruff check src tests`                           | clean                       |
| etl V2 focused rating/display/projected suite            | 91 passed                   |
| etl V2 `pytest -q`                                      | 241 passed                  |
| merit-v3 V2 mutation proofs                             | 3/3 guards failed when deliberately broken |
| merit-v3 V2 historical artifact generation              | two-run byte-identical hash match |
| merit-v3 V2 conservatism                                | 2026 outputs + career_stature + compact unchanged |
| etl V3/V4 `ruff check src tests`                        | clean                       |
| etl V3/V4 `pytest -q`                                   | 288 passed                  |
| merit-v3 V3/V4 §7 movers/controls                       | 14 in-band, 6 pinned-miss elements; controls 7/7 evaluable pass |
| merit-v3 V3/V4 distribution/coherence probes             | median and 90+ pass; pile-up, inversion, and 9 pre-1967 violations pinned for V8 waiver |
| merit-v3 V3/V4 determinism                              | both stage orders run-twice byte-identical |
| merit-v3 V3/V4 boundary                                 | career_stature, canonical tables, compact, canary, lambda/realism untouched |
| merit-v3 V6 compact regen                               | 12,219 ratings · 270 legends · dual basis 12,219/12,219 · 1,216,302 bytes before V8 stamp |
| merit-v3 V7 lambda                                      | evals 175 · winner BASE 1.05 / SPREAD 6.5 / MIN 0.70 / GAMMA_MID 0.80 / KO 0.82 |
| merit-v3 V8 compact stamp                               | `build:compact` ok · 12,219 ratings · 270 legends · 1,216,305 bytes |
| merit-v3 V8 generators                                  | e2e seed `:29`, era, leaderboard, token-skew, canary, asym realism regenerated |
| `pnpm typecheck && pnpm lint && pnpm test && pnpm build` | PASS on V8 final local diff: typecheck 7/7 · lint 4/4 · test 7/7 · build 4/4 |
| V8 explicit goldens + ETL + heavy realism              | core 3 + 37 · data 31 + 22 · web leaderboard 5 · ETL ruff clean / pytest 288 · heavy realism 7/7 |
| V8 regen byte-stability                                | compact/e2e/era/canary/asym/leaderboard/token-skew output hashes unchanged after rerun |

## CI (`.github/workflows/`)

- `ci.yml` jobs: **dedupe** (skips push-event runs when the pushed branch has an open
  PR — the pull_request run still gates; q-008) · **verify** (typecheck·lint·test·build) · **golden** (RNG + draft) ·
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
