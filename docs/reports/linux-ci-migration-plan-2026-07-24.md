# Executable plan — migrate wcdraft CI to self-hosted Linux (2026-07-24)

**Status:** ready for owner approval as a single dispatch. **Do not execute** until approved.  
**Why now:** macOS ProcessInvoker fork/atfork wedges prevent CI convergence on the shared daily-driver Mac; Daily salt-map refresh depends on this runner.

**Feasibility evidence:** `docs/reports/macos-ci-migration-feasibility-2026-07-24.md`  
**Standing cost rule (unchanged):** self-hosted runner minutes are free; do **not** move jobs to GitHub-hosted `ubuntu-latest` billable minutes without an explicit policy change.

---

## 0. Decision gates

| Gate         | Criteria                                                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Approve host | Owner picks **always-on Linux box/VPS** (recommended) vs Linux VM on Mac (interim only)                                                                |
| Arch         | **x86_64** (cheapest VPS, broadest binary support) **or** **aarch64** (Apple Silicon VM / Ampere). Both work; pick one and stick to it for tool caches |
| Labels       | New: `self-hosted, Linux, wcdraft` (+ `X64` or `ARM64` to match host). Drop `macOS` from required set                                                  |
| Success      | One full PR CI green + one nightly-heavy green on Linux; then decommission `wcdraft-m4`                                                                |

---

## 1. Exact workflow `runs-on` changes

Replace **every** occurrence of:

```yaml
runs-on: [self-hosted, macOS, ARM64, wcdraft]
```

with:

```yaml
runs-on: [self-hosted, Linux, wcdraft]
# optional arch pin once host known:
# runs-on: [self-hosted, Linux, X64, wcdraft]   # or ARM64
```

| File                                          | Job count (approx) | Notes                                                                                               |
| --------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`                    | 10 jobs            | path detector, static, verify, golden, realism, etl, db ephemeral, rating lock, gitleaks, aggregate |
| `.github/workflows/etl.yml`                   | 3                  | changes, ingest, rating-lock matrix                                                                 |
| `.github/workflows/nightly-heavy.yml`         | 3                  | daily runway, realism heavy, rating-lock matrix                                                     |
| `.github/workflows/marketing-x.yml`           | 1                  |                                                                                                     |
| `.github/workflows/production-db-migrate.yml` | 1                  | manual prod migration                                                                               |

**Cutover strategy (recommended):** dual-label transitional PR:

1. Register Linux runner with labels `self-hosted, Linux, wcdraft` (and arch).
2. Change workflows to `runs-on: [self-hosted, Linux, wcdraft]` in one PR.
3. Keep macOS runner registered but **without** the `wcdraft` label (or offline) so nothing schedules there.
4. Rollback: re-add `macOS, ARM64` to `runs-on` and re-label `wcdraft-m4` with `wcdraft`.

Do **not** leave both macOS and Linux matching the same label set (split-brain).

---

## 2. ARM64 vs x86_64 — native dependencies

| Surface                    | Decision                                                                 |
| -------------------------- | ------------------------------------------------------------------------ |
| Node 22 + pnpm             | Official builds both arch; use `actions/setup-node` or runner tool cache |
| Python 3.11–3.13 via `uv`  | Official wheels both arch                                                |
| Playwright chromium/webkit | Official browser builds both; **install Linux system deps** (below)      |
| PGlite                     | WASM; arch-neutral                                                       |
| Neon CLI / API             | Arch-neutral (Node/HTTP)                                                 |
| `pnpm-lock.yaml`           | Multi-platform; cold install on new arch is fine                         |
| Optional native addons     | None required by CI today for shipped paths                              |

**Recommendation:** **x86_64 VPS** unless reusing an existing ARM box — fewer surprises for random npm optional deps.

---

## 3. Playwright Linux system dependencies

After `pnpm install`, CI already runs:

```bash
node apps/web/node_modules/playwright-core/cli.js install chromium webkit
```

On a bare Linux host, **once per machine** (or in runner bootstrap):

```bash
# Debian/Ubuntu example — use Playwright's own installer:
sudo npx playwright install-deps chromium webkit
# or: node apps/web/node_modules/playwright-core/cli.js install-deps chromium webkit
```

WebKit here is **Playwright’s bundled Linux WebKit**, not system Safari. No Xcode.

Cache key already includes `${{ runner.os }}-${{ runner.arch }}` — will rekey cleanly.

---

## 4. Runner hygiene + disk maintenance move

| Host component                                    | Action                                                                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `.github/actions/self-hosted-runner-hygiene`      | Keep; verify paths (`RUNNER_TEMP`, `RUNNER_TOOL_CACHE`, workspace under `_work`) on Linux — scripts are POSIX                       |
| `scripts/ci/self-hosted-runner-hygiene.sh`        | Smoke-test on Linux once; fix only if macOS-only utilities appear                                                                   |
| `com.wcdraft.runner-disk-maintenance` LaunchAgent | **Replace** with systemd timer or cron on Linux (same free-space floor ≥30 GiB on `_work`)                                          |
| `com.wcdraft.runner-worker-watchdog`              | **Do not port CPU/log macOS watchdog as a “fix”.** Optional Linux orphan reap only; fork wedge is the macOS Network.framework class |
| Absolute `/Users/paulo/actions-runner-wcdraft`    | Retire; document `WCDRAFT_RUNNER_ROOT` for Linux path                                                                               |

---

## 5. Nightly runway job (`nightly-heavy.yml`)

- Same `runs-on` label change.
- Requires host **always-on** (or awake overnight) — this is a primary reason to leave the laptop.
- Secrets: `TURBO_*`, GitHub token for opening automation PR `automation/daily-seed-salt-map-refresh`, any existing workflow secrets — copy to runner env / org secrets as today.
- After cutover: confirm one scheduled run creates/updates refresh PR when `remaining_days ≤ 21`.

---

## 6. Provision + register self-hosted Linux host

### 6.1 Hardware / VPS sketch

| Spec | Minimum                | Comfortable                        |
| ---- | ---------------------- | ---------------------------------- |
| CPU  | 4 vCPU                 | 8 vCPU (realism N=2000)            |
| RAM  | 8 GiB                  | 16 GiB                             |
| Disk | 80 GiB SSD             | 120 GiB+ (tool cache + Playwright) |
| OS   | Ubuntu 22.04/24.04 LTS | same                               |

### 6.2 Bootstrap (outline)

1. Create user `github-runner` (or `paulo`); no interactive agent PATH pollution in service env.
2. Install: `git`, `curl`, `build-essential`, `python3`, `unzip`; Node via nodesource or fnm; `pnpm` via corepack; `uv` for Python.
3. Download GitHub Actions runner for linux-x64 (or arm64); extract to e.g. `/opt/actions-runner-wcdraft`.
4. Register:

   ```bash
   ./config.sh --url https://github.com/pnascimento9596/wcdraft \
     --token <REGISTRATION_TOKEN> \
     --name wcdraft-linux-1 \
     --labels self-hosted,Linux,wcdraft,X64 \
     --work _work
   ```

5. Install as **systemd** service (`./svc.sh install && ./svc.sh start`) — not a laptop LaunchAgent.
6. Write clean service `PATH` (no codex/grok/opencode): `/usr/local/bin:/usr/bin:/bin`.
7. Run `playwright install-deps` once; warm `pnpm fetch` optional.
8. Prove: `gh api …/actions/runners` shows online + labels.

---

## 7. Cutover sequence

1. **Provision + register** Linux runner (labels without stealing `wcdraft` yet, or with `wcdraft` while macOS is **offline**).
2. **Land label PR** changing all five workflows’ `runs-on` (Yellow/Green docs+CI config — treat as Red if it breaks CI routing).
3. **Offline or unlabel** `wcdraft-m4` (`./svc.sh stop`; remove `wcdraft` label in GitHub UI or reconfig).
4. **Re-run #325** (or any open PR) on Linux; require green including **golden RNG**.
5. **Nightly:** wait for schedule or `workflow_dispatch` nightly-heavy; confirm runway job + realism.
6. **Decommission Mac runner:** remove LaunchAgents for wcdraft runner + watchdog + disk maintenance; leave biotraxiq untouched.
7. **Update runbooks** (`self-hosted-runner-worker-watchdog.md` → Linux ops or “macOS retired”).

### Rollback

1. Stop Linux runner (or remove `wcdraft` label).
2. Re-label/start `wcdraft-m4` with `self-hosted,macOS,ARM64,wcdraft`.
3. Revert `runs-on` commit on `main` (or emergency PR).
4. Expect macOS wedge risk to return — rollback is availability, not health.

---

## 8. Wall-clock risk (~31 min verify on M4 Pro)

| Lane                  | M4 Pro (known)    | Modest Linux (4–8 vCPU)                                                                                      |
| --------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------ |
| Full verify + goldens | ~31 min           | **Unknown** — expect same order of magnitude if SSD + warm caches; cold Playwright install adds minutes once |
| Realism N=2000×3      | Dominates nightly | May be **slower** on 4 vCPU; not a correctness blocker                                                       |
| Rating-lock ×3 Python | Moderate          | Fine                                                                                                         |
| Neon ephemeral        | Network-bound     | Neutral                                                                                                      |

Record first green Linux wall-clock in the migration PR report. Do not promise “faster than M4.”

---

## 9. Acceptance checklist (dispatch definition of done)

- [ ] Linux runner online with intended labels
- [ ] All five workflows use Linux label set; no job still requires `macOS`
- [ ] Playwright chromium+webkit green on Linux
- [ ] Golden RNG + draft + data + leaderboard goldens green
- [ ] Ephemeral Neon job green (when path-selected)
- [ ] One nightly-heavy green (or forced dispatch)
- [ ] `wcdraft-m4` offline; biotraxiq untouched
- [ ] Runbooks updated; Daily runway automation path verified

---

## 10. Out of scope for the migration dispatch

- Product code changes for Track A (#325)
- GitHub-hosted Actions minutes
- Moving `apps/mobile` into CI
- “Fixing” macOS fork via more watchdog heuristics
