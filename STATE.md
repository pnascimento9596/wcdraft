# STATE.md — measured ground truth

> Update rule: every lane updates this file in the SAME change that merges.
> Numbers below were MEASURED by running the commands, not assumed — re-measure
> whatever your change touches.

Last measured for leaderboard-profiles in-flight work: 2026-06-13 ·
`origin/leaderboard-profiles` `af7b002f5a7d8f0427f85a2fc94c7549012cab44`
plus local post-main-sync validation against `origin/main`
`595049b0afd6779ca3c3f8ab1443d6e51866321c`. Production/main facts below remain
from the prior 2026-06-12 measurement unless explicitly noted: after the merit-v3
V8 season merge (#104, squash `1552e44`), the leaderboard runtime-data hotfix
(#105, squash `a0d0828`), and accounts/email production light-up/docs (#108/#109).
The live repo pins are now `runtime-data-2.0.0` / `engine-2026.06.12`; draft-config's
`runtime-data-1.2.0` / `engine-2026.06.11` anchors are historical PREV-skew
fixtures, not the current production season.

merit-v3 as-built facts: U0 linked the 17 Audit-2 2026 identity misses; V1 emitted
`career-stature-3.0.0` with active-career source set
`active-career-source-set-2.0.0` and the club-season honors census; V2 emitted
`wc-perf-5.0.0`; V3 emitted `proj-career-4.0.0`; V4 re-fit the shared display curve
as `unified_pooled_piecewise_power_v2`; V5 backfilled historical club-at-tournament
coverage; V6 emitted `runtime-data-2.0.0` dual-basis compact data and locked the
source-derived legend census at 270; V7 refit lambda and realism bands; V8 owns the
single public engine stamp and season merge docs. The default basis is Career;
the Current basis (materialized in `basis_ratings.current`) is now SELECTABLE at
setup and rides the existing t2 token — a Current run re-rates the user squad
from `basis_ratings.current` for both display and sim, and is non-canonical
(casual-only, honest `NON_CANONICAL_CONFIG` 422 on the ranked board).

Merit-v3 shipped with its §7 waiver ledger preserved, not erased: Yamal, Haaland,
Valverde-2026, Neymar-2026, Lukaku, B. Fernandes, Kocsis card, Cruyff-1974 card,
pile-up, inversion, 9 pre-1967 coherence violations, legend census 302→270, and
Dembélé non-material legend remain documented carryovers / waived misses rather
than hidden regressions.

## Lanes in flight at last measurement

- merit-v3 V8 is live on main/prod via #104; #105 then hotfixed leaderboard
  runtime-data loading from public assets without changing engine/data contracts.
- Draft-config's shipped `runtime-data-1.2.0` / `engine-2026.06.11` anchors are now
  committed PREV-skew artifacts after merit-v3, not current production anchors.
- F-4 U1–U6 are live; accounts/email light-up is **LIVE** as of 2026-06-12
  (Resend domain `wcdraft.com` verified, `RESEND_API_KEY` + `AUTH_EMAIL_FROM` +
  `AUTH_BASE_URL` set in Vercel Production, magic-link verify proven end-to-end
  with a real owner sign-in). Ranked leaderboard remains human-gated
  (`LEADERBOARD_REQUIRE_ACCOUNT` still UNSET — casual board only).
- Leaderboard-profiles Red season is in flight on integration branch
  `leaderboard-profiles`: L1 schema/profiles (#114), L2 ranked-requires-account
  (#117), and L3 Memory ranked lane (#122; squash `d6569175`) are landed into the
  integration branch. L4 local board-display/privacy work adds a route-level public
  payload email sweep across all 17 currently exported `apps/web/app/api/**/route.ts`
  methods beyond the leaderboard serializer, pins React text escaping for username/alias
  rendering, and captures Classic/Memory board screenshots in light/dark themes at
  390×844 / 360×800. No schema, core, data, or golden fixtures were changed.
- Auth hardening mop-up is in flight on `auth/base-url-gate`: `AUTH_BASE_URL`
  now participates in the ship-dark auth gate, and production magic-link
  verify URLs must be https and non-localhost before any token is persisted or
  email is sent. With all three production auth env names set, prod remains
  light-up equivalent; missing any one stays honestly dark.
- `ws-wrap/post-season` is the current Yellow post-season wrap wave: service-worker
  registration timing, results/share config badges, position-first lock-bar copy, and
  doc-truth reconciliation. It must not touch schema/contracts/sim/rating/synergy/
  draft-sampling/entitlements; any such need is dropped and ledgered.
- Post-season backlog still includes the full archive re-research wave for unsung-role
  and pre-1967 legend-coherence gaps; this was deliberately ledgered out of merit-v3.
- `ws-ux/mobile-content` (Yellow) shipped the draft-screen mobile horizontal-overflow
  fix (`.candList` collapsible grid track — see
  `docs/investigations/draft-mobile-overflow-2026-06-12.md`) and the as-shipped
  how-to-play rewrite (scaffold removed). Display/content only; goldens untouched.
  The Current-basis enablement (sim wiring, in-draft visibility, disclosure
  default-open, basis copy + the MV2-12b/selected-basis stale-language sweep) is the
  paired RED lane `ui/ux-basis-wave`, held for fresh-session review + pinned approval.
- `ui/ux-basis-wave` (RED) ENABLES the Current rating basis end-to-end: setup
  control selectable + disclosure default-open + factual basis copy; the display
  adapter and `buildSimWorldInputs` both resolve `basis_ratings.current` for a
  Current run (the sim genuinely consumes the Current channels — not display-
  only); a CURRENT chip on the squad/card surfaces (config, survives Memory
  blinding); leaderboard still refuses Current as `NON_CANONICAL_CONFIG`. The
  Career path is byte-identical (goldens untouched, no regen; heavy realism 7/7).
  Stale MV2-12b/selected-basis gate language swept from code comments + setup.

## Shipped versions (repo pins — `packages/data/src/generated/manifest.json`)

| Field                       | Value                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| schema_version              | runtime-data-2.0.0                                                                       |
| dataset_version             | 2026-06-04                                                                               |
| ruleset_version             | ruleset-2026.06.04                                                                       |
| engine_version              | engine-2026.06.12                                                                        |
| rating_version (historical) | wc-perf-5.0.0                                                                            |
| rating_version (projected)  | proj-career-4.0.0                                                                        |
| career_stature              | career-stature-3.0.0                                                                     |
| active source set           | active-career-source-set-2.0.0                                                           |
| runtime legend census       | 270                                                                                      |
| runtime ratings             | 12,219                                                                                   |
| leaderboard season key      | engine-2026.06.12_wc-perf-5.0.0+proj-career-4.0.0_2026-06-04_ruleset-2026.06.04_03bc6434 |
| compact brotli total        | 1,216,305 bytes                                                                          |

## Test counts (latest relevant measurements; branch noted where not main)

| Suite                                                     | Result                                                                                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| @wcdraft/core `test`                                      | 338 passed (ui/ux-basis-wave: current-basis recorded, no longer refused)                                  |
| @wcdraft/core `test:golden` (RNG)                         | 3 passed                                                                                                  |
| @wcdraft/core `test:golden:draft`                         | 40 passed (entity-resolution and manager-identity goldens now wired)                                      |
| @wcdraft/data `test`                                      | 65 passed, 7 skipped (72)                                                                                 |
| @wcdraft/data `test:golden:data`                          | 31 passed                                                                                                 |
| @wcdraft/data `test:golden:integration`                   | 22 passed                                                                                                 |
| @wcdraft/db `test`                                        | 74 passed                                                                                                 |
| @wcdraft/web `test` (ui/ux-basis-wave on main)            | 634 passed, 1 skipped (635) (+rating-basis seam/divergence/determinism tests)                             |
| @wcdraft/web `test` (leaderboard-profiles L4)             | 653 passed, 1 skipped (654)                                                                               |
| @wcdraft/web `test` (leaderboard-profiles main-sync)      | 665 passed, 1 skipped (666)                                                                               |
| @wcdraft/web `test:golden:leaderboard` (main)             | 5 passed                                                                                                  |
| @wcdraft/web `test:golden:leaderboard` (L4)               | 6 passed                                                                                                  |
| @wcdraft/marketing-x `test`                               | 64 passed (engine parity, composer/lexicon, pipeline, queue, X client, engagement, weekly pack/banks)     |
| etl V1 `ruff check src tests`                             | clean                                                                                                     |
| etl V1 focused merit suite                                | 42 passed                                                                                                 |
| etl V1 `pytest -q`                                        | 233 passed                                                                                                |
| merit-v3 V1 club-season citation verifier                 | 14/14 rows verified                                                                                       |
| merit-v3 V1 active/stature generation                     | two-run byte-identical hash match                                                                         |
| merit-v3 V1 conservatism                                  | ratings + compact generated artifacts unchanged                                                           |
| etl V2 `ruff check src tests`                             | clean                                                                                                     |
| etl V2 focused rating/display/projected suite             | 91 passed                                                                                                 |
| etl V2 `pytest -q`                                        | 241 passed                                                                                                |
| merit-v3 V2 mutation proofs                               | 3/3 guards failed when deliberately broken                                                                |
| merit-v3 V2 historical artifact generation                | two-run byte-identical hash match                                                                         |
| merit-v3 V2 conservatism                                  | 2026 outputs + career_stature + compact unchanged                                                         |
| etl V3/V4 `ruff check src tests`                          | clean                                                                                                     |
| etl V3/V4 `pytest -q`                                     | 288 passed                                                                                                |
| merit-v3 V3/V4 §7 movers/controls                         | 14 in-band, 6 pinned-miss elements; controls 7/7 evaluable pass                                           |
| merit-v3 V3/V4 distribution/coherence probes              | median and 90+ pass; pile-up, inversion, and 9 pre-1967 violations pinned for V8 waiver                   |
| merit-v3 V3/V4 determinism                                | both stage orders run-twice byte-identical                                                                |
| merit-v3 V3/V4 boundary                                   | career_stature, canonical tables, compact, canary, lambda/realism untouched                               |
| merit-v3 V6 compact regen                                 | 12,219 ratings · 270 legends · dual basis 12,219/12,219 · 1,216,302 bytes before V8 stamp                 |
| merit-v3 V7 lambda                                        | evals 175 · winner BASE 1.05 / SPREAD 6.5 / MIN 0.70 / GAMMA_MID 0.80 / KO 0.82                           |
| merit-v3 V8 compact stamp                                 | `build:compact` ok · 12,219 ratings · 270 legends · 1,216,305 bytes                                       |
| merit-v3 V8 generators                                    | e2e seed `:29`, era, leaderboard, token-skew, canary, asym realism regenerated                            |
| `pnpm exec turbo run typecheck lint test build --force`   | PASS on post-season wrap final local diff: 16/16 tasks · 0 cached                                         |
| V8 explicit goldens + ETL + heavy realism                 | core 3 + 37 · data 31 + 22 · web leaderboard 5 · ETL ruff clean / pytest 288 · heavy realism 7/7          |
| V8 regen byte-stability                                   | compact/e2e/era/canary/asym/leaderboard/token-skew output hashes unchanged after rerun                    |
| post-season focused web tests                             | SW registration/cache + config badges/copy: 28 passed                                                     |
| post-season browser proof                                 | local production build: 12 screenshots · SW registered · stale test caches evicted · console errors 0     |
| leaderboard-profiles L3 focused suite                     | validation + golden + submit + board + UI + serializer: 145 passed                                        |
| leaderboard-profiles L3 lane mutation proof               | disabling the token.md<->draft_mode guard failed validate + submit cross-lane tests; restored 77 passed   |
| leaderboard-profiles L4 focused privacy/UI suite          | all exported API-method public-payload email sweep + UI render/XSS guards: 37 passed                      |
| leaderboard-profiles L4 screenshots                       | 4 local Playwright captures: Classic/Memory x light/dark at 390x844 / 360x800; rendered email probe false |
| @wcdraft/web `build` (leaderboard-profiles L4)            | PASS; existing Next/Webpack circular chunk warnings only                                                  |
| leaderboard-profiles main-sync focused suite              | privacy sweep + UI gating + board-view tests: 49 passed                                                   |
| @wcdraft/web `typecheck` (leaderboard-profiles main-sync) | PASS                                                                                                      |
| @wcdraft/web `build` (leaderboard-profiles main-sync)     | PASS; existing Next/Webpack circular chunk warnings only                                                  |

## CI (`.github/workflows/`)

- `ci.yml` jobs: **dedupe** (skips push-event runs when the pushed branch has an open
  PR — the pull_request run still gates; q-008) · **verify** (typecheck·lint·test·build) · **golden** (RNG + draft) ·
  **realism** (heavy asymmetric gate, N=2000 × 3 policies) · **db-gate → db-rollback-check**
  (path-filtered to `packages/db/**`+workflow+lockfile+turbo.json; ephemeral Neon branch,
  never prod) · **etl-rating** (ruff · rating tests · ratings.json byte-determinism).
- `etl.yml`: ingest · identity-QA · determinism, path-filtered to `etl/**`; upstream
  Fjelstul pinned `f41e9437`.
- `marketing-x.yml` (q-007): **ZERO-API content-pack model.** @WCDraft has no X API
  credits — both `POST /2/tweets` AND search return 402 `CreditsDepleted` — and the owner
  will not buy credits, so there is NO automated posting. The workflow is a weekly `pack`
  job (Mondays 06:00 UTC + `workflow_dispatch`) that runs the composer → commits
  `marketing/x/packs/pack-YYYY-WW.md` + refreshed `reply-bank.md`/`quote-bank.md` to main
  with `[skip ci]`. The owner schedules posts by hand via X's native composer
  (`marketing/x/ROUTINE.md`). The live poster (`run-poster`/`run-engagement`) + X client
  stay built + tested but DORMANT behind `MARKETING_PAUSED=true` (currently set); they
  activate only if credits are ever loaded. Secrets `X_API_KEY/.../X_BEARER_TOKEN` remain
  in repo Actions secrets (unused under the pack model). Browser-automation posting is
  forbidden (X ToS).
- Triggers (both): PR + push on `main`, `engine-*`, `merit-*`, `season-*`.
- Branch protection requires PR CI; repo auto-merge DISABLED (checks ~7 min; realism ~4 min).

## Deploy reality

Vercel project `wcdraft-web` (team `pnascimento9596s-projects`) → www.wcdraft.com.
**Push/merge to `main` = automatic production deploy.** Build runs
`pnpm turbo run build --filter=@wcdraft/web...` (apps/web/vercel.json).

## Prod env (names only — never record values here)

- SET: `DATABASE_URL`, `AUTH_COOKIE_SECRET` (do NOT rotate), `LEADERBOARD_ENABLED`,
  `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, `AUTH_BASE_URL` — verified via
  `vercel env ls production` 2026-06-12. All three auth env names are also
  declared in `turbo.json`'s `tasks.build.env` so the SSG'd root layout
  prerenders `authEnabled:true` (see PR #108).
- UNSET in current production pre-season-merge: `LEADERBOARD_REQUIRE_ACCOUNT`.
  On the in-flight `leaderboard-profiles` integration branch, ranked submit no
  longer has an anonymous-open OFF state; ranked requires an account in code.
- Neon prod DB: migrations 0000–0004 applied (provisioned + verified live 2026-06-10;
  re-verify with `pnpm --filter @wcdraft/db db:migrate` status before relying on it).
- GitHub **Actions secrets** (not Vercel): `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`,
  `X_ACCESS_SECRET`, `X_BEARER_TOKEN` (q-007 marketing). Repo **vars** govern the lane:
  `MARKETING_PAUSED` (kill switch, default off), `MARKETING_LIVE` (default off → dry-run),
  `MARKETING_DAILY_CAP` (optional, clamped to 6).

## Branch / merge convention (from git history)

`ws-<area>/<topic>` task branches; long-lived integration branches `engine-*`/`merit-*`
(CI-watched); PRs squash-merge to `main` (one commit per PR); Red merges pinned with
`--match-head-commit`.
