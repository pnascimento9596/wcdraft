#!/usr/bin/env bash

set -euo pipefail

phase="${1:-}"
floor_kb="${WCDRAFT_RUNNER_MIN_FREE_KB:-31457280}"
target_kb="${WCDRAFT_RUNNER_TARGET_FREE_KB:-37748736}"
stale_minutes="${WCDRAFT_RUNNER_STALE_MINUTES:-60}"
force_cleanup="${WCDRAFT_RUNNER_FORCE_CLEANUP:-0}"
configured_agent_temp_root="${WCDRAFT_AGENT_TEMP_ROOT:-/private/tmp}"
agent_temp_roots=("$configured_agent_temp_root")
if [ -z "${WCDRAFT_AGENT_TEMP_ROOT:-}" ] && [ -n "${TMPDIR:-}" ]; then
  agent_temp_roots+=("$TMPDIR")
fi
agent_temp_root="$configured_agent_temp_root"
agent_temp_cleanup_marker=".wcdraft-agent-cleanup-ready"

for required_command in git lsof mount ps find awk sed grep cat; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "::error::required runner hygiene command is missing: $required_command" >&2
    exit 1
  fi
done

case "$floor_kb:$target_kb:$stale_minutes:$force_cleanup" in
  *[!0-9:]*|*::*|:*|*:)
    echo "::error::runner hygiene numeric configuration is invalid" >&2
    exit 1
    ;;
esac
if [ "$target_kb" -lt "$floor_kb" ]; then
  echo "::error::runner hygiene target must be at or above its floor" >&2
  exit 1
fi

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

safe_remove_agent_temp_path() {
  candidate="$1"
  case "$candidate/" in
    "$agent_temp_root"/*) ;;
    *)
      echo "::error::refusing to remove agent temp outside its root: $candidate" >&2
      exit 1
      ;;
  esac
  case "$(basename "$candidate")" in
    wcdraft-*|terrace-*|wave2-*) ;;
    *)
      echo "::error::refusing unrecognized agent temp path: $candidate" >&2
      exit 1
      ;;
  esac
  if ! agent_temp_cleanup_ready "$candidate"; then
    echo "runner-hygiene: skipped agent temp without positive completion marker $candidate"
    return 0
  fi
  if agent_temp_in_use "$candidate"; then
    echo "runner-hygiene: skipped in-use, mounted, symlinked, or linked agent temp $candidate"
    return 0
  fi
  echo "runner-hygiene: pruning stale agent temp $candidate"
  rm -rf -- "$candidate"
}

agent_temp_cleanup_ready() {
  candidate="$1"
  marker="$candidate/$agent_temp_cleanup_marker"
  [ -f "$marker" ] || return 1
  [ ! -L "$marker" ] || return 1
  [ "$(cat "$marker")" = "cleanup-ready-v1" ] || return 1
}

agent_temp_in_use() {
  candidate="$1"
  if [ -L "$candidate" ]; then
    return 0
  fi
  if mount | awk -v candidate="$candidate" '$3 == candidate { found = 1 } END { exit found ? 0 : 1 }'; then
    return 0
  fi
  common_dir="$(git -C "$candidate" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  if [ -n "$common_dir" ]; then
    case "$common_dir/" in
      "$candidate"/*) ;;
      *) return 0 ;;
    esac
    while IFS= read -r line; do
      case "$line" in
        "worktree "*)
          linked_path="${line#worktree }"
          case "$linked_path/" in
            "$candidate"/*) ;;
            *) return 0 ;;
          esac
          ;;
      esac
    done < <(git -C "$candidate" worktree list --porcelain 2>/dev/null || true)
  fi
  if lsof -a -d cwd -Fn 2>/dev/null |
    sed -n 's/^n//p' |
    awk -v candidate="$candidate" '$0 == candidate || index($0, candidate "/") == 1 { found = 1 } END { exit found ? 0 : 1 }'; then
    return 0
  fi
  if ps -axo command= | grep -F -- "$candidate" | grep -v 'grep -F' | grep -q .; then
    return 0
  fi
  return 1
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
  echo "runner-hygiene: free_kb=$before_kb floor_kb=$floor_kb target_kb=$target_kb"
  if [ "$before_kb" -lt "$target_kb" ] || [ "$force_cleanup" = "1" ]; then
    seen_agent_temp_roots=":"
    for configured_root in "${agent_temp_roots[@]}"; do
      [ -d "$configured_root" ] || continue
      agent_temp_root="$(cd "$configured_root" && pwd -P)"
      case "$seen_agent_temp_roots" in
        *":$agent_temp_root:"*) continue ;;
      esac
      seen_agent_temp_roots="$seen_agent_temp_roots$agent_temp_root:"
      for candidate in \
        "$agent_temp_root"/wcdraft-* \
        "$agent_temp_root"/terrace-* \
        "$agent_temp_root"/wave2-*; do
        [ -e "$candidate" ] || continue
        if ! find "$candidate" -prune -mmin "+$stale_minutes" -print -quit | grep -q .; then
          continue
        fi
        safe_remove_agent_temp_path "$candidate"
      done
    done

    for candidate in "$work_root"/*; do
      [ -d "$candidate" ] || continue
      [ "$candidate" = "$active_container" ] && continue
      case "$(basename "$candidate")" in
        _actions|_diag|_temp|_tool|_update) continue ;;
      esac
      if find "$candidate" -prune -mmin "+$stale_minutes" -print -quit | grep -q .; then
        safe_remove_runner_path "$candidate"
      fi
    done

    if [ -d "$cache_root" ]; then
      for candidate in "$cache_root"/*; do
        [ -e "$candidate" ] || continue
        if find "$candidate" -prune -mmin "+$stale_minutes" -print -quit | grep -q .; then
          safe_remove_runner_path "$candidate"
        fi
      done
    fi

    for candidate in "$runner_temp"/*; do
      [ -e "$candidate" ] || continue
      if find "$candidate" -prune -mmin "+$stale_minutes" -print -quit | grep -q .; then
        safe_remove_runner_path "$candidate"
      fi
    done

    after_kb="$(free_kb)"
    echo "runner-hygiene: after_free_kb=$after_kb floor_kb=$floor_kb target_kb=$target_kb"
    if [ "$after_kb" -lt "$floor_kb" ]; then
      echo "::error::runner-owned cleanup completed, but host free space remains below the configured floor (${floor_kb} KiB): ${after_kb} KiB" >&2
      exit 1
    fi
    if [ "$after_kb" -lt "$target_kb" ]; then
      echo "::warning::runner-owned cleanup completed, but host free space remains below the best-effort pre-lane target (${target_kb} KiB): ${after_kb} KiB" >&2
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
