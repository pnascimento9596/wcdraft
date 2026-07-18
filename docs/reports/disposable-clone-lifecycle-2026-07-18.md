# Mandatory disposable-clone lifecycle

Date: 2026-07-18

Risk: YELLOW (agent tooling, CI hygiene, and agent instructions only)

Pinned base: `f3e93472b18bc9f05d7e491fa5da3a98462064b3` (PR #314)

## Outcome

The create-side lifecycle gap is closed on branch `ws-meta/disposable-clone-lifecycle` at
checkpoint `c32f9db3f365d128700da1ddca6761956910780e`. Every sanctioned disposable WCDraft
implementer, reviewer, cross-model, replay, or repro clone is now created through one helper,
registered pending before Git population, and paired with the existing positive completion
transition. Aged paths without the exact completion marker are listed in every hygiene start while
remaining report-only and fail-closed.

This checkpoint is not yet represented as shipped production state. Merge, deployment readiness,
live health/OG checks, and the final reviewer maintenance receipts are recorded only after they
actually complete.

No product, schema, rating, data, engine, draft, sim, auth, leaderboard, or runtime contract changed.

## U0: shipped surface and gap

The lane fetched `origin` and pinned `origin/main` to
`f3e93472b18bc9f05d7e491fa5da3a98462064b3`, exactly the dispatch floor. The owner's checkout was
clean but 13 commits behind and remained untouched.

### Marker contract at the base

- `apps/web/scripts/agent-temp-lifecycle.ts` defined the regular-file marker
  `.wcdraft-agent-cleanup-ready` with exact content `cleanup-ready-v1`.
- `apps/web/scripts/mark-agent-temp-cleanup-ready.mts` exposed only the completion transition.
- The producer realpath-resolved both root and candidate, required a real non-symlink directory,
  direct-child containment, and a `wcdraft-`, `terrace-`, or `wave2-` basename prefix. Existing
  markers were accepted only as regular non-symlink files with the exact value.
- `scripts/ci/self-hosted-runner-hygiene.sh` scanned only direct children with those prefixes. It
  entered pruning below the 36 GiB target or when forced, considered only directory mtimes older
  than `WCDRAFT_RUNNER_STALE_MINUTES` (default 60), required the exact positive marker, wrote
  recovery JSON before deletion, and preserved candidates on symlink, mount, process cwd/command,
  Git common-directory, or linked-worktree uncertainty.
- The base had no create-side helper, pending registration, or aged-unmarked audit.

### Clone-creation inventory

The current operational instruction/script scan found six categories:

1. `CLAUDE.md` instructed agents to run raw
   `git worktree add /tmp/<task> -b ws-<area>/<topic> origin/main`.
2. `AGENTS.md` contained the byte-identical raw-worktree instruction. CI runs
   `scripts/check-agent-contracts.mjs`, so updating only `CLAUDE.md` as the dispatch proposed would
   either fail CI or require weakening the existing parity guard. Both contracts were therefore
   updated byte-identically as one agent-instruction surface.
3. CI and ETL clone `jfjelstul/worldcup` under the active workspace; `etl/README.md` documents the
   same acquisition. Those are job-local vendor data inputs reclaimed with the workspace, not
   agent-temp clones.
4. `scripts/ci/validate-daily-refresh-regeneration.test.sh` creates a detached worktree nested under
   its trapped `mktemp` probe root, then removes both on EXIT. It is a bounded regeneration fixture,
   not an operational reviewer clone, but it is a current scripted disposable-worktree path.
5. `docs/runbooks/daily-salt-map-manual-refresh.md` instructs an operator to create a protected
   rollback worktree at `/tmp/wcdraft-daily-revert-$rollback_stamp`. It is a manually managed
   recovery checkout rather than a disposable agent/reviewer clone; existing Git/common-directory
   safety probes must continue to preserve it.
6. At the pinned base, the hygiene contract creates test-owned Git repositories and a linked
   worktree under its trapped `mktemp` root. Those are fixtures, not operational reviewer clones.
   The helper-created clone fixtures described below are introduced by this lane, not present at
   the base.

Historical reports mention ad hoc `/tmp` clones, but no executable/current agent instruction or
package script at the base provided a sanctioned create path. The create-side gap was therefore
confirmed, not assumed. The full blocking inventory was also preserved during implementation at
`/tmp/u0-marker-findings.md`; its first draft missed categories 4 and 5 and anachronistically
attributed the new helper fixtures to the base. Fresh U0 review corrected all three defects before
ship.

## Implementation and safety boundary

`apps/web/scripts/create-disposable-clone.mts` now:

- accepts a bounded lowercase/digit/hyphen label, a non-option ref, optional branch, and optional
  source;
- realpath-resolves `WCDRAFT_AGENT_TEMP_ROOT` (default `/private/tmp`) and allocates one direct-child
  `wcdraft-<label>-*` directory;
- writes `.wcdraft-agent-cleanup-pending=cleanup-pending-v1` before `git init`, remote setup, fetch,
  or checkout;
- creates a self-contained clone whose Git common directory remains inside the candidate. A linked
  worktree is intentionally not used because the existing pruner correctly preserves candidates
  whose common repository is external;
- records both lifecycle marker names in the clone-local `.git/info/exclude`, keeping verdict
  worktrees clean without changing repository ignore policy;
- fetches the requested ref with `--filter=blob:none`, checks it out detached or on the requested
  branch, prints `DISPOSABLE_CLONE_PATH`, and prints an executable `MARK_COMPLETE_COMMAND`;
- embeds the resolved lifecycle root in every printed completion command. The paired command always
  runs from the still-usable invoking checkout instead of assuming the requested ref contains this
  monorepo or a package manifest; this holds for both successful clones and pre-checkout failures.

The existing lifecycle module owns both state transitions. Pending registration and completion use
the same root/prefix/direct-child validation. Completion validates any pending marker before
writing the unchanged `cleanup-ready-v1` marker, then removes the pending marker. Legacy paths with
no pending marker can still use the existing finalizer. Corrupt pending state cannot become cleanup
eligible.

`CLAUDE.md` and `AGENTS.md` add four short lines mandating the helper for implementer, reviewer,
cross-model, replay, and repro clones; the printed completion command must run when the purpose ends;
raw disposable clones/worktrees and unmarked leftovers are review defects.

### Residue audit

Every hygiene `start` now runs `audit_unmarked_agent_temp_residue` independently of cleanup need.
It scans the same realpath-resolved, de-duplicated direct-child roots and prefixes, defaults to a
60-minute threshold (`WCDRAFT_AGENT_TEMP_RESIDUE_MINUTES`), skips symlink directories and unsafe
control characters, and emits one warning per aged path without the exact positive completion
marker. Warnings classify `pending`, `unregistered`, `invalid-pending-marker`, or
`invalid-completion-marker`, include measured KiB when available, and finish with a count summary.
The function always returns zero: residue visibility cannot retroactively turn an otherwise healthy
CI lane red. Size-probe failure is likewise diagnostic-only: it emits
`candidate_kb=unavailable`, retains the count summary, and returns zero.

## Negative controls

The committed hygiene contract re-executes the real helper, lifecycle producer, and pruner:

1. **Marked helper clone:** the helper creates a self-contained clone with exact pending state; the
   package-level completion command writes `cleanup-ready-v1` and removes pending; after aging, the
   real pruner logs the exact path, writes recovery JSON, and removes it.
2. **Unmarked helper clone:** a second helper clone remains pending; after aging, the audit emits its
   exact path with `registration=pending`; the pruner logs that it lacks positive completion evidence,
   preserves the directory, and the sentinel remains unchanged.
3. **Audit-disabled mutation:** a temporary copy replaces only the production audit call with a
   mutation marker. The audit contract fails because the unmarked helper path and count line are
   absent, while the mutation marker proves the intended seam fired. Restored production passes.

Additional controls retain corrupt ready-marker rejection, add corrupt pending-marker rejection
before cleanup eligibility, preserve active and linked-worktree paths, fail closed on four safety
probe failures, force a pre-checkout fetch failure and execute its advertised recovery command
byte-for-byte, force `du` failure without turning hygiene red, prove the real `/private/tmp` prune
path, and retain both existing prune-disabled mutations.

The first implementation checkpoint `df05f40` failed an exact paired-command probe: its printed
pnpm separator was passed through as the script's first argument, so the finalizer tried to mark
`--`. Checkpoint `a0be080` removed the separator, added package-level execution coverage, and made
the CLI tolerate a leading separator for compatibility. Checkpoint `1feaa51` made a failed residue
size measurement report `candidate_kb=unavailable` without failing hygiene. Fresh U0 then found that
a helper failure before checkout printed a candidate-rooted pnpm command even though the candidate
had no `package.json`; checkpoint `df27d64` prints a source-checkout-rooted recovery command and
embeds the configured lifecycle root. Fresh U1 then proved that a _successful_ clone may also target
a non-monorepo tree, making its candidate-rooted completion command unusable; checkpoint `c32f9db`
uses the invoking checkout for every completion command and makes the success control execute the
printed command exactly against a sentinel-only source. The failure control likewise forces the
failure and runs its printed recovery command exactly. No stale PASS was carried across any fix.

## First real residue output

The first report-only production-root audit used cleanup-disabled maintenance mode with a 60-minute
threshold. It returned `count=9`, totaling **744 KiB**, and changed no path:

| Path                                                        | KiB | Registration |
| ----------------------------------------------------------- | --: | ------------ |
| `/private/tmp/wcdraft-copy-assets-closure-T7QIqS`           | 156 | unregistered |
| `/private/tmp/wcdraft-copy-assets-current-mismatch-PHJcjw`  |  84 | unregistered |
| `/private/tmp/wcdraft-copy-assets-policy-XCSzlX`            |  80 | unregistered |
| `/private/tmp/wcdraft-copy-assets-retained-mismatch-5nCjpS` |  84 | unregistered |
| `/private/tmp/wcdraft-copy-assets-retained-missing-75vsAM`  |  80 | unregistered |
| `/private/tmp/wcdraft-copy-assets-reuse-l7jN2g`             | 156 | unregistered |
| `/private/tmp/wcdraft-copy-assets-unsafe-path-Z6Iyb2`       |  80 | unregistered |
| `/private/tmp/wcdraft-server-data-path-zk9tbz`              |   8 | unregistered |
| `/private/tmp/wcdraft-sw-version-path-MAO0kg`               |  16 | unregistered |

Raw output: `/tmp/marker-lifecycle-real-residue-audit.log`. These are tiny unmarked test residues,
not evidence that the 1-2 GiB reviewer-clone problem remains. The audit authorizes no deletion.

## Sustainability and time to breach

Mandatory completion fixes indefinite retention but not peak concurrency. The 36 GiB cleanup target
still provides only 6 GiB above the 30 GiB floor. At PR #313's observed 7.01 GiB/hour growth, that
buffer is consumed in **6 / 7.01 = 0.856 hours, about 51 minutes**.

Writing the completion marker updates the candidate directory mtime. With the unchanged 60-minute
stale threshold and 15-minute LaunchAgent interval, a completed clone becomes reclaimable no earlier
than 60 minutes and normally within 60-75 minutes. At the incident rate, a continuous completed
residue window can therefore hold **7.01-8.76 GiB**, still larger than the 6 GiB buffer. Thirteen
concurrent active/review clones can also reproduce the earlier 17.06 GiB peak before any verdict
exists to authorize completion.

Therefore the dedicated-hardware recommendation **still stands**. Mandatory markers materially
reduce retained estate and make steady-state recovery automatic, but the number that decides the
capacity question remains 51 minutes to the floor versus at least 60 minutes to first eligibility.
The safe follow-up is capacity isolation or a separately reviewed staleness/threshold redesign—not
silent deletion of pending work.

## Validation, reviews, and maintenance receipts

Executed on the branch through checkpoint `c32f9db`:

- `bash -n` for production hygiene and its contract: passed;
- hygiene contract: passed, including all three required lifecycle controls and the additional
  fail-closed controls summarized above;
- agent-contract parity: passed;
- root dependency-aware typecheck: 9/9 tasks passed;
- root lint: 6/6 tasks passed;
- root build: 5/5 tasks passed, including 40/40 pages and both runtime-data traces at 8/8;
- root test retry: 9/9 tasks passed in 27m44s after the first attempt's responsive Chromium process
  closed during `ci-desktop-shell`. The successful uncontended retry recorded web Vitest at 129
  files passed + 1 skipped / 1,377 tests passed + 1 skipped, shell audits at 84 + 56 + 40 + 30 + 8
  metrics with zero failures, narrow collisions at 264 metrics with zero failures across Chromium
  and WebKit, and one-screen fit at 216 metrics with zero failures. The first browser-process failure
  is retained as infrastructure evidence and is not represented as a product pass;
- explicit core golden: 7 files / 111 tests passed (69 base golden + 42 draft golden);
- explicit data golden: 6 files / 81 tests passed (59 data + 22 integration);
- explicit leaderboard golden: 1 file / 6 tests passed;
- `git diff --check`: passed.

An attempted package-only web typecheck ran before workspace dependency builds and produced
`Cannot find module '@wcdraft/core|data|db'` cascades. It is recorded as an invalid isolated command,
not a product failure; the documented dependency-aware root typecheck subsequently passed 9/9.

Bootstrap/implementation maintenance already proved real reclamation:

- `/private/tmp/wcdraft-marker-lifecycle-impl-tp4XDH`: marked, then reclaimed at
  `2026-07-18T17:11:51Z`; recovery receipt
  `/Users/paulo/actions-runner-wcdraft/_work/_diag/wcdraft-runner-hygiene/recovery-20260718T171151Z-77384-1.json`
  records 658,956 KiB and trigger `marker-lifecycle-bootstrap-reclaim`.
- `/private/tmp/wcdraft-marker-lifecycle-impl-final-lHHV3T`: marked, then reclaimed at
  `2026-07-18T17:25:15Z`; recovery receipt
  `/Users/paulo/actions-runner-wcdraft/_work/_diag/wcdraft-runner-hygiene/recovery-20260718T172515Z-30800-1.json`
  records 1,429,504 KiB and trigger `marker-lifecycle-preformatted-reclaim`.

Final unit reviews passed independently at exact code head
`c32f9db3f365d128700da1ddca6761956910780e`:

- U0: `/tmp/marker-u0-c32-review.md`, SHA-256
  `6717edcec4090ddb2b418c07f4b3e95e2f9ea3e46c04a6683b5b321026ee5cab`;
- U1: `/tmp/marker-u1-c32-review.md`, SHA-256
  `7df44aadc91d0aa82131f4b906526981e50d975a2072427f4fb087164e9100b3`.

Both reviewers re-executed the exact successful command against a sentinel-only source, forced
pre-checkout recovery, the full hygiene contract, custom-root handling, boundaries, the three
dispatch controls, and root typecheck. Earlier FAIL/SUPERSEDED reports remain in `/tmp`; no stale
PASS was promoted after a fix.

The real production pruner then reclaimed 14 positively marked task-owned unit-review/probe clones
under trigger `marker-lifecycle-review-reclaim`. Recovery receipts are
`recovery-20260718T175829Z-8368-1.json` through
`recovery-20260718T175855Z-8368-14.json` in
`/Users/paulo/actions-runner-wcdraft/_work/_diag/wcdraft-runner-hygiene/`. The receipts total
13,563,120 KiB of candidate data; observed free space rose from 62,725,896 to 70,127,552 KiB. The
invoking implementation clone remained pending by design because child completion commands depend
on it until all children have closed.

Cross-model, protected-CI, final implementation-clone, merge, deploy, and live receipts are added
only after completion; no unexecuted gate is represented as green here.

## Scope, rollback, and carryovers

Tracked scope is limited to lifecycle scripts/tests, package exposure, the byte-identical agent
contracts, this report, and `STATE.md`. `AGENTS.md` is the one necessary addition to the dispatch's
literal allowlist because the verified CI parity invariant made a `CLAUDE.md`-only change unsafe.
PR #303 and local `recovery/season2-s4-caf2f3b` remain protected.

Rollback is a source revert: it removes the create helper, pending state, audit/reporting control,
and mandate while leaving the pre-existing completion marker and pruner semantics intact. Existing
pending clones remain conservatively unmarked and therefore preserved; no rollback deletes data.
