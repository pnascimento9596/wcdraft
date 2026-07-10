#!/usr/bin/env bash

set -euo pipefail

fail() {
  echo "daily salt-map revert validation: STOP: $1" >&2
  exit 1
}

usage() {
  echo "usage: $0 target <refresh-merge-sha> | post-revert" >&2
  exit 2
}

expected_paths="$({
  printf '%s\n' \
    packages/data/reports/compact-size.json \
    packages/data/src/generated/daily-seed-salt-map.compact.json \
    packages/data/src/generated/manifest.json
} | LC_ALL=C sort)"

assert_exact_paths() {
  label="$1"
  actual_paths="$2"
  [ "$actual_paths" = "$expected_paths" ] ||
    fail "$label must contain exactly the three Daily refresh outputs"
}

git rev-parse --is-inside-work-tree >/dev/null 2>&1 ||
  fail "run this command from the rollback worktree"

case "${1:-}" in
  target)
    [ "$#" -eq 2 ] || usage
    refresh_merge_sha="$2"
    git cat-file -e "$refresh_merge_sha^{commit}" 2>/dev/null ||
      fail "REFRESH_MERGE_SHA is not a commit"

    read -r -a commit_and_parents <<<"$(git rev-list --parents -n 1 "$refresh_merge_sha")"
    [ "${#commit_and_parents[@]}" -eq 2 ] ||
      fail "REFRESH_MERGE_SHA must be the single-parent commit produced by the squash-merge workflow; root and merge commits are not valid refresh targets"

    target_paths="$(
      git diff-tree --no-commit-id --name-only -r "$refresh_merge_sha" |
        LC_ALL=C sort -u
    )"
    assert_exact_paths "target commit path set" "$target_paths"
    echo "daily salt-map revert target validation: PASS (single parent, 3 exact paths)"
    ;;
  post-revert)
    [ "$#" -eq 1 ] || usage
    [ -z "$(git ls-files --unmerged)" ] ||
      fail "post-revert index contains unmerged entries"

    full_tracked_paths="$(git diff --name-only HEAD | LC_ALL=C sort -u)"
    staged_paths="$(git diff --cached --name-only | LC_ALL=C sort -u)"
    unstaged_paths="$(git diff --name-only | LC_ALL=C sort -u)"

    assert_exact_paths "complete post-revert tracked path set" "$full_tracked_paths"
    assert_exact_paths "staged post-revert path set" "$staged_paths"
    [ -z "$unstaged_paths" ] ||
      fail "post-revert worktree contains unstaged tracked changes"
    echo "daily salt-map post-revert validation: PASS (3 exact tracked paths, fully staged)"
    ;;
  *)
    usage
    ;;
esac
