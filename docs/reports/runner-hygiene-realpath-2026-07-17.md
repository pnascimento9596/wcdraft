# Runner hygiene real-root proof

## Summary

The self-hosted runner hygiene script is retained unchanged. Its apparent production no-op is
correct threshold behavior: with no `WCDRAFT_AGENT_TEMP_ROOT` override, it scans `/private/tmp`,
but pruning starts only below the 36 GiB best-effort target or when cleanup is explicitly forced.
Recent production jobs were above that target. The defect was that the contract tested deletion
only under a synthetic agent-temp root; its existing `/private/tmp` probe stopped after writing the
lifecycle marker.

The contract now proves the production default-root path end to end and includes a working negative
control. It creates a uniquely named, marker-authorized candidate directly under `/private/tmp`,
ages it to the year 2000, runs the production script with `WCDRAFT_AGENT_TEMP_ROOT` unset and forced
cleanup, and requires the candidate to be removed. It then runs the same contract against a copied
script whose single agent-temp prune call is disabled; that mutation must go red and the sentinel
must survive.

## Diagnosis

- Production default root: `/private/tmp` from
  `configured_agent_temp_root="${WCDRAFT_AGENT_TEMP_ROOT:-/private/tmp}"`.
- Cleanup gate: `before_kb < 37748736` (36 GiB) or `WCDRAFT_RUNNER_FORCE_CLEANUP=1`.
- Host free space measured during this lane: `43505048 KiB`, above the target.
- Exact PR #309 CI run `29620016142` observed production starts at `44038804`, `42092584`,
  `41719980`, `43892240`, `43891124`, and `43894716 KiB`; none qualified for production cleanup.
- The same run emitted `pruning` and `after_free_kb` only inside the synthetic contract probe. This
  explains both prior observation lanes without changing the production script.

## Files

- `scripts/ci/self-hosted-runner-hygiene.test.sh`: adds the real-root deletion contract and
  prune-disabled mutation control.
- `STATE.md`: records the script's retained fate and evidence pointer.
- `docs/reports/runner-hygiene-realpath-2026-07-17.md`: this diagnosis and validation record.

The production script, composite action, workflows, thresholds, prefix allowlist, lifecycle marker,
in-use probes, and deletion implementation are unchanged.

## Validation run

- `bash -n scripts/ci/self-hosted-runner-hygiene.test.sh scripts/ci/self-hosted-runner-hygiene.sh`
  — passed.
- `scripts/ci/self-hosted-runner-hygiene.test.sh` — passed. The existing contract remained green,
  including the 30 GiB hard floor, 36 GiB target, four diagnostic fail-closed probes, producer and
  workflow bindings, three synthetic marker-authorized removals, and eleven sentinel checks.
- Real-root positive control — passed: one marked, stale
  `/private/tmp/wcdraft-runner-hygiene-realpath.*` candidate was pruned by the unchanged production
  script with `WCDRAFT_AGENT_TEMP_ROOT` unset.
- Real-root negative control — red as intended: disabling the single
  `safe_remove_agent_temp_path "$candidate"` call caused the same contract to fail and preserved
  the mutation sentinel.

## Safety boundary

The real-root probe uses a unique `wcdraft-*` directory, the exact `cleanup-ready-v1` lifecycle
marker, and a `10000000`-minute staleness threshold. Its candidate is dated to 2000, so contemporary
task output cannot qualify during the scan. The existing symlink, mount, Git common-dir/worktree,
cwd, and process-command checks still run before deletion. A trap removes only the two exact
test-owned candidates if the contract exits early.

## Not run + why

No production threshold was artificially crossed and no real user/task directory was selected.
The proof uses forced cleanup against a uniquely owned candidate because lowering live disk space
would be destructive and unnecessary. Full repository CI remains the merge gate for the separate
PR.

## Risks

The test intentionally exercises `/private/tmp`; regressions in its extreme staleness cutoff or
exact candidate naming could broaden the probe. The assertions and cleanup trap keep those values
explicit. Production pruning behavior and thresholds have zero diff, so rollback is the single
test/report squash commit.

## HUMAN ACTIONS

None.
