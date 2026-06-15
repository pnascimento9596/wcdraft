# STATE.md — measured ground truth

> Update rule: every lane updates this file in the SAME change that merges.
> Numbers below were MEASURED by running the commands, not assumed — re-measure
> whatever your change touches.

Last measured for era closeout and post-purge doc refresh:
2026-06-15 · post-purge `origin/main`
`a7580ea1728844a6c7d4c33998baff14d2a23dde`, then docs-only branch
`ws-meta/era-closeout-doc-refresh`. The live production manifest was read from
both `/data/wcdraft/manifest.json` and
`/data/wcdraft/runtime-data-2.3.0/manifest.json`; both returned sha256
`126a77fba59e9bf432b0163c6691a79eb3e70d93d037f7a8f92bad0a14de16ea`.

Current live runtime anchor:
`runtime-data-2.3.0` / `engine-2026.06.14-merit-v4.1` / `wc-perf-6.1.0` /
`proj-career-5.1.0`, dataset `2026-06-04`, ruleset `ruleset-2026.06.04`, legend
census `295`, player-card count `12,219`, manager-card count `501`, teams `48`,
knockout slots `62`. Live leaderboard season key:
`engine-2026.06.14-merit-v4.1_wc-perf-6.1.0+proj-career-5.1.0_2026-06-04_ruleset-2026.06.04_11cbbd5e`.

Live data/bundle anchors:
`draft-pool.compact.json` raw bytes `101,026,822` with sha256
`f0f76fd3c2f8d003a3ee5062957220c591431e37fc6ea54daa689c6e992e11b7`;
served versioned Brotli artifact bytes `1,429,691` with encoded sha256
`b7422612f3dd8284dac92b74949a232e6d381367dadb84b75846fe091cbd5fcf`;
manifest Brotli metadata is the normalized bucket `1,429,760`.
`scenario-2026.compact.json` raw bytes `108,775` with sha256
`bd362cb7a509b8081ec7febf440749217fe94f7fc7d14d9431ce28347803f420`.

The named canonical doc files (`Build State`, `Architecture`, `Roadmap`,
`Surface Inventory`) are not present in this repo. The owner-filed doc-set
refresh is captured at `docs/reports/era-closeout-doc-refresh-2026-06-15.md`:
Build State v10, Architecture v6, Roadmap v6, and Surface Inventory v6, each
superseding the prior version. This `STATE.md` is the in-repo closeout truth
surface.

## UI polish overhaul local state

Branch `ui-polish` was created from `origin/main`
`ccb80a81b5ce90921ee181532dbe00b0f5fbec94` for the mobile polish overhaul.
At this local checkpoint, production leaderboard synthetic test rows were
removed via Neon production branch `br-blue-heart-aqcejtyf`, and live API
checks for ranked Classic, ranked Memory, casual Classic, and casual Memory
returned 200 with the probe rows absent.

Local UI implementation evidence is captured in
`docs/reports/ui-polish-overhaul-2026-06-15.md`,
`docs/reports/ui-polish-overhaul-local.json`,
`docs/reports/ui-polish-overhaul-axe.json`,
`docs/reports/ui-polish-overhaul-independent-review.md`, and 72 screenshots
under `docs/screenshots/ui-polish-overhaul/` (18 surfaces × 390×844/360×800 ×
light/dark). The local measurement report shows zero document overflow on all
non-permitted-scroll core-loop routes, including `squad-review`; permitted long
content remains `attribution`, `how-to-play`, `privacy`, and `results`.

Implemented presentation-only surfaces: thin vertical SVG pitch, compact
position-shaped/provenance-hued nodes with national mini flags, starter/bench/
manager flags, presentation-only Synergy adjacency lines from existing
`computeSynergy(...).linked_pairs`, compact Synergy score strip, mobile
compaction, and transform/opacity-only motion with reduced-motion snapping.
No schema, database, ETL, sim, rating, compact data, `formations.json`, or
Synergy mechanic files are changed.

Local gates run so far: `pnpm --filter @wcdraft/web typecheck`, `pnpm --filter
@wcdraft/web lint`, focused `vitest` for `pitch-markings` and
`synergy-overlay` (2 files / 11 tests), `git diff --check`, hardcoded-color and
lexicon guard greps, browser screenshot/fit measurement against
`http://localhost:3002`, post-fix Playwright + axe on `draft-complete` and
`review` at 390×844/360×800 in both themes (8/8 zero violations, zero
console/page errors, zero document overflow, 17 flags, one lit Synergy line,
reduced-motion snap verified), independent fresh-context Codex CLI review
from this WCDraft worktree (PASS / no Yellow blockers), and full root `pnpm
typecheck && pnpm lint && pnpm test && pnpm build` (typecheck 8/8, lint 5/5,
test 8/8 with core 366, data 73 passed / 7 skipped, db 79, marketing-x 64, web
694 passed / 1 skipped, build 4/4). RepoPrompt review could not run because
the active RepoPrompt workspace was bound to BiotraxIQ, not this WCDraft
worktree; a later attempt to rebind RepoPrompt to `/tmp/wcdraft-ui-polish`
failed with a broken-pipe MCP transport error. PR/merge, deploy, and live
production UI verification are still pending.

## Era closeout status at last measurement

- Branch/PR graveyard cleanup completed before the purge window. PR #76 was closed
  only after its orphaned forensic report was ported through #144; `gh pr list`
  against `main` was empty before the history rewrite.
- History purge completed with backup ref
  `refs/backup/pre-purge-2026-06-15-0244Z` pointing to pre-purge main
  `431aaec5ed960389c75da299895a77fd4bc9009d`.
- Purged generated paths:
  `packages/data/src/generated/draft-pool.compact.json` max historical size
  `100,702,891` bytes / `96.04 MiB`; `etl/output/ratings.json` max historical
  size `95,222,758` bytes / `90.81 MiB`. Source data and ETL inputs were not
  stripped.
- Fresh clone size moved from `.git` `98,668` KB / working clone `229,196` KB to
  `.git` `82,284` KB / working clone `212,812` KB. A post-push fresh clone had no
  generated blob over 40 MB and rebuilt/regenerated byte-identically against the
  live manifest.
- All collaborators and agents must re-clone after the force-push; old clones
  diverge from rewritten `main`.
- merit-v4 is live and now the base rating-methodology rebuild: public
  national-team-strength prior, objective `club_honors`, active-career damping,
  compact regen, lambda/realism relock, and leaderboard season reset. The old
  merit-v3.1 88-wall STOP remains preserved as historical proof for the old
  fixed-ceiling/fixed-median request, but it is no longer an active blocker.
- merit-v4.1 is current production: pool-wide objective-achievement staging,
  smoothed league-strength prior (`FW/MF/DF/GK`
  `0.31/0.34/0.31/0.28 -> 0.18/0.20/0.18/0.16`), `0.70` cap on the projected
  objective-record pathway, AFC `0/7 -> 7/7`, CONCACAF `0/5 -> 5/5`, CAF
  `2/8 -> 4/8`, Son 2026 `90`, Salem Al-Dawsari 2026 `86`, Pulisic 2026 `88`,
  pooled runtime `90+` `290 / 12,219 = 2.373%`.
- The only known ratings carryover for this closeout is the deliberately deferred
  CAF-4 honest miss set: Ghana, Ivory Coast, South Africa, and Tunisia still lack
  material headroom cards under the current conservative linker/source surface.
- Platform pass is DONE-LIVE: #133 SEO + themed 404/error, #134 AA contrast +
  44px targets, #135 response headers, #138 nonce CSP + unsigned-summary
  neutralization, #136/#142 performance and atomic versioned delivery, #139 a11y
  and candidate render memoization, #140 safe patch dependencies.
- Runtime data delivery is atomic/versioned at
  `/data/wcdraft/runtime-data-2.3.0/`; fixed legacy `/data/wcdraft/*` paths remain
  for old clients/server readers. Future data-version bumps must retain the
  immediately previous versioned directory across N+1 deploys.
- Trusted OG is DONE-LIVE via #143: `/api/og/sign` validates replay tokens against
  the current manifest, reconstructs the draft, runs the deterministic engine, and
  signs the canonical OG render model plus token hash; `/api/og/run` verifies the
  signature/version/token hash on Edge and otherwise renders the static fallback.
  Vercel Production has `WCDRAFT_OG_SIGNING_SECRET` set.

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

| Suite                                                     | Result                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| @wcdraft/core `test`                                      | 338 passed (ui/ux-basis-wave: current-basis recorded, no longer refused)                                                                                                                                                                                                                                                                                                                                 |
| @wcdraft/core `test:golden` (RNG)                         | 3 passed                                                                                                                                                                                                                                                                                                                                                                                                 |
| @wcdraft/core `test:golden:draft`                         | 40 passed (entity-resolution and manager-identity goldens now wired)                                                                                                                                                                                                                                                                                                                                     |
| @wcdraft/data `test`                                      | 65 passed, 7 skipped (72)                                                                                                                                                                                                                                                                                                                                                                                |
| @wcdraft/data `test:golden:data`                          | 31 passed                                                                                                                                                                                                                                                                                                                                                                                                |
| @wcdraft/data `test:golden:integration`                   | 22 passed                                                                                                                                                                                                                                                                                                                                                                                                |
| @wcdraft/db `test`                                        | 74 passed                                                                                                                                                                                                                                                                                                                                                                                                |
| @wcdraft/web `test` (ui/ux-basis-wave on main)            | 634 passed, 1 skipped (635) (+rating-basis seam/divergence/determinism tests)                                                                                                                                                                                                                                                                                                                            |
| @wcdraft/web `test` (leaderboard-profiles L4)             | 653 passed, 1 skipped (654)                                                                                                                                                                                                                                                                                                                                                                              |
| @wcdraft/web `test` (leaderboard-profiles main-sync)      | 665 passed, 1 skipped (666)                                                                                                                                                                                                                                                                                                                                                                              |
| @wcdraft/web `test` (main @ 2026-06-14 improvement pass)  | 674 passed, 1 skipped (675) (#133–#136 added no tests; metadata/CSS/header/perf only)                                                                                                                                                                                                                                                                                                                    |
| @wcdraft/web focused a11y/perf follow-up                  | 32 passed (a11y focus/perf, club provenance, Synergy SR delta, position-first, full-path final, tap-stability)                                                                                                                                                                                                                                                                                           |
| Root `pnpm test` (a11y/perf follow-up branch)             | core 366 passed · data 65 passed/7 skipped · db 79 passed · marketing-x 64 passed · web 678 passed/1 skipped                                                                                                                                                                                                                                                                                             |
| @wcdraft/web `test:golden:leaderboard` (main)             | 5 passed                                                                                                                                                                                                                                                                                                                                                                                                 |
| @wcdraft/web `test:golden:leaderboard` (L4)               | 6 passed                                                                                                                                                                                                                                                                                                                                                                                                 |
| @wcdraft/marketing-x `test`                               | 64 passed (engine parity, composer/lexicon, pipeline, queue, X client, engagement, weekly pack/banks)                                                                                                                                                                                                                                                                                                    |
| etl V1 `ruff check src tests`                             | clean                                                                                                                                                                                                                                                                                                                                                                                                    |
| etl V1 focused merit suite                                | 42 passed                                                                                                                                                                                                                                                                                                                                                                                                |
| etl V1 `pytest -q`                                        | 233 passed                                                                                                                                                                                                                                                                                                                                                                                               |
| merit-v3 V1 club-season citation verifier                 | 14/14 rows verified                                                                                                                                                                                                                                                                                                                                                                                      |
| merit-v3 V1 active/stature generation                     | two-run byte-identical hash match                                                                                                                                                                                                                                                                                                                                                                        |
| merit-v3 V1 conservatism                                  | ratings + compact generated artifacts unchanged                                                                                                                                                                                                                                                                                                                                                          |
| etl V2 `ruff check src tests`                             | clean                                                                                                                                                                                                                                                                                                                                                                                                    |
| etl V2 focused rating/display/projected suite             | 91 passed                                                                                                                                                                                                                                                                                                                                                                                                |
| etl V2 `pytest -q`                                        | 241 passed                                                                                                                                                                                                                                                                                                                                                                                               |
| merit-v3 V2 mutation proofs                               | 3/3 guards failed when deliberately broken                                                                                                                                                                                                                                                                                                                                                               |
| merit-v3 V2 historical artifact generation                | two-run byte-identical hash match                                                                                                                                                                                                                                                                                                                                                                        |
| merit-v3 V2 conservatism                                  | 2026 outputs + career_stature + compact unchanged                                                                                                                                                                                                                                                                                                                                                        |
| etl V3/V4 `ruff check src tests`                          | clean                                                                                                                                                                                                                                                                                                                                                                                                    |
| etl V3/V4 `pytest -q`                                     | 288 passed                                                                                                                                                                                                                                                                                                                                                                                               |
| merit-v3 V3/V4 §7 movers/controls                         | 14 in-band, 6 pinned-miss elements; controls 7/7 evaluable pass                                                                                                                                                                                                                                                                                                                                          |
| merit-v3 V3/V4 distribution/coherence probes              | median and 90+ pass; pile-up, inversion, and 9 pre-1967 violations pinned for V8 waiver                                                                                                                                                                                                                                                                                                                  |
| merit-v3 V3/V4 determinism                                | both stage orders run-twice byte-identical                                                                                                                                                                                                                                                                                                                                                               |
| merit-v3 V3/V4 boundary                                   | career_stature, canonical tables, compact, canary, lambda/realism untouched                                                                                                                                                                                                                                                                                                                              |
| merit-v3 V6 compact regen                                 | 12,219 ratings · 270 legends · dual basis 12,219/12,219 · 1,216,302 bytes before V8 stamp                                                                                                                                                                                                                                                                                                                |
| merit-v3 V7 lambda                                        | evals 175 · winner BASE 1.05 / SPREAD 6.5 / MIN 0.70 / GAMMA_MID 0.80 / KO 0.82                                                                                                                                                                                                                                                                                                                          |
| merit-v3 V8 compact stamp                                 | `build:compact` ok · 12,219 ratings · 270 legends · 1,216,305 bytes                                                                                                                                                                                                                                                                                                                                      |
| merit-v3 V8 generators                                    | e2e seed `:29`, era, leaderboard, token-skew, canary, asym realism regenerated                                                                                                                                                                                                                                                                                                                           |
| `pnpm exec turbo run typecheck lint test build --force`   | PASS on post-season wrap final local diff: 16/16 tasks · 0 cached                                                                                                                                                                                                                                                                                                                                        |
| V8 explicit goldens + ETL + heavy realism                 | core 3 + 37 · data 31 + 22 · web leaderboard 5 · ETL ruff clean / pytest 288 · heavy realism 7/7                                                                                                                                                                                                                                                                                                         |
| V8 regen byte-stability                                   | compact/e2e/era/canary/asym/leaderboard/token-skew output hashes unchanged after rerun                                                                                                                                                                                                                                                                                                                   |
| post-season focused web tests                             | SW registration/cache + config badges/copy: 28 passed                                                                                                                                                                                                                                                                                                                                                    |
| post-season browser proof                                 | local production build: 12 screenshots · SW registered · stale test caches evicted · console errors 0                                                                                                                                                                                                                                                                                                    |
| leaderboard-profiles L3 focused suite                     | validation + golden + submit + board + UI + serializer: 145 passed                                                                                                                                                                                                                                                                                                                                       |
| leaderboard-profiles L3 lane mutation proof               | disabling the token.md<->draft_mode guard failed validate + submit cross-lane tests; restored 77 passed                                                                                                                                                                                                                                                                                                  |
| leaderboard-profiles L4 focused privacy/UI suite          | all exported API-method public-payload email sweep + UI render/XSS guards: 37 passed                                                                                                                                                                                                                                                                                                                     |
| leaderboard-profiles L4 screenshots                       | 4 local Playwright captures: Classic/Memory x light/dark at 390x844 / 360x800; rendered email probe false                                                                                                                                                                                                                                                                                                |
| @wcdraft/web `build` (leaderboard-profiles L4)            | PASS; existing Next/Webpack circular chunk warnings only                                                                                                                                                                                                                                                                                                                                                 |
| leaderboard-profiles main-sync focused suite              | privacy sweep + UI gating + board-view tests: 49 passed                                                                                                                                                                                                                                                                                                                                                  |
| merit-v3.1 ETL gates                                      | `ruff check .` clean · `pytest -q` 291 passed · `tests/test_merit_v3_gate.py` 34 passed                                                                                                                                                                                                                                                                                                                  |
| merit-v3.1 compact/goldens                                | `build:compact` twice byte-identical · data golden 31 passed · integration golden 22 passed                                                                                                                                                                                                                                                                                                              |
| merit-v3.1 canary                                         | regen twice + normal run passed · hash `151528048c35a8cb5053eebddb2bba742a8d2831b1f3b8ba712954c24df9acc1`                                                                                                                                                                                                                                                                                                |
| merit-v3.1 leaderboard/token skew                         | leaderboard golden 6 passed · run-token v1/v2 skew tests 44 passed                                                                                                                                                                                                                                                                                                                                       |
| merit-v3.1 fix-forward local gates                        | gitleaks no leaks · source snapshot manifests ok · heavy realism 7 passed after re-lock                                                                                                                                                                                                                                                                                                                  |
| merit-v4 root gate                                        | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` PASS: typecheck 8/8 · lint 5/5 · test 8/8 (core 366, data 65 passed/7 skipped, db 79, web 674/1 skipped, marketing-x 64) · build 4/4                                                                                                                                                                                                            |
| merit-v4 explicit goldens                                 | core `test:golden` 67 + `test:golden:draft` 40 · data `test:golden:data` 31 + `test:golden:integration` 22 · web leaderboard 6                                                                                                                                                                                                                                                                           |
| merit-v4 ETL gates                                        | `ruff check src tests` clean · focused v4 probe suite 225 passed · full `pytest -q` 297 passed                                                                                                                                                                                                                                                                                                           |
| merit-v4 GitHub blob-limit fix                            | deterministic compact `ratings.json` encoding lowered artifact to 59,551,789 bytes · post-amend ruff clean / pytest 297 · `git diff --check` clean                                                                                                                                                                                                                                                       |
| merit-v4 compact/generators                               | `build:compact` ok · 12,219 ratings · 295 legends · dual basis 12,219/12,219 · 1,434,624 normalized brotli bytes · e2e/era/canary/asym/leaderboard/token-skew regenerated                                                                                                                                                                                                                                |
| merit-v4 compact metadata CI fix                          | normalized Brotli metadata to 128-byte upper-bound buckets after Linux CI measured draft-pool Brotli 2 bytes below macOS · data test 65/7 · root gate rerun 8/5/8/4 · data golden 31 + integration 22                                                                                                                                                                                                    |
| merit-v4 lambda/realism                                   | fit 175 evals · winner BASE 1.10 / SPREAD 6.0 / MIN 0.30 / GAMMA_MID 0.80 / KO 0.82 · symmetric goals 2.544, draw 24.87%, margin4 4.86%, ET 34.13%, SO 21.33% · heavy realism 7/7                                                                                                                                                                                                                        |
| merit-v4 canary                                           | strategic-pick canary regenerated; 6 intentional pick flips documented for review                                                                                                                                                                                                                                                                                                                        |
| perf-delivery local gates                                 | data/web focused 8+38 · root typecheck/lint/test/build 8/5/8/4 · goldens core 67+40, data 31+22, web 6 · heavy realism 7 · ETL ruff clean / pytest 297                                                                                                                                                                                                                                                   |
| og-trusted focused share-image suite                      | OG/signing + public-payload privacy sweep: 18 passed; illegal-pick mutation rejected as `ILLEGAL_PICK`; tampered-result mutation signed/rendered the true re-derived summary; long untrusted display text sanitized before signing; oversized headerless signer bodies rejected while streaming; repeated uncached signer attempts capped; signed route repeat fetch byte-identical with immutable cache |
| og-trusted root gates                                     | forced cumulative Turbo typecheck/lint/test/build 19/19, 0 cached (core 366, data 73 passed/7 skipped, db 79, marketing-x 64, web 693/1 skipped) · existing Next/Webpack circular chunk + Edge static-generation warnings only                                                                                                                                                                           |
| og-trusted goldens + generated + heavy realism            | core `test:golden` 67 + `test:golden:draft` 40 · data `test:golden:data` 31 + `test:golden:integration` 22 · web leaderboard 6 · data heavy realism 7 · `pnpm check:generated` PASS                                                                                                                                                                                                                      |
| oversized artifact migration                              | inventory exactly 2 tracked blobs >40 MB · `pnpm run check:generated` PASS after full regen · ETL rating 42 passed · data golden 31 passed · core draft golden 40 passed · copy-web-assets PASS · forced full turbo 19/19 tasks, 0 cached · fresh verifier PASS · Vercel preview READY                                                                                                                   |
| history purge + post-purge verification                   | backup ref `refs/backup/pre-purge-2026-06-15-0244Z` pushed · generated paths stripped with `git filter-repo` · no remaining generated blob >40 MB · post-push fresh clone `pnpm install --frozen-lockfile`, `pnpm check:generated`, local-vs-live hash compare, and `pnpm build` PASS · main CI + ETL + Vercel green                                                                                     |
| @wcdraft/web `typecheck` (leaderboard-profiles main-sync) | PASS                                                                                                                                                                                                                                                                                                                                                                                                     |
| @wcdraft/web `build` (leaderboard-profiles main-sync)     | PASS; existing Next/Webpack circular chunk warnings only                                                                                                                                                                                                                                                                                                                                                 |
| narrative-v2 focused goldens                              | narrative golden 64 passed · narrative+sim golden 117 passed                                                                                                                                                                                                                                                                                                                                             |
| narrative-v2 all explicit goldens                         | turbo 9/9 tasks · core 67 · draft 40 · data golden/data 31 · integration 22 · leaderboard 6                                                                                                                                                                                                                                                                                                              |
| narrative-v2 full turbo                                   | typecheck/lint/test/build 19/19 tasks · core 366 · data 65 passed/7 skipped · db 79 · web 665/1 skipped · marketing-x 64                                                                                                                                                                                                                                                                                 |
| narrative-v2 heavy realism                                | 7 passed                                                                                                                                                                                                                                                                                                                                                                                                 |
| narrative-v2 formatting/lexicon                           | `git diff --check` clean · Prettier clean · changed-line lexicon/IP grep clean                                                                                                                                                                                                                                                                                                                           |

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
  `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, `AUTH_BASE_URL`,
  `WCDRAFT_OG_SIGNING_SECRET` — verified via `vercel env ls production`
  2026-06-15. All three auth env names are also declared in `turbo.json`'s
  `tasks.build.env` so the SSG'd root layout prerenders `authEnabled:true`
  (see PR #108). `WCDRAFT_OG_SIGNING_SECRET` is server-only and also declared
  in `turbo.json` so signed-OG route builds/tests are cache-keyed correctly.
- UNSET in current production closeout: `LEADERBOARD_REQUIRE_ACCOUNT`. Ranked
  submit requires an account in code, but ranked production light-up remains
  human-gated/dark until the owner sets the flag and live-verifies it; casual
  leaderboard remains enabled.
- Neon prod DB: migrations 0000–0004 were provisioned + verified live 2026-06-10.
  Migration 0005 is in the repo and shipped with leaderboard profiles; re-verify
  prod migration status before relying on 0005-specific production state.
- GitHub **Actions secrets** (not Vercel): `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`,
  `X_ACCESS_SECRET`, `X_BEARER_TOKEN` (q-007 marketing). Repo **vars** govern the lane:
  `MARKETING_PAUSED` (kill switch, default off), `MARKETING_LIVE` (default off → dry-run),
  `MARKETING_DAILY_CAP` (optional, clamped to 6).

## Branch / merge convention (from git history)

`ws-<area>/<topic>` task branches; long-lived integration branches `engine-*`/`merit-*`
(CI-watched); PRs squash-merge to `main` (one commit per PR); Red merges pinned with
`--match-head-commit`.
