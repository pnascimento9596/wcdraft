# Watchdog dry-run evidence — zero biotraxiq selections

- captured_at_utc: 2026-07-24T19:23:05Z
- host: shared Mac (wcdraft-m4 + biotraxiq-m4)
- mode: `WCDRAFT_WATCHDOG_DRY_RUN=1` (report only; no kills; no `.path` writes)
- watchdog LaunchAgent: **down** throughout
- dry-run ticks: 5
- biotraxiq `Runner.Listener` live on every tick: **yes**
- biotraxiq `Runner.Worker` during this 5-tick window: none (job idle); Listener is the standing foreign process. Earlier same-session inventory captured Worker PID 60761 at `/Users/paulo/actions-runner-biotraxiq/bin/Runner.Worker` under a live parent — same path-prefix rule applies.

## Goal

Prove the path-scoped watchdog classifies biotraxiq processes as **foreign** and
selects **zero** of them for kill.

## Live inventory during dry-run

```
88908     1   0.0    01:35:14 /bin/bash /Users/paulo/actions-runner-biotraxiq/runsvc.sh
88912 88911   0.0    01:35:14 /Users/paulo/actions-runner-biotraxiq/bin/Runner.Listener run --startuptype service
```

## Dry-run log excerpt

```
2026-07-24T19:22:24Z DRY-RUN would sanitize .path under /Users/paulo/actions-runner-wcdraft
2026-07-24T19:22:24Z AUDIT foreign pid=88912 ppid=88911 cpu=0.0 exe=/Users/paulo/actions-runner-biotraxiq/bin/Runner.Listener
2026-07-24T19:22:24Z ok mode=dry-run scanned=0 selected=0 skipped_foreign=0 skipped_unresolved=0 log_status=wedge log_heartbeats=9 path_sanitized=/Users/paulo/actions-runner-wcdraft
2026-07-24T19:22:32Z DRY-RUN would sanitize .path under /Users/paulo/actions-runner-wcdraft
2026-07-24T19:22:32Z AUDIT foreign pid=88912 ppid=88911 cpu=0.0 exe=/Users/paulo/actions-runner-biotraxiq/bin/Runner.Listener
2026-07-24T19:22:32Z ok mode=dry-run scanned=0 selected=0 skipped_foreign=0 skipped_unresolved=0 log_status=wedge log_heartbeats=9 path_sanitized=/Users/paulo/actions-runner-wcdraft
2026-07-24T19:22:40Z DRY-RUN would sanitize .path under /Users/paulo/actions-runner-wcdraft
2026-07-24T19:22:40Z AUDIT foreign pid=88912 ppid=88911 cpu=0.0 exe=/Users/paulo/actions-runner-biotraxiq/bin/Runner.Listener
2026-07-24T19:22:40Z ok mode=dry-run scanned=0 selected=0 skipped_foreign=0 skipped_unresolved=0 log_status=wedge log_heartbeats=9 path_sanitized=/Users/paulo/actions-runner-wcdraft
2026-07-24T19:22:48Z DRY-RUN would sanitize .path under /Users/paulo/actions-runner-wcdraft
2026-07-24T19:22:48Z AUDIT foreign pid=88912 ppid=88911 cpu=0.0 exe=/Users/paulo/actions-runner-biotraxiq/bin/Runner.Listener
2026-07-24T19:22:48Z ok mode=dry-run scanned=0 selected=0 skipped_foreign=0 skipped_unresolved=0 log_status=wedge log_heartbeats=9 path_sanitized=/Users/paulo/actions-runner-wcdraft
2026-07-24T19:22:56Z DRY-RUN would sanitize .path under /Users/paulo/actions-runner-wcdraft
2026-07-24T19:22:56Z AUDIT foreign pid=88912 ppid=88911 cpu=0.0 exe=/Users/paulo/actions-runner-biotraxiq/bin/Runner.Listener
2026-07-24T19:22:56Z ok mode=dry-run scanned=0 selected=0 skipped_foreign=0 skipped_unresolved=0 log_status=wedge log_heartbeats=9 path_sanitized=/Users/paulo/actions-runner-wcdraft
```

## Assertions

| Check                                       | Result                |
| ------------------------------------------- | --------------------- |
| `AUDIT foreign` biotraxiq lines             | 5                     |
| lines containing `selected=0`               | 5                     |
| `DRY-RUN SELECT` lines                      | 0                     |
| DRY-RUN SELECT targeting biotraxiq          | **0**                 |
| false-positive shell scans (`exe=/bin/zsh`) | **0** after argv0 fix |
| Writes under actions-runner-biotraxiq       | **none**              |
| Overall                                     | **PASS**              |

## Script contract verified

- Real exe via `lsof` txt; leave-if-unsure on unresolved paths
- Act only under `/Users/paulo/actions-runner-wcdraft`
- Candidate match is argv0 `*/Runner.Worker` (not substring-in-command-line)
- Kill keys: orphan ppid=1 **or** log wedge signature; CPU never sole trigger
- PATH sanitise refuses any root outside wcdraft / containing biotraxiq
