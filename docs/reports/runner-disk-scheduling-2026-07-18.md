# Runner disk scheduling and capacity evidence

Date: 2026-07-18

Risk: YELLOW (runner/CI infrastructure only; no product/runtime contract changed)

Pinned base: `58d184154082e2b673fcbd02cebbe05456233f01`

Runner: `wcdraft-m4` (GitHub runner id 21, version 2.335.1)

## Outcome

The scheduling hole is closed for artifacts that satisfy the existing fail-closed lifecycle
contract. The runner now has a user LaunchAgent that executes every 900 seconds and on load,
refuses to run while an Actions `Runner.Worker` process is active, and invokes the same bounded
positive-marker pruner used by CI. Every deletion is preceded by recovery JSON. The pre-job gate
still prunes first and then fails below the hard 30 GiB floor, but its failure is now a compact
`RUNNER_DISK` line with the largest in-scope consumers.

This does **not** prove that the shared Mac can sustainably preserve 30 GiB under the current
fresh-review workflow. The PR #313 incident accumulated 13.44 GiB in 1.91 hours, while the 36 GiB
cleanup target provides only 6 GiB above the floor. Those reviewer clones had no positive
completion marker, so both the old pruner and the new timer must preserve them. The durable
recommendation is a dedicated runner, plus mandatory lifecycle completion for every disposable
review/replay clone.

## U0: raw incident reconstruction

The hypothesis that nothing ran between lanes was only partly correct. There was no host trigger,
but repository hygiene executed repeatedly before the incident:

| UTC                    | Run                                            |                                                                                        Observed free-space result |
| ---------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------: |
| 2026-07-18 01:43-01:48 | PR #311 main push `29625732480`                |                                                                                       Six starts, 35.93-40.13 GiB |
| 03:45-04:24            | PR #312 pull request `29629366193`             |                                  Six starts; first 32.98 GiB, two eligible roots removed, 35.30 GiB after cleanup |
| 04:25-04:30            | PR #312 main push `29630527670`                |                                                   Six starts; last after-cleanup value 34,611,276 KiB (33.01 GiB) |
| 04:30-06:25            | No Actions job and no host maintenance trigger |                                              PR #313 review/replay trees accumulated without lifecycle completion |
| 06:25                  | PR #313 attempt 1 `29633962964`                | 20,523,532 KiB before, 23,711,788 KiB (22.61 GiB) after two eligible roots; static, changes, and aggregate failed |
| 06:30                  | Attempt 2 after task-owned cleanup             |                                                                                34,178,636 KiB (32.60 GiB); passed |

The raw failure was `runner-owned cleanup completed, but host free space remains below configured
floor`. The old pruner saw the dominant review trees and correctly reported that they lacked the
exact `cleanup-ready-v1` marker. A timer that merely reran that implementation would therefore not
have prevented PR #313.

All 18 current self-hosted job definitions bind the composite action exactly once: CI has 10;
ETL has 3; marketing has 1; nightly has 3 definitions and 5 executions because of its Python
matrix; production migration has 1. The action starts after checkout and its post step always
finishes the active workspace. Before this lane there was no LaunchAgent, runner start/completion
hook, or other host maintenance service.

### Growth attribution

PR #313's own archived closeout inventory recorded its implementation tree at 1.3 GiB; pre-change
tree at 1.1 GiB; cross-model tree at 1.5 GiB; five U0/U1 trees at 1.4, 1.4, 1.5, 1.4, and 1.6 GiB;
one U2 tree at 2.5 GiB; and three U3 trees at 1.4, 1.4, and 1.1 GiB. These were fresh-context,
task-owned review/replay clones. The machine-wide `df` delta from the last PR #312 invocation to
PR #313 attempt 1 was 14,087,744 KiB (13.44 GiB) over 1.91 hours, approximately 7.01 GiB/hour.
The path total is larger than the `df` delta because APFS reclamation and concurrent activity mean
`du` and `df` are not additive accounting systems.

The collision lane is a second observation: it started with 26.26 GiB free and measured 31.881 GiB
under `/private/tmp`, about 23 GiB agent-named, including 17.06 GiB in 13 detached review/repro
clones. That recurrence makes disposable review estate the dominant repeatable source; it does not
authorize deletion of uncertain or unmarked paths.

Fresh read-only inventory during this lane found the runner `_work` at 3.07 GiB (2.40 GiB `_tool`),
shared Playwright browsers at 2.12 GiB, the owner checkout at 9.18 GiB (7.51 GiB `.turbo`), AP
portal at 4.30 GiB (3.52 GiB `.next`), Colima at 24.59 GiB, and `.codex` at 9.31 GiB. These are
retained. `/Users/paulo/.Trash/wcdraft-guard-pr308-cleanup-20260717` measured 7.90 GiB and was
inspected read-only; it was not modified.

A fresh-context U0 reviewer cloned the exact pinned base, re-downloaded the raw job logs, and
returned PASS. It independently counted the same 18 pre-incident starts and 3 attempt-1 failures,
verified the 11 review/pre-change trees plus 1 implementation tree, and confirmed that timer-only
cannot reach the dominant unmarked paths. It also rechecked the owner, other-project, runner, and
Trash boundaries read-only before deleting only its own clean review clone.

### Nightly window

`.github/workflows/nightly-heavy.yml` is scheduled at `23 15 * * *`. The last real scheduled run,
`29596855946`, began at 2026-07-17T16:36:57Z and its five starts observed 57,217,580-57,540,180 KiB
(54.57-54.87 GiB), so no production prune was needed. It is useful defense in depth, but cannot
close a sub-two-hour gap: the workflow must first be accepted by the runner, and it is not forced
maintenance.

## U1: implementation and safety boundary

### Pre-job behavior

`scripts/ci/self-hosted-runner-hygiene.sh` retains the hard 30 GiB floor and best-effort 36 GiB
cleanup target. When still below the floor, it emits one compact line such as:

```text
RUNNER_DISK status=FAIL trigger=pre-job free_kb=... floor_kb=31457280 target_kb=37748736 largest_consumers=...
```

Consumer discovery is read-only and restricted to direct agent-named temporary roots plus the
runner's bounded work roots. Before removing any eligible root, the script writes
`wcdraft-runner-recovery-v1` JSON with path, measured KiB, ownership class, reason, and timestamp.

### Between-lane trigger

The installed contract is:

- plist: `/Users/paulo/Library/LaunchAgents/com.wcdraft.runner-disk-maintenance.plist`;
- installed scripts: `/Users/paulo/actions-runner-wcdraft/wcdraft-maintenance/`;
- receipt root: `/Users/paulo/actions-runner-wcdraft/_work/_diag/wcdraft-runner-maintenance/`;
- `RunAtLoad=true`, `StartInterval=900` seconds;
- exact runner-root basename guard and user-owned direct-child guard in the installer;
- lock plus live `Runner.Worker` refusal before cleanup;
- maintenance mode preserves runner workspace, cache, and temp roots and considers only stale,
  direct-child, agent-prefixed roots with the exact positive completion marker.

At checkpoint `68d8d78`, the installed wrapper and hygiene script SHA-256 values exactly matched
the repository copies. The RunAtLoad invocation exited 0 and wrote
`receipt-20260718T145939Z-67318.json` with schema `wcdraft-runner-maintenance-v1`, trigger
`launchd-interval`, status `PASS`, reason `hygiene-completed`, 81,170,628 KiB before and
81,168,420 KiB after.

The natural interval—not an installer kickstart—then began at 2026-07-18T15:14:41Z. Launchd's
run count moved from 1 to 2, the service removed only the armed stale direct child
`/private/tmp/wcdraft-runner-maintenance-scheduled-proof-20260718T1508Z`, and it exited 0. Before
deletion it wrote `recovery-20260718T151444Z-51550-1.json`, recording schema
`wcdraft-runner-recovery-v1`, trigger `launchd-interval`, ownership
`agent/CI-owned-positive-marker`, reason `marked-stale-agent-temp`, the exact candidate path, and
4 KiB measured size. `receipt-20260718T151441Z-51508.json` records schema
`wcdraft-runner-maintenance-v1`, status `PASS`, reason `hygiene-completed`, 78,638,496 KiB before
and 78,646,636 KiB after. The candidate no longer existed after completion.

The wrapper adds PID-owned lock recovery: a live matching owner remains a conservative skip,
a just-created empty lock remains a skip, a dead recorded owner is reclaimed, and only an empty
ownerless lock older than 30 minutes can be reclaimed. Its first reinstall probe exposed a safe
false positive in the worker guard because a diagnostic shell command merely contained the worker
path. The guard was tightened from substring matching to an exact first process argument and the
behavioral worker test was updated. A fresh exact-head review at `7020a20` then rejected two
symlink-containment gaps: a redirected lock could expose an external `owner.pid` to deletion, and a
redirected install root could expose external files to install/uninstall. The fix-forward validates
every maintenance/install ancestor as an exact real directory, rejects redirected scripts and
lock roots, and atomically renames only the validated lock directory before bounded deletion.
Behavioral controls prove that install, uninstall, and lock recovery preserve external sentinels.

The fixed source was installed while runner id 21 was online and idle. Final installed wrapper
SHA-256 is `b14f215a693aacfb370c6bb8d99ed8b8970e6acbb13cfc307f7cc4238838e867`; installed hygiene
SHA-256 is `9e589fb4549e29bee713e4b8856888ee26258df4d41f0529bbe8c89a4a297b90`, both equal to the
repository copies. The install-triggered execution exited 0 at 2026-07-18T16:29:17Z and wrote
`receipt-20260718T162903Z-21314.json` with status `PASS`, reason `hygiene-completed`, 71,458,748 KiB
before and 71,459,988 KiB after. An earlier exact-source execution at 16:14:14Z safely removed three
now-stale, positively marked output roots from this lane's completed browser phases, wrote recovery
metadata for each, and preserved the unmarked active worktree and test scratch.

### Negative controls

The committed hygiene contract proves both required controls against a temporary mutated copy of
the production script:

1. With the real default `/private/tmp` root and cleanup disabled, a stale marked sentinel remains
   and the contract fails red.
2. With free space forced below 30 GiB and cleanup disabled, the pre-job contract fails red and
   emits `RUNNER_DISK status=FAIL` with the in-scope largest consumer.

The positive controls prove marked stale removal, recovery JSON written before removal, exact
marker value, regular-directory/direct-child containment, linked-worktree protection, active and
unmarked preservation, corrupt-marker preservation, and maintenance-mode runner-root retention.
The host wrapper behaviorally proves a live exact-path `Runner.Worker` skip, a held-lock skip, and
safe recovery of a stale empty lock. It also proves that stale runner workspace, tool-cache, and
runner-temp entries remain untouched in maintenance mode. The workflow inventory assertion binds
all 18 self-hosted job definitions.

## U2: sustainability verdict

The current shared Mac is **not proven sustainable** at a standing 30 GiB floor under existing
review fanout:

- the 36 GiB target has 6 GiB of headroom above the floor;
- the PR #313 interval consumed 13.44 GiB, exceeding that margin by 7.44 GiB;
- the earlier collision clone estate was 17.06 GiB, exceeding it by 11.06 GiB;
- absorbing those observations from a single target would require at least 43.44 GiB or 47.06 GiB
  respectively, before accounting for concurrent daily-driver use;
- this lane's exact `df` readings moved between roughly 69 and 79 GiB without task-owned deletion,
  demonstrating why APFS purgeable capacity cannot be treated as a fixed reserve.

At the observed 7.01 GiB/hour incident rate, even a fully pruned 36 GiB target reaches the floor
in about 51 minutes. The timer reduces eligible residue but cannot safely delete the unmarked
review clones that caused the incident. The recommended durable shape is a dedicated runner with
capacity monitoring, while making the existing lifecycle marker a mandatory closeout step for
every disposable clone. Raising thresholds alone is not a fix; it only moves the alert earlier.

## Validation and review

Narrow validation completed at checkpoint `68d8d78`, then re-executed after the containment
fix-forward:

- shell syntax: 5/5 scripts passed `bash -n`;
- maintenance installer/LaunchAgent contract: 1/1 suite passed, including redirected install,
  uninstall, and lock negative controls plus behavioral runner-root preservation;
- hygiene contract: 1/1 suite passed, including both negative controls, 4 expected unsafe-probe
  failures, the below-floor gate, maintenance preservation, recovery JSON, and 18/18 bindings;
- `git diff --check`: passed.
- `actionlint`: the changed `ci.yml` passed; the repository-wide command exited 0 with existing
  ShellCheck findings in untouched nightly and production-migration workflow steps.

The first exact-head independent review at `7020a20` was FAIL for the two symlink-containment gaps
described above. That verdict invalidated the earlier cross-model PASS and forced this fix-forward.
Fresh reviews and protected CI must evaluate the new commit; no stale verdict is represented as a
merge authorization.

The first local full-envelope attempt completed typecheck 9/9, lint 6/6, and 2,226 unit/package
tests with 10 expected skips. Game flow passed; all six collision mutations fired in Chromium and
WebKit; and the responsive shell passed 218/218 contexts (84 desktop, 56 mobile, 40 interaction,
30 mode/setup, and 8 mobile-nav). The chained `pnpm test` did **not** pass: collision group 1
Chromium remained idle without an atomic result until the task-owned run reached the explicit
66-minute cutoff, twice the 33-minute duration of protected run `29629366193`. The process was
stopped with exit 130 and its one orphaned task-owned Chrome profile was terminated and removed.
The host was under heavy Spotlight indexing load during the attempt. This is recorded as a local
infrastructure timeout, not a product pass or product failure; protected CI must re-execute the
complete 264-cell gate before merge.

After the timeout cleanup, the final source tree passed typecheck 9/9, lint 6/6, and build 5/5;
the build retained 40/40 pages and both protected runtime-data traces at 8/8. Explicit golden
commands passed 69 core, 42 draft, 59 data, 22 integration, and 6 leaderboard assertions. The
CI-config-triggered heavy realism lane passed 10/10 in 40.62 seconds. Shared Turbo cache replay was
used where the input hash already existed; the changed runner contracts were separately executed
uncached by their focused shell suites.

## Protected carryovers and rollback

PR #303 and local `recovery/season2-s4-caf2f3b` remain protected. Owner WCDraft data, AP portal,
Colima, shared caches, and the guarded Trash bundle remain outside deletion scope.

Operational rollback is exact and reversible:

```sh
scripts/ci/install-runner-disk-maintenance.sh uninstall
```

Uninstall removes only the exact LaunchAgent and installed maintenance scripts. It retains
diagnostic/recovery receipts. Reverting the repository commit removes the pre-job diagnostic and
installation contract without altering product code or data.
