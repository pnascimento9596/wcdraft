# Self-hosted runner worker watchdog (wcdraft-m4)

Never print secrets. This runbook is host operations for the **wcdraft** free
self-hosted Mac runner only.

## ⚠ Multi-tenant host (read first)

This Mac runs **two** self-hosted GitHub Actions runners:

| Runner | Root | Ownership |
| --- | --- | --- |
| `wcdraft-m4` | `/Users/paulo/actions-runner-wcdraft/` | wcdraft |
| biotraxiq | `/Users/paulo/actions-runner-biotraxiq/` | **unrelated project — production for its owner** |

**Never** treat name-matched `Runner.Worker` / `Runner.Listener` as safe to kill.
A biotraxiq worker at high CPU with a live parent is a healthy job, not a wedge.
Unscoped `pkill -f Runner.Worker`, `killall`, or CPU-only kill heuristics will
destroy the other project's CI and are **forbidden**.

Every process action must:

1. Resolve the candidate's **real executable path** (e.g. `lsof` `txt`).
2. Act **only** if that path is under `/Users/paulo/actions-runner-wcdraft/`.
3. **Leave-if-unsure** — if the path cannot be resolved with confidence, skip and log.

PATH / `.env` sanitisation writes **only** under the wcdraft runner root. Verify
by inspection that no write path can resolve into `actions-runner-biotraxiq`.

Disk pruning applies to **wcdraft's `_work` only**.

## Purpose

**Containment, not a fix.** Bound a multi-hour silent `Runner.Worker` spawn wedge
to a several-minute self-healing kill with a durable log. The wedge is a
property of forking a multithreaded .NET agent on macOS (Network.framework
`pthread_atfork` child handler `nw_settings_child_has_forked`). Containment
cannot make CI converge if wedges are frequent. See
`docs/runbooks/assets/runner-worker-watchdog/DIAGNOSIS-worker-cpu-spin-2026-07-24.md`.

## Wedge signature (kill keys)

Kill **only** when path-scoped to wcdraft **and** one of:

1. **Orphan:** `Runner.Worker` with **ppid=1** under the wcdraft executable path.
2. **Log wedge:** in the wcdraft runner's own `_diag/Worker_*.log`:
   - `Starting process:` with **no** following `Process started with process id …`
   - then repeating `HostContext Well known directory` past a generous threshold
     (default 30 heartbeats ≈ 5 minutes).

**High CPU is never a sole trigger.** Optional CPU is secondary confirmation on a
process already matched by path **and** log signature. A busy compile/test worker
and a wedged worker look identical on CPU alone.

Watchdog kill lines land in
`~/Library/Logs/com.wcdraft.runner-worker-watchdog/kills.log`.

## Install (once per runner Mac)

```bash
set -euo pipefail
RUNNER_ROOT="${WCDRAFT_RUNNER_ROOT:-/Users/paulo/actions-runner-wcdraft}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
ASSETS="$REPO_ROOT/docs/runbooks/assets/runner-worker-watchdog"

test -d "$RUNNER_ROOT"
# Hard refuse wrong tenant
case "$(cd "$RUNNER_ROOT" && pwd -P)" in
  /Users/paulo/actions-runner-wcdraft|/Users/paulo/actions-runner-wcdraft/*) ;;
  *) echo "REFUSE: RUNNER_ROOT is not wcdraft"; exit 1 ;;
esac

mkdir -p "$RUNNER_ROOT/wcdraft-maintenance" \
  "$HOME/Library/Logs/com.wcdraft.runner-worker-watchdog" \
  "$HOME/Library/LaunchAgents"

install -m 0755 "$ASSETS/runner-worker-watchdog.sh" \
  "$RUNNER_ROOT/wcdraft-maintenance/runner-worker-watchdog.sh"
install -m 0644 "$ASSETS/com.wcdraft.runner-worker-watchdog.plist" \
  "$HOME/Library/LaunchAgents/com.wcdraft.runner-worker-watchdog.plist"
install -m 0644 "$ASSETS/DIAGNOSIS-worker-cpu-spin-2026-07-24.md" \
  "$RUNNER_ROOT/wcdraft-maintenance/DIAGNOSIS-worker-cpu-spin-2026-07-24.md"

# Clean PATH file (wcdraft root only; survives binary auto-update)
printf '%s\n' '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' \
  >"$RUNNER_ROOT/.path"
printf '%s\n' 'LANG=C.UTF-8' >"$RUNNER_ROOT/.env"

# Do NOT bootstrap the LaunchAgent until dry-run evidence shows zero foreign
# selections against a live biotraxiq job. See § Dry-run gate.
```

## Dry-run gate (required before enable)

With a **live biotraxiq** `Runner.Worker` running:

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export WCDRAFT_WATCHDOG_DRY_RUN=1
/Users/paulo/actions-runner-wcdraft/wcdraft-maintenance/runner-worker-watchdog.sh
# Repeat for several minutes (or loop 5–10 times at 60s)
grep -E 'SKIP foreign|DRY-RUN SELECT|selected=' \
  ~/Library/Logs/com.wcdraft.runner-worker-watchdog/watchdog.log | tail -40
```

**Pass criteria:** every biotraxiq process is `SKIP foreign`; `selected=0` while
only biotraxiq is busy; no write into `actions-runner-biotraxiq`. Commit that
log excerpt as evidence, then bootstrap:

```bash
uid="$(id -u)"
launchctl bootout "gui/${uid}/com.wcdraft.runner-worker-watchdog" 2>/dev/null || true
launchctl bootstrap "gui/${uid}" \
  "$HOME/Library/LaunchAgents/com.wcdraft.runner-worker-watchdog.plist"
launchctl kickstart -k "gui/${uid}/com.wcdraft.runner-worker-watchdog"
sleep 2
tail -5 "$HOME/Library/Logs/com.wcdraft.runner-worker-watchdog/watchdog.log"
```

## PATH survival (evidence)

| Location                                | Role                                                            | Survives runner binary auto-update?                                               |
| --------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `$RUNNER_ROOT/.path`                    | `runsvc.sh` exports `PATH=$(cat .path)` on every Listener start | **Yes** — file lives in runner root, not under versioned `bin.*`                  |
| `$RUNNER_ROOT/.env`                     | optional env snippets                                           | **Yes** — same                                                                    |
| LaunchAgent `EnvironmentVariables.PATH` | PATH for `runsvc.sh` process itself                             | **Yes**, until someone re-runs `svc.sh install` (regenerates plist from template) |
| Watchdog tick                           | rewrites **wcdraft** `.path` every 60s                          | Belt-and-suspenders if anything re-pollutes the file                              |

**Does not survive alone:** a LaunchAgent PATH if `svc.sh install` is re-run without re-applying the clean PATH. After any `svc.sh install`, re-apply LaunchAgent PATH and reinstall the watchdog LaunchAgent from this runbook.

Writes are confined to `$RUNNER_ROOT` after `pwd -P` validation against
`/Users/paulo/actions-runner-wcdraft`. The script refuses any root containing
`actions-runner-biotraxiq`.

## Verify healthy

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# No wcdraft orphan workers (path-resolved)
for pid in $(pgrep -f 'Runner\.Worker' || true); do
  exe=$(lsof -p "$pid" 2>/dev/null | awk '$4=="txt"{print $NF; exit}')
  ppid=$(ps -p "$pid" -o ppid= | tr -d ' ')
  case "$exe" in
    /Users/paulo/actions-runner-wcdraft/*)
      echo "wcdraft PID=$pid PPID=$ppid EXE=$exe"
      ;;
  esac
done

# Listener up, workers idle or absent
ps -axo pid=,ppid=,etime=,pcpu=,command= | grep actions-runner-wcdraft | grep -v grep

# Watchdog heartbeats
tail -20 ~/Library/Logs/com.wcdraft.runner-worker-watchdog/watchdog.log

# Kills (empty is fine)
tail -20 ~/Library/Logs/com.wcdraft.runner-worker-watchdog/kills.log
```

## On a recorded kill (CI job)

1. Read `kills.log` — treat as **infrastructure failure**, not product FAIL.
2. Re-run the failed GitHub Actions job/run **once**.
3. Record the re-run in the final report.
4. Never fix-forward product code against it; never auto-revert production on it.
5. If the same infrastructure signature fails twice, stop and report.
6. Remember: the watchdog bounds damage; frequent kills mean the macOS fork hazard
   is still winning — escalate to Linux migration, do not tighten CPU heuristics.

## Manual emergency kill (wcdraft path only)

**Never** use unscoped `pkill` / `killall`. Resolve path, then kill.

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
WCDRAFT_ROOT="/Users/paulo/actions-runner-wcdraft"

# Orphans under wcdraft only
for pid in $(pgrep -f 'Runner\.Worker' || true); do
  exe=$(lsof -p "$pid" 2>/dev/null | awk '$4=="txt"{print $NF; exit}')
  ppid=$(ps -p "$pid" -o ppid= | tr -d ' ')
  case "$exe" in
    "$WCDRAFT_ROOT"/*)
      if [ "$ppid" = "1" ]; then
        echo "killing orphan $pid $exe"
        kill -KILL "$pid" 2>/dev/null || true
      fi
      ;;
  esac
done

# Full Worker tree for wcdraft only (leaves Listener up; never biotraxiq)
for pid in $(pgrep -f 'Runner\.Worker' || true); do
  exe=$(lsof -p "$pid" 2>/dev/null | awk '$4=="txt"{print $NF; exit}')
  case "$exe" in
    "$WCDRAFT_ROOT"/*)
      echo "killing wcdraft worker $pid $exe"
      kill -KILL "$pid" 2>/dev/null || true
      ;;
  esac
done
```

## Related

- Host install lives under `$RUNNER_ROOT/wcdraft-maintenance/` (operational copy).
- Disk maintenance remains `com.wcdraft.runner-disk-maintenance` (separate LaunchAgent;
  must also stay wcdraft-scoped).
- Runner service label: `actions.runner.pnascimento9596-wcdraft.wcdraft-m4` —
  start/stop only that label (or `svc.sh` under the wcdraft root). Never global
  `launchctl` operations that would affect biotraxiq's service.
