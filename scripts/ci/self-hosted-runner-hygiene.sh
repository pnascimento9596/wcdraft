#!/usr/bin/env bash

set -euo pipefail

phase="${1:-}"
floor_kb="${WCDRAFT_RUNNER_MIN_FREE_KB:-31457280}"
target_kb="${WCDRAFT_RUNNER_TARGET_FREE_KB:-37748736}"
stale_minutes="${WCDRAFT_RUNNER_STALE_MINUTES:-60}"
force_cleanup="${WCDRAFT_RUNNER_FORCE_CLEANUP:-0}"
maintenance_mode="${WCDRAFT_RUNNER_MAINTENANCE_MODE:-0}"
trigger="${WCDRAFT_RUNNER_TRIGGER:-ci-job}"
configured_agent_temp_root="${WCDRAFT_AGENT_TEMP_ROOT:-/private/tmp}"
agent_temp_roots=("$configured_agent_temp_root")
if [ -z "${WCDRAFT_AGENT_TEMP_ROOT:-}" ] && [ -n "${TMPDIR:-}" ]; then
  agent_temp_roots+=("$TMPDIR")
fi
agent_temp_root="$configured_agent_temp_root"
agent_temp_cleanup_marker=".wcdraft-agent-cleanup-ready"

for required_command in git lsof mount ps find awk sed grep cat du sort head mkdir date; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "::error::required runner hygiene command is missing: $required_command" >&2
    exit 1
  fi
done

case "$floor_kb:$target_kb:$stale_minutes:$force_cleanup:$maintenance_mode" in
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
recovery_root="$work_root/_diag/wcdraft-runner-hygiene"
recovery_counter=0

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

record_recovery_json() {
  local candidate="$1"
  local ownership="$2"
  local reason="$3"
  local candidate_kb="-1"
  local receipt=""
  local recorded_at=""

  mkdir -p "$recovery_root"
  if measured_kb="$(du -sk "$candidate" 2>/dev/null | awk 'NR == 1 { print $1 }')" &&
    [ -n "$measured_kb" ]; then
    candidate_kb="$measured_kb"
  fi
  recorded_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  recovery_counter=$((recovery_counter + 1))
  receipt="$recovery_root/recovery-$(date -u +'%Y%m%dT%H%M%SZ')-$$-$recovery_counter.json"
  printf '{\n  "schema": "wcdraft-runner-recovery-v1",\n  "recorded_at": "%s",\n  "trigger": "%s",\n  "ownership": "%s",\n  "reason": "%s",\n  "candidate": "%s",\n  "candidate_kb": %s\n}\n' \
    "$(json_escape "$recorded_at")" \
    "$(json_escape "$trigger")" \
    "$(json_escape "$ownership")" \
    "$(json_escape "$reason")" \
    "$(json_escape "$candidate")" \
    "$candidate_kb" >"$receipt"
  echo "runner-hygiene: recovery_json=$receipt candidate=$candidate"
}

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
  reason="${2:-bounded-runner-path}"
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
  [ -e "$candidate" ] || return 0
  record_recovery_json "$candidate" "agent/CI-owned" "$reason"
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
  record_recovery_json "$candidate" "agent/CI-owned-positive-marker" "marked-stale-agent-temp"
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
  local candidate="$1"
  local common_dir=""
  local linked_path=""
  local line=""
  local lsof_output=""
  local mount_output=""
  local probe_status=0
  local ps_output=""
  local worktree_output=""
  if [ -L "$candidate" ]; then
    return 0
  fi
  if ! mount_output="$(mount 2>/dev/null)"; then
    echo "::warning::runner-hygiene safety probe failed (mount); preserving agent temp $candidate" >&2
    return 0
  fi
  if [ -z "$mount_output" ]; then
    echo "::warning::runner-hygiene safety probe returned no mounts; preserving agent temp $candidate" >&2
    return 0
  fi
  if awk -v candidate="$candidate" '$3 == candidate { found = 1 } END { exit found ? 0 : 1 }' <<<"$mount_output"; then
    return 0
  else
    probe_status=$?
    if [ "$probe_status" -ne 1 ]; then
      echo "::warning::runner-hygiene safety probe failed (mount parser); preserving agent temp $candidate" >&2
      return 0
    fi
  fi

  if [ -e "$candidate/.git" ] || [ -L "$candidate/.git" ] || { [ -f "$candidate/HEAD" ] && [ -d "$candidate/objects" ]; }; then
    if ! common_dir="$(git -C "$candidate" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; then
      echo "::warning::runner-hygiene safety probe failed (git common dir); preserving agent temp $candidate" >&2
      return 0
    fi
    if [ -z "$common_dir" ]; then
      echo "::warning::runner-hygiene safety probe returned no common dir; preserving agent temp $candidate" >&2
      return 0
    fi
    case "$common_dir/" in
      "$candidate"/*) ;;
      *) return 0 ;;
    esac
    if ! worktree_output="$(git -C "$candidate" worktree list --porcelain 2>/dev/null)"; then
      echo "::warning::runner-hygiene safety probe failed (git worktree list); preserving agent temp $candidate" >&2
      return 0
    fi
    if [ -z "$worktree_output" ]; then
      echo "::warning::runner-hygiene safety probe returned no worktrees; preserving agent temp $candidate" >&2
      return 0
    fi
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
    done <<<"$worktree_output"
  fi

  if ! lsof_output="$(lsof -a -d cwd -Fn 2>/dev/null)"; then
    echo "::warning::runner-hygiene safety probe failed (lsof); preserving agent temp $candidate" >&2
    return 0
  fi
  if [ -z "$lsof_output" ]; then
    echo "::warning::runner-hygiene safety probe returned no process working directories; preserving agent temp $candidate" >&2
    return 0
  fi
  if awk -v candidate="$candidate" '
    /^n/ {
      cwd = substr($0, 2)
      if (cwd == candidate || index(cwd, candidate "/") == 1) found = 1
    }
    END { exit found ? 0 : 1 }
  ' <<<"$lsof_output"; then
    return 0
  else
    probe_status=$?
    if [ "$probe_status" -ne 1 ]; then
      echo "::warning::runner-hygiene safety probe failed (lsof parser); preserving agent temp $candidate" >&2
      return 0
    fi
  fi

  if ! ps_output="$(ps -axo command= 2>/dev/null)"; then
    echo "::warning::runner-hygiene safety probe failed (ps); preserving agent temp $candidate" >&2
    return 0
  fi
  if [ -z "$ps_output" ]; then
    echo "::warning::runner-hygiene safety probe returned no processes; preserving agent temp $candidate" >&2
    return 0
  fi
  if awk -v candidate="$candidate" 'index($0, candidate) > 0 { found = 1 } END { exit found ? 0 : 1 }' <<<"$ps_output"; then
    return 0
  else
    probe_status=$?
    if [ "$probe_status" -ne 1 ]; then
      echo "::warning::runner-hygiene safety probe failed (ps parser); preserving agent temp $candidate" >&2
      return 0
    fi
  fi
  return 1
}

scrub_job_temp_files() {
  safe_remove_runner_path "$runner_temp/gitleaks.tmp" "job-temp-gitleaks"
  for candidate in "$runner_temp/neon-ephemeral.env" "$runner_temp"/realism-*.log; do
    [ -e "$candidate" ] || continue
    safe_remove_runner_path "$candidate" "job-temp-file"
  done
}

free_kb() {
  df -Pk "$work_root" | awk 'NR == 2 { print $4 }'
}

emit_largest_consumers() {
  local inventory="$runner_temp/runner-disk-consumers.$$"
  local candidate=""
  local configured_root=""
  local resolved_root=""
  : >"$inventory"

  for configured_root in "${agent_temp_roots[@]}"; do
    [ -d "$configured_root" ] || continue
    resolved_root="$(cd "$configured_root" && pwd -P)"
    for candidate in \
      "$resolved_root"/wcdraft-* \
      "$resolved_root"/terrace-* \
      "$resolved_root"/wave2-*; do
      [ -e "$candidate" ] || continue
      case "$candidate" in
        *$'\n'*|*$'\r'*|*$'\t'*) continue ;;
      esac
      du -sk "$candidate" 2>/dev/null | awk -v ownership="agent-named" \
        '{ printf "%s\t%s\t%s\n", $1, ownership, $2 }' >>"$inventory" || true
    done
  done

  for candidate in "$work_root"/*; do
    [ -e "$candidate" ] || continue
    case "$candidate" in
      *$'\n'*|*$'\r'*|*$'\t'*) continue ;;
    esac
    du -sk "$candidate" 2>/dev/null | awk -v ownership="runner-owned" \
      '{ printf "%s\t%s\t%s\n", $1, ownership, $2 }' >>"$inventory" || true
  done

  if [ -s "$inventory" ]; then
    sort -nr "$inventory" | head -5 | awk -F '\t' '
      BEGIN { printf "largest_consumers=" }
      {
        if (NR > 1) printf ","
        printf "%s:%sKiB:%s", $2, $1, $3
      }
      END { printf "\n" }
    '
  else
    echo "largest_consumers=unavailable"
  fi
  rm -f -- "$inventory"
}

if [ "$phase" = "start" ]; then
  if [ "${RUNNER_NAME:-}" != "wcdraft-m4" ]; then
    echo "::error::unexpected self-hosted runner: ${RUNNER_NAME:-unset}" >&2
    exit 1
  fi

  if [ "$maintenance_mode" != "1" ]; then
    scrub_job_temp_files
  fi

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

    if [ "$maintenance_mode" != "1" ]; then
      for candidate in "$work_root"/*; do
        [ -d "$candidate" ] || continue
        [ "$candidate" = "$active_container" ] && continue
        case "$(basename "$candidate")" in
          _actions|_diag|_temp|_tool|_update) continue ;;
        esac
        if find "$candidate" -prune -mmin "+$stale_minutes" -print -quit | grep -q .; then
          safe_remove_runner_path "$candidate" "stale-runner-work-container"
        fi
      done

      if [ -d "$cache_root" ]; then
        for candidate in "$cache_root"/*; do
          [ -e "$candidate" ] || continue
          if find "$candidate" -prune -mmin "+$stale_minutes" -print -quit | grep -q .; then
            safe_remove_runner_path "$candidate" "stale-declared-runner-cache"
          fi
        done
      fi

      for candidate in "$runner_temp"/*; do
        [ -e "$candidate" ] || continue
        case "$candidate" in
          "$runner_temp/runner-disk-consumers."*) continue ;;
        esac
        if find "$candidate" -prune -mmin "+$stale_minutes" -print -quit | grep -q .; then
          safe_remove_runner_path "$candidate" "stale-runner-temp"
        fi
      done
    else
      echo "runner-hygiene: maintenance mode preserves runner work, cache, and temp roots"
    fi

    after_kb="$(free_kb)"
    echo "runner-hygiene: after_free_kb=$after_kb floor_kb=$floor_kb target_kb=$target_kb"
    if [ "$after_kb" -lt "$floor_kb" ]; then
      largest_consumers="$(emit_largest_consumers)"
      echo "::error::RUNNER_DISK status=FAIL trigger=$trigger free_kb=$after_kb floor_kb=$floor_kb target_kb=$target_kb $largest_consumers" >&2
      echo "::error::runner-owned cleanup completed, but host free space remains below the configured floor (${floor_kb} KiB): ${after_kb} KiB" >&2
      exit 1
    fi
    if [ "$after_kb" -lt "$target_kb" ]; then
      echo "::warning::runner-owned cleanup completed, but host free space remains below the best-effort pre-lane target (${target_kb} KiB): ${after_kb} KiB" >&2
    fi
    echo "RUNNER_DISK status=PASS trigger=$trigger before_kb=$before_kb after_kb=$after_kb floor_kb=$floor_kb target_kb=$target_kb cleanup=attempted"
  else
    echo "RUNNER_DISK status=PASS trigger=$trigger before_kb=$before_kb after_kb=$before_kb floor_kb=$floor_kb target_kb=$target_kb cleanup=not-required"
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
