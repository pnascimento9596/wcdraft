# Disk reclaim — Tier 1 + Tier 2 (minus RepoPrompt) + grok worktrees

**Date:** 2026-07-18  
**Runner host:** `wcdraft-m4`  
**Base:** `origin/main` `dca08420fa57ff7595d7f7a0997671540e07faf4` (PR #315) — verified ancestor  
**Disposable clone:** `/tmp/wcdraft-reclaim-tier1-82033` branch `ws-ci/disk-reclaim-tier1`  
**Preflight:** `/tmp/u0-reclaim-preflight.md`  
**Receipts:** `/tmp/reclaim-receipts-20260718/` (+ `INDEX.sha256`)

---

## Executive summary

| Metric | Value |
| --- | ---: |
| Free before | **69.05 GiB** (72,397,148 KiB) |
| Free after (host main) | **~115.7 GiB** (121,279,472 KiB at host-main sample; later ~117+ after PW/hygiene) |
| Net free gain | **~46+ GiB** |
| Expected if zero vetoes | 95–100 GiB free |
| Actual vs expectation | Lower than 95–100 because **prepurge (5.9G)** and **~17G grok** were vetoed |

Repo lane ships a CI **hygiene install drift guard** (`HYGIENE_INSTALL_DRIFT`) with fixture red control. Host reclaim is receipts-only (no product commits).

Live anchors: engine `engine-2026.07.18-basis-aware-tiering` — unchanged by this lane (verified at live-verify if ship completes).

---

## Preflight table (U0 re-measure)

| Target | Size | Verdict | Evidence |
| --- | ---: | --- | --- |
| Playwright superseded (user+runner) | ~1.87 GiB | **DELETE** | absent from `playwright-core@1.61.1` browsers.json (keep 1228/2311/1011) |
| Hygiene install | n/a | **DRIFT** then reinstall | installed `9e589fb4…` ≠ main `e4411630…` |
| `wcdraft-old-prepurge` | 5.9 GiB | **VETO** | 10 stashes; 8 no-upstream refs; `ws-merit/v4-diag` ahead 1 |
| grok ap-audit (6) | 4.0 GiB | **VETO** | dirty |
| grok biotraxiq (21) | 8.5 GiB | **VETO** | stash ± dirty |
| grok wcdraft/grok-lane-2 | 0.57 GiB | **DELETE** | clean |
| grok wcdraft/layer-4-audit | 0.46 GiB | **DELETE** | clean |
| grok wcdraft other 6 | ~4.9 GiB | **VETO** | dirty |
| opencode live DB | 14 GiB | **UNTOUCHED** | quick_check=ok; open by pid |
| opencode backup | 11 GiB | **DELETE** | distinct file; not open |
| Docker prune path | (in-VM) | **OK** | 2 healthy containers; linked vols survive |
| Trash | 8.8 GiB | **EMPTY** | top-level listed in receipt |
| npm cache | 9.2 GiB | **DELETE** (user-owned) | 26 root-owned residual files blocked full `npm cache clean` |
| `.next` ×3 | 5.6 GiB | **DELETE** | no next processes |

§1 prohibitions re-checked: none targeted.

---

## Host reclaim (§5) — freed bytes (content)

| Item | Preflight size | Freed (approx) | Notes |
| --- | ---: | ---: | --- |
| Trash empty | 8.8 GiB | ~8.8 GiB content / ~5.3 GiB df first sample | APFS df lag |
| Docker volume prune -a + image prune | large unused set | host free +~16.5 GiB at sample | linked vols intact; containers healthy |
| fstrim | — | **datadisk file still 30 GiB** | honest sparse-image non-shrink |
| npm user cache | 9.2 → 0.19 GiB | ~8.9 GiB | 26 root-owned files remain (sudo needed) |
| prepurge | 5.9 GiB | **0 (VETO)** | preserved |
| opencode backup | 11 GiB | ~11 GiB | live DB untouched |
| grok authorized | ~1.03 GiB | ~1.03 GiB | 2 nested only |
| grok vetoed | ~17 GiB | **0** | preserved with receipts |
| `.next` ×3 | 5.6 GiB | ~5.6 GiB | `.next` only |

---

## Docker before/after

**Containers (before and after):** `ap-audit-s6-pg`, `biotraxiq-proj-repro` — Up (healthy).  
**Linked volumes surviving prune:** `ap-audit-s6-pgdata`, `biotraxiq-proj-repro-pgdata` (only 2 volumes remain post-prune).  
**Image prune reclaim (Docker report):** 1.071 GB dangling layers.  
**Host datadisk:** `32212254720` bytes before and after fstrim — **no shrink** (known sparse-image behavior).  
**Host free delta during docker step:** +17,296,756 KiB (~16.5 GiB) — space returned from volume content even though the sparse file size is unchanged.

---

## Repo lane (§4)

### 4.1 Playwright

Deleted revisions 1208/1223/webkit-2287 from both caches (total 1,914,048 KiB). Kept chromium-1228, headless-shell-1228, webkit-2311, ffmpeg-1011.

**Rehydration proof:**
```
RESOLVE_OK browser=chromium version=149.0.7827.55 body=ok
RESOLVE_OK browser=webkit version=26.5 body=ok
```
Responsive-shell production smoke (Chromium engine): `responsive-shell-fit: ok` — desktop 84, mobile 56, interactions 40, mode-setup 30, mobile-nav 8 (218/218); narrow-collisions 264/264 engines=2. WebKit engine: `responsive-shell-fit: ok` 218/218 + narrow-collisions 264/264 engines=2 (same harness).

### 4.2 Hygiene reinstall

Installer: `scripts/ci/install-runner-disk-maintenance.sh install` from disposable clone.  
SHA before → after: `9e589fb4…` → `e4411630…` (matches HEAD).  
Kickstart/residue audit: `runner-hygiene: unmarked-residue-audit count=29` (report-only warnings; maintenance `PASS hygiene-completed`).

### 4.3 Drift guard

| Piece | Path |
| --- | --- |
| Check | `scripts/ci/check-hygiene-install-drift.sh` |
| Contract test | `scripts/ci/check-hygiene-install-drift.test.sh` |
| CI hooks | `ci.yml` — contract probe + live check after existing maintenance probes |

**Mechanism:** SHA-256 of repo `scripts/ci/{self-hosted-runner-hygiene,runner-disk-maintenance}.sh` vs installed files under `$WCDRAFT_RUNNER_ROOT/wcdraft-maintenance`. Mismatch or missing install (when required) → exit 1 with **`HYGIENE_INSTALL_DRIFT`**. Unreachable install root → skip when require=0.

**Red control (measured):** fixture appends a comment to hygiene script → exit 1, stderr contains `HYGIENE_INSTALL_DRIFT`. Live install never desynced for the control.

---

## Vetoed items (owner call only if desired later)

1. **`~/Projects/wcdraft-old-prepurge`** — stashes + upstream-less refs + unpushed commit  
2. **All grok nests under `projects-ap-audit-portal` and `projects-biotraxiq`** — dirty/stash  
3. **Six dirty `projects-wcdraft` nests** — untracked audit artifacts  
4. **26 root-owned files under `~/.npm`** — needs `sudo chown` (not escalated)

---

## Receipts index

Directory: `/tmp/reclaim-receipts-20260718/`  
SHA-256 index: `/tmp/reclaim-receipts-20260718/INDEX.sha256`  

Classes present: `trash-empty`, `docker-volume-prune`, `docker-image-prune`, `docker-fstrim`, `npm-cache`, `opencode-backup`, `prepurge-veto`, `grok-worktree`, `grok-worktree-veto`, `next-cache`, `playwright-superseded`, `hygiene-install`.

---

## HUMAN ACTIONS

- **None required** for authorized work that passed preflight.  
- Optional later: owner decision on vetoed prepurge/grok trees; `sudo chown -R $(id -u):$(id -g) ~/.npm` then `npm cache clean --force` for residual root-owned cache files.
