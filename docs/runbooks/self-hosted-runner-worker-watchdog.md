# Self-hosted runner worker watchdog (wcdraft-m4)

Never print secrets. This runbook is host operations for the free self-hosted
Mac runner only.

## Purpose

Convert a multi-hour silent `Runner.Worker` CPU wedge into a ~3-minute
self-healing kill with a durable log. The wedge signature is a recurring
upstream self-hosted runner failure class (not a product defect). See
`docs/runbooks/assets/runner-worker-watchdog/DIAGNOSIS-worker-cpu-spin-2026-07-24.md`.

## Wedge signature

- Log: `Starting process:` with **no** following `Process started with process id … waiting for process exit`
- Log: repeating `HostContext Well known directory` every ~10s
- Host: `Runner.Worker` at ≥90% CPU, or `Runner.Worker` with **ppid=1** (orphan)
- Watchdog: a line in `~/Library/Logs/com.wcdraft.runner-worker-watchdog/kills.log`

## Install (once per runner Mac)

```bash
set -euo pipefail
RUNNER_ROOT="${WCDRAFT_RUNNER_ROOT:-/Users/paulo/actions-runner-wcdraft}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
ASSETS="$REPO_ROOT/docs/runbooks/assets/runner-worker-watchdog"

test -d "$RUNNER_ROOT"
mkdir -p "$RUNNER_ROOT/wcdraft-maintenance" \
  "$HOME/Library/Logs/com.wcdraft.runner-worker-watchdog" \
  "$HOME/Library/LaunchAgents"

install -m 0755 "$ASSETS/runner-worker-watchdog.sh" \
  "$RUNNER_ROOT/wcdraft-maintenance/runner-worker-watchdog.sh"
install -m 0644 "$ASSETS/com.wcdraft.runner-worker-watchdog.plist" \
  "$HOME/Library/LaunchAgents/com.wcdraft.runner-worker-watchdog.plist"
install -m 0644 "$ASSETS/DIAGNOSIS-worker-cpu-spin-2026-07-24.md" \
  "$RUNNER_ROOT/wcdraft-maintenance/DIAGNOSIS-worker-cpu-spin-2026-07-24.md"

# Clean PATH file (survives binary auto-update; runsvc sources it on start)
printf '%s\n' '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' \
  >"$RUNNER_ROOT/.path"
printf '%s\n' 'LANG=C.UTF-8' >"$RUNNER_ROOT/.env"

uid="$(id -u)"
launchctl bootout "gui/${uid}/com.wcdraft.runner-worker-watchdog" 2>/dev/null || true
launchctl bootstrap "gui/${uid}" \
  "$HOME/Library/LaunchAgents/com.wcdraft.runner-worker-watchdog.plist"
launchctl kickstart -k "gui/${uid}/com.wcdraft.runner-worker-watchdog"

# Prove watchdog fires
sleep 2
test -f "$HOME/Library/Logs/com.wcdraft.runner-worker-watchdog/watchdog.log"
tail -5 "$HOME/Library/Logs/com.wcdraft.runner-worker-watchdog/watchdog.log"
```

## PATH survival (evidence)

| Location                                | Role                                                            | Survives runner binary auto-update?                                               |
| --------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `$RUNNER_ROOT/.path`                    | `runsvc.sh` exports `PATH=$(cat .path)` on every Listener start | **Yes** — file lives in runner root, not under versioned `bin.*`                  |
| `$RUNNER_ROOT/.env`                     | optional env snippets                                           | **Yes** — same                                                                    |
| LaunchAgent `EnvironmentVariables.PATH` | PATH for `runsvc.sh` process itself                             | **Yes**, until someone re-runs `svc.sh install` (regenerates plist from template) |
| Watchdog tick                           | rewrites `.path` every 60s                                      | Belt-and-suspenders if anything re-pollutes the file                              |

**Does not survive alone:** a LaunchAgent PATH if `svc.sh install` is re-run without re-applying the clean PATH. After any `svc.sh install`, re-apply LaunchAgent PATH and reinstall the watchdog LaunchAgent from this runbook.

## Verify healthy

```bash
# No orphan workers
ps -axo pid=,ppid=,pcpu=,command= | awk '/actions-runner-wcdraft.*Runner\.Worker/ && $2==1 {print}'

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

## Manual emergency kill

```bash
# Orphans only
ps -axo pid=,ppid=,command= | awk '/actions-runner-wcdraft.*Runner\.Worker/ && $2==1 {print $1}' \
  | while read -r p; do kill -KILL "$p"; done

# Full Worker tree for this runner (leaves Listener up)
ps -axo pid=,command= | awk '/actions-runner-wcdraft.*Runner\.Worker/ {print $1}' \
  | while read -r p; do kill -KILL "$p"; done
```

## Related

- Host install lives under `$RUNNER_ROOT/wcdraft-maintenance/` (operational copy).
- Disk maintenance remains `com.wcdraft.runner-disk-maintenance` (separate LaunchAgent).
