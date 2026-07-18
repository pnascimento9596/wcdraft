#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
configured_runner_root="${WCDRAFT_RUNNER_ROOT:-/Users/paulo/actions-runner-wcdraft}"
runner_root="$(cd "$configured_runner_root" && pwd -P)"
hygiene_script="${WCDRAFT_RUNNER_HYGIENE_SCRIPT:-$script_dir/self-hosted-runner-hygiene.sh}"
work_root="$runner_root/_work"
runner_temp="$work_root/_temp"
tool_cache="$work_root/_tool"
workspace="$work_root/_maintenance/wcdraft"
diag_root="$work_root/_diag/wcdraft-runner-maintenance"
lock_dir="$diag_root/lock"
lock_owner="$lock_dir/owner.pid"
started_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
stamp="$(date -u +'%Y%m%dT%H%M%SZ')"

case "$runner_root" in
  */actions-runner-wcdraft) ;;
  *)
    echo "RUNNER_DISK_MAINTENANCE status=FAIL reason=unexpected-runner-root path=$runner_root" >&2
    exit 1
    ;;
esac

for required_command in date df mkdir ps grep awk cat find rmdir; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "RUNNER_DISK_MAINTENANCE status=FAIL reason=missing-command command=$required_command" >&2
    exit 1
  fi
done

if [ ! -x "$hygiene_script" ]; then
  echo "RUNNER_DISK_MAINTENANCE status=FAIL reason=missing-hygiene-script path=$hygiene_script" >&2
  exit 1
fi

mkdir -p "$runner_temp" "$tool_cache" "$workspace" "$diag_root"
receipt="$diag_root/receipt-$stamp-$$.json"

free_kb() {
  df -Pk "$work_root" | awk 'NR == 2 { print $4 }'
}

write_receipt() {
  local status="$1"
  local reason="$2"
  local before_kb="$3"
  local after_kb="$4"
  local completed_at=""
  completed_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  printf '{\n  "schema": "wcdraft-runner-maintenance-v1",\n  "started_at": "%s",\n  "completed_at": "%s",\n  "trigger": "launchd-interval",\n  "status": "%s",\n  "reason": "%s",\n  "before_kb": %s,\n  "after_kb": %s\n}\n' \
    "$started_at" "$completed_at" "$status" "$reason" "$before_kb" "$after_kb" >"$receipt"
  echo "RUNNER_DISK_MAINTENANCE status=$status trigger=launchd-interval reason=$reason before_kb=$before_kb after_kb=$after_kb receipt=$receipt"
}

acquire_lock() {
  local existing_pid=""
  local existing_command=""

  if mkdir "$lock_dir" 2>/dev/null; then
    printf '%s\n' "$$" >"$lock_owner"
    return 0
  fi

  if [ -f "$lock_owner" ] && [ ! -L "$lock_owner" ]; then
    existing_pid="$(cat "$lock_owner" 2>/dev/null || true)"
  fi
  case "$existing_pid" in
    ''|*[!0-9]*) ;;
    *)
      existing_command="$(ps -p "$existing_pid" -o command= 2>/dev/null || true)"
      if kill -0 "$existing_pid" 2>/dev/null &&
        printf '%s\n' "$existing_command" | grep -F "$script_dir/runner-disk-maintenance.sh" >/dev/null 2>&1; then
        return 1
      fi
      ;;
  esac

  if [ -z "$existing_pid" ] &&
    ! find "$lock_dir" -prune -mmin +30 -print -quit 2>/dev/null | grep -q .; then
    return 1
  fi
  find "$lock_owner" -type f -delete 2>/dev/null || true
  rmdir "$lock_dir" 2>/dev/null || return 1
  mkdir "$lock_dir" 2>/dev/null || return 1
  printf '%s\n' "$$" >"$lock_owner"
}

release_lock() {
  find "$lock_owner" -type f -delete 2>/dev/null || true
  rmdir "$lock_dir" 2>/dev/null || true
}

before_kb="$(free_kb)"

if ! acquire_lock; then
  write_receipt "SKIPPED" "maintenance-lock-held" "$before_kb" "$before_kb"
  exit 0
fi
trap release_lock EXIT

if ps -axo command= | awk -v worker="$runner_root/bin/Runner.Worker" '
  $1 == worker { found = 1 }
  END { exit(found ? 0 : 1) }
'; then
  write_receipt "SKIPPED" "runner-worker-active" "$before_kb" "$before_kb"
  exit 0
fi

set +e
GITHUB_WORKSPACE="$workspace" \
  RUNNER_TOOL_CACHE="$tool_cache" \
  RUNNER_TEMP="$runner_temp" \
  RUNNER_NAME="wcdraft-m4" \
  WCDRAFT_RUNNER_FORCE_CLEANUP=1 \
  WCDRAFT_RUNNER_MAINTENANCE_MODE=1 \
  WCDRAFT_RUNNER_TRIGGER="launchd-interval" \
  /bin/bash "$hygiene_script" start
hygiene_status=$?
set -e

after_kb="$(free_kb)"
if [ "$hygiene_status" -eq 0 ]; then
  write_receipt "PASS" "hygiene-completed" "$before_kb" "$after_kb"
  exit 0
fi

write_receipt "FAIL" "hygiene-exit-$hygiene_status" "$before_kb" "$after_kb"
exit "$hygiene_status"
