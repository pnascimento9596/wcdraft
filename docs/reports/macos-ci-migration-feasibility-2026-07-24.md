# Migration feasibility — leave macOS self-hosted CI (2026-07-24)

Report only. **Migrate nothing** in this unit.

## Context

The ProcessInvoker wedge (`fork` → `nw_settings_child_has_forked`) is a property
of running a forking multithreaded CI agent on macOS. Two runners now share the
owner's daily-driver laptop (wcdraft + biotraxiq), so contention and blast
radius are both worse than previously assumed. Containment (watchdog) bounds
each wedge; it cannot make CI converge if wedges are frequent.

## 1. Does any wcdraft CI job actually require macOS?

**Short answer: No. No job requires macOS or Xcode today.**

Every workflow job uses `runs-on: [self-hosted, macOS, ARM64, wcdraft]`. That
label set is an **operational choice** (free self-hosted host), not a product
requirement derived from the job body.

| Workflow | Jobs | Real OS requirement |
| --- | --- | --- |
| `ci.yml` | `changes · path detector`, `static · format · contracts`, `typecheck · lint · test · build`, `golden RNG determinism`, `realism · asymmetric gate`, `ingest · identity-QA · determinism`, `db · ephemeral branch · …`, `rating · lock-file determinism`, `secrets · gitleaks`, `required · aggregate gates` | Linux or macOS. Node 22, pnpm, uv/Python, git, shell. |
| `etl.yml` | path detector, ingest/QA, rating-lock matrix (3.11/3.12/3.13) | Linux or macOS. Python + uv. |
| `nightly-heavy.yml` | Daily runway, realism N=2000×3, rating-lock matrix | Linux or macOS. |
| `marketing-x.yml` | marketing automation | Linux or macOS. |
| `production-db-migrate.yml` | prod migration (manual dispatch) | Linux or macOS. Neon CLI/API + Node. |

### Playwright WebKit

CI installs Playwright browsers explicitly:

```text
node apps/web/node_modules/playwright-core/cli.js install chromium webkit
```

The suite uses `playwright-core`'s **bundled** WebKit (`webkit.launch`), plus
Playwright device profiles named `"Desktop Safari"` for viewport/UA — **not**
system Safari and **not** Xcode WebKit. Playwright ships its own Linux WebKit
build. No Safari/system-WebKit dependency found in workflows.

### Python ETL matrix

`python-version: ["3.11", "3.12", "3.13"]` via `uv` — fully portable to Linux.

### PGlite

`@electric-sql/pglite` is used in **unit tests** (WASM Postgres). Runs on Linux
and macOS; no macOS-only dependency.

### Neon ephemeral branches

API + connection-string driven (`NEON_API_KEY`, `NEON_PROJECT_ID`). Host OS
irrelevant.

### `next build`

Standard Node build; Linux is the common production match (Vercel).

### `apps/mobile`

Explicitly **out of CI path filters** (`ci.yml` comments: free-tier Capacitor
only; must not appear under the default JS/CI change detector). **Xcode is not
invoked by any CI job today.**

## 2. What is hard-coded to this host?

| Item | Location | Notes |
| --- | --- | --- |
| Label set `self-hosted, macOS, ARM64, wcdraft` | All five workflows | Every job |
| Runner name `wcdraft-m4` | GitHub registration / LaunchAgent label `actions.runner.pnascimento9596-wcdraft.wcdraft-m4` | Host registration |
| `WCDRAFT_RUNNER_ROOT=/Users/paulo/actions-runner-wcdraft` | Watchdog plist + scripts | Absolute Mac path |
| `self-hosted-runner-hygiene` action | `.github/actions/` + every job | Assumes persistent runner `_work` / tool cache layout |
| Disk maintenance LaunchAgent | `com.wcdraft.runner-disk-maintenance` | Host-local; wcdraft `_work` free-space floor (~30 GiB) |
| Worker watchdog LaunchAgent | `com.wcdraft.runner-worker-watchdog` | Host-local; now path-scoped |
| Playwright cache key | `playwright-chromium-webkit-${{ runner.os }}-${{ runner.arch }}-…` | Portable; will rekey on Linux |
| Nightly runway job | `nightly-heavy.yml` | Same label set; stay-awake host required while on laptop |
| ARM64 | Labels + tool cache paths | Prefer Linux aarch64 or x86_64; lockfile is multi-platform pnpm |

No workflow references the string `wcdraft-m4` as a hostname; selection is by
**labels**. Scripts under `scripts/ci/` are generally POSIX; hygiene is the main
host-coupled surface.

## 3. Wall-clock risk

| Lane | M4 Pro (observed / stated) | Modest Linux host (estimate) |
| --- | --- | --- |
| Full verify (~typecheck/lint/test/build + goldens + related) | ~31 minutes | **Unknown precisely**; likely same order of magnitude on a 4–8 vCPU / 16 GiB box if disk is SSD and pnpm store is warm. Cold Playwright browser install adds minutes once. |
| Realism heavy N=2000×3 | Dominates nightly; CPU-bound | Scales with cores; a modest 4-vCPU box may be **slower** than M4 Pro. Flag as capacity risk, not correctness risk. |
| Rating-lock ×3 Python | Moderate | Fine on Linux |
| Neon ephemeral round-trip | Network-bound | Neutral |

Honest gap: **no measured Linux baseline in this repo**. Do not treat “faster on
Linux” as proven. The migration win is **reliability and isolation**, not
wall-clock.

Jobs that could become a problem on a weak Linux box: `realism` (nightly and
CI-config paths), full `verify` with Playwright cold cache. Not blockers for a
dedicated small always-on host with ≥4 cores and ≥16 GiB RAM.

## 4. Options (costed) + recommendation

| Option | Cost | Escapes fork hazard | Escapes daily-driver contention | Escapes stay-awake requirement | Notes |
| --- | --- | --- | --- | --- | --- |
| **(a) Linux VM on this Mac** (Virtualization.framework / UTM / Lima) | ~$0 | Yes | **No** (same laptop CPU/RAM/disk) | **No** | Still competes with biotraxiq and interactive work; laptop sleep still kills CI |
| **(b) Small always-on Linux box or VPS** (self-hosted runner) | Small recurring (hardware electricity or ~$5–20/mo VPS) | Yes | Yes | Yes | Matches project playbook: runner should not be the daily driver |
| **(c) Stay on macOS + corrected watchdog** | $0 | **No** | **No** | **No** | Containment only; already failed to converge once under load + co-tenant |

### Recommendation

**Prefer (b)** — a small always-on **self-hosted Linux** runner (mini PC or cheap
VPS), registered with labels such as `self-hosted, Linux, wcdraft` (and drop
`macOS`/`ARM64` requirements from workflows, or dual-label during transition).

Rationale:

1. The wedge is structural on macOS; watchdog rewrites do not fix it.
2. Co-tenancy with biotraxiq on the daily driver multiplies blast radius.
3. Playbook already wants the runner off the interactive machine.
4. **No CI job needs macOS/Xcode today** — migration is label + hygiene path work,
   not a product rewrite.

**(a)** is a reasonable interim experiment if hardware purchase/VPS is delayed,
but it does not fix contention or sleep.

**(c)** is acceptable only as short-term containment after the path-scoped
watchdog lands — not as the steady state.

### Cost rule (unchanged)

A self-hosted Linux host remains consistent with the standing cost rule: it is
**not** GitHub-hosted Actions minutes. That prohibition is untouched. Do not
move these jobs onto `ubuntu-latest` billable minutes without an explicit
policy change.

## Implementation sketch (not in this unit)

1. Provision Linux host; install runner; labels `self-hosted, Linux, wcdraft`.
2. Change `runs-on` in all five workflows (or add Linux labels and keep macOS
   as fallback briefly).
3. Retarget hygiene/disk scripts to Linux paths; retire macOS LaunchAgents on
   the laptop for wcdraft.
4. Warm Playwright cache once; run one full CI + one nightly heavy.
5. De-register `wcdraft-m4` only after green parallel proof.

## Evidence sources

- `.github/workflows/{ci,etl,nightly-heavy,marketing-x,production-db-migrate}.yml`
- `apps/web/package.json` Playwright scripts; `playwright-core` install step in `ci.yml`
- `docs/runbooks/assets/runner-worker-watchdog/DIAGNOSIS-worker-cpu-spin-2026-07-24.md`
- Dry-run: `docs/reports/watchdog-dryrun-zero-biotraxiq-2026-07-24.md`
