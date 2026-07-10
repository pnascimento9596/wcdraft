#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
gate="$repo_root/scripts/ci/validate-daily-salt-map-revert.sh"
runbook="$repo_root/docs/runbooks/daily-salt-map-manual-refresh.md"
workflow="$repo_root/.github/workflows/ci.yml"
probe_root="$(mktemp -d "${TMPDIR:-/tmp}/wcdraft-daily-revert-contract.XXXXXX")"
refresh_paths=(
  packages/data/reports/compact-size.json
  packages/data/src/generated/daily-seed-salt-map.compact.json
  packages/data/src/generated/daily-seed-salt-map.compact.json.br
  packages/data/src/generated/manifest.json
  packages/data/src/generated/manifest.json.br
)
unexpected_path="docs/unexpected-sixth-path.md"

cleanup() {
  rm -rf -- "$probe_root"
}
trap cleanup EXIT

fail() {
  echo "daily salt-map revert contract: FAIL: $1" >&2
  exit 1
}

assert_contains() {
  file="$1"
  text="$2"
  grep -Fq -- "$text" "$file" || fail "$file missing contract binding: $text"
}

run_expect() {
  name="$1"
  expected_status="$2"
  worktree="$3"
  shift 3
  log="$probe_root/$name.log"

  set +e
  (cd "$worktree" && "$gate" "$@") >"$log" 2>&1
  status=$?
  set -e

  [ "$status" -eq "$expected_status" ] ||
    fail "$name exited $status, expected $expected_status; log: $log"
}

seed_repo() {
  name="$1"
  worktree="$probe_root/$name"
  git init -q "$worktree"
  git -C "$worktree" config user.name "Rollback Contract Probe"
  git -C "$worktree" config user.email "rollback-contract@example.invalid"
  mkdir -p \
    "$worktree/packages/data/reports" \
    "$worktree/packages/data/src/generated" \
    "$worktree/docs"
  printf 'baseline size\n' >"$worktree/packages/data/reports/compact-size.json"
  printf 'baseline salts\n' >"$worktree/packages/data/src/generated/daily-seed-salt-map.compact.json"
  printf 'baseline salts brotli\n' >"$worktree/packages/data/src/generated/daily-seed-salt-map.compact.json.br"
  printf 'baseline manifest\n' >"$worktree/packages/data/src/generated/manifest.json"
  printf 'baseline manifest brotli\n' >"$worktree/packages/data/src/generated/manifest.json.br"
  printf 'baseline note\n' >"$worktree/$unexpected_path"
  git -C "$worktree" add "${refresh_paths[@]}" "$unexpected_path"
  git -C "$worktree" commit -qm "test: seed rollback fixture"
  printf '%s\n' "$worktree"
}

make_valid_refresh() {
  worktree="$1"
  printf 'refreshed size\n' >"$worktree/packages/data/reports/compact-size.json"
  printf 'refreshed salts\n' >"$worktree/packages/data/src/generated/daily-seed-salt-map.compact.json"
  printf 'refreshed salts brotli\n' >"$worktree/packages/data/src/generated/daily-seed-salt-map.compact.json.br"
  printf 'refreshed manifest\n' >"$worktree/packages/data/src/generated/manifest.json"
  printf 'refreshed manifest brotli\n' >"$worktree/packages/data/src/generated/manifest.json.br"
  git -C "$worktree" add "${refresh_paths[@]}"
  git -C "$worktree" commit -qm "chore(data): refresh Daily salts"
  git -C "$worktree" rev-parse HEAD
}

assert_contains "$workflow" "scripts/ci/validate-daily-salt-map-revert.test.sh"
assert_contains "$runbook" 'scripts/ci/validate-daily-salt-map-revert.sh target "$REFRESH_MERGE_SHA"'
assert_contains "$runbook" "scripts/ci/validate-daily-salt-map-revert.sh post-revert"
assert_contains "$runbook" "packages/data/src/generated/daily-seed-salt-map.compact.json.br"
assert_contains "$runbook" "packages/data/src/generated/manifest.json.br"

valid_repo="$(seed_repo valid-target)"
valid_target="$(make_valid_refresh "$valid_repo")"
run_expect valid-target 0 "$valid_repo" target "$valid_target"

missing_repo="$(seed_repo missing-sidecars)"
printf 'refreshed size\n' >"$missing_repo/packages/data/reports/compact-size.json"
printf 'refreshed salts\n' >"$missing_repo/packages/data/src/generated/daily-seed-salt-map.compact.json"
printf 'refreshed manifest\n' >"$missing_repo/packages/data/src/generated/manifest.json"
git -C "$missing_repo" add \
  packages/data/reports/compact-size.json \
  packages/data/src/generated/daily-seed-salt-map.compact.json \
  packages/data/src/generated/manifest.json
git -C "$missing_repo" commit -qm "chore(data): refresh without canonical sidecars"
missing_target="$(git -C "$missing_repo" rev-parse HEAD)"
run_expect missing-sidecars-refused 1 "$missing_repo" target "$missing_target"
assert_contains "$probe_root/missing-sidecars-refused.log" "five Daily refresh outputs"

sixth_repo="$(seed_repo unexpected-sixth-path)"
printf 'refreshed size\n' >"$sixth_repo/packages/data/reports/compact-size.json"
printf 'refreshed salts\n' >"$sixth_repo/packages/data/src/generated/daily-seed-salt-map.compact.json"
printf 'refreshed salts brotli\n' >"$sixth_repo/packages/data/src/generated/daily-seed-salt-map.compact.json.br"
printf 'refreshed manifest\n' >"$sixth_repo/packages/data/src/generated/manifest.json"
printf 'refreshed manifest brotli\n' >"$sixth_repo/packages/data/src/generated/manifest.json.br"
printf 'unexpected target change\n' >"$sixth_repo/$unexpected_path"
git -C "$sixth_repo" add "${refresh_paths[@]}" "$unexpected_path"
git -C "$sixth_repo" commit -qm "chore(data): malformed six-path refresh"
sixth_target="$(git -C "$sixth_repo" rev-parse HEAD)"
before_head="$sixth_target"
revert_marker="$probe_root/unexpected-sixth-path.revert-reached"
commit_marker="$probe_root/unexpected-sixth-path.commit-reached"
push_marker="$probe_root/unexpected-sixth-path.push-reached"
set +e
(
  set -e
  cd "$sixth_repo"
  "$gate" target "$sixth_target"
  : >"$revert_marker"
  git revert --no-commit "$fourth_target"
  : >"$commit_marker"
  git commit -qm "fix(data): partial rollback must not happen"
  : >"$push_marker"
) >"$probe_root/unexpected-sixth-path.log" 2>&1
sixth_status=$?
set -e
[ "$sixth_status" -ne 0 ] || fail "unexpected sixth target path was accepted"
[ "$(git -C "$sixth_repo" rev-parse HEAD)" = "$before_head" ] ||
  fail "unexpected sixth target path reached rollback commit"
[ ! -e "$revert_marker" ] || fail "unexpected sixth target path reached revert marker"
[ ! -e "$commit_marker" ] || fail "unexpected sixth target path reached commit marker"
[ ! -e "$push_marker" ] || fail "unexpected sixth target path reached push marker"
[ -z "$(git -C "$sixth_repo" status --porcelain=v1)" ] ||
  fail "unexpected sixth target path mutated the worktree before stopping"

root_repo="$probe_root/root-target"
git init -q "$root_repo"
git -C "$root_repo" config user.name "Rollback Contract Probe"
git -C "$root_repo" config user.email "rollback-contract@example.invalid"
mkdir -p \
  "$root_repo/packages/data/reports" \
  "$root_repo/packages/data/src/generated"
printf 'root size\n' >"$root_repo/packages/data/reports/compact-size.json"
printf 'root salts\n' >"$root_repo/packages/data/src/generated/daily-seed-salt-map.compact.json"
printf 'root salts brotli\n' >"$root_repo/packages/data/src/generated/daily-seed-salt-map.compact.json.br"
printf 'root manifest\n' >"$root_repo/packages/data/src/generated/manifest.json"
printf 'root manifest brotli\n' >"$root_repo/packages/data/src/generated/manifest.json.br"
git -C "$root_repo" add "${refresh_paths[@]}"
git -C "$root_repo" commit -qm "chore(data): root refresh fixture"
root_target="$(git -C "$root_repo" rev-parse HEAD)"
run_expect root-target-refused 1 "$root_repo" target "$root_target"
assert_contains "$probe_root/root-target-refused.log" "single-parent commit produced by the squash-merge workflow"

post_repo="$(seed_repo post-revert)"
post_target="$(make_valid_refresh "$post_repo")"
(cd "$post_repo" && "$gate" target "$post_target" >/dev/null)
git -C "$post_repo" revert --no-commit "$post_target"
printf 'unexpected post-revert change\n' >"$post_repo/$unexpected_path"
run_expect post-revert-sixth-path-refused 1 "$post_repo" post-revert
assert_contains "$probe_root/post-revert-sixth-path-refused.log" "complete post-revert tracked path set"
git -C "$post_repo" restore -- "$unexpected_path"
run_expect post-revert-valid 0 "$post_repo" post-revert

echo "daily salt-map revert contract: PASS (6 behavior cases, 5 runbook/workflow bindings)"
