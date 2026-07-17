#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
hygiene_script="$repo_root/scripts/ci/self-hosted-runner-hygiene.sh"
workflow="$repo_root/.github/workflows/ci.yml"
etl_workflow="$repo_root/.github/workflows/etl.yml"
probe_root="$(mktemp -d "${TMPDIR:-/tmp}/wcdraft-runner-hygiene.XXXXXX")"
work_root="$probe_root/_work"
runner_temp="$work_root/_temp"
tool_cache="$work_root/_tool"
workspace="$work_root/wcdraft/wcdraft"
workspace_sentinel="$workspace/gitleaks.tmp"
outside_sentinel="$probe_root/outside/gitleaks.tmp"

cleanup() {
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

run_hygiene() {
  phase="$1"
  GITHUB_WORKSPACE="$workspace" \
    RUNNER_TOOL_CACHE="$tool_cache" \
    RUNNER_TEMP="$runner_temp" \
    RUNNER_NAME="wcdraft-m4" \
    WCDRAFT_RUNNER_MIN_FREE_KB=0 \
    /bin/bash "$hygiene_script" "$phase"
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

if actor_can_run "dependabot[bot]"; then
  fail "Dependabot actor must not reach self-hosted jobs"
fi
actor_can_run "pnascimento9596" || fail "owner actor must remain allowed"
actor_can_run "github-actions[bot]" || fail "repository automation must remain allowed"

mkdir -p "$runner_temp" "$tool_cache" "$workspace" "$(dirname "$outside_sentinel")"
printf '%s\n' "workspace-sentinel" >"$workspace_sentinel"
printf '%s\n' "outside-sentinel" >"$outside_sentinel"
git -C "$workspace" init -q
git -C "$workspace" add gitleaks.tmp
git -C "$workspace" -c user.name="runner-hygiene-probe" \
  -c user.email="runner-hygiene-probe@invalid" commit -qm "seed workspace sentinel"

printf '%s\n' "stale-start-download" >"$runner_temp/gitleaks.tmp"
run_hygiene start
assert_runner_temp_scrubbed
assert_file_content "workspace-sentinel" "$workspace_sentinel"
assert_file_content "outside-sentinel" "$outside_sentinel"

printf '%s\n' "stale-finish-download" >"$runner_temp/gitleaks.tmp"
run_hygiene finish
assert_runner_temp_scrubbed
assert_file_content "workspace-sentinel" "$workspace_sentinel"
assert_file_content "outside-sentinel" "$outside_sentinel"

echo "runner hygiene contract: PASS (1 TMPDIR binding, 4 actor guards, 1 static composite-if binding, 4 static dispatch constraints, 1 static aggregate-name expression, 2 aggregate-name literals, 10 needs edges, 3 actor gate cases, 2 temp removals, 4 sentinel checks)"
