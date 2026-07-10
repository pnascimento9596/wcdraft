#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
gate="$repo_root/scripts/ci/require-neon-for-db-paths.sh"
workflow="$repo_root/.github/workflows/ci.yml"
probe_root="$(mktemp -d "${TMPDIR:-/tmp}/wcdraft-neon-gate.XXXXXX")"

cleanup() {
  rm -rf -- "$probe_root"
}
trap cleanup EXIT

fail() {
  echo "db readiness CI contract: FAIL: $1" >&2
  exit 1
}

assert_workflow_contains() {
  grep -Fq -- "$1" "$workflow" || fail "workflow missing: $1"
}

strict_patterns="$({
  sed -n \
    '/^            db_migrations:$/,/^            [a-z_][a-z_]*:$/p' \
    "$workflow" || true
} | sed -n "s/^              - '\(.*\)'$/\1/p")"

[ "$strict_patterns" = "packages/db/**
migrations/**" ] || fail "strict workflow selector must contain only packages/db/** and migrations/**"

strict_selector_for_path() {
  path="$1"
  while IFS= read -r pattern; do
    [ -n "$pattern" ] || continue
    case "$path" in
      $pattern)
        echo true
        return 0
        ;;
    esac
  done <<EOF
$strict_patterns
EOF
  echo false
}

run_case() {
  name="$1"
  expected_status="$2"
  db_paths_changed="$3"
  api_key="$4"
  project_id="$5"
  expected_output="$6"
  output="$probe_root/$name.output"
  log="$probe_root/$name.log"
  : >"$output"

  set +e
  DB_PATHS_CHANGED="$db_paths_changed" \
    NEON_API_KEY="$api_key" \
    NEON_PROJECT_ID="$project_id" \
    GITHUB_OUTPUT="$output" \
    /bin/bash "$gate" >"$log" 2>&1
  status=$?
  set -e

  [ "$status" -eq "$expected_status" ] || fail "$name exited $status, expected $expected_status"
  [ "$(tr -d '\r\n' <"$output")" = "$expected_output" ] || fail "$name output mismatch"
}

run_path_case() {
  name="$1"
  path="$2"
  expected_selector="$3"
  expected_status="$4"
  actual_selector="$(strict_selector_for_path "$path")"
  [ "$actual_selector" = "$expected_selector" ] ||
    fail "$name mapped $path to $actual_selector, expected $expected_selector"
  run_case "$name" "$expected_status" "$actual_selector" "" "" "skip=true"
}

assert_workflow_contains "- 'packages/db/**'"
assert_workflow_contains "- 'migrations/**'"
assert_workflow_contains "db_migrations: \${{ steps.filter.outputs.db_migrations || 'false' }}"
assert_workflow_contains 'DB_PATHS_CHANGED: ${{ needs.changes.outputs.db_migrations }}'
assert_workflow_contains "needs.changes.outputs.db == 'true'"
assert_workflow_contains "scripts/ci/require-neon-for-db-paths.sh"
assert_workflow_contains 'DB_RESULT: ${{ needs.db-rollback-check.result }}'
assert_workflow_contains 'check_result "db · ephemeral branch · apply → anon-dedupe → rollback round-trip" "$DB_RESULT"'

run_case non-db-missing 0 false "" "" "skip=true"
run_case db-missing 1 true "" "" "skip=true"
run_case db-partial 1 true "key-present" "" "skip=true"
run_case db-present 0 true "key-present" "project-present" "skip=false"
run_case ci-only-present 0 false "key-present" "project-present" "skip=false"
run_case invalid-selector 2 unexpected "key-present" "project-present" ""

run_path_case strict-package-db  packages/db/src/schema/users.ts true 1
run_path_case strict-root-migration migrations/0012_next.sql true 1
run_path_case shared-package-json package.json false 0
run_path_case shared-lockfile pnpm-lock.yaml false 0
run_path_case shared-workspace pnpm-workspace.yaml false 0
run_path_case unrelated-data packages/data/src/index.ts false 0

echo "db readiness CI contract: PASS (6 behavior cases, 6 workflow path cases, 8 workflow bindings)"
