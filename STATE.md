# STATE.md — measured ground truth

> Update rule: every lane updates this file in the SAME change that merges.
> Numbers below were MEASURED by running the commands, not assumed — re-measure
> whatever your change touches.

Last measured: 2026-06-11 · draft-config cumulative merge review on
`engine-draft-config` at `f0a9f5c` plus the fix-forward token-route patch:
`pnpm build && pnpm typecheck && pnpm lint && pnpm test` green (build 4/4
tasks, typecheck 7/7, lint 4/4, test 7/7). Web count is now 594 passed, 1
skipped after integrating current `main` plus the versioned run-token
navigation regression. Compact
rebuild, token skew, leaderboard canonical-config, era honesty, and golden
diff gates were re-executed in the fresh season-merge review. merit-v3 U0 also
measured ETL ruff clean, ETL pytest 199 passed (+17 identity-link tests), 2026
ingest run-twice byte-identical, and linker-conservatism byte-stability for
`source_facts.json`/`link_review.json`/`career_stature.json`. merit-v3 V1
measured ETL ruff clean, focused merit suite 42 passed, full ETL pytest 233
passed, active/stature generation run twice byte-identical, and ratings plus
compact generated artifacts unchanged. Active-career source set stays
`active-career-source-set-2.0.0`; club-season honors is census-locked at 14 rows
/ 9 finals over the 26-player active scope; Alaba 2020 is pinned to UEFA match
2030150 and all 14 cited final pages were re-verified. Club-at-tournament
backfill remains staged for MV2-12b
(`docs/reports/club-backfill-manifest-2026-06-10.md`).
merit-v3 V2 measured ETL ruff clean, focused V2/curve/projected suite 91
passed, full ETL pytest 241 passed, three mutation proofs failed when
deliberately broken, historical artifact generation was two-run byte-identical,
and 2026 outputs plus `career_stature.json` plus compact/runtime artifacts
remained unchanged.

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
- Draft-config season E1+E2+E3 + prep BUILT on the `engine-draft-config` integration
  branch (NOT main): DC-1 `t2.` config token + explicit DraftState config axes
  (#94), DC-2 era-preset bounded sampling (#95), DC-3 position-first state
  machine (#96), then prep bumped anchors to `runtime-data-1.2.0` /
  `engine-2026.06.11`, re-locked compact/era/token/leaderboard/e2e header
  goldens, added the shipped-manifest `current_prod_t1` skew fixture, and
  fixed the terminal position-first coachless dead-end copy. Measured on the
  prep branch before PR review: compact rebuild deterministic; era/token/
  leaderboard generators rerun; e2e seed `:29` unchanged except anchor strings;
  no sim/rating/math paths changed. `Current` basis stays gated on MV2-12b;
  the board rejects every non-canonical config (`NON_CANONICAL_CONFIG`).
  Consolidated fresh-session review found one fix-forward blocker: replay/share
  routing accepted only legacy `t1.` tokens while current shares emit `t2.`;
  the parser now routes versioned `tN.` tokens to the decoder so current tokens
  round-trip and future versions reach the newer-version notice. Season merge to
  main remains Red (review + owner approval). Screenshots:
  `docs/validation/draft-config-2026-06-11/`; build report:
  `docs/reports/draft-config-e1-e3-build-2026-06-11.md`.
- UX: `ws-ux/pitch-realism` is Yellow/display-only (realistic pitch markings +
  low-ink formation mini-pitches), with before/after 390×844 screenshots under
  `docs/validation/ws-ux-pitch-realism/`.
- Brand/marketing assets: `ws-brand/marketing-assets` adds the marketing-only
  medallion/banner intake, generated OG/social PNGs, site-wide static metadata
  wiring, a pick-screen attribution line, and the organic X plan + q-007 queue
  item. In-app SVG mark and PWA icon family remain locked/unchanged.
- MV2-12a active-career intake (`ws-etl/mv212a-active-career-intake`, RED, IN REVIEW):
  facts-only inert channel, 47 facts / 23 players; rating outputs + compact bundles
  byte-identical (see `docs/queue/q-002-mv2-12-candidate.md`). 12b stays DISPATCH-ONLY.
- merit-v3 SEASON DESIGN landed (this change, docs-only):
  `docs/plans/merit-v3-design-2026-06-11.md` on integration branch `merit-v3` —
  D2 activation (person-identity stature seam, stage-normalized active index,
  inertness-guard flips), D1 age-conditioned projected scoring (age_factor retired),
  index-bias mitigation (eligibility re-norm + sparse-fact saturation; archive
  re-research ledgered), award-gated raw-ceiling headroom + curve re-fit, dual-basis
  Career/Current internals materialized for `engine-draft-config`, club backfill in
  the same single skew event. Version matrix: wc-perf-5.0.0 / proj-career-4.0.0 /
  career-stature-3.0.0 / runtime-data-2.0.0 / engine bump. Units U0 (in flight) +
  V1–V8, all DISPATCH-ONLY; acceptance probes pre-registered in plan §7.
- merit-v3 U0 identity-link fix (this change, RED, on `merit-v3` only): the 17
  Audit-2 §H.3 seam misses now LINK (2026 linked census 335→352, minted 911→894,
  minted ids renumbered); 4 staged 12a bridges promoted into the real linker path
  (`identity_2026.IDENTITY_BRIDGES`, mechanism-agreement-guarded); Neymar-2026
  88→93 + legend, Rodri-2026 88→90 + legend (both inside plan §7 probe bands);
  80 further cards +1 single-channel (weight==0 quantile-pool shift, zero
  negative). `*_2026.json` + merit active staging re-locked ON BRANCH; NO version
  bumps / compact regen / canary / λ (V6–V8 own those). 5 near-miss identity
  candidates surfaced for human verification (PR table) — withheld, not linked.
- merit-v3 V1 stature core fix-forward (this change, PR #91): top-tier
  continental club honors intake is now an explicit scope x finals-registry
  census (14 rows over 26 active-scope players), with completeness tested from
  manifest metadata; Alaba 2020 is re-pinned from UEFA match 2029490 to 2030150,
  and the active-note verification ledger confirms all 14 cited final pages name
  the player. Active/archive access now fails unresolved identity bridges before
  stature merge, with mutation proof in the test suite; V1 report, delta CSV, and
  STATE updated. No compact goldens or rating consumer artifacts changed.
- merit-v3 V2 historical re-score (this change, RED, in review): historical
  rating now consumes the full `career-stature-3.0.0` table, applies award-gated
  raw headroom, participation-scaled finish/down-cap mechanics, and emits
  additive Career/Current basis payloads while keeping the top-level surface
  Career-compatible. `ratings.json`, `MERIT_V2_SAMPLE.md`, and the review-only
  merit divergence artifact are re-locked; `ratings_2026.json`,
  `career_stature.json`, compact/runtime goldens, canary, and lambda/realism
  goldens remain untouched. V4 owns curve refit and final probe gate; V6/V7 own
  compact/canary/lambda.

## Shipped versions (repo pins — `packages/data/src/generated/manifest.json`)

| Field                       | Value              |
| --------------------------- | ------------------ |
| schema_version              | runtime-data-1.2.0 |
| dataset_version             | 2026-06-04         |
| ruleset_version             | ruleset-2026.06.04 |
| engine_version              | engine-2026.06.11  |
| rating_version (historical) | wc-perf-4.2.1      |
| rating_version (projected)  | proj-career-3.0.0  |

## Test counts (run 2026-06-11; draft-config cumulative review + token-route fix-forward)

| Suite                                                   | Result                      |
| ------------------------------------------------------- | --------------------------- |
| @wcdraft/core `test`                                    | 331 passed, 3 skipped (334) |
| @wcdraft/core `test:golden` (RNG)                       | 3 passed                    |
| @wcdraft/core `test:golden:draft`                       | 37 passed                   |
| @wcdraft/data `test`                                    | 62 passed, 7 skipped (69)   |
| @wcdraft/data `test:golden:data`                        | 28 passed                   |
| @wcdraft/data `test:golden:integration`                 | 22 passed                   |
| @wcdraft/db `test`                                      | 74 passed                   |
| @wcdraft/web `test`                                     | 594 passed, 1 skipped (595) |
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
| `pnpm build && pnpm typecheck && pnpm lint && pnpm test` | build 4/4 · typecheck 7/7 · lint 4/4 · test 7/7 |

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
