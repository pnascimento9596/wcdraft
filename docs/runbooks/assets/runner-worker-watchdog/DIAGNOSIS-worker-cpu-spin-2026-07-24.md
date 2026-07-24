# Runner.Worker 99% CPU spin — diagnosis (2026-07-24)

## Symptom

`Runner.Worker spawnclient` burns ~100% CPU for minutes to hours. Parent may die
and leave an **orphan** (ppid=1) that never exits. GitHub Actions jobs appear
stuck (often on Setup Node / early steps) with no product progress.

## Signature (infrastructure wedge)

1. ProcessInvoker logs `Starting process:` for a step binary (`setup-node`, bash, …).
2. **Never** logs `Process started with process id … waiting for process exit`.
3. Worker then only emits `HostContext Well known directory` every ~10 s.
4. Host `sample(1)` shows a managed busy-loop (no blocking syscall), not compile/test work.
5. Force-stopping the service can leave Workers reparented to launchd (ppid=1).

## Evidence (this host)

| Episode   | Job                                       | Notes                                                 |
| --------- | ----------------------------------------- | ----------------------------------------------------- |
| Overnight | CI Setup Node (golden lane)               | ~6 936 Well-known lines after failed spawn transition |
| Afternoon | nightly-heavy `rating lock · Python 3.13` | Same signature; event=`schedule` (not manual)         |

## What this is — and is not

This hang signature is a **long-standing, version-independent self-hosted runner
failure class**. Public reports of the same pattern span runner versions from
the 2.28x series through 2.31x (and beyond), Linux and macOS, 2020–2024
(actions/runner issues #679, #1377, #1496, #3611; community discussions).

**Rejected on evidence (do not re-open without new proof):**

- **Not** a confirmed 2.336.0 regression — the signature predates this version by years.
- **Not** attributed to `useV2Flow` — no causal evidence; the failure class appears
  with and without V2-era deployments in public reports.
- **Do not pin an older runner** — inherits the same failure class and fights
  self-hosted auto-update.

We **do not claim a proven upstream root cause** beyond the ProcessInvoker
spawn/wait wedge signature. The controlled answer on a single free self-hosted
Mac is operational: detect and kill the wedge quickly.

## Fix (host)

| Control                                                              | Role                                                                                                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Clean PATH in LaunchAgent + `.path` (re-written every watchdog tick) | Removes interactive agent PATH pollution (codex/grok/opencode shims) that survived into `runsvc` via `.path`                           |
| `runner-worker-watchdog.sh` every 60s                                | Kill ppid=1 Workers; kill CPU ≥90% for 3 consecutive samples (~3 min); **log every kill** to `kills.log` with pid/ppid/cpu/job context |
| Version-controlled runbook                                           | `docs/runbooks/self-hosted-runner-worker-watchdog.md`                                                                                  |

A multi-hour silent wedge becomes a ~3-minute self-healing event. That is the
fix, not a version pin.

## Infrastructure vs product

A CI job exhibiting this signature (or a recorded watchdog kill) is an
**infrastructure failure**, not a product gate FAIL. Re-run once; never
fix-forward product code against it; never auto-revert production on it.
See `Claude.md` / `Agents.md` standing rule.
