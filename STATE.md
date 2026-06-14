# STATE.md — measured ground truth

> Update rule: every lane updates this file in the SAME change that merges.
> Numbers below were MEASURED by running the commands, not assumed — re-measure
> whatever your change touches.

Last measured for perf-delivery Red season:
2026-06-14 · branch `perf-delivery` off `origin/main`
`c5eb8e8` after merit-v4.1 merged. Local runtime-data anchor remains:
`runtime-data-2.3.0` / `engine-2026.06.14-merit-v4.1` / `wc-perf-6.1.0` /
`proj-career-5.1.0`, legend census `295`, career-stature-estimate `541`, dataset
`2026-06-04`, ruleset `ruleset-2026.06.04`. Local leaderboard season key:
`engine-2026.06.14-merit-v4.1_wc-perf-6.1.0+proj-career-5.1.0_2026-06-04_ruleset-2026.06.04_11cbbd5e`.

perf-delivery is DELIVERY-only over the current merit-v4.1 compact bytes:
`draft-pool.compact.json` remains `101,026,822` decompressed bytes with sha256
`f0f76fd3c2f8d003a3ee5062957220c591431e37fc6ea54daa689c6e992e11b7`.
The browser delivery path moves to
`/data/wcdraft/runtime-data-2.3.0/draft-pool.compact.json.br`, generated at
Brotli quality 11 and measured locally at `1,429,691` encoded bytes; decompressed
sha256 equals the manifest draft-pool sha. The fixed legacy `/data/wcdraft/*`
paths remain copied for old clients/server filesystem readers. The SW precache
now targets the versioned compressed artifact, not the raw draft-pool path.

merit-v4 as-built facts: ratings now use individual merit contextualized by a
public national-team-strength prior and objective club achievement. The
national-strength prior is built from World Football Elo all-years plus official
FIFA ranking snapshots from 1994 onward; it replaces the old nation-blind raw-only
`0.62` ceiling with a smooth `(tournament, nation)` prior from `0.500` to `0.625`.
The `club_honors` family is active for public-factual internal inputs only
(major club trophies, continental club titles, league top-scorer by goals,
world-record/era-defining transfer facts). Fan-vote/proprietary-ratings exclusion
still stands.

The merit-v3.1 88-wall STOP is retired, not deleted. The STOP was correct for the
old merit-v3.1 request because a global `<=4% at any display value` wall conflicts
with fixed median/control constraints by pigeonhole lower bound. merit-v4 changes
the internal layer instead: `raw_only_ceiling == 0.62` goes `10,735 -> 0`, exact
`raw_only_score == 0.62` goes `1,162 -> 0`, the 88 display share falls from
`1,358 / 11.114%` to `685 / 5.606%`, and the old pigeonhole-vs-fixed-median
incompatibility no longer binds as a release blocker. Residual low-band clustering
and the legacy measured-vs-measured cross-era inversion metric remain explicit
carryovers, not hidden regressions.

merit-v4 anchor deltas: Son 2022 `81 -> 89`, Bale 2022 `82 -> 90`, Ibrahimović
2002/2006 holds `90`, Haaland 2026 `98 -> 92` under active-career cap, Saudi
Arabia 2022 weak-nation wall collapses to max `79`, South Korea 2022 spreads
`68-89` with Son on top, pooled `90+` is `290 / 12,219 = 2.373%`, and the
strategic-pick canary was intentionally regenerated with 6 documented pick flips.

merit-v4.1 anchor deltas: Son 2026 holds `90` (acceptance `>=88`), Salem
Al-Dawsari 2026 moves `77 -> 86` and becomes top Saudi, AFC coverage moves
`0/7 -> 7/7` squads with material headroom, CONCACAF moves `0/5 -> 5/5`, CAF
moves `2/8 -> 4/8`, pooled `90+` is `290 / 12,219 = 2.373%`, and the strategic
pick canary was intentionally regenerated with 2 documented pick flips. The
league-of-employment prior is reduced from dominant context to smooth context
(`FW/MF/DF/GK` weights `0.31/0.34/0.31/0.28 -> 0.18/0.20/0.18/0.16`) and the
projected-only objective-record pathway is limited to active current facts plus
the under-covered AFC/CAF/CONCACAF 2026 squad set.

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
- Leaderboard-profiles Red season shipped on main as `12dd2b934760a2deac8670b195b932ef4f2638a2`:
  L1 schema/profiles (#114), L2 ranked-requires-account (#117), L3 Memory ranked
  lane (#122; squash `d6569175`), and L4 board-display/privacy work are now the
  base for later seasons. The main merge included the route-level public-payload
  email sweep, React escaping guardrails, Classic/Memory board screenshots, and
  migration 0005.
- `merit-v3.1` is superseded by merit-v4. Its W3 88-wall STOP remains preserved as
  a valid proof for the old fixed-ceiling/fixed-median request, but it is no
  longer the active release blocker because merit-v4 dissolved the `0.62` internal
  shelf instead of trying to patch the display wall alone.
- `merit-v4` is live on main/prod via PR #130 at `34a8dfb`. It lands
  national-strength raw-only ceilings, objective `club_honors`, projected
  active-career damping, compact regen, λ/golden relocks, leaderboard season reset,
  and the public runtime anchors listed below.
- `ws-meta/oversized-merit-v4` is the current repo-health branch. It removes the
  two oversized deterministic generated blobs from normal git going forward,
  replaces them with tracked fingerprints + on-demand regeneration, and preserves
  existing-history bloat as a documented carryover (no destructive history rewrite).
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
- `feature/dynamic-og` is the active Red share-image lane: new completed-run `t2`
  tokens carry a compact `og` result summary copied from the already-computed
  simulation; `/play/share` metadata points current-anchor summary tokens at
  `/api/og/run?run=...&v=...`; the image route decodes the token cold, verifies
  anchors, replays the pick log for the XI, and renders the card without running
  the tournament server-side. Malformed, legacy `t1`, pre-summary `t2`, and
  foreign-build tokens retain the static `/brand/marketing/og-default.png`
  fallback and must not 500 crawlers.
- `feature/narrative-v2` (RED) is the active deterministic results-narrative
  candidate rebased on `origin/main`
  `c195f8736e4df4f74f63c55d8d5d095a86568e40`.
  It expands the static narrative bank from 49 fallback templates to 99 total
  templates (25 scenario families, two variants each) and stamps
  `engine-2026.06.13` because `RunResult.narrative` bytes change. It is not
  shipped until fresh Red review, owner SHA-pinned approval, merge, deploy, and
  live production verification.
- **Platform improvement pass (2026-06-14)** shipped four Yellow fix-forward PRs to
  prod, each fresh-reviewed + CI-green + live-verified: #133 SEO surface + themed
  404/error (`ae6be47`), #134 light/dark AA contrast + 44px tap targets (`337c40a`),
  #135 security response headers (`4810b27`), #136 perf parallel data-fetch + lazy
  MemoryReveal (`7044aa6`). No schema/rating/sim/data-contract change. Owner-
  contractual items (ratings-coverage extension `merit-v4.1`, data-delivery
  5MB→1.4MB wire, OG-edge full-pool parse, sim-payload narrowing, share-token
  integrity, full CSP) are PROPOSALS in
  `docs/reports/platform-improvement-pass-2026-06-14.md` — NOT shipped.
- **Security E/F follow-up (2026-06-14)** clears the bounded CSP and share-summary
  integrity proposals without touching rating/data/sim semantics. CSP now lives in
  `apps/web/proxy.ts` with per-request nonces, preview/dev report-only mode,
  production enforcement, and `/api/csp-report` logging. Current browser-minted
  share tokens still carry `og` for decode compatibility, but server-rendered OG
  metadata treats that summary as untrusted and uses the neutral static card; the
  share/results pages continue to replay the token client-side from the pick log.
  HMAC signing was not added because the current browser-only minting path cannot
  use a server-held secret without exposing it or creating a signing oracle.
  Validation for the branch: web focused CSP/share/public-payload sweep passed
  3 files / 15 tests; root `pnpm typecheck`, `pnpm lint`, `pnpm test`, and
  `pnpm build` passed, with root test counts unchanged at core 366, data 65/7
  skipped, db 79, marketing-x 64, and web 679/1 skipped. Fresh-context review
  caught and fix-forwarded the CSP report intake to byte-bound reads plus `413`
  oversized-body rejection.
- **A11y/perf follow-up (2026-06-14)** clears the bounded remaining UI items from
  the platform pass: Synergy delta SR text, collapsed candidate provenance SR text,
  one spin live region, account-menu and slot-sheet focus traps/restores, spin→lineup
  heading focus, setup contrast fixes found by axe, and `CandidateCard` /
  `ManagerCandidate` memoization with stable draft-screen selection callbacks.
  Browser axe is `0` violations on formation select, selected lineup, and slot sheet
  at `390x844` and `360x800`; interaction proof covers selection, sort, slot sheet,
  lock-pick, and position-first target. Render measurement: baseline `origin/main`
  no-op whitespace search re-rendered `23/23` visible `CandidateCard` rows; the
  follow-up branch re-rendered `0/23`. Report:
  `docs/reports/a11y-perf-followups-2026-06-14.md`.
- **Safe dependency bump (2026-06-14)** updates only patch-level framework/tooling
  dependencies: `next 16.2.7 -> 16.2.9`, `@types/react 19.2.16 -> 19.2.17`,
  `@types/node 25.9.1 -> 25.9.3`, `prettier 3.8.3 -> 3.8.4`, and
  `turbo 2.9.16 -> 2.9.18`. No app code, schema, rating, sim, data-contract,
  auth, or leaderboard behavior changed. Validation for the branch: root
  `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` passed; root test
  counts were core 366, data 65/7 skipped, db 79, marketing-x 64, and web
  674/1 skipped. Local `next start` on Next 16.2.9 served `/`,
  `/robots.txt`, `/data/wcdraft/manifest.json`, and the bad-token OG fallback.
- `merit-v4.1` is the active Red ratings coverage season. It implements Proposal A
  from the platform-improvement pass with citation-backed Salem/Aymen active-note
  recovery, projected-only objective-record material entry for under-covered
  AFC/CAF/CONCACAF standouts, a smoothed league prior, display-curve refit, λ refit
  (`GAMMA_MID=1.00`), compact/data/web golden relocks, and a new leaderboard season
  key. Human approval is intentionally waived by dispatch for this lane.
- `perf-delivery` is the active Red delivery/performance season implementing
  platform-improvement Proposals B/C/D plus atomic versioned delivery. It is
  coordinated after the merit-v4.1 merge (`origin/main` `c5eb8e8`), changes no
  compact DATA bytes, and moves delivery to schema-versioned runtime-data paths
  with a max-quality retained `.br` draft-pool artifact. Local proof:
  prod-before Brotli wire `5,015,795` bytes on the fixed path; candidate
  artifact `1,429,691` bytes with identical decompressed sha; sim worker payload
  fixture `500,458 -> 155,336` JSON bytes while preserving byte-identical
  simulation output; `/api/og/run` no longer imports the full draft-pool render
  path under the current unsigned-summary contract.

## Shipped versions (repo pins — `packages/data/src/generated/manifest.json`)

| Field                         | Value                                                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| schema_version                | runtime-data-2.3.0                                                                                             |
| dataset_version               | 2026-06-04                                                                                                     |
| ruleset_version               | ruleset-2026.06.04                                                                                             |
| engine_version                | engine-2026.06.14-merit-v4.1                                                                                   |
| rating_version (historical)   | wc-perf-6.1.0                                                                                                  |
| rating_version (projected)    | proj-career-5.1.0                                                                                              |
| career_stature                | career-stature-4.1.0                                                                                           |
| merit source set              | merit-source-set-2.2.0                                                                                         |
| active source set             | active-career-source-set-2.2.0                                                                                 |
| runtime legend census         | 295                                                                                                            |
| runtime ratings               | 12,219                                                                                                         |
| Career basis counts           | 11,292 measured · 541 career-stature · 386 baseline                                                            |
| career-stature table          | 847 players · 209 material · 114 source-derived legends                                                        |
| leaderboard season key        | engine-2026.06.14-merit-v4.1_wc-perf-6.1.0+proj-career-5.1.0_2026-06-04_ruleset-2026.06.04_11cbbd5e            |
| compact brotli total          | 1,436,160 normalized bytes                                                                                     |
| served draft-pool br artifact | 1,429,691 bytes at `/data/wcdraft/runtime-data-2.3.0/draft-pool.compact.json.br`; decompressed sha `f0f76fd3…` |
| compact sha256                | manifest `126a77fb…` · draft `f0f76fd3…` · scenario `bd362cb7…`                                                |
| oversized artifact locks      | ratings `81c2a6ab…` / 59,551,889 bytes · draft-pool `f0f76fd3…` / 101,026,822 bytes                            |

## Superseded candidate versions (`merit-v3.1`, not shipped)

| Field                       | Value                                                           |
| --------------------------- | --------------------------------------------------------------- |
| schema_version              | runtime-data-2.1.0                                              |
| dataset_version             | 2026-06-04                                                      |
| ruleset_version             | ruleset-2026.06.04                                              |
| engine_version              | engine-2026.06.12                                               |
| rating_version (historical) | wc-perf-5.1.0                                                   |
| rating_version (projected)  | proj-career-4.1.0                                               |
| career_stature              | career-stature-3.1.0                                            |
| merit source set            | merit-source-set-2.1.0                                          |
| active source set           | active-career-source-set-2.1.0                                  |
| runtime legend census       | 287                                                             |
| runtime ratings             | 12,219                                                          |
| Career basis counts         | 11,351 measured · 482 career-stature · 386 baseline             |
| compact brotli total        | 1,218,099 bytes                                                 |
| compact sha256              | manifest `d5b32a05…` · draft `ba238aa1…` · scenario `182546ab…` |

## Candidate versions (`feature/narrative-v2`, not shipped)

| Field                       | Value                                                           |
| --------------------------- | --------------------------------------------------------------- |
| schema_version              | runtime-data-2.1.0                                              |
| dataset_version             | 2026-06-04                                                      |
| ruleset_version             | ruleset-2026.06.04                                              |
| engine_version              | engine-2026.06.13                                               |
| rating_version (historical) | wc-perf-5.1.0                                                   |
| rating_version (projected)  | proj-career-4.1.0                                               |
| runtime legend census       | 287                                                             |
| runtime ratings             | 12,219                                                          |
| narrative templates         | 49 fallback -> 99 total; 25 scenario families                   |
| compact brotli total        | 1,218,097 bytes                                                 |
| compact sha256              | manifest `f0ba1339…` · draft `ba238aa1…` · scenario `182546ab…` |

## Test counts (latest relevant measurements; branch noted where not main)

| Suite                                                     | Result                                                                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| @wcdraft/core `test`                                      | 338 passed (ui/ux-basis-wave: current-basis recorded, no longer refused)                                                 |
| @wcdraft/core `test:golden` (RNG)                         | 3 passed                                                                                                                 |
| @wcdraft/core `test:golden:draft`                         | 40 passed (entity-resolution and manager-identity goldens now wired)                                                     |
| @wcdraft/data `test`                                      | 65 passed, 7 skipped (72)                                                                                                |
| @wcdraft/data `test:golden:data`                          | 31 passed                                                                                                                |
| @wcdraft/data `test:golden:integration`                   | 22 passed                                                                                                                |
| @wcdraft/db `test`                                        | 74 passed                                                                                                                |
| @wcdraft/web `test` (ui/ux-basis-wave on main)            | 634 passed, 1 skipped (635) (+rating-basis seam/divergence/determinism tests)                                            |
| @wcdraft/web `test` (leaderboard-profiles L4)             | 653 passed, 1 skipped (654)                                                                                              |
| @wcdraft/web `test` (leaderboard-profiles main-sync)      | 665 passed, 1 skipped (666)                                                                                              |
| @wcdraft/web `test` (main @ 2026-06-14 improvement pass)  | 674 passed, 1 skipped (675) (#133–#136 added no tests; metadata/CSS/header/perf only)                                    |
| @wcdraft/web focused a11y/perf follow-up                  | 32 passed (a11y focus/perf, club provenance, Synergy SR delta, position-first, full-path final, tap-stability)            |
| Root `pnpm test` (a11y/perf follow-up branch)             | core 366 passed · data 65 passed/7 skipped · db 79 passed · marketing-x 64 passed · web 678 passed/1 skipped             |
| @wcdraft/web `test:golden:leaderboard` (main)             | 5 passed                                                                                                                 |
| @wcdraft/web `test:golden:leaderboard` (L4)               | 6 passed                                                                                                                 |
| @wcdraft/marketing-x `test`                               | 64 passed (engine parity, composer/lexicon, pipeline, queue, X client, engagement, weekly pack/banks)                    |
| etl V1 `ruff check src tests`                             | clean                                                                                                                    |
| etl V1 focused merit suite                                | 42 passed                                                                                                                |
| etl V1 `pytest -q`                                        | 233 passed                                                                                                               |
| merit-v3 V1 club-season citation verifier                 | 14/14 rows verified                                                                                                      |
| merit-v3 V1 active/stature generation                     | two-run byte-identical hash match                                                                                        |
| merit-v3 V1 conservatism                                  | ratings + compact generated artifacts unchanged                                                                          |
| etl V2 `ruff check src tests`                             | clean                                                                                                                    |
| etl V2 focused rating/display/projected suite             | 91 passed                                                                                                                |
| etl V2 `pytest -q`                                        | 241 passed                                                                                                               |
| merit-v3 V2 mutation proofs                               | 3/3 guards failed when deliberately broken                                                                               |
| merit-v3 V2 historical artifact generation                | two-run byte-identical hash match                                                                                        |
| merit-v3 V2 conservatism                                  | 2026 outputs + career_stature + compact unchanged                                                                        |
| etl V3/V4 `ruff check src tests`                          | clean                                                                                                                    |
| etl V3/V4 `pytest -q`                                     | 288 passed                                                                                                               |
| merit-v3 V3/V4 §7 movers/controls                         | 14 in-band, 6 pinned-miss elements; controls 7/7 evaluable pass                                                          |
| merit-v3 V3/V4 distribution/coherence probes              | median and 90+ pass; pile-up, inversion, and 9 pre-1967 violations pinned for V8 waiver                                  |
| merit-v3 V3/V4 determinism                                | both stage orders run-twice byte-identical                                                                               |
| merit-v3 V3/V4 boundary                                   | career_stature, canonical tables, compact, canary, lambda/realism untouched                                              |
| merit-v3 V6 compact regen                                 | 12,219 ratings · 270 legends · dual basis 12,219/12,219 · 1,216,302 bytes before V8 stamp                                |
| merit-v3 V7 lambda                                        | evals 175 · winner BASE 1.05 / SPREAD 6.5 / MIN 0.70 / GAMMA_MID 0.80 / KO 0.82                                          |
| merit-v3 V8 compact stamp                                 | `build:compact` ok · 12,219 ratings · 270 legends · 1,216,305 bytes                                                      |
| merit-v3 V8 generators                                    | e2e seed `:29`, era, leaderboard, token-skew, canary, asym realism regenerated                                           |
| `pnpm exec turbo run typecheck lint test build --force`   | PASS on post-season wrap final local diff: 16/16 tasks · 0 cached                                                        |
| V8 explicit goldens + ETL + heavy realism                 | core 3 + 37 · data 31 + 22 · web leaderboard 5 · ETL ruff clean / pytest 288 · heavy realism 7/7                         |
| V8 regen byte-stability                                   | compact/e2e/era/canary/asym/leaderboard/token-skew output hashes unchanged after rerun                                   |
| post-season focused web tests                             | SW registration/cache + config badges/copy: 28 passed                                                                    |
| post-season browser proof                                 | local production build: 12 screenshots · SW registered · stale test caches evicted · console errors 0                    |
| leaderboard-profiles L3 focused suite                     | validation + golden + submit + board + UI + serializer: 145 passed                                                       |
| leaderboard-profiles L3 lane mutation proof               | disabling the token.md<->draft_mode guard failed validate + submit cross-lane tests; restored 77 passed                  |
| leaderboard-profiles L4 focused privacy/UI suite          | all exported API-method public-payload email sweep + UI render/XSS guards: 37 passed                                     |
| leaderboard-profiles L4 screenshots                       | 4 local Playwright captures: Classic/Memory x light/dark at 390x844 / 360x800; rendered email probe false                |
| @wcdraft/web `build` (leaderboard-profiles L4)            | PASS; existing Next/Webpack circular chunk warnings only                                                                 |
| leaderboard-profiles main-sync focused suite              | privacy sweep + UI gating + board-view tests: 49 passed                                                                  |
| merit-v3.1 ETL gates                                      | `ruff check .` clean · `pytest -q` 291 passed · `tests/test_merit_v3_gate.py` 34 passed                                  |
| merit-v3.1 compact/goldens                                | `build:compact` twice byte-identical · data golden 31 passed · integration golden 22 passed                              |
| merit-v3.1 canary                                         | regen twice + normal run passed · hash `151528048c35a8cb5053eebddb2bba742a8d2831b1f3b8ba712954c24df9acc1`                |
| merit-v3.1 leaderboard/token skew                         | leaderboard golden 6 passed · run-token v1/v2 skew tests 44 passed                                                       |
| merit-v3.1 fix-forward local gates                        | gitleaks no leaks · source snapshot manifests ok · heavy realism 7 passed after re-lock                                  |
| merit-v4 root gate                                        | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` PASS: typecheck 8/8 · lint 5/5 · test 8/8 (core 366, data 65 passed/7 skipped, db 79, web 674/1 skipped, marketing-x 64) · build 4/4 |
| merit-v4 explicit goldens                                 | core `test:golden` 67 + `test:golden:draft` 40 · data `test:golden:data` 31 + `test:golden:integration` 22 · web leaderboard 6 |
| merit-v4 ETL gates                                        | `ruff check src tests` clean · focused v4 probe suite 225 passed · full `pytest -q` 297 passed                           |
| merit-v4 GitHub blob-limit fix                            | deterministic compact `ratings.json` encoding lowered artifact to 59,551,789 bytes · post-amend ruff clean / pytest 297 · `git diff --check` clean |
| merit-v4 compact/generators                               | `build:compact` ok · 12,219 ratings · 295 legends · dual basis 12,219/12,219 · 1,434,624 normalized brotli bytes · e2e/era/canary/asym/leaderboard/token-skew regenerated |
| merit-v4 compact metadata CI fix                          | normalized Brotli metadata to 128-byte upper-bound buckets after Linux CI measured draft-pool Brotli 2 bytes below macOS · data test 65/7 · root gate rerun 8/5/8/4 · data golden 31 + integration 22 |
| merit-v4 lambda/realism                                   | fit 175 evals · winner BASE 1.10 / SPREAD 6.0 / MIN 0.30 / GAMMA_MID 0.80 / KO 0.82 · symmetric goals 2.544, draw 24.87%, margin4 4.86%, ET 34.13%, SO 21.33% · heavy realism 7/7 |
| merit-v4 canary                                           | strategic-pick canary regenerated; 6 intentional pick flips documented for review                                       |
| perf-delivery local gates                                 | data/web focused 8+38 · root typecheck/lint/test/build 8/5/8/4 · goldens core 67+40, data 31+22, web 6 · heavy realism 7 · ETL ruff clean / pytest 297 |
| oversized artifact migration                              | inventory exactly 2 tracked blobs >40 MB · `pnpm run check:generated` PASS after full regen · ETL rating 42 passed · data golden 31 passed · core draft golden 40 passed · copy-web-assets PASS · forced full turbo 19/19 tasks, 0 cached · fresh verifier PASS · Vercel preview READY |
| @wcdraft/web `typecheck` (leaderboard-profiles main-sync) | PASS                                                                                                                     |
| @wcdraft/web `build` (leaderboard-profiles main-sync)     | PASS; existing Next/Webpack circular chunk warnings only                                                                 |
| narrative-v2 focused goldens                              | narrative golden 64 passed · narrative+sim golden 117 passed                                                             |
| narrative-v2 all explicit goldens                         | turbo 9/9 tasks · core 67 · draft 40 · data golden/data 31 · integration 22 · leaderboard 6                              |
| narrative-v2 full turbo                                   | typecheck/lint/test/build 19/19 tasks · core 366 · data 65 passed/7 skipped · db 79 · web 665/1 skipped · marketing-x 64 |
| narrative-v2 heavy realism                                | 7 passed                                                                                                                 |
| narrative-v2 formatting/lexicon                           | `git diff --check` clean · Prettier clean · changed-line lexicon/IP grep clean                                           |

## CI (`.github/workflows/`)

- `ci.yml` jobs: **dedupe** (skips push-event runs when the pushed branch has an open
  PR — the pull_request run still gates; q-008) · **verify** (generated-data determinism · AGENTS/CLAUDE drift check · typecheck·lint·test·build) · **golden** (RNG + draft) ·
  **realism** (heavy asymmetric gate, N=2000 × 3 policies) · **db-gate → db-rollback-check**
  (path-filtered to `packages/db/**`+workflow+lockfile+turbo.json; ephemeral Neon branch,
  never prod) · **etl-rating** (ruff · rating tests · ratings.lock.json byte-determinism).
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
`pnpm turbo run build --filter=@wcdraft/web...` (apps/web/vercel.json); data build
regenerates ignored oversized artifacts from tracked fingerprints before copying
web static assets.

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
