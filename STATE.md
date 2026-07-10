# STATE.md — measured ground truth

> Update rule: every lane updates this file in the SAME change that merges.
> Numbers below were MEASURED by running the commands, not assumed — re-measure
> whatever your change touches.

Self-hosted Actions runner migration:
2026-07-10 · Unit A0 branch `ci/self-hosted-runner`, based on `origin/main`
`c77ee289ab33cca3f0c27a6f0020b6492a5dd31e`, moves all four active workflows
(`CI`, `ETL`, `Nightly heavy gates`, and `marketing-x`) from metered hosted
compute to the durable `wcdraft-m4` macOS ARM64 runner. The runner is installed
at `~/actions-runner-wcdraft` as a launchd service and GitHub reported it online
with labels `self-hosted`, `macOS`, `ARM64`, and `wcdraft`. Every job explicitly
cleans its checkout, uses runner-owned declared dependency caches, registers an
always-run workspace scrub, and prunes only stale runner-owned work/cache paths
when free space is below 20 GiB. Fork pull-request workflows are disabled;
repository Actions remain enabled for owner branches with default workflow
permissions `read`, branch protection still requires the app-owned
`required · aggregate gates`, and `enforce_admins` remains enabled.
The nightly heavy schedule is `15:23 UTC` (`11:23 EDT` / `10:23 EST`) to run
while this Mac is typically awake; a missed night is benign because the Daily
runway gate evaluates coverage thresholds rather than requiring daily diffs.
Local A0 validation passed: frozen pnpm install; root typecheck 8/8 (3 cached);
actionlint v1.7.12 across all four workflows; Bash 3.2 and Node syntax checks;
Prettier and `git diff --check`; and a forced-low-disk functional probe that
pruned stale runner-owned work/cache/temp paths while preserving the active
workspace and an outside sentinel. The host had approximately 12.1 GiB free
during that probe, so the remaining below-20-GiB condition is surfaced as a
warning after safe runner-owned cleanup rather than deleting user-owned data.
The first branch run exposed `actions/setup-python` attempting the hosted-image
path `/Users/runner` on this self-hosted Mac; Python setup now uses pinned
`setup-uv` plus `uv python install` with both the download cache and managed
Python installations under the declared runner cache. A local isolated probe
installed and executed CPython 3.12.13 arm64 without privileged paths.
A0 shipped through PR #228 as `b882cc387669b1e64c25f726913c22ebacee5c09`.
Its successful gitleaks PR job `86287107874` downloaded the v8.24.3 archive to
the macOS user temp file `/var/folders/.../T/gitleaks.tmp`, scanned 2 commits,
and reported no leaks. The next gitleaks job on `main`, `86288569206`, failed
before scanning because that destination file still existed; this was a
persistent-runner tool-temp collision, not a secret finding. The focused A0
fix-forward binds only the gitleaks step's `TMPDIR` to `${{ runner.temp }}` and
scrubs `${RUNNER_TEMP}/gitleaks.tmp` at both hygiene start and its always-run
post phase. The existing canonical-path guards still constrain deletion to the
runner work root and protect the active workspace, so global/user temp is not
touched. A committed contract probe runs in the static CI job and passed 1
TMPDIR binding check, 4 actor guards, 1 static aggregate-name expression, 2
aggregate-name literals, 10 downstream `needs` edges, 3 actor gate cases, 2
independently seeded temp removals, and 4 active-workspace/outside sentinel
checks. Local fix-forward validation passed: frozen pnpm install (187 packages,
2.9s / 3.01s real; final-tree recheck already up to date in 318ms / 0.39s
real); root typecheck 8/8 cached tasks (0.60s real); actionlint v1.7.12 across 4
workflows (0.02s real); Bash 3.2 syntax for 2 scripts; Node syntax for the
hygiene action; full-repo Prettier (8.15s real); and `git diff --check`.
Post-merge A0 also exposed a trust-model gap: Dependabot refreshed 3 historical
action-update PRs and queued 6 CI/ETL runs (`29069760550`/`573`,
`29069758727`/`755`, and `29069754540`/`577`) against `wcdraft-m4`; jobs from
the bot-authored merge refs did execute before those runs were cancelled. CI
now rejects `dependabot[bot]` at both root jobs (`changes` and `static`) and at
the `always()` aggregate, while ETL rejects it at its root `changes` job. Every
remaining job depends on a guarded root, so bot runs enqueue zero self-hosted
jobs; owner branches and `github-actions[bot]` automation remain allowed.
Because GitHub treats a condition-skipped required job as successful, the
aggregate source expression reserves `required · aggregate gates` for trusted
actors and includes a distinct `blocked · dependabot actor` literal. A skipped
job's displayed name is not assumed to evaluate that expression; live checks
are the authority. Dependabot PRs stay protected-blocked until their change is
promoted onto an owner/agent branch for review and execution.
Live proof on Dependabot PR #165 at head
`5d5f2838523ab33bca0579416cb51f3326a97441`: CI run `29072226902` completed
with 10/10 jobs skipped, and ETL run `29072226897` completed with 3/3 jobs
skipped. All 13 jobs had null `runner_id` and `runner_name`, so none reached
`wcdraft-m4`. GitHub displayed the skipped aggregate name as the raw expression
`github.actor == 'dependabot[bot]' && 'blocked · dependabot actor' || 'required
· aggregate gates'`, not as the evaluated blocked literal. The head had zero
check runs named exactly `required · aggregate gates`, while `main` protection
still required that app-owned context; PR #165 reported `mergeStateStatus`
`BLOCKED`. The security goal was met even though the earlier display-name model
was false: no bot job received a runner, and the protected context was absent.

Desktop viewport-fit pass:
2026-07-06 · local YELLOW implementation on branch
`ws-ux/desktop-viewport-fit-20260706`, based on `origin/main`
`61f9905d6aecf33b2e59e542d61d4fba51b80088`. Scope is layout-only in
`apps/web`: desktop/laptop fixed-height shell rules for in-run spin, pick,
assign, and squad-review surfaces; desktop spin and share compositions; desktop
review internal panel scroll; sign-up title wrapping; and an expanded
responsive audit harness with `1512x982`, per-surface/viewport filters,
seeded draft states, desktop shell no-scroll assertions, and primary-action
viewport measurement. No core, rating, sim, token, API, schema, ETL, compact
runtime-data, or leaderboard scoring behavior changed. Local gates passed:
package build prereq for `@wcdraft/core`, `@wcdraft/data`, and `@wcdraft/db`;
web typecheck; root typecheck (8/8); root lint (5/5); root test (8/8; web
Vitest 83 files passed / 1 skipped, 904 tests passed / 1 skipped plus
`game-flow-playwright` and the responsive shell-fit gate); root build (4/4; existing Next circular chunk/runtime
warnings only); strict desktop responsive matrix (21 surfaces x 4 desktop
viewports x 2 themes = 168 captures / 0 failures, including 56 shell-gated
rows / 0 shell failures); strict mobile shell regression matrix (7 shell
surfaces x 2 mobile viewports x 2 themes = 28 captures / 0 failures); and
fresh-context reviewer PASS after rerunning web typecheck, desktop shell audit
(56/0), mobile shell audit (28/0), and representative visual inspection.
Report: `docs/reports/desktop-responsive-2026-07-06/REPORT.md`.

Desktop responsive pass:
2026-07-06 · local YELLOW implementation on branch
`ws-ux/desktop-responsive-20260706`, initially baselined on `origin/main`
`1274ff9b8cf3c36831be145fcff42e13d7bd48c5` and finally integrated after rebase
onto `origin/main` `09e1769461b65a49839ea0da61f21f8ae55cafb9`. Scope is
layout-only in `apps/web`: wider desktop container system, capped home hero scale and composed
hero grid, desktop mode-select card grid with non-overlapping in-flow CTA,
desktop draft pitch/candidate split, review/results two-column compositions,
history and leaderboard wide layouts, account desktop CSS, and a reusable
responsive browser audit harness. No core, rating, sim, token, API, schema,
ETL, compact runtime-data, or leaderboard scoring behavior changed. Local gates
passed: focused web typecheck/lint/test (83 files passed / 1 skipped, 904 tests
passed / 1 skipped plus `game-flow-playwright`), root typecheck (8/8), root lint
(5/5), root test (8/8), root build (4/4; existing Next chunk/runtime warnings
only), strict dev responsive matrix (8 surfaces x 5 viewports x 2 themes = 80
captures / 0 failures), and strict production-build responsive matrix via
`next start` (80 captures / 0 failures). Report:
`docs/reports/desktop-responsive-2026-07-06/REPORT.md`.

Blind Open draft mode closeout:
2026-07-03 · PR #214 (`ws-ux/blind-open-20260703`) merged to `main` as `7b497c9422672bedea578e926e005712951fa143`. Scope: added Blind Open as the fourth draft mode, with Open Draft choice density and pre-sim rating/synergy blinding, deterministic replay/share labels, and leaderboard exclusion. Recorded PR gates: focused core/web/marketing tests, root typecheck/lint/test/build, core/data/web goldens, and fresh detached review; heavy realism was not run because rating/sim/data artifacts did not move. Live verification on 2026-07-03: `https://www.wcdraft.com/play` returned 200, showed Blind Open in the mode selector, and exposed mobile build stamp `7b497c9 · 2026-07-03`. Report: `docs/reports/blind-open-2026-07-03.md`.

Space Grotesk single-font lane:
2026-07-03 · local YELLOW implementation on branch `ws-ux/space-grotesk-20260703`, based on `origin/main` `7b497c9`. Scope: removes the Space Mono public font payload and all app mono/system-family font references under `apps/web`, consolidates typography tokens to Space Grotesk, enables tabular numeric features globally, updates share/OG/global-error/auth-verify/static-SVG surfaces, embeds Space Grotesk font data into downloaded share-card SVGs, and keeps email-client markup as the documented exception. Payload proof: web font files drop from 267,031 B to 172,521 B (-94,510 B); Space Grotesk Latin faces carry OpenType `tnum`. Browser proof: strict mobile font audit (`apps/web/scripts/verify-font-consolidation-browser.mts`) passed at 390x844 and 360x800 in light/dark across 48 surfaces and 40 targets with zero failures, no non-Grotesk computed families, no horizontal overflow, no sub-44px targets, zero numeric surfaces missing tabular samples, and downloaded share SVG blobs containing embedded Space Grotesk font data. Local gates passed: focused web Vitest 2 files / 32 tests; web typecheck/lint/test (83 files passed / 1 skipped, 902 tests passed / 1 skipped plus game-flow Playwright); root typecheck 8/8, lint 5/5, test 8/8, build 4/4; web leaderboard golden 1 file / 6 tests; `pnpm check:generated`; `git diff --check`; targeted Prettier on supported changed files. Report: `docs/reports/font-consolidation-2026-07-03.md`.

Reference standing (FIT-06) lane:
2026-07-01 · RED lane on branch `ws-f4/reference-standing-20260701`, based on
`origin/main` `012c25a`. Scope: ships the strategicAutoDraft N=2000 score
population (the one pinned by `asym-realism-golden.json`) as a compact
quantile-table artifact `packages/data/src/generated/score-distribution.compact.json`
(1856 bytes raw / 767 gzip / 640 brotli; 101 nearest-rank breakpoints;
anchors = dataset/engine/rating/ruleset versions + source-bundle sha256s),
stamped into `manifest.json` as optional `bundles.score_distribution` and the
size report; `runtime-data-2.9.0` and `dataset_version 2026-07-01` unchanged
(dataset_version already equals today's ETL revision date — no honest newer
date exists; the manifest's new bundle entry is the live anchor). Every
completed run now shows a LOCAL "Beat ~X% of reference drafts" standing
(monotone, whole-%, tails clamp to Top/Bottom ~1%, anchor-gated to the run
record's versions, omitted when unknown); non-daily captions carry it; daily
captions keep the posted-field rules; How-to-Play explains the distinction.
Engine surfaces untouched: ratings/draw/sim math unchanged, canary and all
goldens byte-stable, zero pick flips. Gates run: data targeted suites
(web-assets-copy + compact-data golden + score-distribution golden = 16/16),
root typecheck (8/8), root lint (5/5), root test (8/8; web 860 passed / 1
skipped + game-flow-playwright), root build (4/4), core/data/web golden turbo
tasks (2+3+4 successful), heavy realism gate WCDRAFT_REALISM_HEAVY=1 (9/9,
including the new live-ensemble quantile re-derivation), and a Playwright/axe
UI proof (`apps/web/scripts/verify-reference-standing-browser.mts`): scores
{−7, 0, 14, 52} at 390x844 + 360x800, light + dark, 16 screenshots, 0 axe
violations, token-replay standing identical.

Password-first auth + ranked verification lane:
2026-07-03 · local RED implementation on branch
`ws-auth/password-first-20260703`, based on `origin/main` `ebfac96`. Scope:
reconciles PR #193's magic-link-first account hub into the owner target model:
primary sign-up is username + email + password with signup-time username format,
blocklist, and uniqueness validation; sign-in is username-or-email + password;
magic-link sign-in remains as the secondary legacy/passwordless path; forgot
password sends a reset-purpose magic link to `/account?set_new_password=1`;
`/account` now surfaces identity, username, email verification, change password,
fresh-link set-new-password, and delete controls; ranked attempt/submit require
`users.email_verified_at` while casual play/posts remain available unverified.
Migration `0011_email_verification` adds only nullable
`users.email_verified_at`; existing magic-only/no-username accounts remain
valid, and consuming any magic link sets verification. No core, sim, rating,
ETL, compact runtime-data, or data bundle files changed; runtime-data anchors
remain `runtime-data-2.9.0`. Local gates passed before fresh-context review:
focused auth/leaderboard suite (8 files / 130 tests), DB tests (3 files / 108
tests), root typecheck (8/8), root lint (5/5), root test (8/8; core 389, data
101 passed / 9 skipped, db 108, marketing 68, web 895 passed / 1 skipped plus
`game-flow-playwright`), web production build, core/data/web golden Turbo tasks,
Neon ephemeral branch apply + full rollback round-trip including
`0011_email_verification.down.sql`, and local production Playwright/axe proof:
sign-in, sign-up, unverified account verification/change-password, and
fresh-link set-new-password at 390x844 and 360x800 in light and dark; 16
screenshots, 0 axe violations, no horizontal overflow. Report:
`docs/reports/auth-password-first-2026-07-03/summary.md`.

Daily-seed vetting + ENG-08 invariant lane:
2026-07-02 · local RED implementation on branch
`ws-core/daily-seed-vetting-20260702`, based on `origin/main` `07aaf42`. Scope:
adds a committed `daily-seed-salt-map-1.0.0` artifact for the UTC Daily Draft
seed, stamps it into `manifest.json` as optional
`bundles.daily_seed_salt_map`, and makes client daily derivation,
token/replay recognition, and leaderboard validation read the same shipped map.
Runtime code only reads the bundle; vetting simulation stays in data generation
and scheduled CI. Initial window is `2026-07-02` through `2026-07-15` UTC,
reference policy `greedyOverallAutoDraft`, N=128 sample seeds per candidate,
8 candidate salts/date max, final bands = easy perfect >= 10% or easy
qualifying >= 95%, cruel qualifying <= 10% or median <= score-distribution q10
(-8). Initial `salts` is empty: all 14 dates measured normal (qualifying range
0.218750-0.335938, median range -7.0 to -4.0, perfect rate 0). Artifact
fingerprint: 9084 raw bytes / 1345 gzip / 1152 brotli, sha256
`6dcb7042eca6b529abe231cb57823d392beda21f15e7742f74c8ab38bb5ae1bf`. ENG-08:
`choice_overall` is documented and guarded as display/offer-tiering only, never
scoring/sim/best-XI/team-strength. Local gates passed: generated chain through
daily salt map and final compact, `pnpm run check:generated`, focused
data/core/web suites, root typecheck (8/8), root lint (5/5), root test (8/8;
core 389, data 101 passed / 9 skipped, db 106, marketing 68, web 867 passed /
1 skipped plus game-flow Playwright), root build (4/4), core/data/web golden
Turbo tasks, and heavy realism (9/9). Report:
`docs/reports/daily-seed-vetting-2026-07-02.md`.

Daily-seed 45-day runway refresh (Audit S1 A2):
2026-07-10 · RED implementation on branch
`ws-core/audit-s1-daily-runway` in PR #225, rebased without conflicts onto
`origin/main` `986c5789614b0dc2e3bc726f5e34b2dd266d1f55` after A1 shipped through
PR #227 at that same commit. A1's typed fail-closed behavior outside committed
Daily coverage remains the base behavior and is untouched here. A2 raises the
Daily salt-map builder default from 14 to exactly 45 days and replaces the
committed artifact with 45 contiguous UTC dates from `2026-07-10` through
`2026-08-23` inclusive.
Policy `greedyOverallAutoDraft`, N=128 sample seeds/candidate, 8 candidate
salts/date, salt/seed construction, and the existing degeneracy bands are
unchanged. All 45 selected candidates measured normal (qualifying range
0.187500-0.335938, median range -7.5 to -3.0, perfect-rate range
0-0.007813): 39 dates are unsalted and six use salt `#2` (`2026-07-24`,
`2026-07-27`, `2026-08-10`, `2026-08-17`, `2026-08-20`, `2026-08-21`).
Artifact fingerprint: 26,506 raw bytes / 2,229 gzip / 1,792 brotli, sha256
`42d012d035565b4ff218d890b2ecbd28d0e3ea3c3c30240737d8ba4afc3f5d79`.
No rating, sim, core, ETL, schema, auth, or A3 workflow semantics changed.
Post-rebase verification ran the mandated five-step regeneration chain twice
with `--start-date 2026-07-10`; both passes ended with a clean worktree and
zero-byte tracked diff. Both reproduced the artifact sha above plus manifest
sha `7979fa756545287ef84a4cc338d9d2fa7d362f03e5ad84814318cf1bd7cc28bb`,
compact-size report sha
`003dbf2e48d7bc1469288795bd3fa08b353f2b5f919ff57eac89a99616add64c`,
and score-distribution sha
`16c01f921455ebd6a47b22e0ee7ee5f7e3d36239bc3df9982d123e155c75b06d`.
The exact window, 45-date contiguity, today's coverage, and manifest/report
fingerprints were asserted independently after each pass. Frozen install was
already current (0.18s). Post-rebase local gates passed: focused Daily golden
(1 file / 8 tests); full data tests (13 files passed / 1 skipped, 103 tests
passed / 9 skipped); generated-artifact check; root typecheck (8/8), lint
(5/5), test (8/8; core 391, data 103 passed / 9 skipped, DB 108, marketing 68,
web 919 passed / 1 skipped, game-flow Playwright, responsive shell-fit 56
desktop + 28 mobile metrics / 0 failures), and build (4/4); core goldens (111
tests), data/integration goldens (71 tests), web leaderboard golden (6 tests),
and heavy realism (9/9). Required PR gates now execute on the self-hosted
`wcdraft-m4` runner; CI results remain unclaimed until this exact head is pushed.

Share polish + orientation lane:
2026-07-01 · local YELLOW implementation on branch
`ws-ux/share-polish-orientation-20260701`, based on `origin/main`
`1a5fa90809a3`. Scope is bounded to `apps/web`: signed-caption share flow,
OG-sign retry/error affordances, recipient share-tool disclosure and Daily
beat-context handoff, Daily/orientation copy, DATA/FIT labels, mid-spin seed
reassurance, human season display, seed/history/result copy cleanup, account
null-draw formatting, daily non-canonical board rejection code, and crest
normalization for audited existing assets/monograms. No `packages/` or `etl/`
files changed; runtime-data anchors remain `runtime-data-2.9.0`. Local gates
passed: package builds for `@wcdraft/core`, `@wcdraft/data`, and `@wcdraft/db`
(3/3; cache hits), full `@wcdraft/web` test (79 Vitest files passed, 1 skipped;
838 tests passed, 1 skipped, plus `game-flow-playwright`), root typecheck
(8/8), root lint (5/5), root test (8/8; 7 cached, web uncached), root build
(4/4; web uncached, Next chunk/runtime warnings only), `git diff --check`, and
local production-style Playwright/axe verification with 36 screenshots covering
390x844 and 360x800 in light and dark for mode select, Daily draft, Classic
pick, mid-spin resume, results, share, recipient share, board, and How-to-Play.
The browser verifier mocked `/api/og/sign` success/failure because this local
shell has neither `WCDRAFT_OG_SIGNING_SECRET` nor `DATABASE_URL`; leaderboard
API failures in the local board proof were expected from enabling the board
without DB credentials and were not treated as UI regressions. Screenshot set:
`/private/tmp/wcdraft-share-polish-screenshots`.

Open Draft / RED-contract reconciliation lane:
2026-07-01 · local RED implementation candidate on branch
`ws-ux/open-draft-contract-ship-20260701`, based on `origin/main`
`9c154dd`. Scope: adds `DraftMode: "open"` as a casual-only full-roster
nation draft, extends run tokens to `t4.` with picked card ids and manager card
ids, keeps leaderboard submission accepted modes to Classic/Memory only,
fail-closes marketing replay for Open tokens, updates How to Play/mode labels,
and reconciles current/future-facing RED contract wording to the v5
fresh-context reviewer -> autonomous SHA-pinned merge -> deploy ->
live-verify -> auto-revert chain. Runtime data anchors remain
`runtime-data-2.9.0`; no ETL output or compact runtime-data artifact changed.
Local gates passed: `@wcdraft/core` test (23 files / 384 tests), focused web
Vitest (8 files / 160 tests), `@wcdraft/marketing-x` typecheck and test (8
files / 68 tests), root typecheck (8/8), root lint (5/5), root test (8/8; web
837 passed / 1 skipped plus `game-flow-playwright`, data 84 passed / 7 skipped,
core 384, db 106, marketing 68), root build (4/4), core/data/web golden tasks,
`pnpm check:generated`, `git diff --check`, repeated web production builds, and
local production-style Playwright/axe proof at 390x844 and 360x800 in light and
dark with no horizontal overflow, no sub-44px visible targets, zero axe
violations, `t4.` Open token replay, and tampered-token rejection. Report:
`docs/reports/open-draft-2026-07-01.md`.

Accounts/auth hub lane:
2026-06-30 · PR #193 branch `ws-fix/accounts-auth-hub`, originally based on
`995b11a70054278ab716a7667486eb91bafcbe6a`, rebased onto `origin/main`
`11ef02afd754c553533858d3efd61f2ed7554b85`. Scope: optional password login
on top of existing magic links, `/account` hub, account-owned runs/stats,
password set/change/delete-account flows, deterministic account-stat clock
injection for tests, shared session issuance, and nullable `users.password_hash`
/ `users.password_set_at` migration `0010`. The checked-in RED contract now uses
the v5 autonomous chain; Red safety is fresh-context implementer/reviewer
separation, machine gates, SHA-pinned merge, deploy observation, live
verification, and auto-revert on failed live checks. Current
local validation passed: DB tests (3 files / 106 tests), focused auth/account
tests (6 files / 35 tests), Neon branch up/down plus pre-migration magic-link-only
auth proof, root typecheck (8/8), root lint (5/5), root test (8/8; core 384,
db 106, data 84 passed / 7 skipped, marketing 67, web 831 passed / 1 skipped
plus `game-flow-playwright`), root build (4/4), core/data/web goldens, and mobile
Playwright/axe proof at 390x844 and 360x800. The `/account` destructive action
contrast is fixed against existing tokens and measures 5.11:1 light / 6.19:1
dark. Report: `docs/reports/accounts-auth-2026-06-30.md`.

Last measured for merit-v4.6 curve-inverted owner overrides:
2026-06-28 · local RED gates run on branch
`ws-merit/v45-curve-inversion-20260628` before merge/ship.
Closeout report: `docs/reports/merit-v4.6-curve-inversion-2026-06-28.md`.

Spin Agency / choose-from-3 lane:
2026-06-30 · local RED implementation on branch
`ws-core/spin-agency-20260630`, based on `origin/main`
`421587cf553df8894fc6d27085b6844288ee52f7`. Scope: draft spins now surface
up to three deterministic player choices plus the manager option; current share
tokens are `t3.` and carry choice indices instead of player card ids; leaderboard
anti-cheat replay refuses legacy tokens and out-of-range choices; runtime-data
anchors moved to `runtime-data-2.9.0` /
`engine-2026.06.30-spin-agency`; active leaderboard season default moved to
`season-2026-spin-agency`. Local gates passed: core test (23 files / 383 tests),
data golden/data+integration/canary/heavy realism, serial Turbo test
(`pnpm exec turbo run test --concurrency=1`, 8/8 tasks), root typecheck (8/8),
root lint (5/5), root build (4/4), and `git diff --check`. Report:
`docs/reports/spin-agency-choose-three-2026-06-30.md`. Not shipped until the RED
independent reviewer PASS, SHA-pinned merge/deploy, and live production readback
gates complete.

Real club crests lane:
2026-06-30 · local RED implementation on branch `ws-ux/real-club-crests`,
based on `origin/main` `995b11a`. Scope is display-only in `apps/web`: an
audited side manifest for current club-entity crest assets, exact normalized
club-string lookup at render time, and deterministic neutral monogram fallback
for unmapped, ambiguous, and historical rows. Coverage from
`docs/reports/real-club-crests.md`: historical 1930-2022 resolves 0 / 10,957
club rows by design; projected 2026 resolves 84 / 1,246 club rows; all other
rows fall back honestly. No runtime-data schema, player-card schema,
runtime-data version, core, sim, rating, ETL, or golden behavior changed. Local
gates passed: `@wcdraft/data` build, `@wcdraft/db` build, focused web Vitest (2
files / 18 tests), web typecheck, web lint, full web test (74 files passed / 1
skipped; 804 tests passed / 1 skipped plus `game-flow-playwright`), web
production build, `git diff --check`, static SVG scan, and browser proof at
390x844 / 360x800 in light+dark with zero axe violations, no horizontal
overflow, reserved 16x16 crest boxes, and CLS 0. Report:
`docs/reports/real-club-crests.md`; browser proof:
`docs/reports/real-club-crests/browser-proof.json`.

OG durability lane:
2026-06-30 · local RED implementation on branch
`ws-fix/og-durability-20260630`, based on `origin/main`
`3e1bdc5daa0be84ff38dee09322b93ee52a8dadc`. Scope is bounded to `apps/web`:
signed per-run OG cards now render as durable historical snapshots when the HMAC
and token hash verify, even after deploy/runtime-data/rating-version rotations;
the `/api/og/run` edge route no longer loads current runtime-data or invalidates
signed snapshots on version mismatch; OG cache keys now use signed payload
version plus token-hash prefix instead of deploy/data hashes; and
`/api/og/health` asserts the stable server-only OG secret is present without
exposing it. Local gates passed: package builds for `@wcdraft/core`,
`@wcdraft/data`, and `@wcdraft/db` (3/3), focused OG Vitest (28 tests), public
payload/API inventory sweep (1 test), web typecheck, web lint, root
`pnpm typecheck` (8/8), root `pnpm lint` (5/5), root `pnpm test` (8/8; web
809 passed / 1 skipped plus `game-flow-playwright`), root `pnpm build` (4/4),
and `git diff --check`. Report:
`docs/reports/og-durability-2026-06-30.md`. Fresh-context independent reviewer
passed from separate clone `/private/tmp/wcdraft-og-review-195-YvebK8/wcdraft`
on PR #195: re-executed package builds, focused OG Vitest (28 tests), public
payload/API inventory sweep (1 test), web typecheck, and `git diff --check
origin/main...HEAD`. PR #195 merged as
`a65fa933dfbc1125c0f25dc9cf6c1b2af137e7a6`, but its first production Vercel
deployment failed before READY because Lane B's lineup inspector still called the
old one-argument `buildRunOgCacheKey`.

OG durability deploy recovery:
2026-06-30 · production Vercel build for merge commit `a65fa933` failed because
Lane B's leaderboard lineup inspector still called the old one-argument
`buildRunOgCacheKey`. Recovery branch `ws-fix/og-durability-lineup-cache`
decouples the lineup inspector cache from OG image cache keys and scopes it to
current run-data version anchors plus token hash. Local recovery gates passed:
lineup inspector + OG Vitest (37 tests), web typecheck, Vercel-equivalent
`pnpm exec turbo run build --filter=@wcdraft/web...` (4/4 tasks), Prettier check
for the touched file, and `git diff --check`. PR #198 CI run `28470048653`
passed and merged as `a18e492027f9c4d3b96e505c8e797ca0c2a4fcfe`. Production
deployment `dpl_GHKXRgCL25xEd2nPPhpHq7EVjUSd` reached READY and aliased
`www.wcdraft.com`; live readback proved the pre-deploy signed OG image remained
byte-identical after deploy, malformed/missing signatures fall back to
`og-default.png`, malformed signer input rejects 422, and no `/api/og/*` runtime
errors were found in the post-deploy Vercel window.

Manager attrition engine-season lane:
2026-06-30 · local RED implementation on branch
`ws-core/engine-season-20260630`, based on `origin/main`
`7b31d1b`. Scope: U1 revalidated the committed manual override resolver
with real current counts (`v4.5` remains 2,336/2,516 matched, 180 unmatched, 36
existing recovered v4.3 honest misses; 0 new recoveries in this lane); U2 wires
the reserved manager band through `SynergyResult.manager_link` without reading
`ManagerRating.overall`; U3 lowers persistent user-path tournament-ending injury
probability from `0.34` to `0.12`; U4 assessed choose-from-3 position-fit
non-triviality; U5 raises the choose-from-3 weak-candidate floor by sampling
full offers from the top three buckets of an eight-bucket ranked legal roster.
Post-U5 strategic difficulty landed at 1329/2000 qualifying (66.45%) and mean
score 14.479 versus the post-U1-through-U3 baseline of 1090/2000 (54.50%) and
8.229. Undefeated regulation moved 6 -> 10 and perfect 8-0 moved 4 -> 7.
Legend/elite display OVRs and catalog draw probabilities are unchanged, but
offered-choice exposure rose: 90+ choices 9.0563% -> 10.7458%, legend choices
8.0385% -> 9.8354%. Runtime anchors moved to `runtime-data-2.9.0` /
`engine-2026.06.30-manager-attrition`; rating anchors remain `wc-perf-6.6.0` +
`proj-career-5.6.0`; active leaderboard season default moved to
`season-2026-manager-attrition`. Local gates passed: core build, draft golden
regen, data compact/e2e/era/canary/asym/leaderboard regenerators, core narrow
goldens (5 files / 42 tests), data golden:data (2 files / 31 tests), data
golden:integration (2 files / 22 tests), canary (1 file / 1 test), heavy realism
(1 file / 7 tests), web leaderboard golden (1 file / 6 tests), core
draft/manager/synergy/sim goldens (4 files / 95 tests), root typecheck (8/8),
root lint (5/5), root test (8/8; core 384, data 84 passed / 7 skipped, db 104,
marketing 67, web 818 passed / 1 skipped plus `game-flow-playwright`), and root
build (4/4). Report:
`docs/reports/engine-season-manager-attrition-2026-06-30.md`. Fresh-context
independent review passed with no blockers and re-executed the requested gates.
The checked-in RED contract now uses autonomous RED shipping: fresh-context
independent review, SHA-pinned merge, deploy observation, live verification, and
auto-revert on failed live checks. Reviewer carryover: a synthetic legal-roster
size 4/5 edge can yield fewer than three offered player choices under the U5
bucket filter, though a 5,000 real-pool draft probe found 85,000 player spins
with `minRolled=3` and `short=0`.

CI spend/branch-protection lane:
2026-06-27 · local gates run on branch `ws-meta/ci-spend-aggregate-20260627`.
The CI contract now uses path detection plus one required aggregate status,
`required · aggregate gates`, instead of making individual heavy jobs required.
Branch-protection baseline before edits required exactly
`typecheck · lint · test · build` and `golden RNG determinism`. The lane report is
`docs/reports/ci-spend-aggregate-2026-06-27.md`.

PWA launch hardening lane:
2026-06-28 · local YELLOW gates run on branch
`ws-ux/pwa-launch-hardening-20260628`, rebased onto `origin/main`
`eed5c4e` / `runtime-data-2.8.0`. Scope is bounded to `apps/web`: first-run
seed collision prevention, share-recipient acquisition + signed OG/caption
hardening, WCAG AA token fixes, compact post-reveal candidate ordering/focus,
and draft loading skeleton. Local gates passed: root `pnpm typecheck` (8/8),
`pnpm lint` (5/5), `pnpm test` (8/8; web 745 passed / 1 skipped plus
`game-flow-playwright`), `pnpm build` (4/4), axe-core 4.12.1 on 6 mobile
page/theme states, and browser verification with 16 screenshots at 360×800 /
390×844 in both themes. Report:
`docs/reports/pwa-launch-hardening-2026-06-28/summary.md`.

Daily Draft implementation lane:
2026-06-29 · local RED implementation on branch
`ws-f4/daily-draft-20260629`, based on `origin/main`
`797fefa8a68edb0449f46199917e4d4b0e83d4d6`. Scope: UTC date-derived Daily
Draft seed, canonical Classic / Squad First / All-time / Career / 4-3-3 config,
daily token metadata/replay validation, public casual daily leaderboard,
best-of-many per identity/day, share CTA routing for the same daily teams,
explicit active leaderboard season id (`WCDRAFT_LEADERBOARD_SEASON_ID` with
pinned default), and rating-version stamping on accepted leaderboard rows.
Report: `docs/reports/daily-draft-2026-06-29.md`. Not shipped until the RED
independent reviewer PASS, SHA-pinned merge/deploy, and live production
readback gates complete.

Leaderboard season/ranked-attempt lane:
2026-06-29 · local RED implementation on branch
`ws-leaderboard/season-attempts-20260629`, based on `origin/main`
`acc0a82f4b768f7938e2cd4d116109d15d8809ce`. Scope: aggregate Casual/Ranked
boards now use explicit active season id `season-2026-summer` instead of a
six-anchor version hash; accepted rows still stamp `rating_version` so
cross-version seasons remain auditable. Ranked drafts now mint a server-issued,
single-use, short-window attempt seed bound to user, season, formation, and full
board config; ranked submit requires the matching unconsumed attempt and stores
`attempt_id`. Casual and Daily remain attempt-free; Daily remains public
best-of-many by UTC date. Report:
`docs/reports/leaderboard-season-ranked-attempts-2026-06-29.md`. Not shipped
until production migration, merge/deploy, and live readback gates complete.
Fresh-context independent reviewer passed from separate clone
`/tmp/wcdraft-leaderboard-review-bI1pIo`: no findings; re-executed targeted DB
tests (3 files / 104 tests), targeted web tests (9 files / 149 tests), and
`git diff --check`.

Daily fronting / OG craft lane:
2026-06-29 · local YELLOW gates run on branch
`ws-ux/daily-fronting-og-craft-20260629`, based on `origin/main`
`33fff71c437c2d64eddddf9c956da8341f7c51fe`. Scope is bounded to
`apps/web`: Daily Draft fronted in home/nav/play/how-to-play, daily leaderboard
CTA/copy/percentile row polish, daily share-caption standing copy with honest
fallback, shared token-rooted share/OG palette with provenance-hued lineup
fills, shared loading fallback/global-error polish, and null-preserving
view-model fallbacks. No leaderboard server route, submit route, store, season,
migration, engine, ETL, compact data, or rating contract changed. Local gates
passed: package build for `@wcdraft/core`, `@wcdraft/data`, and `@wcdraft/db`
(3/3), root `pnpm typecheck` (8/8), root `pnpm lint` (5/5), root `pnpm test`
(8/8; web 776 passed / 1 skipped plus `game-flow-playwright`), root
`pnpm build` (4/4), `test:golden:leaderboard` (4/4; 6 tests), fresh-context
review (PASS / no blockers), and browser proof with 28 mobile screenshots plus
1 OG card, zero axe violations, zero contrast failures, zero overflow failures,
zero page errors, zero console errors, and zero HTTP errors. The web Vitest
fork pool is now capped at 4 workers after unbounded fork startup proved flaky
on loaded local runners. Report:
`docs/reports/daily-fronting-og-craft-2026-06-29/summary.md`.

Memory reveal share / progression / leaderboard IA lane:
2026-06-29 · local YELLOW gates run on branch
`ws-ux/memory-reveal-share-20260629`, based on `origin/main`
`371bee8cb57ece40a027ba76e1c076bcbb8e03d0`, then rebased onto `origin/main`
`2de107c4e7088c5296cbf7a113e1b08c0c215430`. Scope is bounded to `apps/web`:
Memory hidden-mode reveal before/after share SVG/OG/caption, cold `/play`
Memory de-emphasis behind Daily/Classic, post-run `Try drafting blind`
progression affordance, and leaderboard IA labels that keep sighted Classic and
blind Memory lanes separate. No `blindCardRatingView` seam, engine, draft/sim,
compact data, ETL, run-token schema, leaderboard server route/store/scoring,
migration, or season-key change. Parallel-lane files `apps/web/app/page.tsx`,
root layout, and theme provider were not touched. Local gates passed: focused
web Vitest (5 files / 95 tests), web typecheck, root `pnpm typecheck` (8/8),
root `pnpm lint` (5/5), root `pnpm test` (8/8; web 790 passed / 1 skipped plus
`game-flow-playwright`), root `pnpm build` (4/4), `test:golden:leaderboard`
(4/4; 6 tests), fresh-context review for all three units (PASS / no blockers),
and browser proof with 12 mobile screenshots at 360×800 / 390×844 in both
themes, zero axe violations, zero contrast failures, zero overflow failures,
zero page errors, zero console errors, and zero HTTP errors. Runtime anchors
remain `runtime-data-2.8.0` / `engine-2026.06.28-merit-v4.6` /
`wc-perf-6.6.0+proj-career-5.6.0`, dataset `2026-06-04`, ruleset
`ruleset-2026.06.04`; explicit active leaderboard season id remains
`season-2026-summer`. Report:
`docs/reports/memory-reveal-share-2026-06-29/summary.md`.

BASIS: merit-v4.3 pins both **Career/default** and **Current** to the owner
`final_rating`; merit-v4.5 is a conservative recovery list for v4.3's unresolved
rows and uses that same Career+Current pin path. merit-v4.4 re-rates **Current**
only and still supersedes Current on overlap while leaving the v4.3/v4.5 Career
pin in place. merit-v4.6 preserves those display pins but restores their
internal sim score/channel inputs to `display_curve^-1(owner display)` before
channel materialization.

Current repo runtime anchor:
`runtime-data-2.9.0` / `engine-2026.06.30-manager-attrition` / `wc-perf-6.6.0` /
`proj-career-5.6.0`, dataset `2026-07-01`, ruleset `ruleset-2026.06.04`, legend
census `295`, player-card count `12,219`, manager-card count `501`, teams `48`,
knockout slots `62`. Explicit active leaderboard season id:
`season-2026-manager-attrition`.

X marketing lane:
source assets are present on `origin/main` as of
`b67d1e54bac8b16e9eee4a5a4bc1d39a2e343907`; current operator pack is
`marketing/x/packs/pack-2026-W25.md`, generated/refreshed 2026-06-15 for the Jun 16-22
tournament hook frame. The playbook artifacts at
`marketing/x/playbook/wcdraft-x-playbook.{docx,pdf}` are regenerated from W25 plus the
committed reply and quote banks. Organic posting is unblocked; paid promotion remains
blocked on trademark counsel.

Manual rating override sources (v4.3 ∪ v4.5 ∪ v4.4 — v4.4 supersedes the
current pin on overlap):

- v4.3 (career+current pin): `etl/overrides/manual-ratings-v4.3.csv`, sha256
  `f121d0f768fe70cfc6d699559bf78dc25d356ccea33ca0aa5e8ded11c65d9da6`, 2,516 rows;
  2,300 matched (`91.4149%`), 216 honest misses, 2,246 effective pins. UNCHANGED.
- v4.5 (career+current pin; conservative recovery of v4.3 honest misses):
  `etl/overrides/manual-ratings-v4.5-recovered.csv`, sha256
  `3effc3ba9adb7efd5fb4d00c406da5aa82db67d5b64f20e5a049cb807eaef249`, 36 rows.
  v4.3+v4.5 resolution: 2,336/2,516 matched (`92.85%`), 180 honest misses,
  2,265 effective Career+Current pins before the v4.4 Current overlay.
- v4.4 (CURRENT pin only): `etl/overrides/manual-ratings-v4.4.csv`, sha256
  `d51f188357d645f2ff558d8a851434ab78d7e5755136e0be189ad34cdab143a0`, 1,154 rows
  (515 applied, 639 blank-target no-changes). 515/515 matched (`100%`), 0 honest
  misses, 0 collisions. Split: 144 up / 249 down / 122 same. Combined v4.3+v4.5
  plus v4.4 effective card pins: 2,691. Artifacts:
  `etl/output/manual-ratings-v4.5-{resolution,unmatched,effective}.csv`,
  `manual-ratings-v4.5-summary.json`,
  `etl/output/manual-ratings-v4.4-{resolution,unmatched,effective}.csv`,
  `manual-ratings-v4.4-summary.json`.

Data/bundle anchors:
`draft-pool.compact.json` raw bytes `130,545,042` with sha256
`461601c64221289ccddabc97db426d54fbd4d39ef06bcd2a9bbdae129d2a487a`;
draft-pool manifest Brotli bucket `2,224,896` (copied `.br` bytes `2,224,859`);
manifest sha256 `2d475e8f0224e320cb51ce870280dc0016d51456cd96ce3ecddad8d49d218fd4`.
`scenario-2026.compact.json` raw bytes `108,775` with sha256
`7846fa3abe0eab4aa283efd1e8382959593ec1248030eba13913fac0ae8da398`.
Runtime data delivery is versioned at `/data/wcdraft/runtime-data-2.9.0/`, with
`runtime-data-2.3.0` through `runtime-data-2.6.0` retained under
`apps/web/public/data/wcdraft/` during local web asset copy.

The named canonical doc files (`Build State`, `Architecture`, `Roadmap`,
`Surface Inventory`) are not present in this repo. The owner-filed doc-set
refresh is captured at `docs/reports/era-closeout-doc-refresh-2026-06-15.md`:
Build State v10, Architecture v6, Roadmap v6, and Surface Inventory v6, each
superseding the prior version. This `STATE.md` is the in-repo closeout truth
surface.

Per-config leaderboard shipped via PR #156 merge `ffb7a4f` (2026-06-17): DC-8
policy is resolved to exact per-config boards for both casual and ranked. Ranked
remains account-required, but the single canonical ranked ladder is removed.
Board partition key is
`mode × draft_mode × draft_order × era × rating_basis`; default landing remains
Ranked · Classic · Squad First · Career · All-time. Migration `0006` adds
nullable `draft_order`, `era`, and `rating_basis`, backfills only current-season
rows whose stored token yields a coherent config, and excludes legacy/old-season
NULL-config rows from filterable views. Report:
`docs/reports/per-config-leaderboard-2026-06-17.md`.

## UI polish overhaul shipped state

PR #148 shipped the mobile polish overhaul from fix-forward branch
`ws-ux/ui-polish-v2`, based on reverted `origin/main`
`1db44cba1f3328ccc90a84b952619a27f6557626`. Attempt v1 shipped through
PR #146 at merge
`4590a7a383b1d1bac7c898d5b9e99cf37d5a5621` and Vercel deployment
`6A38ktV3PY2E8v9qbtSqonAoEncX`, then failed live verification because the
production `/leaderboard` page still scrolled at both target mobile widths
and emitted an anonymous `/me` 401 resource console error. Per dispatch, v1
was auto-reverted through PR #147 at merge
`1db44cba1f3328ccc90a84b952619a27f6557626` and Vercel deployment
`w76cFPSm6Kp6SJYoxbmPG7BugZtU`; post-revert board API checks stayed clean.
Production leaderboard synthetic test rows were removed via Neon production
branch `br-blue-heart-aqcejtyf`, and live API checks for ranked Classic,
ranked Memory, casual Classic, and casual Memory returned 200 with the probe
rows absent.

v2 shipped through PR #148 at merge `fa796cbd79da7e1c2673f9717fc283c5656cb06d`
and Vercel production deployment `6XzjEFQAiN3cgvw5nAenQyU9Skgr`. Main CI on the
merge commit passed: dedupe 5s, ETL rating/lint/golden 37s, heavy realism 3m45s,
typecheck/lint/test/build 4m43s, golden RNG 50s, db path filter 10s, db ephemeral
branch skipped by path filter. Production live verification against
`https://www.wcdraft.com` passed 48 page checks (12 surfaces × 390×844/360×800 ×
light/dark), 4 leaderboard API checks, zero failures, zero non-permitted document
overflow, zero console-error pages, 17 review flags, one live Synergy line,
`leaderboardMaxDelta=0`, and reduced-motion snap proof. v2 was not reverted.

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
compaction, transform/opacity-only motion with reduced-motion snapping, and a
v2 leaderboard mobile compaction/fetch-gate pass. The leaderboard pass hides
the footer on mobile leaderboard, tightens the header/season key/toolbar/panel
and empty state, and skips the `/api/leaderboard/me` highlight fetch until the
existing auth context has a real browser session. No schema, database, ETL,
sim, rating, compact data, `formations.json`, auth contract, or Synergy
mechanic files are changed.

Local gates run so far: `pnpm --filter @wcdraft/web typecheck`, `pnpm --filter
@wcdraft/web lint`, focused `vitest` for `pitch-markings` and
`synergy-overlay` (2 files / 11 tests), `git diff --check`, hardcoded-color and
lexicon guard greps, browser screenshot/fit measurement against
`http://localhost:3002`, post-fix Playwright + axe on `draft-complete` and
`review` at 390×844/360×800 in both themes (8/8 zero violations, zero
console/page errors, zero document overflow, 17 flags, one lit Synergy line,
reduced-motion snap verified), v2 leaderboard recapture against
`http://127.0.0.1:3020/leaderboard` with `LEADERBOARD_ENABLED=1` and
intercepted public board reads (4/4 zero document overflow and zero
console/page errors), independent fresh-context Codex CLI review from this
WCDraft worktree (PASS / no Yellow blockers), and full root `pnpm typecheck &&
pnpm lint && pnpm test && pnpm build` (typecheck 8/8, lint 5/5, test 8/8 with
core 366, data 73 passed / 7 skipped, db 79, marketing-x 64, web 694 passed /
1 skipped, build 4/4). RepoPrompt review could not run because the active
RepoPrompt workspace was bound to BiotraxIQ, not this WCDraft worktree; a
later attempt to rebind RepoPrompt to `/tmp/wcdraft-ui-polish` failed with a
broken-pipe MCP transport error.

## Formations + results-page UX wave (ws-f4/formations-results-ux)

- Supported formations expanded **6 → 8**: added `4-1-4-1` and `3-4-2-1` to core
  `FORMATION_TEMPLATES`, web `SUPPORTED_FORMATION_IDS`/`FORMATION_BLURBS`, and
  `apps/web/public/brand/formations.json` (mini-pitch rows). Both reuse existing
  `SlotPosition` roles — no new slot-role/compatibility entries. `formation-adjacency`
  golden re-locked (EXPECTED_ADJACENCY count 6 → 8); new validity proof
  `packages/data/test/new-formations-validity.test.ts` (8 tests) drives each new shape
  through autoDraft → fieldable XI + GK → schema → full sim on real data.
- Formation lock-page picker redesigned: emerald left-accent rail removed; calm equal
  vertical tiles with the mini-pitch as focus, hero id, emerald reserved for the
  `LOCK THIS SHAPE` CTA + focus ring. DRAFT SETUP disclosure unchanged.
- Results page: sans throughout (Sora body + Saira Condensed numbers via new `next/font`
  vars — Newsreader untouched elsewhere); outcome-plate emerald → plate-ink/gold so it
  clears AA on the inverted cream plate; narration + match rows no longer overflow;
  top-scorer national flag added (honest no-flag fallback). axe 0 violations on picker +
  results, both themes, 390×844 + 360×800. Evidence:
  `docs/validation/formations-results-ux-2026-06-16/`.

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
- merit-v4.6 is the current ratings/data season: owner override display pins
  remain exact, but their internal sim score and channels are now
  curve-inverted onto the natural internal scale before channel materialization.
  v4.4 remains a Current-only overlay on top of v4.3+v4.5. The lambda fitter was
  re-run against the corrected Career-basis distribution before the realism
  re-lock. The accepted lambda is
  `BASE=1.10/SPREAD=5.5/MIN=0.30/MAX=3.4/W_DEF=0.7/W_GK=0.30/GAMMA_MID=1.0`
  with `KO_LAMBDA_FACTOR=0.82`, `CHANCES.REGULATION=50`, `EXTRA_TIME=17`,
  `LAMBDA_DISP.OUTER_PROB=0.2`, `LAMBDA_DISP.A=0.75`,
  `GROUP_OUTER_PROB=0.14`, and `GROUP_A=0.4`. Career display 90+ remains
  `324/12,219 = 2.6516%`.
- merit-v4.3 (career+current owner pins) remains the base layer under v4.5:
  owner-authored manual pins are applied after merit scoring as internal-score
  pins, so display OVERALL, best-XI selection, and the Poisson sim all consume
  the authoritative value for resolved cards. v4.5 recovers only reviewer-agreed
  unresolved rows; non-listed cards are unchanged.
- Residual >=5-player clusters are dominated by older/sparse squads. North Korea
  2010 remains at max duplicate 5 because the clustered rows have genuinely
  near-identical public records, not because of a filler floor.
- Platform pass is DONE-LIVE: #133 SEO + themed 404/error, #134 AA contrast +
  44px targets, #135 response headers, #138 nonce CSP + unsigned-summary
  neutralization, #136/#142 performance and atomic versioned delivery, #139 a11y
  and candidate render memoization, #140 safe patch dependencies.
- Runtime data delivery is atomic/versioned at
  `/data/wcdraft/runtime-data-2.9.0/`; fixed legacy `/data/wcdraft/*` paths remain
  for old clients/server readers and `runtime-data-2.8.0` is retained for N+1
  propagation.
- Trusted OG is DONE-LIVE via #143: `/api/og/sign` validates replay tokens against
  the current manifest, reconstructs the draft, runs the deterministic engine, and
  signs the canonical OG render model plus token hash; `/api/og/run` verifies the
  signature/version/token hash on Edge and otherwise renders the static fallback.
  Vercel Production has `WCDRAFT_OG_SIGNING_SECRET` set.

## Shipped versions (repo pins — `packages/data/src/generated/manifest.json`)

| Field                          | Value                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| schema_version                 | runtime-data-2.9.0                                                                                                                        |
| dataset_version                | 2026-07-01                                                                                                                                |
| ruleset_version                | ruleset-2026.06.04                                                                                                                        |
| engine_version                 | engine-2026.06.30-manager-attrition                                                                                                       |
| rating_version (historical)    | wc-perf-6.6.0                                                                                                                             |
| rating_version (projected)     | proj-career-5.6.0                                                                                                                         |
| career_stature                 | career-stature-4.1.0                                                                                                                      |
| merit source set               | merit-source-set-2.2.0                                                                                                                    |
| active source set              | active-career-source-set-2.2.0                                                                                                            |
| runtime legend census          | 295                                                                                                                                       |
| runtime ratings                | 12,219                                                                                                                                    |
| Career basis counts            | 11,292 measured · 541 career-stature · 386 baseline                                                                                       |
| career-stature table           | 847 players · 209 material · 114 source-derived legends                                                                                   |
| explicit leaderboard season id | season-2026-manager-attrition                                                                                                             |
| compact brotli total           | 2,231,296 measured bytes                                                                                                                  |
| served draft-pool br artifact  | 2,224,859 bytes at `/data/wcdraft/runtime-data-2.9.0/draft-pool.compact.json.br`; manifest bucket `2,224,896`; decompressed sha `461601…` |
| compact sha256                 | manifest `2d475e8f…` · draft `461601…` · scenario `7846fa3a…`                                                                             |
| generated artifact locks       | ratings lockfile `bf4b75e…` / payload `89630181…` / 212 bytes · draft-pool `461601…` / 130,545,042 bytes                                  |

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

| Suite                                                     | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| @wcdraft/core `test`                                      | 338 passed (ui/ux-basis-wave: current-basis recorded, no longer refused)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| @wcdraft/core `test:golden` (RNG)                         | 3 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| @wcdraft/core `test:golden:draft`                         | 40 passed (entity-resolution and manager-identity goldens now wired)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| @wcdraft/data `test`                                      | 65 passed, 7 skipped (72)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| @wcdraft/data `test:golden:data`                          | 31 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| @wcdraft/data `test:golden:integration`                   | 22 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| @wcdraft/db `test`                                        | 74 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| @wcdraft/web `test` (ui/ux-basis-wave on main)            | 634 passed, 1 skipped (635) (+rating-basis seam/divergence/determinism tests)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| @wcdraft/web `test` (leaderboard-profiles L4)             | 653 passed, 1 skipped (654)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| @wcdraft/web `test` (leaderboard-profiles main-sync)      | 665 passed, 1 skipped (666)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| @wcdraft/web `test` (main @ 2026-06-14 improvement pass)  | 674 passed, 1 skipped (675) (#133–#136 added no tests; metadata/CSS/header/perf only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| @wcdraft/web focused a11y/perf follow-up                  | 32 passed (a11y focus/perf, club provenance, Synergy SR delta, position-first, full-path final, tap-stability)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Root `pnpm test` (a11y/perf follow-up branch)             | core 366 passed · data 65 passed/7 skipped · db 79 passed · marketing-x 64 passed · web 678 passed/1 skipped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| @wcdraft/web `test:golden:leaderboard` (main)             | 5 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| @wcdraft/web `test:golden:leaderboard` (L4)               | 6 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| @wcdraft/marketing-x `test`                               | 64 passed (engine parity, composer/lexicon, pipeline, queue, X client, engagement, weekly pack/banks)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| etl V1 `ruff check src tests`                             | clean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| etl V1 focused merit suite                                | 42 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| etl V1 `pytest -q`                                        | 233 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| merit-v3 V1 club-season citation verifier                 | 14/14 rows verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| merit-v3 V1 active/stature generation                     | two-run byte-identical hash match                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| merit-v3 V1 conservatism                                  | ratings + compact generated artifacts unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| etl V2 `ruff check src tests`                             | clean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| etl V2 focused rating/display/projected suite             | 91 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| etl V2 `pytest -q`                                        | 241 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| merit-v3 V2 mutation proofs                               | 3/3 guards failed when deliberately broken                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| merit-v3 V2 historical artifact generation                | two-run byte-identical hash match                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| merit-v3 V2 conservatism                                  | 2026 outputs + career_stature + compact unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| etl V3/V4 `ruff check src tests`                          | clean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| etl V3/V4 `pytest -q`                                     | 288 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| merit-v3 V3/V4 §7 movers/controls                         | 14 in-band, 6 pinned-miss elements; controls 7/7 evaluable pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| merit-v3 V3/V4 distribution/coherence probes              | median and 90+ pass; pile-up, inversion, and 9 pre-1967 violations pinned for V8 waiver                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| merit-v3 V3/V4 determinism                                | both stage orders run-twice byte-identical                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| merit-v3 V3/V4 boundary                                   | career_stature, canonical tables, compact, canary, lambda/realism untouched                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| merit-v3 V6 compact regen                                 | 12,219 ratings · 270 legends · dual basis 12,219/12,219 · 1,216,302 bytes before V8 stamp                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| merit-v3 V7 lambda                                        | evals 175 · winner BASE 1.05 / SPREAD 6.5 / MIN 0.70 / GAMMA_MID 0.80 / KO 0.82                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| merit-v3 V8 compact stamp                                 | `build:compact` ok · 12,219 ratings · 270 legends · 1,216,305 bytes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| merit-v3 V8 generators                                    | e2e seed `:29`, era, leaderboard, token-skew, canary, asym realism regenerated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `pnpm exec turbo run typecheck lint test build --force`   | PASS on post-season wrap final local diff: 16/16 tasks · 0 cached                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| V8 explicit goldens + ETL + heavy realism                 | core 3 + 37 · data 31 + 22 · web leaderboard 5 · ETL ruff clean / pytest 288 · heavy realism 7/7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| V8 regen byte-stability                                   | compact/e2e/era/canary/asym/leaderboard/token-skew output hashes unchanged after rerun                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| post-season focused web tests                             | SW registration/cache + config badges/copy: 28 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| post-season browser proof                                 | local production build: 12 screenshots · SW registered · stale test caches evicted · console errors 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| leaderboard-profiles L3 focused suite                     | validation + golden + submit + board + UI + serializer: 145 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| leaderboard-profiles L3 lane mutation proof               | disabling the token.md<->draft_mode guard failed validate + submit cross-lane tests; restored 77 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| leaderboard-profiles L4 focused privacy/UI suite          | all exported API-method public-payload email sweep + UI render/XSS guards: 37 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| leaderboard-profiles L4 screenshots                       | 4 local Playwright captures: Classic/Memory x light/dark at 390x844 / 360x800; rendered email probe false                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| @wcdraft/web `build` (leaderboard-profiles L4)            | PASS; existing Next/Webpack circular chunk warnings only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| leaderboard-profiles main-sync focused suite              | privacy sweep + UI gating + board-view tests: 49 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| merit-v3.1 ETL gates                                      | `ruff check .` clean · `pytest -q` 291 passed · `tests/test_merit_v3_gate.py` 34 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| merit-v3.1 compact/goldens                                | `build:compact` twice byte-identical · data golden 31 passed · integration golden 22 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| merit-v3.1 canary                                         | regen twice + normal run passed · hash `151528048c35a8cb5053eebddb2bba742a8d2831b1f3b8ba712954c24df9acc1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| merit-v3.1 leaderboard/token skew                         | leaderboard golden 6 passed · run-token v1/v2 skew tests 44 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| merit-v3.1 fix-forward local gates                        | gitleaks no leaks · source snapshot manifests ok · heavy realism 7 passed after re-lock                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| merit-v4 root gate                                        | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` PASS: typecheck 8/8 · lint 5/5 · test 8/8 (core 366, data 65 passed/7 skipped, db 79, web 674/1 skipped, marketing-x 64) · build 4/4                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| merit-v4 explicit goldens                                 | core `test:golden` 67 + `test:golden:draft` 40 · data `test:golden:data` 31 + `test:golden:integration` 22 · web leaderboard 6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| merit-v4.6 local gates (2026-06-28)                       | ETL `ruff` clean · `pytest -q` 310 passed · compact regen 12,219 ratings / draft `7d6d06…` / season `…_aa7256a5` · lambda fit 175 evals, winner BASE 1.10 / SPREAD 5.5 / MIN 0.30 / GAMMA_MID 1.00 / GROUP_OUTER_PROB 0.14 · symmetric realism 2.565 goals, 24.96% draw, 4.92% margin>=4, 33.73% ET, 21.87% SO · canary 24 intentional pick flips · heavy realism 7 · core goldens 68+40 · data goldens 31 · integration 22 · leaderboard golden 6 · typecheck 8 · lint 5 · test 8 (web 733+1skip, data 84+7skip, core 381, db 90, mkt-x 67) · build 4 · `git diff --check` clean                                                                                      |
| merit-v4.5 gates (2026-06-24)                             | ETL `ruff` clean · `pytest -q` 306 passed (incl. new `test_manual_overrides_v45.py` 4) · manual resolver v4.5 2,336/2,516 matched with 36 recovered / 180 remaining · data goldens 31 · integration 22 · canary 0 flips (stamp-only) · heavy realism 7 · core goldens 67+40 · leaderboard golden 6 (season `…_e0542bd8`) · typecheck 8 forced · lint 5 · test 8 (web 704+1skip, data 82+7skip, core 376, db 83, mkt-x 64) · build 4 · `git diff --check` clean                                                                                                                                                                                                         |
| merit-v4.4 gates (2026-06-16)                             | ETL `ruff` clean · `pytest -q` 302 passed (incl. new `test_manual_overrides_v44.py` 5) · data goldens 38 · integration (e2e `:105`, era) · canary 0 flips (stamp-only) · asym-realism landings byte-identical (λ unchanged) · heavy realism 7 · core goldens 67+40 · leaderboard golden 6 (season `…_f79ba870`) · typecheck 8 · lint 5 · test 8 (web 694+1skip, data 74+7skip, core 366, db 79, mkt-x 64) · build 4 · `git diff --check` clean (`.gitattributes` protects fingerprinted override CSVs)                                                                                                                                                                 |
| merit-v4 ETL gates                                        | `ruff check src tests` clean · focused v4 probe suite 225 passed · full `pytest -q` 297 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| merit-v4 GitHub blob-limit fix                            | deterministic compact `ratings.json` encoding lowered artifact to 59,551,789 bytes · post-amend ruff clean / pytest 297 · `git diff --check` clean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| merit-v4 compact/generators                               | `build:compact` ok · 12,219 ratings · 295 legends · dual basis 12,219/12,219 · 1,434,624 normalized brotli bytes · e2e/era/canary/asym/leaderboard/token-skew regenerated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| merit-v4 compact metadata CI fix                          | normalized Brotli metadata to 128-byte upper-bound buckets after Linux CI measured draft-pool Brotli 2 bytes below macOS · data test 65/7 · root gate rerun 8/5/8/4 · data golden 31 + integration 22                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| merit-v4 lambda/realism                                   | fit 175 evals · winner BASE 1.10 / SPREAD 6.0 / MIN 0.30 / GAMMA_MID 0.80 / KO 0.82 · symmetric goals 2.544, draw 24.87%, margin4 4.86%, ET 34.13%, SO 21.33% · heavy realism 7/7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| merit-v4 canary                                           | strategic-pick canary regenerated; 6 intentional pick flips documented for review                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| perf-delivery local gates                                 | data/web focused 8+38 · root typecheck/lint/test/build 8/5/8/4 · goldens core 67+40, data 31+22, web 6 · heavy realism 7 · ETL ruff clean / pytest 297                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| og-trusted focused share-image suite                      | OG/signing + public-payload privacy sweep: 18 passed; illegal-pick mutation rejected as `ILLEGAL_PICK`; tampered-result mutation signed/rendered the true re-derived summary; long untrusted display text sanitized before signing; oversized headerless signer bodies rejected while streaming; repeated uncached signer attempts capped; signed route repeat fetch byte-identical with immutable cache                                                                                                                                                                                                                                                               |
| og-trusted root gates                                     | forced cumulative Turbo typecheck/lint/test/build 19/19, 0 cached (core 366, data 73 passed/7 skipped, db 79, marketing-x 64, web 693/1 skipped) · existing Next/Webpack circular chunk + Edge static-generation warnings only                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| og-trusted goldens + generated + heavy realism            | core `test:golden` 67 + `test:golden:draft` 40 · data `test:golden:data` 31 + `test:golden:integration` 22 · web leaderboard 6 · data heavy realism 7 · `pnpm check:generated` PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| oversized artifact migration                              | inventory exactly 2 tracked blobs >40 MB · `pnpm run check:generated` PASS after full regen · ETL rating 42 passed · data golden 31 passed · core draft golden 40 passed · copy-web-assets PASS · forced full turbo 19/19 tasks, 0 cached · fresh verifier PASS · Vercel preview READY                                                                                                                                                                                                                                                                                                                                                                                 |
| history purge + post-purge verification                   | backup ref `refs/backup/pre-purge-2026-06-15-0244Z` pushed · generated paths stripped with `git filter-repo` · no remaining generated blob >40 MB · post-push fresh clone `pnpm install --frozen-lockfile`, `pnpm check:generated`, local-vs-live hash compare, and `pnpm build` PASS · main CI + ETL + Vercel green                                                                                                                                                                                                                                                                                                                                                   |
| @wcdraft/web `typecheck` (leaderboard-profiles main-sync) | PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| @wcdraft/web `build` (leaderboard-profiles main-sync)     | PASS; existing Next/Webpack circular chunk warnings only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| narrative-v2 focused goldens                              | narrative golden 64 passed · narrative+sim golden 117 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| narrative-v2 all explicit goldens                         | turbo 9/9 tasks · core 67 · draft 40 · data golden/data 31 · integration 22 · leaderboard 6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| narrative-v2 full turbo                                   | typecheck/lint/test/build 19/19 tasks · core 366 · data 65 passed/7 skipped · db 79 · web 665/1 skipped · marketing-x 64                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| narrative-v2 heavy realism                                | 7 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| narrative-v2 formatting/lexicon                           | `git diff --check` clean · Prettier clean · changed-line lexicon/IP grep clean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| supply-chain/determinism floor (2026-06-25)               | action `uses:` SHA-pinned · Dependabot added · `format:check` clean after generated/runtime-data ignores · `etl/uv.lock` committed and `uv sync --locked` clean · Python 3.11/3.12/3.13 rating lock all sha256 `1084f74194c7d46c66892f4d0328d3d90a728a8cec43956564cffd2ec651f0a0` · gitleaks full-history and incremental scans 0 unallowlisted findings after path-narrow false-positive allowlist · ETL ruff clean / pytest 306 · core goldens 67+40 · data goldens 31+22 · leaderboard golden 6 · heavy realism 7 · root typecheck 8/8 · lint 5/5 · test 8/8 (core 376, data 82+7skip, db 83, marketing-x 64, web 704+1skip) · build 4/4 · `git diff --check` clean |

## CI (`.github/workflows/`)

- `ci.yml` jobs: **dedupe** (skips push-event runs when the pushed branch has an open
  PR — the pull_request run still gates; q-008) · **verify** (generated-data determinism ·
  AGENTS/CLAUDE drift check · `format:check` · typecheck·lint·test·build) ·
  **golden** (RNG + draft + data/integration + web leaderboard) · **realism** (heavy
  asymmetric gate, N=2000 × 3 policies) · **db-gate → db-rollback-check**
  (path-filtered to `packages/db/**`+workflow+lockfile+turbo.json; ephemeral Neon branch,
  never prod; apply → read-only `db:migrate:status` → rollback-check) · **etl-rating**
  (Python 3.12 + `uv sync --locked` · ruff · rating tests · ratings.lock.json
  byte-determinism) · **gitleaks** (incremental PR/push scan).
- `etl.yml`: ingest · identity-QA · determinism, path-filtered to `etl/**`; upstream
  Fjelstul pinned `f41e9437` with a post-clone `rev-parse` assertion. Primary ETL job
  uses Python 3.12 + `uv sync --locked`; rating-lock matrix proves Python 3.11/3.12/3.13
  all keep `etl/output/ratings.lock.json` byte-identical.
- `marketing-x.yml` (q-007): **ZERO-API content-pack model.** @WCDraft has no X API
  credits — both `POST /2/tweets` AND search return 402 `CreditsDepleted` — and the owner
  will not buy credits, so there is NO automated posting. The workflow is a weekly `pack`
  job (Mondays 06:00 UTC + `workflow_dispatch`) that runs the composer → commits
  `marketing/x/packs/pack-YYYY-WW.md` + refreshed `reply-bank.md`/`quote-bank.md` to main
  with `[skip ci]`. The owner schedules posts by hand via X's native composer
  (`marketing/x/ROUTINE.md`). The live poster (`run-poster`/`run-engagement`) + X client
  stay built + tested but DORMANT behind `MARKETING_PAUSED=true` (currently set); they
  activate only if credits are ever loaded. Repo Actions no longer stores
  `X_API_KEY`/`X_API_SECRET`/`X_ACCESS_TOKEN`/`X_ACCESS_SECRET`/`X_BEARER_TOKEN`, and no
  workflow references those names. Browser-automation posting is forbidden (X ToS).
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
- `WCDRAFT_CSP_REPORT_ONLY` is an optional build/test cache-keyed override declared in
  `turbo.json`; it is not a required production secret. `WCDRAFT_LEADERBOARD_SEASON_ID`
  is the optional explicit aggregate season-id override and is also declared in
  `turbo.json`; the code default is `season-2026-manager-attrition`.
  `LEADERBOARD_REQUIRE_ACCOUNT` is retired as an env lever and removed from
  Turbo env lists; ranked submit requires an account in code without reading
  that flag.
- Neon prod DB: migrations 0000–0004 were provisioned + verified live 2026-06-10.
  Migration 0005 is in the repo and shipped with leaderboard profiles; re-verify
  prod migration status before relying on 0005-specific production state.
- GitHub **Actions secrets** (not Vercel): only `NEON_API_KEY` and `NEON_PROJECT_ID` were
  present when rechecked on 2026-06-25. The old X API secret names are absent and unused.
  Repo **vars** govern the marketing lane: `MARKETING_PAUSED` (kill switch, default off),
  `MARKETING_LIVE` (default off → dry-run), `MARKETING_DAILY_CAP` (optional, clamped to 6).

## Branch / merge convention (from git history)

`ws-<area>/<topic>` task branches; long-lived integration branches `engine-*`/`merit-*`
(CI-watched); PRs squash-merge to `main` (one commit per PR); Red merges pin the
reviewed head with `--match-head-commit`, then require deploy observation and
live verification on `www.wcdraft.com` with auto-revert on any failed live check.
