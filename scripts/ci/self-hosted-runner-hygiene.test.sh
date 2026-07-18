#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
hygiene_script="$repo_root/scripts/ci/self-hosted-runner-hygiene.sh"
workflow="$repo_root/.github/workflows/ci.yml"
etl_workflow="$repo_root/.github/workflows/etl.yml"
marketing_workflow="$repo_root/.github/workflows/marketing-x.yml"
nightly_workflow="$repo_root/.github/workflows/nightly-heavy.yml"
migration_workflow="$repo_root/.github/workflows/production-db-migrate.yml"
responsive_shell_producer="$repo_root/apps/web/scripts/test-responsive-shell-fit.mts"
one_screen_producer="$repo_root/apps/web/scripts/verify-home-fold-browser.mts"
disposable_clone_helper="$repo_root/apps/web/scripts/create-disposable-clone.mts"
probe_root="$(mktemp -d "${TMPDIR:-/tmp}/wcdraft-runner-hygiene.XXXXXX")"
work_root="$probe_root/_work"
runner_temp="$work_root/_temp"
tool_cache="$work_root/_tool"
workspace="$work_root/wcdraft/wcdraft"
workspace_sentinel="$workspace/gitleaks.tmp"
outside_sentinel="$probe_root/outside/gitleaks.tmp"
agent_temp_root="$probe_root/agent-temp"
agent_temp_stale="$agent_temp_root/wcdraft-ci-stale"
agent_temp_idle_unmarked="$agent_temp_root/wcdraft-review-inflight-idle"
agent_temp_corrupt_marker="$agent_temp_root/wcdraft-review-corrupt-marker"
agent_temp_corrupt_pending="$agent_temp_root/wcdraft-review-corrupt-pending"
agent_temp_fresh="$agent_temp_root/wcdraft-review-fresh"
agent_temp_unrelated="$agent_temp_root/owner-stale"
agent_temp_terrace="$agent_temp_root/terrace-complete-stale"
agent_temp_wave2="$agent_temp_root/wave2-complete-stale"
agent_temp_active="$agent_temp_root/wcdraft-review-active-cwd"
agent_temp_git_main="$agent_temp_root/wcdraft-review-main-repo"
agent_temp_git_linked="$agent_temp_root/wcdraft-review-linked-child"
active_pid=""
default_root_probe=""
real_root_candidate=""
mutation_root_candidate=""
mutated_hygiene_script="$probe_root/self-hosted-runner-hygiene-prune-disabled.sh"
mutated_audit_script="$probe_root/self-hosted-runner-hygiene-audit-disabled.sh"
disposable_source="$probe_root/disposable-source"
helper_created_marked=""
helper_created_unmarked=""

cleanup() {
  if [ -n "$active_pid" ]; then
    kill "$active_pid" 2>/dev/null || true
    wait "$active_pid" 2>/dev/null || true
  fi
  if [ -n "$default_root_probe" ]; then
    rm -rf -- "$default_root_probe"
  fi
  if [ -n "$real_root_candidate" ]; then
    rm -rf -- "$real_root_candidate"
  fi
  if [ -n "$mutation_root_candidate" ]; then
    rm -rf -- "$mutation_root_candidate"
  fi
  rm -rf -- "$probe_root"
}
trap cleanup EXIT

fail() {
  echo "runner hygiene contract: FAIL: $1" >&2
  exit 1
}

workflow_jobs() {
  awk '
    $0 == "jobs:" { in_jobs = 1; next }
    in_jobs && /^[^ ]/ { exit }
    in_jobs && /^  [A-Za-z0-9_-]+:$/ {
      name = $1
      sub(/:$/, "", name)
      jobs = jobs (jobs == "" ? "" : " ") name
    }
    END { print jobs }
  ' "$1"
}

job_block() {
  awk -v header="  $2:" '
    $0 == header { in_job = 1 }
    in_job && $0 != header && /^  [A-Za-z0-9_-]+:$/ { exit }
    in_job { print }
  ' "$1"
}

assert_job_set() {
  actual="$(workflow_jobs "$1")"
  [ "$actual" = "$2" ] || fail "unclassified job graph in $1: $actual"
}

assert_job_contains() {
  block="$(job_block "$1" "$2")"
  [ -n "$block" ] || fail "job is missing from $1: $2"
  case "$block" in
    *"$3"*) ;;
    *) fail "job $2 in $1 is missing contract: $3" ;;
  esac
}

actor_can_run() {
  [ "$1" != "dependabot[bot]" ]
}

assert_file_content() {
  expected="$1"
  path="$2"
  [ -f "$path" ] || fail "sentinel is missing: $path"
  [ "$(cat "$path")" = "$expected" ] || fail "sentinel changed: $path"
}

assert_runner_temp_scrubbed() {
  [ ! -e "$runner_temp/gitleaks.tmp" ] || fail "runner gitleaks temp survived: $runner_temp/gitleaks.tmp"
}

create_disposable_clone() {
  local label="$1"
  local output=""
  local candidate=""
  output="$(
    (
    cd "$repo_root"
    WCDRAFT_AGENT_TEMP_ROOT="$agent_temp_root" \
      pnpm --filter @wcdraft/web create:disposable-clone \
        --label "$label" --source "$disposable_source" --ref HEAD
    )
  )"
  candidate="$(printf '%s\n' "$output" | sed -n 's/^DISPOSABLE_CLONE_PATH=//p')"
  [ -n "$candidate" ] || fail "disposable clone helper did not print its path"
  [ "$(cd "$(dirname "$candidate")" && pwd -P)" = "$(cd "$agent_temp_root" && pwd -P)" ] ||
    fail "disposable clone helper escaped the configured direct-child root"
  printf '%s\n' "$output" | grep -Fq 'MARK_COMPLETE_COMMAND=' ||
    fail "disposable clone helper did not print its paired completion command"
  if printf '%s\n' "$output" | grep -F 'MARK_COMPLETE_COMMAND=' | grep -Fq ' -- '; then
    fail "disposable clone helper printed a pnpm separator that becomes the candidate argument"
  fi
  assert_file_content "cleanup-pending-v1" "$candidate/.wcdraft-agent-cleanup-pending"
  grep -Fxq '.wcdraft-agent-cleanup-pending' "$candidate/.git/info/exclude" ||
    fail "disposable clone helper did not locally exclude its pending marker"
  grep -Fxq '.wcdraft-agent-cleanup-ready' "$candidate/.git/info/exclude" ||
    fail "disposable clone helper did not locally exclude its completion marker"
  [ -z "$(git -C "$candidate" status --porcelain)" ] ||
    fail "disposable clone helper left its lifecycle registration visible to git"
  printf '%s\n' "$candidate"
}

run_residue_audit_contract() {
  local script_path="$1"
  local candidate="$2"
  local output="$3"
  if ! GITHUB_WORKSPACE="$workspace" \
    RUNNER_TOOL_CACHE="$tool_cache" \
    RUNNER_TEMP="$runner_temp" \
    RUNNER_NAME="wcdraft-m4" \
    WCDRAFT_RUNNER_MIN_FREE_KB=0 \
    WCDRAFT_RUNNER_TARGET_FREE_KB=0 \
    WCDRAFT_RUNNER_STALE_MINUTES=60 \
    WCDRAFT_AGENT_TEMP_RESIDUE_MINUTES=1 \
    WCDRAFT_AGENT_TEMP_ROOT="$agent_temp_root" \
    /bin/bash "$script_path" start >"$output" 2>&1; then
    return 1
  fi
  grep -Fq "::warning::runner-hygiene unmarked agent temp residue path=$candidate registration=pending" \
    "$output" || return 1
  grep -Fq 'runner-hygiene: unmarked-residue-audit count=' "$output" || return 1
}

run_residue_audit_with_du_failure() {
  local candidate="$1"
  local mock_bin="$probe_root/mock-residue-du"
  local output="$probe_root/residue-du-failure.log"
  mkdir -p "$mock_bin"
  printf '%s\n' '#!/bin/sh' 'exit 2' >"$mock_bin/du"
  chmod +x "$mock_bin/du"

  if ! PATH="$mock_bin:$PATH" \
    GITHUB_WORKSPACE="$workspace" \
    RUNNER_TOOL_CACHE="$tool_cache" \
    RUNNER_TEMP="$runner_temp" \
    RUNNER_NAME="wcdraft-m4" \
    WCDRAFT_RUNNER_MIN_FREE_KB=0 \
    WCDRAFT_RUNNER_TARGET_FREE_KB=0 \
    WCDRAFT_RUNNER_STALE_MINUTES=60 \
    WCDRAFT_AGENT_TEMP_RESIDUE_MINUTES=1 \
    WCDRAFT_AGENT_TEMP_ROOT="$agent_temp_root" \
    /bin/bash "$hygiene_script" start >"$output" 2>&1; then
    fail "report-only residue audit made hygiene fail when size measurement was unavailable"
  fi
  grep -Fq "::warning::runner-hygiene unmarked agent temp residue path=$candidate registration=pending candidate_kb=unavailable" \
    "$output" || fail "residue audit did not report unavailable size without failing"
  grep -Fq 'runner-hygiene: unmarked-residue-audit count=' "$output" ||
    fail "residue audit omitted its summary after size-measurement failure"
}

run_hygiene() {
  phase="$1"
  force_cleanup="${2:-0}"
  GITHUB_WORKSPACE="$workspace" \
    RUNNER_TOOL_CACHE="$tool_cache" \
    RUNNER_TEMP="$runner_temp" \
    RUNNER_NAME="wcdraft-m4" \
    WCDRAFT_RUNNER_MIN_FREE_KB=0 \
    WCDRAFT_RUNNER_TARGET_FREE_KB=0 \
    WCDRAFT_RUNNER_STALE_MINUTES=60 \
    WCDRAFT_RUNNER_FORCE_CLEANUP="$force_cleanup" \
    WCDRAFT_AGENT_TEMP_ROOT="$agent_temp_root" \
    /bin/bash "$hygiene_script" "$phase"
}

run_hygiene_with_probe_failure() {
  probe="$1"
  candidate="$agent_temp_root/wcdraft-review-${probe}-probe-failure"
  mock_bin="$probe_root/mock-$probe"
  output="$probe_root/${probe}-probe-failure.log"

  mkdir -p "$candidate" "$mock_bin"
  printf '%s\n' "$probe-probe-failure" >"$candidate/sentinel"
  printf '%s\n' "cleanup-ready-v1" >"$candidate/.wcdraft-agent-cleanup-ready"
  if [ "$probe" = "git" ]; then
    printf '%s\n' "gitdir: /definitely/missing" >"$candidate/.git"
  fi
  touch -t 202001010000 "$candidate"
  printf '%s\n' '#!/bin/sh' 'exit 2' >"$mock_bin/$probe"
  chmod +x "$mock_bin/$probe"

  if ! PATH="$mock_bin:$PATH" \
    GITHUB_WORKSPACE="$workspace" \
    RUNNER_TOOL_CACHE="$tool_cache" \
    RUNNER_TEMP="$runner_temp" \
    RUNNER_NAME="wcdraft-m4" \
    WCDRAFT_RUNNER_MIN_FREE_KB=0 \
    WCDRAFT_RUNNER_TARGET_FREE_KB=0 \
    WCDRAFT_RUNNER_STALE_MINUTES=60 \
    WCDRAFT_RUNNER_FORCE_CLEANUP=1 \
    WCDRAFT_AGENT_TEMP_ROOT="$agent_temp_root" \
    /bin/bash "$hygiene_script" start >"$output" 2>&1; then
    fail "runner hygiene must preserve candidates when the $probe safety probe fails"
  fi
  grep -Fq "safety probe failed ($probe" "$output" ||
    fail "runner hygiene did not report the $probe safety-probe failure"
  assert_file_content "$probe-probe-failure" "$candidate/sentinel"
}

run_hygiene_expect_floor_failure() {
  output="$probe_root/floor-failure.log"
  if GITHUB_WORKSPACE="$workspace" \
    RUNNER_TOOL_CACHE="$tool_cache" \
    RUNNER_TEMP="$runner_temp" \
    RUNNER_NAME="wcdraft-m4" \
    WCDRAFT_RUNNER_MIN_FREE_KB=999999999 \
    WCDRAFT_RUNNER_TARGET_FREE_KB=999999999 \
    WCDRAFT_RUNNER_STALE_MINUTES=60 \
    WCDRAFT_AGENT_TEMP_ROOT="$agent_temp_root" \
    /bin/bash "$hygiene_script" start >"$output" 2>&1; then
    fail "runner hygiene must fail when bounded cleanup cannot restore the floor"
  fi
  grep -Fq '::error::runner-owned cleanup completed, but host free space remains below the configured floor' "$output" ||
    fail "runner hygiene floor failure did not emit the required error"
  grep -Fq '::error::RUNNER_DISK status=FAIL' "$output" ||
    fail "runner hygiene floor failure did not emit the compact RUNNER_DISK diagnostic"
  grep -Fq 'largest_consumers=' "$output" ||
    fail "runner hygiene floor failure did not name its largest consumers"
  grep -Fq 'agent-named:' "$output" ||
    fail "runner hygiene floor failure did not identify agent-named consumers"
}

run_prune_disabled_expect_floor_failure() {
  output="$probe_root/prune-disabled-floor-failure.log"
  if GITHUB_WORKSPACE="$workspace" \
    RUNNER_TOOL_CACHE="$tool_cache" \
    RUNNER_TEMP="$runner_temp" \
    RUNNER_NAME="wcdraft-m4" \
    WCDRAFT_RUNNER_MIN_FREE_KB=999999999 \
    WCDRAFT_RUNNER_TARGET_FREE_KB=999999999 \
    WCDRAFT_RUNNER_STALE_MINUTES=60 \
    WCDRAFT_RUNNER_FORCE_CLEANUP=1 \
    WCDRAFT_AGENT_TEMP_ROOT="$agent_temp_root" \
    /bin/bash "$mutated_hygiene_script" start >"$output" 2>&1; then
    fail "pre-job disk gate stayed green when pruning was disabled below the floor"
  fi
  grep -Fq 'runner-hygiene: mutation disabled agent temp prune' "$output" ||
    fail "pre-job negative control did not disable pruning"
  grep -Fq '::error::RUNNER_DISK status=FAIL' "$output" ||
    fail "pre-job negative control failed without the RUNNER_DISK diagnostic"
  grep -Fq 'largest_consumers=' "$output" ||
    fail "pre-job negative control omitted largest-consumer evidence"
  grep -Fq 'agent-named:' "$output" ||
    fail "pre-job negative control did not identify the preserved agent consumer"
}

run_hygiene_expect_target_warning() {
  output="$probe_root/target-warning.log"
  if ! GITHUB_WORKSPACE="$workspace" \
    RUNNER_TOOL_CACHE="$tool_cache" \
    RUNNER_TEMP="$runner_temp" \
    RUNNER_NAME="wcdraft-m4" \
    WCDRAFT_RUNNER_MIN_FREE_KB=0 \
    WCDRAFT_RUNNER_TARGET_FREE_KB=999999999 \
    WCDRAFT_RUNNER_STALE_MINUTES=60 \
    WCDRAFT_AGENT_TEMP_ROOT="$agent_temp_root" \
    /bin/bash "$hygiene_script" start >"$output" 2>&1; then
    fail "runner hygiene must keep the pre-lane target best-effort when the hard floor is satisfied"
  fi
  grep -Fq '::warning::runner-owned cleanup completed, but host free space remains below the best-effort pre-lane target' "$output" ||
    fail "runner hygiene target miss did not emit the required warning"
}

create_real_root_candidate() {
  local label="$1"
  local candidate=""
  candidate="$(mktemp -d /private/tmp/wcdraft-runner-hygiene-realpath.XXXXXX)"
  printf '%s\n' "$label" >"$candidate/sentinel"
  printf '%s\n' "cleanup-ready-v1" >"$candidate/.wcdraft-agent-cleanup-ready"
  touch -t 200001010000 "$candidate"
  printf '%s\n' "$candidate"
}

run_real_root_prune_contract() {
  local script_path="$1"
  local candidate="$2"
  local output="$3"
  if ! env -u WCDRAFT_AGENT_TEMP_ROOT \
    GITHUB_WORKSPACE="$workspace" \
    RUNNER_TOOL_CACHE="$tool_cache" \
    RUNNER_TEMP="$runner_temp" \
    RUNNER_NAME="wcdraft-m4" \
    WCDRAFT_RUNNER_MIN_FREE_KB=0 \
    WCDRAFT_RUNNER_TARGET_FREE_KB=0 \
    WCDRAFT_RUNNER_STALE_MINUTES=10000000 \
    WCDRAFT_RUNNER_FORCE_CLEANUP=1 \
    /bin/bash "$script_path" start >"$output" 2>&1; then
    return 1
  fi
  grep -Fq "runner-hygiene: pruning stale agent temp $candidate" "$output" || return 1
  [ ! -e "$candidate" ] || return 1
}

actor_guard="if: \${{ github.actor != 'dependabot[bot]' }}"
static_composite_guard="    if: >-"
static_actor_guard="github.actor != 'dependabot[bot]' &&"
static_dispatch_event_guard="github.event_name != 'workflow_dispatch' ||"
static_dispatch_repository_guard="github.repository == 'pnascimento9596/wcdraft'"
static_dispatch_force_guard="inputs.force_all &&"
static_dispatch_ref_guard="github.ref == 'refs/heads/automation/daily-seed-salt-map-refresh'"
aggregate_guard="if: \${{ always() && github.actor != 'dependabot[bot]' }}"
aggregate_name_expression="name: \${{ github.actor == 'dependabot[bot]' && 'blocked · dependabot actor' || 'required · aggregate gates' }}"

grep -Fq 'WCDRAFT_RUNNER_MIN_FREE_KB:-31457280' "$hygiene_script" ||
  fail "runner hygiene default floor must remain 30 GiB"
grep -Fq 'WCDRAFT_RUNNER_TARGET_FREE_KB:-37748736' "$hygiene_script" ||
  fail "runner hygiene must retain one measured lane of headroom above its floor"
grep -Fq '::error::runner-owned cleanup completed, but host free space remains below the configured floor' "$hygiene_script" ||
  fail "runner hygiene must fail when cleanup cannot restore the configured floor"
grep -Fq '::warning::runner-owned cleanup completed, but host free space remains below the best-effort pre-lane target' "$hygiene_script" ||
  fail "runner hygiene must report a best-effort target miss without weakening the hard floor"
grep -Fq '::error::RUNNER_DISK status=FAIL' "$hygiene_script" ||
  fail "runner hygiene must emit one compact disk-floor diagnostic"
grep -Fq 'record_recovery_json' "$hygiene_script" ||
  fail "runner hygiene must write recovery JSON before bounded deletion"
grep -Fq 'maintenance mode preserves runner work, cache, and temp roots' "$hygiene_script" ||
  fail "host maintenance must not race runner-owned work/cache/temp roots"
grep -Fq 'wcdraft-*|terrace-*|wave2-*' "$hygiene_script" ||
  fail "runner hygiene must keep agent-temp deletion prefix bounded"
grep -Fq '.wcdraft-agent-cleanup-ready' "$hygiene_script" ||
  fail "runner hygiene must require positive lifecycle completion evidence"
grep -Fq 'audit_unmarked_agent_temp_residue' "$hygiene_script" ||
  fail "runner hygiene must report aged unmarked agent-temp residue"
grep -Fq 'registerAgentTempCleanupPending' "$disposable_clone_helper" ||
  fail "disposable clone helper must register pending state before use"
grep -Fq 'markAgentTempCleanupReady(outDir, tmpdir())' "$responsive_shell_producer" ||
  fail "responsive browser lifecycle must positively finalize completed auto-owned temp output"
grep -Fq 'markAgentTempCleanupReady(outputRoot, tmpdir())' "$one_screen_producer" ||
  fail "one-screen lifecycle must positively finalize completed auto-owned temp output"
grep -Fq -- '--git-common-dir' "$hygiene_script" ||
  fail "runner hygiene must protect linked worktrees"
grep -Fq 'worktree list --porcelain' "$hygiene_script" ||
  fail "runner hygiene must protect common repositories with external linked worktrees"
grep -Fq 'lsof -a -d cwd' "$hygiene_script" ||
  fail "runner hygiene must protect process working directories"

assert_job_set "$workflow" \
  "changes static verify golden realism etl db-rollback-check etl-rating gitleaks aggregate"
assert_job_contains "$workflow" changes "$actor_guard"
assert_job_contains "$workflow" static "$static_composite_guard"
assert_job_contains "$workflow" static "$static_actor_guard"
assert_job_contains "$workflow" static "$static_dispatch_event_guard"
assert_job_contains "$workflow" static "$static_dispatch_repository_guard"
assert_job_contains "$workflow" static "$static_dispatch_force_guard"
assert_job_contains "$workflow" static "$static_dispatch_ref_guard"
for job in verify golden realism etl db-rollback-check etl-rating gitleaks; do
  assert_job_contains "$workflow" "$job" "needs: changes"
done
for job in changes static verify golden realism etl db-rollback-check etl-rating gitleaks aggregate; do
  assert_job_contains "$workflow" "$job" 'uses: ./.github/actions/self-hosted-runner-hygiene'
done
assert_job_contains "$workflow" aggregate "      - changes"
assert_job_contains "$workflow" aggregate "$aggregate_guard"
assert_job_contains "$workflow" aggregate "$aggregate_name_expression"
assert_job_contains "$workflow" aggregate "'blocked · dependabot actor'"
assert_job_contains "$workflow" aggregate "'required · aggregate gates'"
assert_job_contains "$workflow" gitleaks 'TMPDIR: ${{ runner.temp }}'

assert_job_set "$etl_workflow" "changes etl rating-lock-matrix"
assert_job_contains "$etl_workflow" changes "$actor_guard"
for job in etl rating-lock-matrix; do
  assert_job_contains "$etl_workflow" "$job" "needs: changes"
done
for job in changes etl rating-lock-matrix; do
  assert_job_contains "$etl_workflow" "$job" 'uses: ./.github/actions/self-hosted-runner-hygiene'
done

assert_job_set "$marketing_workflow" "pack"
assert_job_contains "$marketing_workflow" pack 'uses: ./.github/actions/self-hosted-runner-hygiene'
assert_job_set "$nightly_workflow" "daily-seed-salt-map realism rating-lock-matrix"
for job in daily-seed-salt-map realism rating-lock-matrix; do
  assert_job_contains "$nightly_workflow" "$job" 'uses: ./.github/actions/self-hosted-runner-hygiene'
done
assert_job_set "$migration_workflow" "migrate"
assert_job_contains "$migration_workflow" migrate 'uses: ./.github/actions/self-hosted-runner-hygiene'

if actor_can_run "dependabot[bot]"; then
  fail "Dependabot actor must not reach self-hosted jobs"
fi
actor_can_run "pnascimento9596" || fail "owner actor must remain allowed"
actor_can_run "github-actions[bot]" || fail "repository automation must remain allowed"

mkdir -p \
  "$runner_temp" \
  "$tool_cache" \
  "$workspace" \
  "$(dirname "$outside_sentinel")" \
  "$agent_temp_stale" \
  "$agent_temp_idle_unmarked" \
  "$agent_temp_corrupt_marker" \
  "$agent_temp_corrupt_pending" \
  "$agent_temp_fresh" \
  "$agent_temp_unrelated" \
  "$agent_temp_terrace" \
  "$agent_temp_wave2" \
  "$agent_temp_active"
git init -q "$disposable_source"
printf '%s\n' "helper-clone-sentinel" >"$disposable_source/sentinel"
git -C "$disposable_source" add sentinel
git -C "$disposable_source" -c user.name="runner-hygiene-probe" \
  -c user.email="runner-hygiene-probe@invalid" commit -qm "seed disposable clone source"
helper_created_marked="$(create_disposable_clone helper-marked)"
helper_created_unmarked="$(create_disposable_clone helper-unmarked)"
(
  cd "$repo_root"
  WCDRAFT_AGENT_TEMP_ROOT="$agent_temp_root" \
    pnpm --filter @wcdraft/web mark:agent-temp-cleanup-ready "$helper_created_marked"
)
assert_file_content "cleanup-ready-v1" "$helper_created_marked/.wcdraft-agent-cleanup-ready"
[ ! -e "$helper_created_marked/.wcdraft-agent-cleanup-pending" ] ||
  fail "completion transition left the pending registration behind"
touch -t 202001010000 "$helper_created_marked" "$helper_created_unmarked"
printf '%s\n' "workspace-sentinel" >"$workspace_sentinel"
printf '%s\n' "outside-sentinel" >"$outside_sentinel"
printf '%s\n' "stale-agent-temp" >"$agent_temp_stale/sentinel"
printf '%s\n' "idle-unmarked-agent-temp" >"$agent_temp_idle_unmarked/sentinel"
printf '%s\n' "corrupt-marker-agent-temp" >"$agent_temp_corrupt_marker/sentinel"
printf '%s\n' "cleanup-ready-v1 " >"$agent_temp_corrupt_marker/.wcdraft-agent-cleanup-ready"
printf '%s\n' "corrupt-pending-agent-temp" >"$agent_temp_corrupt_pending/sentinel"
printf '%s\n' "cleanup-pending-v1 " >"$agent_temp_corrupt_pending/.wcdraft-agent-cleanup-pending"
printf '%s\n' "fresh-agent-temp" >"$agent_temp_fresh/sentinel"
printf '%s\n' "owner-agent-temp" >"$agent_temp_unrelated/sentinel"
printf '%s\n' "terrace-agent-temp" >"$agent_temp_terrace/sentinel"
printf '%s\n' "wave2-agent-temp" >"$agent_temp_wave2/sentinel"
printf '%s\n' "active-agent-temp" >"$agent_temp_active/sentinel"
for completed in "$agent_temp_terrace" "$agent_temp_wave2"; do
  printf '%s\n' "cleanup-ready-v1" >"$completed/.wcdraft-agent-cleanup-ready"
done
(
  cd "$repo_root"
  WCDRAFT_AGENT_TEMP_ROOT="$agent_temp_root" \
    pnpm exec tsx apps/web/scripts/mark-agent-temp-cleanup-ready.mts "$agent_temp_stale"
)
if (
  cd "$repo_root"
  WCDRAFT_AGENT_TEMP_ROOT="$agent_temp_root" \
    pnpm exec tsx apps/web/scripts/mark-agent-temp-cleanup-ready.mts "$agent_temp_corrupt_marker"
); then
  fail "lifecycle producer must reject a marker whose value the pruner rejects"
fi
if (
  cd "$repo_root"
  WCDRAFT_AGENT_TEMP_ROOT="$agent_temp_root" \
    pnpm exec tsx apps/web/scripts/mark-agent-temp-cleanup-ready.mts "$agent_temp_corrupt_pending"
); then
  fail "lifecycle producer must reject corrupt pending registration"
fi
[ ! -e "$agent_temp_corrupt_pending/.wcdraft-agent-cleanup-ready" ] ||
  fail "corrupt pending registration became cleanup eligible"
default_root_probe="$(mktemp -d /private/tmp/wcdraft-marker-default.XXXXXX)"
(
  cd "$repo_root"
  env -u WCDRAFT_AGENT_TEMP_ROOT \
    pnpm exec tsx apps/web/scripts/mark-agent-temp-cleanup-ready.mts "$default_root_probe"
)
assert_file_content "cleanup-ready-v1" "$default_root_probe/.wcdraft-agent-cleanup-ready"
for protected in "$agent_temp_fresh" "$agent_temp_active"; do
  printf '%s\n' "cleanup-ready-v1" >"$protected/.wcdraft-agent-cleanup-ready"
done
touch -t 202001010000 \
  "$agent_temp_stale" \
  "$agent_temp_idle_unmarked" \
  "$agent_temp_corrupt_marker" \
  "$agent_temp_corrupt_pending" \
  "$agent_temp_unrelated" \
  "$agent_temp_terrace" \
  "$agent_temp_wave2" \
  "$agent_temp_active"
git init -q "$agent_temp_git_main"
printf '%s\n' "linked-agent-temp" >"$agent_temp_git_main/sentinel"
git -C "$agent_temp_git_main" add sentinel
git -C "$agent_temp_git_main" -c user.name="runner-hygiene-probe" \
  -c user.email="runner-hygiene-probe@invalid" commit -qm "seed linked worktree"
git -C "$agent_temp_git_main" worktree add -qb runner-hygiene-linked \
  "$agent_temp_git_linked" HEAD
printf '%s\n' "cleanup-ready-v1" >"$agent_temp_git_main/.wcdraft-agent-cleanup-ready"
printf '%s\n' "cleanup-ready-v1" >"$agent_temp_git_linked/.wcdraft-agent-cleanup-ready"
touch -t 202001010000 "$agent_temp_git_main" "$agent_temp_git_linked"
(cd "$agent_temp_active" && sleep 120) &
active_pid="$!"
git -C "$workspace" init -q
git -C "$workspace" add gitleaks.tmp
git -C "$workspace" -c user.name="runner-hygiene-probe" \
  -c user.email="runner-hygiene-probe@invalid" commit -qm "seed workspace sentinel"

printf '%s\n' "stale-start-download" >"$runner_temp/gitleaks.tmp"
initial_hygiene_output="$probe_root/initial-hygiene.log"
run_hygiene start 1 | tee "$initial_hygiene_output"
assert_runner_temp_scrubbed
assert_file_content "workspace-sentinel" "$workspace_sentinel"
assert_file_content "outside-sentinel" "$outside_sentinel"
[ ! -e "$agent_temp_stale" ] || fail "stale WCDraft CI temp survived"
[ ! -e "$agent_temp_terrace" ] || fail "stale Terrace temp survived"
[ ! -e "$agent_temp_wave2" ] || fail "stale wave2 temp survived"
[ ! -e "$helper_created_marked" ] || fail "marked helper-created clone survived the real pruner"
assert_file_content "helper-clone-sentinel" "$helper_created_unmarked/sentinel"
grep -Fq "::warning::runner-hygiene unmarked agent temp residue path=$helper_created_unmarked registration=pending" \
  "$initial_hygiene_output" || fail "unmarked helper-created clone was not reported by the audit"
run_residue_audit_with_du_failure "$helper_created_unmarked"
assert_file_content "idle-unmarked-agent-temp" "$agent_temp_idle_unmarked/sentinel"
assert_file_content "corrupt-marker-agent-temp" "$agent_temp_corrupt_marker/sentinel"
assert_file_content "corrupt-pending-agent-temp" "$agent_temp_corrupt_pending/sentinel"
assert_file_content "fresh-agent-temp" "$agent_temp_fresh/sentinel"
assert_file_content "owner-agent-temp" "$agent_temp_unrelated/sentinel"
assert_file_content "active-agent-temp" "$agent_temp_active/sentinel"
assert_file_content "linked-agent-temp" "$agent_temp_git_main/sentinel"
assert_file_content "linked-agent-temp" "$agent_temp_git_linked/sentinel"

real_root_candidate="$(create_real_root_candidate real-root-prune)"
real_root_output="$probe_root/real-root-prune.log"
run_real_root_prune_contract "$hygiene_script" "$real_root_candidate" "$real_root_output" ||
  fail "runner hygiene did not prune its marked, stale candidate through the real /private/tmp default root"
real_root_candidate=""

sed 's/safe_remove_agent_temp_path "$candidate"/echo "runner-hygiene: mutation disabled agent temp prune $candidate"/' \
  "$hygiene_script" >"$mutated_hygiene_script"
chmod +x "$mutated_hygiene_script"
grep -Fq 'runner-hygiene: mutation disabled agent temp prune $candidate' "$mutated_hygiene_script" ||
  fail "runner hygiene negative control did not disable the agent-temp prune call"
if grep -Fq '        safe_remove_agent_temp_path "$candidate"' "$mutated_hygiene_script"; then
  fail "runner hygiene negative control left the production prune call enabled"
fi

mutation_root_candidate="$(create_real_root_candidate real-root-prune-disabled)"
mutation_root_output="$probe_root/real-root-prune-disabled.log"
if run_real_root_prune_contract \
  "$mutated_hygiene_script" "$mutation_root_candidate" "$mutation_root_output"; then
  fail "real-root prune contract stayed green when agent-temp pruning was disabled"
fi
grep -Fq "runner-hygiene: mutation disabled agent temp prune $mutation_root_candidate" \
  "$mutation_root_output" || fail "real-root negative control failed for an unintended reason"
assert_file_content "real-root-prune-disabled" "$mutation_root_candidate/sentinel"
run_prune_disabled_expect_floor_failure

sed 's/^  audit_unmarked_agent_temp_residue$/  echo "runner-hygiene: mutation disabled unmarked residue audit"/' \
  "$hygiene_script" >"$mutated_audit_script"
chmod +x "$mutated_audit_script"
grep -Fq 'runner-hygiene: mutation disabled unmarked residue audit' "$mutated_audit_script" ||
  fail "unmarked-residue negative control did not disable the production audit call"
if grep -Fxq '  audit_unmarked_agent_temp_residue' "$mutated_audit_script"; then
  fail "unmarked-residue negative control left the production audit call enabled"
fi
audit_mutation_output="$probe_root/audit-disabled.log"
if run_residue_audit_contract \
  "$mutated_audit_script" "$helper_created_unmarked" "$audit_mutation_output"; then
  fail "unmarked-residue contract stayed green when the audit was disabled"
fi
grep -Fq 'runner-hygiene: mutation disabled unmarked residue audit' "$audit_mutation_output" ||
  fail "unmarked-residue negative control failed for an unintended reason"

for failing_probe in mount lsof ps git; do
  run_hygiene_with_probe_failure "$failing_probe"
done
run_hygiene_expect_floor_failure
run_hygiene_expect_target_warning

recovery_receipt="$(find "$work_root/_diag/wcdraft-runner-hygiene" -type f -name 'recovery-*.json' -print -quit)"
[ -n "$recovery_receipt" ] || fail "bounded deletion did not write recovery JSON"
jq -e '
  .schema == "wcdraft-runner-recovery-v1" and
  (.recorded_at | type == "string") and
  (.trigger | type == "string") and
  (.candidate | type == "string") and
  (.candidate_kb | type == "number")
' "$recovery_receipt" >/dev/null || fail "recovery JSON schema drifted"

printf '%s\n' "stale-finish-download" >"$runner_temp/gitleaks.tmp"
run_hygiene finish
assert_runner_temp_scrubbed
assert_file_content "workspace-sentinel" "$workspace_sentinel"
assert_file_content "outside-sentinel" "$outside_sentinel"

echo "runner hygiene contract: PASS (30 GiB hard floor, 36 GiB best-effort pre-lane target, target-miss warning, compact RUNNER_DISK failure inventory, pre-deletion recovery JSON, exact producer-to-pruner lifecycle marker, create-time pending registration, paired completion command, git-local marker excludes, corrupt-marker rejection, private/tmp and TMPDIR finalizer roots, 1 helper-created marked clone pruned, 1 helper-created unmarked clone preserved and reported, 1 audit-size-failure report-only preserve, 1 audit-disabled mutation red, 1 real /private/tmp prune, 1 prune-disabled real-root mutation red, 1 prune-disabled below-floor pre-job mutation red, bounded stale-agent-temp pruning, idle-unmarked preservation, cwd and bidirectional linked-worktree guards, 4 diagnostic-failure preserves, fail-closed floor, maintenance-mode runner-root preservation, 18 self-hosted job bindings across 5 workflows, 2 real browser-output producers, 1 TMPDIR binding, 4 actor guards, 1 static composite-if binding, 4 static dispatch constraints, 1 static aggregate-name expression, 2 aggregate-name literals, 10 needs edges, 3 actor gate cases, 4 marker-authorized agent temp removals, 13 sentinel checks)"
