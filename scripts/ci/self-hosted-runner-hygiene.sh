#!/usr/bin/env bash

set -euo pipefail

phase="${1:-}"
threshold_kb="${WCDRAFT_RUNNER_MIN_FREE_KB:-20971520}"
stale_days="${WCDRAFT_RUNNER_STALE_DAYS:-7}"

require_directory() {
  if [ ! -d "$1" ]; then
    echo "::error::required runner directory is missing: $1" >&2
    exit 1
  fi
}

require_directory "${GITHUB_WORKSPACE:-}"
require_directory "${RUNNER_TOOL_CACHE:-}"
require_directory "${RUNNER_TEMP:-}"

workspace="$(cd "$GITHUB_WORKSPACE" && pwd -P)"
tool_cache="$(cd "$RUNNER_TOOL_CACHE" && pwd -P)"
runner_temp="$(cd "$RUNNER_TEMP" && pwd -P)"
work_root="$(cd "$(dirname "$tool_cache")" && pwd -P)"
active_container="$(dirname "$workspace")"
cache_root="$tool_cache/wcdraft-cache"

case "$workspace/" in
  "$work_root"/*) ;;
  *)
    echo "::error::workspace is outside the runner work root: $workspace" >&2
    exit 1
    ;;
esac

case "$runner_temp/" in
  "$work_root"/*) ;;
  *)
    echo "::error::runner temp is outside the runner work root: $runner_temp" >&2
    exit 1
    ;;
esac

safe_remove_runner_path() {
  candidate="$1"
  case "$candidate/" in
    "$work_root"/*) ;;
    *)
      echo "::error::refusing to remove path outside runner work root: $candidate" >&2
      exit 1
      ;;
  esac
  case "$workspace/" in
    "$candidate"/*)
      echo "::error::refusing to remove active workspace or its ancestor: $candidate" >&2
      exit 1
      ;;
  esac
  rm -rf -- "$candidate"
}

scrub_job_temp_files() {
  safe_remove_runner_path "$runner_temp/gitleaks.tmp"
  rm -f -- "$runner_temp/neon-ephemeral.env" "$runner_temp"/realism-*.log
}

free_kb() {
  df -Pk "$work_root" | awk 'NR == 2 { print $4 }'
}

if [ "$phase" = "start" ]; then
  if [ "${RUNNER_NAME:-}" != "wcdraft-m4" ]; then
    echo "::error::unexpected self-hosted runner: ${RUNNER_NAME:-unset}" >&2
    exit 1
  fi

  scrub_job_temp_files

  before_kb="$(free_kb)"
  echo "runner-hygiene: free_kb=$before_kb threshold_kb=$threshold_kb"
  if [ "$before_kb" -lt "$threshold_kb" ]; then
    for candidate in "$work_root"/*; do
      [ -d "$candidate" ] || continue
      [ "$candidate" = "$active_container" ] && continue
      case "$(basename "$candidate")" in
        _actions|_diag|_temp|_tool|_update) continue ;;
      esac
      if find "$candidate" -prune -mtime "+$stale_days" -print -quit | grep -q .; then
        safe_remove_runner_path "$candidate"
      fi
    done

    if [ -d "$cache_root" ]; then
      for candidate in "$cache_root"/*; do
        [ -e "$candidate" ] || continue
        if find "$candidate" -prune -mtime "+$stale_days" -print -quit | grep -q .; then
          safe_remove_runner_path "$candidate"
        fi
      done
    fi

    for candidate in "$runner_temp"/*; do
      [ -e "$candidate" ] || continue
      if find "$candidate" -prune -mtime "+$stale_days" -print -quit | grep -q .; then
        safe_remove_runner_path "$candidate"
      fi
    done

    after_kb="$(free_kb)"
    if [ "$after_kb" -lt "$threshold_kb" ]; then
      echo "::warning::runner-owned cleanup completed, but host free space remains below 20 GiB: ${after_kb} KiB"
    fi
  fi
  exit 0
fi

if [ "$phase" = "finish" ]; then
  scrub_job_temp_files
  if git -C "$workspace" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$workspace" reset --hard HEAD
    git -C "$workspace" clean -ffdx
  fi
  exit 0
fi

echo "usage: $0 start|finish" >&2
exit 2
