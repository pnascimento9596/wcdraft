#!/usr/bin/env bash
# Kill stuck / orphaned GitHub Actions Runner.Worker processes on wcdraft-m4.
#
# Failure class (recurring, version-independent self-hosted runner hang):
#   ProcessInvoker logs "Starting process:" then never logs
#   "Process started with process id … waiting for process exit", then the
#   Worker burns ~100% CPU while heartbeating "Well known directory" every ~10s.
#   Force-stopping the service leaves Worker children reparented to launchd
#   (ppid=1) that keep spinning until reaped.
#
# This is NOT treated as a 2.336.0 regression or a useV2Flow bug — see
# DIAGNOSIS-worker-cpu-spin-2026-07-24.md. The watchdog is the controlled fix.
#
# Fail-safe: only kills Workers matching stuck signatures. Never kills
# Runner.Listener or runsvc.

set -euo pipefail

RUNNER_ROOT="${WCDRAFT_RUNNER_ROOT:-/Users/paulo/actions-runner-wcdraft}"
STATE_DIR="${WCDRAFT_WATCHDOG_STATE:-$RUNNER_ROOT/_work/_diag/wcdraft-worker-watchdog}"
LOG_DIR="${HOME}/Library/Logs/com.wcdraft.runner-worker-watchdog"
KILL_LOG="${LOG_DIR}/kills.log"
CPU_THRESHOLD="${WCDRAFT_WORKER_CPU_THRESHOLD:-90}"
# Samples at ~60s interval: 3 consecutive hot samples ≈ 3 minutes
HOT_SAMPLES_NEEDED="${WCDRAFT_WORKER_HOT_SAMPLES:-3}"
CLEAN_PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
NOW_EPOCH="$(date +%s)"
NOW_UTC="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

mkdir -p "$STATE_DIR" "$LOG_DIR"

log() {
  printf '%s %s\n' "$NOW_UTC" "$*" >>"$LOG_DIR/watchdog.log"
}

log_kill() {
  # Persistent kill record — next agent must be able to distinguish infra kills
  # from product failures.
  printf '%s %s\n' "$NOW_UTC" "$*" | tee -a "$KILL_LOG" >>"$LOG_DIR/watchdog.log"
}

# Re-sanitize .path every tick so a runner auto-update that rewrites PATH
# mid-session cannot silently re-pollute. runsvc.sh exports PATH from .path
# on each Listener start; this keeps the file correct between starts too.
sanitize_path_file() {
  local path_file="$RUNNER_ROOT/.path"
  local env_file="$RUNNER_ROOT/.env"
  if [ -d "$RUNNER_ROOT" ]; then
    printf '%s\n' "$CLEAN_PATH" >"$path_file"
    if [ ! -f "$env_file" ] || ! grep -q '^LANG=' "$env_file" 2>/dev/null; then
      printf '%s\n' 'LANG=C.UTF-8' >"$env_file"
    fi
  fi
}

# Best-effort: which job/run the runner believes is in flight.
in_flight_context() {
  local stdout_log="${HOME}/Library/Logs/actions.runner.pnascimento9596-wcdraft.wcdraft-m4/stdout.log"
  local job="unknown"
  local run_hint="unknown"
  if [ -f "$stdout_log" ]; then
    # Last "Running job:" line
    job="$(grep 'Running job:' "$stdout_log" 2>/dev/null | tail -1 | sed 's/.*Running job: //' | tr '|' '/' | tr -s ' ' | cut -c1-160 || true)"
    [ -n "$job" ] || job="unknown"
  fi
  # Latest Worker diag may carry plan/job ids in the first lines of the newest log
  local latest_worker
  latest_worker="$(ls -t "$RUNNER_ROOT"/_diag/Worker_*.log 2>/dev/null | head -1 || true)"
  if [ -n "$latest_worker" ] && [ -f "$latest_worker" ]; then
    run_hint="$(basename "$latest_worker")"
  fi
  printf 'job=%s diag=%s' "${job:-unknown}" "${run_hint:-unknown}"
}

kill_pid() {
  local pid="$1"
  local tag="$2"
  local ctx="$3"
  kill -TERM "$pid" 2>/dev/null || true
  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
    log_kill "KILL-FORCE pid=${pid} tag=${tag} ${ctx}"
  fi
}

kill_worker() {
  local pid="$1"
  local ppid="$2"
  local pcpu="$3"
  local etime="$4"
  local reason="$5"
  local ctx parent_cmd root="$pid"
  ctx="$(in_flight_context)"
  # If the hot process is a child Worker under another Worker, kill the parent
  # Worker root so the job cannot respawn another spinning child.
  parent_cmd="$(ps -p "$ppid" -o command= 2>/dev/null || true)"
  case "$parent_cmd" in
    *Runner.Worker*)
      root="$ppid"
      ;;
  esac
  log_kill "KILL pid=${pid} root=${root} ppid=${ppid} cpu=${pcpu} etime=${etime} reason=${reason} ${ctx}"
  # Kill children of root first, then root.
  ps -axo pid=,ppid= | awk -v r="$root" '$2==r {print $1}' | while read -r child; do
    kill_pid "$child" "child-of-${root}" "$ctx"
    rm -f "$STATE_DIR/hot-$child"
  done
  kill_pid "$root" "root" "$ctx"
  rm -f "$STATE_DIR/hot-$pid" "$STATE_DIR/hot-$root"
}

sanitize_path_file

# ps: pid ppid pcpu etime command
# shellcheck disable=SC2009
ps -axo pid=,ppid=,pcpu=,etime=,command= | while read -r pid ppid pcpu etime rest; do
  case "$rest" in
    *Runner.Worker*) ;;
    *) continue ;;
  esac

  # Only act on this runner's binaries
  case "$rest" in
    *actions-runner-wcdraft*) ;;
    *) continue ;;
  esac

  # Orphan: parent gone (reparented to launchd). Always fatal.
  if [ "$ppid" = "1" ]; then
    kill_worker "$pid" "$ppid" "$pcpu" "$etime" "orphan-ppid1"
    continue
  fi

  # High-CPU busy loop: count consecutive hot samples.
  is_hot="$(awk -v c="$pcpu" -v t="$CPU_THRESHOLD" 'BEGIN { print (c+0 >= t+0) ? 1 : 0 }')"
  hot_file="$STATE_DIR/hot-$pid"
  if [ "$is_hot" = "1" ]; then
    if [ -f "$hot_file" ]; then
      read -r count first_epoch <"$hot_file" || true
      count="${count:-0}"
      first_epoch="${first_epoch:-$NOW_EPOCH}"
      count=$((count + 1))
    else
      count=1
      first_epoch="$NOW_EPOCH"
    fi
    printf '%s %s\n' "$count" "$first_epoch" >"$hot_file"
    if [ "$count" -ge "$HOT_SAMPLES_NEEDED" ]; then
      kill_worker "$pid" "$ppid" "$pcpu" "$etime" "cpu-spin samples=${count}"
    else
      log "HOT pid=$pid ppid=$ppid sample=$count/$HOT_SAMPLES_NEEDED cpu=$pcpu etime=$etime"
    fi
  else
    rm -f "$hot_file"
  fi
done

# Drop state files for PIDs that no longer exist
for hot in "$STATE_DIR"/hot-*; do
  [ -e "$hot" ] || continue
  pid="${hot##*/hot-}"
  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$hot"
  fi
done

log "ok workers_scanned path_sanitized"

exit 0
