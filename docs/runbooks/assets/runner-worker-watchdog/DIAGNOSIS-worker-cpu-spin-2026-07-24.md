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

## Root mechanism (macOS + fork)

Captured stacks identify this precisely: `fork` → `nw_settings_child_has_forked`.

`nw_settings_child_has_forked` is Apple's **Network.framework** `pthread_atfork`
**child** handler. The GitHub Actions runner is a multithreaded .NET process.
When it forks to spawn a step:

- POSIX preserves **only the forking thread** in the child.
- Any mutex held by another parent thread stays locked, with **no thread alive
  to release it**.
- macOS makes this structurally worse than Linux: libdispatch, Foundation,
  CoreFoundation, and Network.framework are all **fork-unsafe**. A fork on
  macOS is only safe if the child immediately `exec`s or touches nothing but
  async-signal-safe syscalls in between.
- Here the child wedges **inside the atfork handler** before reaching `exec`.
- The parent therefore never logs `Process started with process id` and spins
  while heartbeating `Well known directory`.

This is a property of running a forking multithreaded CI agent on macOS. It
will recur on this Mac and on any Mac. It is **not** a product defect in
wcdraft application code.

## Multi-tenant host constraint

This machine also hosts an **unrelated** self-hosted runner under
`/Users/paulo/actions-runner-biotraxiq/` (biotraxiq). That runner is production
infrastructure for another project and is frequently running healthy jobs at
high CPU.

**Absolute rules for any agent or operator on this host:**

- Scope every kill/signal by **resolved executable path** under
  `/Users/paulo/actions-runner-wcdraft/` only.
- Never `pkill -f Runner.Worker`, never `killall`, never name-only process sweeps.
- Never modify biotraxiq's `.path`, `.env`, LaunchAgent, `_work`, or service.
- High CPU alone is **not** a wedge — a healthy build pegging a core for minutes
  is ordinary and indistinguishable from a wedge by CPU.

## Evidence (this host)

| Episode   | Job                                       | Notes                                                                  |
| --------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| Overnight | CI Setup Node (golden lane)               | ~6 936 Well-known lines after failed spawn transition                  |
| Afternoon | nightly-heavy `rating lock · Python 3.13` | Same signature; event=`schedule` (not manual)                          |
| Track A   | ETL path detector / aggregate gates       | Unscoped CPU watchdog killed workers mid-job; biotraxiq co-tenant live |

## What this is — and is not

This hang signature is a **long-standing, version-independent self-hosted runner
failure class**, worsened on macOS by fork-unsafe system frameworks. Public
reports of similar ProcessInvoker spawn wedges span runner versions from the
2.28x series through 2.31x (and beyond), Linux and macOS, 2020–2024
(actions/runner issues #679, #1377, #1496, #3611; community discussions).

**Rejected on evidence (do not re-open without new proof):**

- **Not** a confirmed 2.336.0 regression — the signature predates this version by years.
- **Not** attributed to `useV2Flow` — no causal evidence; the failure class appears
  with and without V2-era deployments in public reports.
- **Do not pin an older runner** — inherits the same failure class and fights
  self-hosted auto-update.
- **Not solved** by the watchdog — see below.

## Containment (host) — not a fix

| Control                                                 | Role                                                                                                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Clean PATH in LaunchAgent + `.path` (wcdraft root only) | Removes interactive agent PATH pollution (codex/grok/opencode shims) that survived into `runsvc` via `.path`                                                       |
| `runner-worker-watchdog.sh` every 60s (path-scoped)     | Reap **wcdraft** orphans (ppid=1); kill only on **log wedge signature** (incomplete spawn + Well-known heartbeats past threshold); never CPU-only; never biotraxiq |
| Version-controlled runbook                              | `docs/runbooks/self-hosted-runner-worker-watchdog.md`                                                                                                              |

**The watchdog is containment, not a fix.** It bounds each wedge so a multi-hour
silent hang becomes a several-minute self-healing event, but it **cannot make CI
converge** if wedges are frequent. Do not document this problem as solved. A
durable fix is architectural: stop running the forking multithreaded agent on
macOS (Linux self-hosted host/VM), not a tighter kill heuristic.

## Infrastructure vs product

A CI job exhibiting this signature (or a recorded **wcdraft** watchdog kill) is
an **infrastructure failure**, not a product gate FAIL. Re-run once; never
fix-forward product code against it; never auto-revert production on it.
See `Claude.md` / `Agents.md` standing rule.
