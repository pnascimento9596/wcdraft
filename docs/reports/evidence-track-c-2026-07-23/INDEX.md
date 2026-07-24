# Evidence Track C — Index

**Date:** 2026-07-23  
**Base:** `origin/main` @ `a1beaaaaa2fe0377128d0b1434aa47d2bda5adca`  
**Risk:** Green (docs + measurement scripts only; no product behaviour change)  
**Lane rule:** measurement only — reports decide which Red/Yellow lanes are worth opening.

## One-line verdicts

| Unit                             | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **C1** Offer clustering          | **SEVERE residual; not fixable by estimate-card ratings alone.** Career Δ≤2 remains **74.49%** (unchanged). Current moved modestly after basis-tiering fix. Estimates appear in ~31–42% of Career ties but **pool-excluding the 927 estimate cards worsens** Δ≤2 to **83.68%**. Constructor extracts only **~36%** of remaining-squad OVR spread — **offer construction is the primary lever**; ratings cannot invent signal for estimates and do not address the measured mid-band density the constructor is selecting into. |
| **C2** `Rating.components[]`     | **PROCEED on size/parse bar; runtime sim/offer path does not read components.** Static: zero runtime reads in `apps/web` + `packages/core`. Dynamic: canary zero flips + Daily golden PASS with components stripped. Decoded pool −**74.1%**, host parse −**~200–331 ms**, contended proxy −**~838 ms** (bar was ≥15% decoded or ≥100 ms throttled). Offline integrity tests _do_ read `components` (manual-override flag) — schema drop must rehome that check.                                                               |
| **C3** Current-basis duplication | **Duplication is real and dominated by `components`.** Equal Career/Current field copies ≈ **29.5 MB** decoded with components, collapsing to ≈ **4.2 MB** without. **Sequence C2 before any delta-encoding Red lane** — otherwise C3 arithmetic is mostly components noise. Residual non-component duplication (identity + provenance) may still justify a later encoding lane after C2.                                                                                                                                      |
| **C4** q-003 residual rows       | **NON-ZERO (1 ranked row).** `VALIDATE CONSTRAINT` is **not** safe without remediating `leaderboard_entries.id=4dc1df8e-…` (2026-06-21, `attempt_id` NULL, pre-binding). q-003 “server-issued ranked attempts deferred” is **stale** — issuance shipped in Season 1 (B1/B2); entry corrected.                                                                                                                                                                                                                                  |

## Owner two-minute read (C1 decision)

**How much residual clustering is fixable by ratings / construction / data floor?**

1. **Data-availability floor (estimates):** ~927 Career estimate cards. They participate in **~33–39% of Δ≤1/Δ≤2 tied offers**, but **removing them from the pool increases clustering**. Spreading them by fiat would fabricate signal. Treat as undeclusterable **noise**, not the main driver.
2. **Offer construction:** Observed mean spread **7.73** vs remaining-squad pool **21.14** (ratio **0.36**). Every measured offer left ≥2 OVR of squad separation on the table. **This is the lever that can move player-visible spread without inventing ratings.**
3. **Ratings among measured cards:** Residual after estimate exclusion is still high (post-hoc signal Δ≤2 **71.75%**; pool-exclude Δ≤2 **83.68%**). A rating decluster among measured cards could help **only where public facts actually separate players**; it cannot replace construction reform and must not target estimate cards.

## Artifacts

| Path                                                                                                                                          | Role                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `C1-offer-clustering.md` + `choose3-clustering-remeasure.summary.json` + `choose3-construction-attribution.json`                              | Clustering remeasure + attribution                    |
| `C2-components-reachability.md` + `components-reachability.json` + `bundle-field-attribution.json` + `c2b-dynamic.json` + `parse-timing.json` | Reachability, strip falsification, size/parse         |
| `C3-current-duplication.md` (+ shared attribution JSON)                                                                                       | Field-family duplication with/without components      |
| `C4-q003-residual.md` + `c4-residual-raw.json`                                                                                                | Production residual count (via ephemeral Neon branch) |
| `packages/data/scripts/measure-*.mts`                                                                                                         | Committed reproduction instruments                    |

## Reproduction (high level)

```bash
# C1 — existing instrument (full 16-cell, N=1024+2048 holdout)
pnpm exec tsx packages/data/scripts/analyze-choose3-clustering.mts > /tmp/choose3.json

# C1 — construction + pool-exclusion companion (canonical All-time squad_first)
pnpm exec tsx packages/data/scripts/measure-choose3-construction-attribution.mts

# C2a static
pnpm exec tsx packages/data/scripts/measure-components-reachability.mts

# C2c/C3 size+parse
pnpm exec tsx packages/data/scripts/measure-bundle-field-attribution.mts

# C4 — ephemeral branch (requires ~/.config/wcdraft/neon.env)
pnpm --filter @wcdraft/db db:branch:create /tmp/c4.env
# read-only SQL residual count, then:
pnpm --filter @wcdraft/db db:branch:delete
```

## Explicit non-actions

- No rating, curve, offer-construction, schema, or constraint changes.
- G1/V1 override channel-scale **not re-opened** (already RETIRED 2026-07-17 against merit-v4.6).
- C2b throwaway strip restored; product bundle fingerprints unchanged.
