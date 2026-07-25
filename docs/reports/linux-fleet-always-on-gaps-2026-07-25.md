# Always-on gaps after Linux ephemeral fleet (Phase 6 — report only)

**Date:** 2026-07-25  
**Scope:** Post-fleet CI on Colima arm64 Linux runners (`wcdraft-linux`).  
**Mode:** Report only — no implementation in this document.

## Context

CI for `wcdraft` now targets labels `self-hosted, wcdraft-linux` on an ephemeral
Docker fleet under Colima (host supervisors: `/Users/paulo/runners/wcdraft/`).
Native macOS runner retirement is gated on consecutive full greens after merge.

## Gaps (do not implement here)

### 1. Daily seed salt-map runway automation host

**What exists:** `nightly-heavy.yml` job `daily seed salt map · runway` plus
`packages/data/scripts/daily-seed-runway.mjs` inspect / plan-pr / validate paths.
Contract probes in `ci.yml` assert workflow wiring.

**Gap:** After macOS retirement, the nightly job must continue to land on a live
`wcdraft-linux` runner **and** retain write privileges (PAT / `GITHUB_TOKEN`
permissions for branch + PR). Ephemeral runners do not persist `_work` between
jobs; any local cache assumptions for salt-map rebuild must use Actions cache or
regenerate fully each night.

**Risk if ignored:** Missed night is “benign” per design only if the next run
still evaluates the full runway; a permanent runner-label or auth miss stalls
salt-map PR automation.

**Suggested owner later:** ops + data (not fleet implementer).

### 2. Production Postgres backup (`pg_dump`) path

**What exists:** Neon-oriented restore / rollback runbooks
(`docs/runbooks/neon-restore-vercel-rollback.md`, prod migration failure docs).
No committed, scheduled, host-local `pg_dump` of production was verified as part
of this fleet cutover.

**Gap:** Always-on DR still depends on Neon’s platform backups + manual runbook
steps. There is no fleet-side cron that:

- runs `pg_dump` / logical export against a **read-only** production branch,
- stores encrypted artifacts off-host,
- exercises restore to a throwaway Neon branch on a schedule.

**Risk if ignored:** Platform-only backup is acceptable only if Neon RPO/RTO and
account access are explicitly accepted. Host-fleet CI does not substitute for DB
backup.

**Suggested owner later:** ops + db (explicit acceptance or implement backup job).

### 3. Host PAT / registration-token continuity

**What exists:** Supervisors mint registration tokens via `gh auth` /
`GITHUB_HOST_TOKEN` in `/Users/paulo/runners/wcdraft/.registration.env`.

**Gap:** OAuth/keyring expiry (seen 2026-07-25) stops ephemeral re-registration
after job completion → jobs queue forever on dead labels.

**Risk if ignored:** Fleet looks “up” (containers) but cannot pick jobs.

**Suggested owner later:** ops — document rotation + alerting on
`failed to mint registration token` supervisor log lines.

### 4. Colima capacity vs concurrent heavy jobs

**What exists:** Default stack `REPLICAS=4`, `MEM_LIMIT=4096m`, `CPU_LIMIT=2` on
~16 GiB Colima. Verify job uses `TURBO_CONCURRENCY=1`, `VITEST_MAX_WORKERS=1`,
Chromium-only browser matrix.

**Gap:** Concurrent CI + ETL + proof + ap-audit containers can still pressure
the host. No autoscaling; no job-level “heavy” label separating 4 GiB verify
from light jobs.

**Risk if ignored:** Intermittent exit 137 under multi-workflow spikes.

### 5. WebKit coverage hole on Linux CI

**What exists:** Linux verify forces Chromium for collisions, one-screen, and
native-app-feel to avoid WebKit OOM.

**Gap:** WebKit layout/native-app-feel is no longer exercised on the default CI
path. macOS retirement removes the last free WebKit host unless a future
job/label reintroduces it.

**Risk if ignored:** Safari-only regressions land undetected.

**Suggested owner later:** web/ux — optional scheduled WebKit job on a larger
host, or accept Chromium-as-proxy with explicit product sign-off.

### 6. Lima / pin-test residue

**What exists:** Dispatch cancelled Track2 Lima VM; pin runner left at 2.335.1
on macOS path. Host may still have leftover Lima processes from earlier work.

**Gap:** Confirm no `wcdraft-linux` Lima instance or pin-test label matrix PRs
remain active; avoid dual fleets fighting for the same host CPU.

## Non-gaps (verified directionally)

- Ephemeral registration + labels `wcdraft-linux` are the intended CI surface.
- Proof workflow (`linux-fleet-proof`) exists for non-negotiable probes.
- Salt-map **logic** and runway **policy** are already in-repo; the gap is
  operational continuity after host changes, not missing product code.
- Neon restore runbooks exist; the gap is scheduled export drills, not total
  absence of recovery docs.

## Explicit non-goals of this report

- Implementing salt-map host changes
- Implementing `pg_dump` cron
- Retiring macOS (Phase 5 — separate gate after 3 full greens)
- Changing Neon plan or Vercel config
