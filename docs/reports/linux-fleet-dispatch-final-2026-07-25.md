# Final report — Linux ephemeral fleet dispatch (2026-07-25)

## Outcome

**SHIPPED.** PR #328 squash-merged to `main` as `3b63fe5` (2026-07-25T16:39:13Z).  
Production live-verify: `https://www.wcdraft.com/` and `/play` → **HTTP 200**.  
Phase 5: **macOS `wcdraft-m4` retired** after 3 consecutive full greens.  
Phase 6: always-on gaps documented (report-only).  
**biotraxiq never touched.**

## Gates (real)

| Gate                   | Evidence                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------- |
| PR CI (HEAD `db05ab1`) | run `30165903504` **success**                                                       |
| PR ETL                 | run `30165903503` **success**                                                       |
| Independent Red review | PASS on `db05ab1` (re-executed CI/ETL + runner inventory)                           |
| Main full CI #1        | run `30166057521` attempt 1 **success** (all jobs incl. golden, realism N=2000, db) |
| Main full CI #2        | same run attempt 2 **success**                                                      |
| Main full CI #3        | same run attempt 3 **success**                                                      |
| Live                   | home + play 200 after production deploy `3b63fe5`                                   |

## What changed

- Colima ephemeral arm64 Docker GHA fleet: labels `self-hosted,wcdraft-linux`
- Host supervisors `/Users/paulo/runners/wcdraft/` — REPLICAS=4, MEM=4096m, image 1.0.3
- All workflows `runs-on: [self-hosted, wcdraft-linux]`
- Chromium-only under container caps: collisions, one-screen, native-app-feel
- `turbo.json` env allowlist for Playwright/collision/native-feel vars
- `TURBO_CONCURRENCY=1`, vitest 1 worker / threads on Linux verify
- Short-viewport mode-select CSS + 1px width subpixel slack for one-screen
- Phase 6 gap report: salt-map ops continuity, pg_dump, PAT mint, capacity, WebKit hole

## Phase checklist

| Phase                      | Status                                               |
| -------------------------- | ---------------------------------------------------- |
| 0 Access enumeration       | done                                                 |
| 1 Colima + ephemeral fleet | done                                                 |
| 2 Non-negotiables + wedge  | done (proof green)                                   |
| 3 Workflow adaptation      | done                                                 |
| 4 PR #325/#326             | already merged earlier; #328 shipped                 |
| 5 Retire macOS + watchdog  | done (3 full greens → m4 deleted, watchdog unloaded) |
| 6 Always-on gaps report    | done (no implement)                                  |

## Risks / carryovers

1. **WebKit not on default CI** — Safari-only regressions need a future scheduled job or product acceptance.
2. **Host PAT expiry** — supervisors fail to re-register; monitor `failed to mint registration token`.
3. **Colima capacity** — concurrent heavy jobs can approach 4 GiB caps; keep concurrency low.
4. **Nightly heavy** failed earlier on main (`30165238780`) — separate from fleet merge; investigate if still red.
5. **Disk maintenance launchd** (`com.wcdraft.runner-disk-maintenance`) still loaded — host hygiene for leftover paths; optional later cleanup.

## Open questions

- Accept Chromium-as-proxy for layout permanently, or budget a WebKit lane?
- Explicit Neon backup acceptance vs scheduled logical export (see Phase 6 report)?

## Non-actions honored

- No reboot; no biotraxiq changes; Track2 Lima cancelled earlier; pin-test supersede; Phase 6 report-only.
