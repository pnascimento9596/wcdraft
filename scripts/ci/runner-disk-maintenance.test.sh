#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
maintenance_script="$repo_root/scripts/ci/runner-disk-maintenance.sh"
installer="$repo_root/scripts/ci/install-runner-disk-maintenance.sh"
plist_template="$repo_root/scripts/ci/runner-disk-maintenance.plist.template"
probe_root="$(mktemp -d "${TMPDIR:-/tmp}/wcdraft-runner-maintenance.XXXXXX")"
probe_root="$(cd "$probe_root" && pwd -P)"
fake_user="$probe_root/user"
fake_runner="$fake_user/actions-runner-wcdraft"
mock_launchctl="$probe_root/launchctl"
launchctl_log="$probe_root/launchctl.log"

cleanup() {
  find "$probe_root" -depth -delete
}
trap cleanup EXIT

fail() {
  echo "runner disk maintenance contract: FAIL: $1" >&2
  exit 1
}

mkdir -p "$fake_runner" "$fake_user/Library/LaunchAgents"
mkdir -p "$probe_root/agent-temp"
printf '%s\n' '#!/bin/sh' 'printf "%s\\n" "$*" >>"$WCDRAFT_TEST_LAUNCHCTL_LOG"' >"$mock_launchctl"
chmod +x "$mock_launchctl"

bash -n \
  "$repo_root/scripts/ci/self-hosted-runner-hygiene.sh" \
  "$maintenance_script" \
  "$installer"
plutil -lint "$plist_template" >/dev/null
grep -Fq '<integer>900</integer>' "$plist_template" || fail "launchd interval must remain 15 minutes"
grep -Fq 'RunAtLoad' "$plist_template" || fail "launchd trigger must run at load"
grep -Fq 'WCDRAFT_RUNNER_MAINTENANCE_MODE=1' "$maintenance_script" ||
  fail "host maintenance must preserve runner work/cache/temp roots"
grep -Fq 'runner-worker-active' "$maintenance_script" ||
  fail "host maintenance must skip an active Runner.Worker"

WCDRAFT_RUNNER_ROOT="$fake_runner" \
  WCDRAFT_USER_ROOT="$fake_user" \
  WCDRAFT_LAUNCHCTL_BIN="$mock_launchctl" \
  WCDRAFT_TEST_LAUNCHCTL_LOG="$launchctl_log" \
  WCDRAFT_MAINTENANCE_ALLOW_FAKE_RUNNER=1 \
  "$installer" install

installed_plist="$fake_user/Library/LaunchAgents/com.wcdraft.runner-disk-maintenance.plist"
[ -x "$fake_runner/wcdraft-maintenance/self-hosted-runner-hygiene.sh" ] ||
  fail "installer omitted the proven hygiene script"
[ -x "$fake_runner/wcdraft-maintenance/runner-disk-maintenance.sh" ] ||
  fail "installer omitted the maintenance wrapper"
plutil -lint "$installed_plist" >/dev/null
grep -Fq "$fake_runner/wcdraft-maintenance/runner-disk-maintenance.sh" "$installed_plist" ||
  fail "installed plist did not bind the fake runner root"
grep -Fq 'bootstrap' "$launchctl_log" || fail "installer did not bootstrap launchd"
grep -Fq 'kickstart' "$launchctl_log" || fail "installer did not create an immediate real execution"

WCDRAFT_RUNNER_ROOT="$fake_runner" \
  WCDRAFT_AGENT_TEMP_ROOT="$probe_root/agent-temp" \
  "$fake_runner/wcdraft-maintenance/runner-disk-maintenance.sh"

receipt="$(find "$fake_runner/_work/_diag/wcdraft-runner-maintenance" -type f -name 'receipt-*.json' -print -quit)"
[ -n "$receipt" ] || fail "maintenance execution did not create a receipt"
jq -e '
  .schema == "wcdraft-runner-maintenance-v1" and
  .trigger == "launchd-interval" and
  .status == "PASS" and
  (.before_kb | type == "number") and
  (.after_kb | type == "number")
' "$receipt" >/dev/null || fail "maintenance receipt schema drifted"

mkdir -p "$fake_runner/bin"
ln -s /bin/sleep "$fake_runner/bin/Runner.Worker"
"$fake_runner/bin/Runner.Worker" 30 &
worker_pid=$!
for _ in 1 2 3 4 5; do
  if ps -axo command= | awk -v worker="$fake_runner/bin/Runner.Worker" \
    '$1 == worker { found = 1 } END { exit(found ? 0 : 1) }'; then
    break
  fi
  sleep 1
done
ps -axo command= | awk -v worker="$fake_runner/bin/Runner.Worker" \
  '$1 == worker { found = 1 } END { exit(found ? 0 : 1) }' ||
  fail "active Runner.Worker probe did not start"
WCDRAFT_RUNNER_ROOT="$fake_runner" \
  WCDRAFT_AGENT_TEMP_ROOT="$probe_root/agent-temp" \
  "$fake_runner/wcdraft-maintenance/runner-disk-maintenance.sh"
kill "$worker_pid" 2>/dev/null || true
wait "$worker_pid" 2>/dev/null || true
find "$fake_runner/_work/_diag/wcdraft-runner-maintenance" -type f -name 'receipt-*.json' \
  -exec jq -e 'select(.status == "SKIPPED" and .reason == "runner-worker-active")' {} \; \
  | grep -q . || fail "active Runner.Worker did not produce a skip receipt"

lock_dir="$fake_runner/_work/_diag/wcdraft-runner-maintenance/lock"
mkdir "$lock_dir"
WCDRAFT_RUNNER_ROOT="$fake_runner" \
  WCDRAFT_AGENT_TEMP_ROOT="$probe_root/agent-temp" \
  "$fake_runner/wcdraft-maintenance/runner-disk-maintenance.sh"
rmdir "$lock_dir"
find "$fake_runner/_work/_diag/wcdraft-runner-maintenance" -type f -name 'receipt-*.json' \
  -exec jq -e 'select(.status == "SKIPPED" and .reason == "maintenance-lock-held")' {} \; \
  | grep -q . || fail "held maintenance lock did not produce a skip receipt"

stale_lock_output="$probe_root/stale-lock.log"
mkdir "$lock_dir"
touch -t 200001010000 "$lock_dir"
WCDRAFT_RUNNER_ROOT="$fake_runner" \
  WCDRAFT_AGENT_TEMP_ROOT="$probe_root/agent-temp" \
  "$fake_runner/wcdraft-maintenance/runner-disk-maintenance.sh" >"$stale_lock_output"
grep -Fq 'RUNNER_DISK_MAINTENANCE status=PASS' "$stale_lock_output" ||
  fail "stale empty maintenance lock was not safely reclaimed"
[ ! -e "$lock_dir" ] || fail "reclaimed maintenance lock survived successful cleanup"

echo "runner disk maintenance contract: PASS (15-minute RunAtLoad schedule, active-worker and held-lock skip receipts, stale-lock recovery, maintenance-mode scope, installed-script pin, launchctl bootstrap + kickstart, JSON execution receipt)"
