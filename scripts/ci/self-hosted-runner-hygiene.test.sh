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

aggregate_check_name() {
  if [ "$1" = "dependabot[bot]" ]; then
    echo "blocked · dependabot actor"
  else
    echo "required · aggregate gates"
  fi
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
aggregate_guard="if: \${{ always() && github.actor != 'dependabot[bot]' }}"
aggregate_name="name: \${{ github.actor == 'dependabot[bot]' && 'blocked · dependabot actor' || 'required · aggregate gates' }}"

assert_job_set "$workflow" \
  "changes static verify golden realism etl db-rollback-check etl-rating gitleaks aggregate"
assert_job_contains "$workflow" changes "$actor_guard"
assert_job_contains "$workflow" static "$actor_guard"
for job in verify golden realism etl db-rollback-check etl-rating gitleaks; do
  assert_job_contains "$workflow" "$job" "needs: changes"
done
assert_job_contains "$workflow" aggregate "      - changes"
assert_job_contains "$workflow" aggregate "$aggregate_guard"
assert_job_contains "$workflow" aggregate "$aggregate_name"
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
[ "$(aggregate_check_name "dependabot[bot]")" = "blocked · dependabot actor" ] ||
  fail "Dependabot must emit only the non-required blocked check"
[ "$(aggregate_check_name "dependabot[bot]")" != "required · aggregate gates" ] ||
  fail "Dependabot must not emit the protected aggregate context"
[ "$(aggregate_check_name "pnascimento9596")" = "required · aggregate gates" ] ||
  fail "owner actor must retain the protected aggregate context"
[ "$(aggregate_check_name "github-actions[bot]")" = "required · aggregate gates" ] ||
  fail "repository automation must retain the protected aggregate context"

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

echo "runner hygiene contract: PASS (1 TMPDIR binding, 4 actor guards, 1 protected-check split, 10 needs edges, 3 actor gate cases, 3 check-name mappings, 2 temp removals, 4 sentinel checks)"
