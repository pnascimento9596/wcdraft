# Dependency Sweep & Residual Polish — closure report

Date: 2026-07-14
Repository: `pnascimento9596/wcdraft`
Gate-0 baseline: `81a3b5a22647218597cca92481589d2caf837aa5`
Production dependency-sweep head before this report: `7d0fe9ce94a2dce6d29062c298f83442c8dd77bd`

## Outcome

The seven original Dependabot PRs are resolved: four GitHub Actions updates
shipped through PRs #285 and #286, and the compatible npm subset shipped
through PR #289. The stale originals were closed with links to their replacement
PRs; incompatible majors and the measured Prettier formatter drift were closed
with explicit reasons. Production was live-verified after every merge. At the
first D1 closure snapshot, the open-PR list was empty and the remote branch list
was `main` only.

The post-sweep production dependency graph and all six Python audit projections
are clean. The complete JavaScript graph retains two pre-existing, development-
only esbuild advisories; neither is on a production path or was introduced by
this sweep. D3 found no stale worktree metadata, no stale Season 2 calibration
truth, and no broken/truncated report artifacts. Prettier is pinned exactly at
3.8.4.

Dependabot regenerated incidental PRs after the new grouping took effect. #287
(`actions/setup-node` v7) was closed because it is an ESM major; compatible
v6.5.0 shipped instead. #288 was closed after its nine in-scope updates were
superseded, with a correction noting three newly surfaced Capacitor patches were
not merged. #290 then isolated Prettier 3.9.5 plus those three mobile patches.
Exact-version ignores now prevent those known versions from recreating while
leaving later versions eligible; #290 is to be closed after this configuration
lands.

## Gate 0 — measured baseline

The owner checkout was clean and synchronized at the start, then left untouched
for implementation. A fresh worktree at `81a3b5a22647218597cca92481589d2caf837aa5`
passed:

- clean frozen install;
- generated-artifact check: the historical ETL generator wrote 10,973 rating
  rows with zero null overall values; the compact build verified 12,219 total
  player-card ratings (10,973 historical + 1,246 projected-2026), with no diff;
- typecheck 9/9, lint 6/6;
- root tests 9/9: 2,160 passed and 10 expected skips (core 423, data 183 + 9,
  DB 161, marketing 69, mobile 7, web 1,317 + 1); game-flow Playwright passed;
- responsive harness: 218 metrics, 0 failures (84 desktop + 56 mobile + 40
  interaction + 30 mode/setup + 8 mobile navigation);
- build 5/5, 40 pages/routes, both runtime-data traces 8/8;
- four service-worker suites: 4 files, 48 tests;
- goldens: core 69, draft 42, data 59, integration 22, leaderboard 6.

`wcdraft-m4` was online and the data volume had more than the required 30 GiB
free. The seven open Dependabot PRs were #165, #166, #211, #221, #222, #223,
and #224.

## D1 — seven-PR disposition

“Advisory?” means a direct advisory carried by that PR. None of the seven had a
security label or direct advisory; the two unrelated esbuild advisories are
covered under D2.

| Original PR | Package / original from→to                                                                                                                                                                                                                                                                   | Class and initial triage                            | Advisory?          | Final disposition                      | Reason and evidence                                                                                                                                                                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #166        | `actions/checkout` 6.0.3→7.0.0                                                                                                                                                                                                                                                               | Major; NEEDS-VERIFICATION                           | No                 | Merged via #285                        | Standalone branch only. All 18 pins use official v7.0.0 commit `9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0`; runner hygiene and checkout inputs were unchanged. Candidate `c7adf9a2f8c5a377730db2bae3d69c22a02d9e68`, production `e23aeb78e37fcad66c24764b87fa1cd693057a3d`. |
| #221        | `astral-sh/setup-uv` 8.2.0→8.3.2                                                                                                                                                                                                                                                             | Minor; SAFE-MERGE in Actions batch                  | No                 | Merged via #286                        | Five immutable pins resolve to `11f9893b081a58869d3b5fccaea48c9e9e46f990`; exact-head CI and ETL passed.                                                                                                                                                                   |
| #222        | `dorny/paths-filter` 4.0.1→4.0.2                                                                                                                                                                                                                                                             | Patch; SAFE-MERGE in Actions batch                  | No                 | Merged via #286                        | Two immutable pins resolve to `7b450fff21473bca461d4b92ce414b9d0420d706`; path-filter semantics were unchanged.                                                                                                                                                            |
| #165        | `pnpm/action-setup` tag object `b0f76dfb…`→peeled v6.0.9 commit `0ebf4713…`                                                                                                                                                                                                                  | Immutable-pin refresh within v6; NEEDS-VERIFICATION | No direct advisory | Merged via #286                        | All nine uses pin signed commit `0ebf47130e4866e96fce0953f49152a61190b271`; annotated-tag peeling and v6.0.9 provenance were verified. Actions candidate `92a93925028850dcb23cabd322910a77e5ea02ed`, production `bf646847b614cc9dffe0d21004fa512f4e2c0013`.                |
| #223        | Web group: Next 16.2.9→16.2.10; PGlite 0.5.3→0.5.4; Vitest PR baseline 4.1.8→4.1.10 (effective current-main reapply 4.1.9→4.1.10)                                                                                                                                                            | Patches; NEEDS-VERIFICATION because web + PGlite    | No                 | Closed as superseded by #289           | Full web tests/build, game flow, 218/0 responsive metrics, Vercel preview READY, DB tests, and ephemeral-Neon round trip passed.                                                                                                                                           |
| #224        | Root group: `@types/node` 25.9.3→26.1.1; ESLint 10.4.1→10.7.0; globals 17.6.0→17.7.0; Prettier 3.8.4→3.9.5; tsx 4.22.4→4.23.1; Turbo 2.9.18→2.10.5; TypeScript 6.0.3→7.0.2; typescript-eslint 8.60.1→8.64.0; Vitest 4.1.8→4.1.10; Next 16.2.9→16.2.10; Zod 3.25.76→4.4.3; PGlite 0.5.3→0.5.4 | Mixed patch/minor/major; split REQUIRED             | No                 | Closed as partially superseded by #289 | Compatible updates shipped. `@types/node` 26, TypeScript 7, and Zod 4 remain at their major boundaries. Prettier 3.9.5 was rejected after a read-only probe found 21-file drift; 3.8.4 is exact-pinned.                                                                    |
| #211        | DB PGlite 0.5.3→0.5.4                                                                                                                                                                                                                                                                        | Patch; NEEDS-VERIFICATION                           | No                 | Closed as superseded by #289           | PGlite shipped in both DB and web manifests. Evidence: DB 161/161, focused PGlite-backed web 135/135, and exact-head ephemeral-Neon apply/rollback PASS.                                                                                                                   |

The compatible npm candidate was
`24f557c2718427e6da9d972d660cf1b042d56655`; PR #289 squash-merged as
`7d0fe9ce94a2dce6d29062c298f83442c8dd77bd`.

## Batching and Architect-delegated decisions

1. `actions/checkout` v7 was isolated because a failure would disable every
   workflow on the sole self-hosted runner. It merged only after the full
   required aggregate, heavy realism, ETL, ephemeral Neon, runner-hygiene,
   reviewers, Vercel, and production checks passed.
2. The remaining original Actions updates were batched because normalization of
   the workflow diff left zero semantic changes beyond immutable pins/comments.
3. Compatible npm patches/minors were regenerated from manifests; lock entries
   were never hand-edited. Major boundaries stayed on their existing versions.
4. `actions/setup-node` v7 was not accepted as an incidental major. The official
   v6.5.0 security/dependency refresh at
   `249970729cb0ef3589644e2896645e5dc5ba9c38` shipped across all nine uses with
   no workflow-semantic change.
5. Prettier 3.9.5 was not allowed to redefine the format contract in a dependency
   sweep. Exact 3.8.4 is pinned; Dependabot ignores only 3.9.5, not all future
   Prettier releases.
6. Capacitor 8.4.2 patches first appeared after the original seven-PR baseline.
   They were not self-served because mobile is a separately gated lane. Exact
   8.4.2 ignores prevent repeated PR recreation while later fixes remain
   eligible. This is a close-with-reason, not a claim that they shipped.
7. No forced esbuild override was added. Both advisories are dev-only and
   pre-existing; overriding incompatible 0.x toolchain versions would add risk
   without reducing production exposure.
8. `git worktree prune` was skipped because the metadata inspection found no
   prunable or missing worktree record.

## Determinism guard

After each production merge, `pnpm check:generated` regenerated 10,973
historical rating rows with zero null overall values, verified 1,246 projected-
2026 rows and 12,219 total compact player-card ratings, and produced no tracked
diff. For #289, the candidate tree and squash-merge tree were both
`c46ab24b70525263e281dd1ebcd1020b949a554e`; the post-merge generated check
passed on that identical tree.

No generated/runtime-data path changed from Gate 0 through `7d0fe9ce`. The
current draft-pool raw SHA remains
`ae5376c917377b00ac9dee7a166dcaceb28dd1416fc9fbe8b00b1116ca8e8d07`, the
scenario SHA remains
`50c45d0e9b9b56892e6bd3462988417e072ea1b08aff206fe344c3ebaccd66fd`, and the
schema remains `runtime-data-2.10.0`.

## Validation and exact-head CI

Every merged dependency candidate passed clean frozen installation, generated
determinism, typecheck 9/9, lint 6/6, root tests 9/9 (2,160 passes + 10 expected
skips), build 5/5, and goldens 69/42/59/22/6. Web-affecting #289 also passed
game-flow and 218/0 responsive checks; DB-affecting #289 passed the ephemeral-
Neon round trip.

| PR   | Candidate                                  | CI run        | ETL run       | Merge                                      |
| ---- | ------------------------------------------ | ------------- | ------------- | ------------------------------------------ |
| #285 | `c7adf9a2f8c5a377730db2bae3d69c22a02d9e68` | `29361797746` | `29361797737` | `e23aeb78e37fcad66c24764b87fa1cd693057a3d` |
| #286 | `92a93925028850dcb23cabd322910a77e5ea02ed` | `29364656565` | `29364656619` | `bf646847b614cc9dffe0d21004fa512f4e2c0013` |
| #289 | `24f557c2718427e6da9d972d660cf1b042d56655` | `29366806438` | `29366806541` | `7d0fe9ce94a2dce6d29062c298f83442c8dd77bd` |

For #289, exact-head CI included static/contracts, the 16m14s
typecheck/lint/test/build/WebKit job, heavy realism (N=2,000 × three policies),
all goldens, ETL rating, ETL ingest/determinism, Python 3.11/3.12/3.13 rating
locks, ephemeral-Neon apply/anon-dedupe/rollback, Gitleaks, GitGuardian, Vercel
preview, and the required aggregate. All concluded success.

## Review evidence

### Checkout v7

Primary cross-model transport: `ollama-cloud/glm-5.2`, variant `max`. Attempt 1
re-executed the checks but hung before emitting a verdict; attempt 2 exited
without a verdict. Under the dispatch's two-attempt substitution rule, two
independent fresh-context reviewers replaced that missing verdict. Their exact
verdicts were `PASS` and `PASS` at
`c7adf9a2f8c5a377730db2bae3d69c22a02d9e68`. The retained full reviewer verdict
began:

> **PASS — SHA-pinned to `c7adf9a2f8c5a377730db2bae3d69c22a02d9e68`
> for PR #285.**

It independently verified all 18 pins, official tag/commit provenance, runner
hygiene, production-migration contracts, generated determinism, exact-head CI,
and ETL. No sub-agent diff read was counted as the Red gate.

### Actions batch

GLM max in a fresh detached clone returned verbatim:

> PASS 92a93925028850dcb23cabd322910a77e5ea02ed

It re-resolved all three tags/SHAs, counted 2/5/9 uses, normalized the workflow
diff to zero semantic residue, checked Dependabot YAML, and re-ran the focused
contracts, actionlint, and generated-data check. A separate fresh-context
reviewer also returned `PASS` at the same SHA.

### Compatible npm batch

GLM max attempt 1 returned verbatim:

> **PASS 24f557c2718427e6da9d972d660cf1b042d56655**

It re-ran frozen install, typecheck 9/9, lint 6/6, root tests, goldens
69/42/59/22/6, build 5/5 with 8/8 traces, game flow, 218/0 responsive, format,
generated determinism, lock-graph inspection, action-pin inspection, and audit.
Its prose subtotal of 2,153 omitted mobile's seven passing tests; its raw output
and the implementer evidence show the correct 2,160 total. This arithmetic
omission did not affect its PASS.

The independent fresh-context reviewer returned verbatim:

> **PASS — PR #289 exact SHA
> `24f557c2718427e6da9d972d660cf1b042d56655`**, independently reviewed against
> base `bf646847b614cc9dffe0d21004fa512f4e2c0013`. No blocking findings.

That reviewer additionally passed DB 161/161 and a PGlite-backed web subset
135/135 and verified registry integrity for the updated packages.

## D2 — post-sweep supply-chain baseline

### JavaScript / pnpm

- `pnpm audit --prod --json`: exit 0; 0 info, low, moderate, high, or critical
  vulnerabilities across 80 production/optional dependencies.
- `pnpm audit --json`: 416 total dependencies; 1 low, 1 moderate, 0 high, 0
  critical.

Recorded development-only findings:

| Advisory                                                                 | Severity | Exact path/version                                                                                 | Exposure and disposition                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) | Moderate | `packages__db > drizzle-kit > @esbuild-kit/esm-loader > @esbuild-kit/core-utils > esbuild@0.18.20` | `dev: true`; esbuild development-server cross-origin response issue. Not in the production audit. Pre-existing and unchanged. Fix requires the legacy drizzle-kit loader chain to adopt esbuild ≥0.24.3; no runtime semver change was justified here. |
| [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr) | Low      | Ten `tsx`/Vitest/Vite/drizzle-kit development paths resolving `esbuild@0.28.0`                     | `dev: true`; arbitrary file read applies to a Windows development server. Production runs Linux Vercel output, not this dev server. Patched at 0.28.1; await the upstream toolchain resolution instead of forcing a cross-graph override.             |

The candidate and base contained the same esbuild versions (0.18.20, 0.25.12,
0.28.0), proving the batch neither introduced nor worsened these findings.

### Python / uv

`uv 0.11.8` exported the locked runtime set and the locked `dev` extra. Each
fully pinned export was audited with `pip-audit 2.10.1` under CPython 3.11,
3.12, and 3.13:

| Python | Runtime projection | Runtime packages | Full projection   | Full packages |
| ------ | ------------------ | ---------------: | ----------------- | ------------: |
| 3.11   | 0 vulnerabilities  |                4 | 0 vulnerabilities |            10 |
| 3.12   | 0 vulnerabilities  |                4 | 0 vulnerabilities |            10 |
| 3.13   | 0 vulnerabilities  |                4 | 0 vulnerabilities |            10 |

Python 3.11 selected NumPy 2.4.6; 3.12/3.13 selected NumPy 2.5.0. The first
parallel audit transport attempt failed when concurrent pip-audit processes
each created an `ensurepip` environment and aborted with SIGABRT. The audit was
then rerun sequentially in fully-pinned `--no-deps --disable-pip` mode; all six
completed with exit 0 and no findings. The initial transport failure is not
counted as a security result.

Gitleaks incremental scan and GitGuardian both passed on #289's exact head.

## D3 — residual hygiene

| Item                                    | Result                               | Evidence / action                                                                                                                                                                                                                           |
| --------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner worktree metadata                 | Skipped because absent               | `git worktree list --porcelain` showed no `prunable` entry and every listed path existed. `git worktree prune` was therefore not run.                                                                                                       |
| Prettier pin                            | Done                                 | Root manifest is exact `"prettier": "3.8.4"`; repo-wide format check passed. A read-only 3.9.5 probe found 21 files of drift. Dependabot ignores exact 3.9.5.                                                                               |
| `STATE.md` / `SIM_CALIBRATION.md` truth | Already current; no calibration edit | Both identify Season 2 Squad Depth and `engine-2026.07.14-squad-depth`; they record S1 availability, `MANAGER_MODIFIER.BAND = 0.06`, the per-match mean absolute win-probability movement metric, and drafted-manager presence + link tier. |
| Report/artifact tidiness                | No change needed                     | 794 tracked report artifacts; zero empty regular files, zero broken symlinks, and zero merge-conflict markers in reports/STATE/calibration. No history was deleted or reorganized.                                                          |

## Production live verification

After each dependency merge, Vercel reached READY before live checks. The final
dependency production check returned:

- `/api/health`: `ok=true`, exact build SHA
  `7d0fe9ce94a2dce6d29062c298f83442c8dd77bd`, DB `ready`;
- anchors: schema `runtime-data-2.10.0`, dataset `2026-07-01`, engine
  `engine-2026.07.14-squad-depth`, historical rating `wc-perf-6.6.0`, projected
  rating `proj-career-5.6.0`, ruleset `ruleset-2026.06.04`, current season
  `season-2026-squad-depth`;
- `/api/og/health`: `ok=true`;
- default leaderboard: ranked, classic, squad-first, all-time/career, season
  challenge, current and selected season both `season-2026-squad-depth`, valid
  empty-board shape and null cursor.

No live check failed, so no auto-revert was triggered.

## Branch and recovery ledger

The local recovery artifact is `/tmp/depsweep-branch-recovery.json`; each task
entry records branch, tip SHA, eight log subjects, and the diff stat before
deletion.

| Branch                              | Tip         | PR / production    | Cleanup                                                    |
| ----------------------------------- | ----------- | ------------------ | ---------------------------------------------------------- |
| `ws-meta/deps-checkout-v7`          | `c7adf9a2…` | #285 / `e23aeb78…` | Recovery logged; remote/local branch and worktree removed. |
| `ws-meta/deps-actions-batch`        | `92a93925…` | #286 / `bf646847…` | Recovery logged; remote/local branch and worktree removed. |
| `ws-meta/deps-npm-safe`             | `24f557c2…` | #289 / `7d0fe9ce…` | Recovery logged; remote/local branch and worktree removed. |
| `ws-meta/dependency-sweep-20260714` | `81a3b5a2…` | Gate-0 only        | Empty-diff recovery logged; local branch/worktree removed. |

Original Dependabot heads were captured in PR metadata before or through their
immutable PR refs: #165 `ea89ea7e…`, #166 `d5eb5bed…`, #211 `ed5a0635…`, #221
`d7ca3bdb…`, #222 `825948d1…`, #223 `0fa112b7…`, and #224 `5d16c7c2…`.
Regenerated #287/#288 were closed with reasons and their remote branches were
deleted automatically. `delete_branch_on_merge=true`. All eight protected tags
remain: `audit-s1-base`, `audit-s1-wave-a` through `audit-s1-wave-e`,
`season2-base`, and `season2-ship`.

## Risks and carryovers

- Two esbuild advisories remain in development-only paths; both are explicit in
  D2 and absent from `pnpm audit --prod`.
- Prettier 3.9.5 is intentionally ignored until a dedicated format migration.
- Capacitor 8.4.2 patches are intentionally deferred to the separately gated
  mobile lane; they are not represented as shipped.
- Physical Mobile Safari press feel cannot be proven by Chromium/WebKit desktop
  automation.

## Out of scope

- merit-v4.2 rating decluster (the recommended next dispatch);
- richer manager-quality tiers until a simulation-legal data channel exists;
- iOS M1b and its paid $99 owner gate;
- shared marketing replay/token authority; `marketing/x` remains paused;
- god-module splits, analytics, leaderboard seeding/growth, women's mode,
  monetization, OG-card layout changes, and any new product feature.

## Human actions

1. Run the approximately two-minute physical-iPhone Safari smoke for PLAY DAILY
   press feel.
2. Keep the Mac awake during the nightly self-hosted-runner window.
