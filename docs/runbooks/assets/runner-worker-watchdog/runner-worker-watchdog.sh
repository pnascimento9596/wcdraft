#!/usr/bin/env bash
# Kill stuck / orphaned GitHub Actions Runner.Worker processes on wcdraft-m4 ONLY.
#
# MULTI-TENANT HOST CONSTRAINT (read before editing):
#   This Mac also runs an unrelated self-hosted runner under
#   /Users/paulo/actions-runner-biotraxiq/. That project is production for its
#   owner. Every process action MUST resolve the real executable path and act
#   ONLY on paths under WCDRAFT_RUNNER_ROOT (default actions-runner-wcdraft).
#   Name matching alone is forbidden. Unscoped pkill/killall is forbidden.
#   PATH sanitisation writes ONLY under WCDRAFT_RUNNER_ROOT.
#
# Failure class (macOS fork + Network.framework atfork child handler):
#   Multithreaded Runner.Worker forks to spawn a step. POSIX keeps only the
#   forking thread in the child; any mutex held by another parent thread stays
#   locked forever. On macOS, Network.framework's pthread_atfork child handler
#   (nw_settings_child_has_forked) can wedge the child before exec, so the
#   parent never logs "Process started with process id" and spins while
#   heartbeating "Well known directory". See DIAGNOSIS-worker-cpu-spin-2026-07-24.md.
#
# The watchdog is CONTAINMENT, not a fix. It bounds each wedge; it cannot make
# CI converge if wedges are frequent.
#
# Kill triggers (path-scoped to wcdraft only):
#   1. Orphan Worker (ppid=1) under the wcdraft executable path.
#   2. Wedge signature in the wcdraft runner's own Worker diag log:
#        "Starting process:" with no following "Process started with process id",
#        then repeating "Well known directory" past a generous threshold.
#   CPU alone never triggers a kill. Optional high-CPU is secondary confirmation
#   only after path + log signature match.
#
# Fail-safe: never kills Runner.Listener or runsvc. Never touches biotraxiq.
# DRY_RUN=1 (or WCDRAFT_WATCHDOG_DRY_RUN=1): report only, never kill, never write .path/.env.

set -euo pipefail

EXPECTED_RUNNER_ROOT="/Users/paulo/actions-runner-wcdraft"
FORBIDDEN_ROOT_SUBSTRING="actions-runner-biotraxiq"
RUNNER_ROOT="${WCDRAFT_RUNNER_ROOT:-$EXPECTED_RUNNER_ROOT}"
STATE_DIR="${WCDRAFT_WATCHDOG_STATE:-$RUNNER_ROOT/_work/_diag/wcdraft-worker-watchdog}"
LOG_DIR="${HOME}/Library/Logs/com.wcdraft.runner-worker-watchdog"
KILL_LOG="${LOG_DIR}/kills.log"
# After incomplete spawn, Well-known heartbeats fire ~every 10s.
# Default 30 ≈ 5 minutes — generous so healthy long steps are never confused.
WEDGE_HEARTBEAT_THRESHOLD="${WCDRAFT_WEDGE_HEARTBEAT_THRESHOLD:-30}"
# Optional secondary confirmation only (never a sole trigger).
CPU_SECONDARY_THRESHOLD="${WCDRAFT_WORKER_CPU_SECONDARY:-50}"
CLEAN_PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
DRY_RUN="${WCDRAFT_WATCHDOG_DRY_RUN:-${DRY_RUN:-0}}"
NOW_EPOCH="$(date +%s)"
NOW_UTC="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

mkdir -p "$STATE_DIR" "$LOG_DIR"

log() {
  printf '%s %s\n' "$NOW_UTC" "$*" >>"$LOG_DIR/watchdog.log"
}

log_kill() {
  printf '%s %s\n' "$NOW_UTC" "$*" | tee -a "$KILL_LOG" >>"$LOG_DIR/watchdog.log"
}

# Resolve absolute real path of RUNNER_ROOT; refuse anything outside expected root.
assert_runner_root_safe() {
  local resolved
  if [ ! -d "$RUNNER_ROOT" ]; then
    log "SKIP unsafe: RUNNER_ROOT missing: $RUNNER_ROOT"
    return 1
  fi
  resolved="$(cd "$RUNNER_ROOT" && pwd -P)"
  case "$resolved" in
    *"$FORBIDDEN_ROOT_SUBSTRING"*)
      log "REFUSE: RUNNER_ROOT resolves into forbidden tenant: $resolved"
      return 1
      ;;
  esac
  case "$resolved" in
    "$EXPECTED_RUNNER_ROOT"|"$EXPECTED_RUNNER_ROOT"/*) ;;
    *)
      log "REFUSE: RUNNER_ROOT=$resolved is not under $EXPECTED_RUNNER_ROOT"
      return 1
      ;;
  esac
  RUNNER_ROOT="$resolved"
  return 0
}

# True if path is under the (already validated) wcdraft runner root.
path_is_wcdraft() {
  local p="$1"
  case "$p" in
    "$RUNNER_ROOT"|"$RUNNER_ROOT"/*) return 0 ;;
    *) return 1 ;;
  esac
}

# Resolve real executable path for a PID. Prefer lsof txt; leave-if-unsure.
resolve_exe_path() {
  local pid="$1"
  local line path=""
  # lsof: COMMAND PID USER FD TYPE ... NAME
  line="$(lsof -p "$pid" 2>/dev/null | awk '$4=="txt" { print; exit }' || true)"
  if [ -n "$line" ]; then
    # NAME is the final field; paths do not contain spaces for Runner.* binaries.
    path="$(printf '%s\n' "$line" | awk '{ print $NF }')"
  fi
  if [ -z "$path" ] || [ ! -e "$path" ]; then
    # Fallback: argv0 when absolute and exists
    path="$(ps -p "$pid" -o command= 2>/dev/null | awk '{ print $1 }' || true)"
  fi
  if [ -z "$path" ] || [ ! -e "$path" ]; then
    printf ''
    return 1
  fi
  # Prefer physical path when possible
  if command -v realpath >/dev/null 2>&1; then
    path="$(realpath "$path" 2>/dev/null || printf '%s' "$path")"
  fi
  printf '%s' "$path"
  return 0
}

# Re-sanitize .path ONLY under validated wcdraft root. Never biotraxiq.
sanitize_path_file() {
  local path_file env_file path_dir env_dir
  path_file="$RUNNER_ROOT/.path"
  env_file="$RUNNER_ROOT/.env"
  path_dir="$(cd "$(dirname "$path_file")" && pwd -P)"
  env_dir="$(cd "$(dirname "$env_file")" && pwd -P)"
  if ! path_is_wcdraft "$path_dir" || ! path_is_wcdraft "$env_dir"; then
    log "REFUSE path sanitize: target dir not under wcdraft root path_dir=$path_dir env_dir=$env_dir"
    return 1
  fi
  case "$path_file" in
    *"$FORBIDDEN_ROOT_SUBSTRING"*)
      log "REFUSE path sanitize: forbidden path $path_file"
      return 1
      ;;
  esac
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN would sanitize .path under $RUNNER_ROOT"
    return 0
  fi
  printf '%s\n' "$CLEAN_PATH" >"$path_file"
  if [ ! -f "$env_file" ] || ! grep -q '^LANG=' "$env_file" 2>/dev/null; then
    printf '%s\n' 'LANG=C.UTF-8' >"$env_file"
  fi
}

in_flight_context() {
  local stdout_log="${HOME}/Library/Logs/actions.runner.pnascimento9596-wcdraft.wcdraft-m4/stdout.log"
  local job="unknown"
  local run_hint="unknown"
  if [ -f "$stdout_log" ]; then
    job="$(grep 'Running job:' "$stdout_log" 2>/dev/null | tail -1 | sed 's/.*Running job: //' | tr '|' '/' | tr -s ' ' | cut -c1-160 || true)"
    [ -n "$job" ] || job="unknown"
  fi
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
  local exe
  exe="$(resolve_exe_path "$pid" || true)"
  if [ -z "$exe" ]; then
    log "SKIP kill: cannot resolve exe for pid=$pid tag=$tag (leave-if-unsure)"
    return 0
  fi
  if ! path_is_wcdraft "$exe"; then
    log "SKIP kill: pid=$pid exe=$exe not under wcdraft root (leave-if-unsure)"
    return 0
  fi
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN would kill pid=$pid tag=$tag exe=$exe ${ctx}"
    return 0
  fi
  kill -TERM "$pid" 2>/dev/null || true
  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
    log_kill "KILL-FORCE pid=${pid} tag=${tag} exe=${exe} ${ctx}"
  fi
}

kill_worker() {
  local pid="$1"
  local ppid="$2"
  local pcpu="$3"
  local etime="$4"
  local reason="$5"
  local ctx parent_cmd parent_exe root="$pid"
  local exe
  exe="$(resolve_exe_path "$pid" || true)"
  if [ -z "$exe" ] || ! path_is_wcdraft "$exe"; then
    log "SKIP kill_worker: pid=$pid exe=${exe:-unresolved} not confidently wcdraft"
    return 0
  fi
  ctx="$(in_flight_context)"
  parent_cmd="$(ps -p "$ppid" -o command= 2>/dev/null || true)"
  parent_exe="$(resolve_exe_path "$ppid" 2>/dev/null || true)"
  if [ -n "$parent_exe" ] && path_is_wcdraft "$parent_exe"; then
    case "$parent_cmd" in
      *Runner.Worker*) root="$ppid" ;;
    esac
  fi
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN SELECT pid=${pid} root=${root} ppid=${ppid} cpu=${pcpu} etime=${etime} exe=${exe} reason=${reason} ${ctx}"
    return 0
  fi
  log_kill "KILL pid=${pid} root=${root} ppid=${ppid} cpu=${pcpu} etime=${etime} exe=${exe} reason=${reason} ${ctx}"
  # Kill only children whose exe also resolves under wcdraft.
  local child child_exe
  while read -r child; do
    [ -n "$child" ] || continue
    child_exe="$(resolve_exe_path "$child" || true)"
    if [ -n "$child_exe" ] && path_is_wcdraft "$child_exe"; then
      kill_pid "$child" "child-of-${root}" "$ctx"
    else
      log "SKIP child pid=$child exe=${child_exe:-unresolved} (not wcdraft)"
    fi
    rm -f "$STATE_DIR/hot-$child" "$STATE_DIR/wedge-$child"
  done < <(ps -axo pid=,ppid= | awk -v r="$root" '$2==r {print $1}')
  kill_pid "$root" "root" "$ctx"
  rm -f "$STATE_DIR/hot-$pid" "$STATE_DIR/hot-$root" "$STATE_DIR/wedge-$pid" "$STATE_DIR/wedge-$root"
}

# Inspect latest wcdraft Worker diag for the ProcessInvoker wedge signature.
# Prints: wedge|heartbeats|diag_basename  or  ok|0|diag_basename  or empty if no log.
detect_log_wedge() {
  local latest
  latest="$(ls -t "$RUNNER_ROOT"/_diag/Worker_*.log 2>/dev/null | head -1 || true)"
  if [ -z "$latest" ] || [ ! -f "$latest" ]; then
    printf 'nolog|0|'
    return 0
  fi
  local base
  base="$(basename "$latest")"
  # Use awk: find last "Starting process:" that is not followed by
  # "Process started with process id" before EOF / next start; count Well known
  # directory lines after that incomplete start.
  local result
  result="$(
    awk '
      /Starting process:/ {
        start_line = NR
        incomplete = 1
        heartbeats = 0
        next
      }
      /Process started with process id/ {
        if (incomplete) { incomplete = 0; heartbeats = 0 }
        next
      }
      /Well known directory/ {
        if (incomplete) heartbeats++
        next
      }
      END {
        if (incomplete && start_line > 0) {
          printf "wedge|%d", heartbeats
        } else {
          printf "ok|0"
        }
      }
    ' "$latest"
  )"
  printf '%s|%s' "$result" "$base"
}

# --- main ---
if ! assert_runner_root_safe; then
  exit 0
fi

sanitize_path_file || true

log_wedge_state="$(detect_log_wedge)"
log_status="${log_wedge_state%%|*}"
rest="${log_wedge_state#*|}"
log_heartbeats="${rest%%|*}"
log_diag="${rest#*|}"

wedge_confirmed=0
if [ "$log_status" = "wedge" ] && [ "${log_heartbeats:-0}" -ge "$WEDGE_HEARTBEAT_THRESHOLD" ]; then
  wedge_confirmed=1
  log "LOG-WEDGE diag=$log_diag heartbeats=$log_heartbeats threshold=$WEDGE_HEARTBEAT_THRESHOLD"
fi

scanned=0
selected=0
skipped_foreign=0
skipped_unresolved=0

# True if argv0 looks like a Runner.Worker / Runner.Listener binary path.
# Reject shell wrappers whose command *string* merely mentions those names.
is_runner_binary_cmd() {
  local cmd="$1"
  local argv0="${cmd%% *}"
  case "$argv0" in
    */Runner.Worker|*/Runner.Listener|Runner.Worker|Runner.Listener) return 0 ;;
    *) return 1 ;;
  esac
}

# Dry-run / multi-tenant audit: classify every Runner.Worker AND Runner.Listener
# by resolved exe path. Kill path still only acts on Workers (below).
while read -r pid ppid pcpu etime rest; do
  is_runner_binary_cmd "$rest" || continue
  audit_exe="$(resolve_exe_path "$pid" || true)"
  if [ -z "$audit_exe" ]; then
    log "AUDIT unresolved pid=$pid ppid=$ppid cmd=$(printf '%s' "$rest" | cut -c1-80)"
    continue
  fi
  if path_is_wcdraft "$audit_exe"; then
    log "AUDIT wcdraft pid=$pid ppid=$ppid cpu=$pcpu exe=$audit_exe"
  else
    log "AUDIT foreign pid=$pid ppid=$ppid cpu=$pcpu exe=$audit_exe"
  fi
done < <(ps -axo pid=,ppid=,pcpu=,etime=,command=)

# Enumerate Runner.Worker candidates by argv0, then path-scope via real exe.
while read -r pid ppid pcpu etime rest; do
  argv0="${rest%% *}"
  case "$argv0" in
    */Runner.Worker|Runner.Worker) ;;
    *) continue ;;
  esac
  scanned=$((scanned + 1))

  exe="$(resolve_exe_path "$pid" || true)"
  if [ -z "$exe" ]; then
    skipped_unresolved=$((skipped_unresolved + 1))
    log "SKIP unresolved-exe pid=$pid ppid=$ppid cpu=$pcpu (leave-if-unsure)"
    continue
  fi
  if ! path_is_wcdraft "$exe"; then
    skipped_foreign=$((skipped_foreign + 1))
    log "SKIP foreign pid=$pid ppid=$ppid cpu=$pcpu exe=$exe"
    continue
  fi

  # 1) Orphan under wcdraft path — always reaped.
  if [ "$ppid" = "1" ]; then
    selected=$((selected + 1))
    kill_worker "$pid" "$ppid" "$pcpu" "$etime" "orphan-ppid1"
    continue
  fi

  # 2) Log wedge signature — primary non-orphan kill key.
  #    CPU may only confirm; never trigger alone.
  if [ "$wedge_confirmed" = "1" ]; then
    is_hot="$(awk -v c="$pcpu" -v t="$CPU_SECONDARY_THRESHOLD" 'BEGIN { print (c+0 >= t+0) ? 1 : 0 }')"
    if [ "$is_hot" = "1" ]; then
      selected=$((selected + 1))
      kill_worker "$pid" "$ppid" "$pcpu" "$etime" \
        "log-wedge heartbeats=${log_heartbeats} diag=${log_diag} cpu_secondary=${pcpu}"
    else
      # Signature matched but process not hot — log and keep counting samples
      # in case CPU is temporarily low while still wedged.
      wedge_file="$STATE_DIR/wedge-$pid"
      if [ -f "$wedge_file" ]; then
        read -r wcount <"$wedge_file" || true
        wcount=$((${wcount:-0} + 1))
      else
        wcount=1
      fi
      printf '%s\n' "$wcount" >"$wedge_file"
      # After 3 consecutive ticks with log wedge even without high CPU, kill.
      if [ "$wcount" -ge 3 ]; then
        selected=$((selected + 1))
        kill_worker "$pid" "$ppid" "$pcpu" "$etime" \
          "log-wedge heartbeats=${log_heartbeats} diag=${log_diag} cool-cpu-samples=${wcount}"
      else
        log "LOG-WEDGE-COOL pid=$pid sample=$wcount/3 cpu=$pcpu diag=$log_diag"
      fi
    fi
    continue
  fi

  # Clear per-pid wedge counter when log no longer shows wedge.
  rm -f "$STATE_DIR/wedge-$pid"
done < <(ps -axo pid=,ppid=,pcpu=,etime=,command=)

# Drop state files for PIDs that no longer exist
for statef in "$STATE_DIR"/hot-* "$STATE_DIR"/wedge-*; do
  [ -e "$statef" ] || continue
  base="${statef##*/}"
  pid="${base#hot-}"
  pid="${pid#wedge-}"
  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$statef"
  fi
done

mode="live"
[ "$DRY_RUN" = "1" ] && mode="dry-run"
log "ok mode=$mode scanned=$scanned selected=$selected skipped_foreign=$skipped_foreign skipped_unresolved=$skipped_unresolved log_status=$log_status log_heartbeats=${log_heartbeats:-0} path_sanitized=$RUNNER_ROOT"

exit 0
