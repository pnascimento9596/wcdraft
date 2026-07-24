# C1 — Offer clustering remeasure and attribution

**Date:** 2026-07-23  
**Base:** `a1beaaaaa2fe0377128d0b1434aa47d2bda5adca`  
**Risk:** Green — measurement only  

## Prior instrument and baseline (confirmed)

| Item | Path / value |
| ---- | ------------ |
| Instrument | `packages/data/scripts/analyze-choose3-clustering.mts` (script version `choose3-clustering-1.2.0`) |
| Companion | `packages/data/scripts/compare-choose3-clustering.mjs` |
| Prior report | `docs/reports/choose3-clustering-measurement-2026-07-17.md` |
| Prior JSON | `docs/reports/choose3-clustering-measurement-2026-07-17.json` |
| Prior base | `fc1748f4e4eaaa0994530c83db81582e82e7687c` |
| Prior tier_input | **Career display OVR for both bases** (the `choice_overall` defect) |

### Prior figures confirmed from the committed artifact

Canonical **All-time · Squad First · Career** (17,408 offers, N=1,024 drafts):

| Threshold | All offers | Estimate-excluded (post-hoc) |
| --------: | ---------: | ---------------------------: |
| Δ≤0 | **11.09%** | 11.08% |
| Δ≤1 | **41.31%** | 40.44% |
| Δ≤2 | **74.49%** | 71.75% |

Canonical **All-time · Squad First · Current** (same identities under pre-fix Career tiering):

| Threshold | All offers |
| --------: | ---------: |
| Δ≤0 | **16.79%** |
| Δ≤1 | **50.85%** |
| Δ≤2 | **79.74%** |

Dispatch context figures (~74.5% / ~41.3% / ~50.9%) match the artifact.

Population: **12,219** player cards; Career visible estimates **927** (= 541 `career_stature_estimate` + 386 `baseline_anchor_estimate`); Current visible estimates **388**.

## Remeasure at current main (post basis-tiering fix)

Instrument re-run: same seed template `wcdraft:choose3-clustering:v1:<index>`, 16 cells, N=1,024 (+2,048 holdout). Convergence gate **PASS**.

**Shipped mechanics now:** `choice_overall` is dual-basis (`career` / `current`) via `apps/web/lib/game/data.ts` and the core resolver — Current **selects and renders** Current display OVR.

### Career — zero delta vs baseline

All Career cells match the 2026-07-17 rates to reported precision (**0.00 pp**). Career was already correctly tiered; the basis-tiering fix does not change Career offers.

Canonical Career curve including **X=3** (derived from offer records):

| X | Pair-within rate |
| -: | ---------------: |
| 0 | 11.09% |
| 1 | 41.31% |
| 2 | 74.49% |
| 3 | **89.98%** |

Mean within-offer max−min spread: **7.73**. Spread histogram peaks at 4–8 OVR.

### Current — moved after basis-correct tiering

| Cell | Δ≤0 (pp vs baseline) | Δ≤1 | Δ≤2 |
| ---- | -------------------: | --: | --: |
| all_time.squad_first.current | 14.45% (**−2.33**) | 47.48% (**−3.37**) | 80.96% (**+1.22**) |
| all_time.position_first.current | 14.32% (−2.34) | 47.33% (−3.41) | 80.83% (+1.07) |
| post_2000.squad_first.current | 12.21% (−2.49) | 45.81% (−3.34) | 80.02% (+1.32) |
| post_2010.squad_first.current | 13.36% (−2.18) | 50.66% (−2.45) | 81.51% (+0.26) |
| modern.squad_first.current | 13.14% (−1.24) | 48.82% (**−4.68**) | 81.53% (**−1.52**) |

**Interpretation:** exact and 1-pt ties fell (Current identities now diverge when Current OVR separates them). Δ≤2 is mixed — All-time slightly **up**, Modern **down**. Current remains tighter than Career (mean spread **5.92** vs **7.73**). Current pair-within ≤3: **94.72%**.

Full per-cell table: `choose3-clustering-remeasure.summary.json`.

## Cohort attribution (decisive)

### Share of tied offers involving ≥1 estimate card (Career All-time Squad First)

| Threshold | Tied offers | With ≥1 estimate card | Share |
| --------: | ----------: | --------------------: | ----: |
| Δ≤0 | 1,931 | 595 | **30.81%** |
| Δ≤1 | 7,191 | 2,379 | **33.08%** |
| Δ≤2 | 12,967 | 5,009 | **38.63%** |
| Δ≤3 | — | — | **41.60%** |

Post-hoc “signal” exclusion (existing instrument): Δ≤2 74.49% → **71.75%** (−2.74 pp). Estimates are **present** in a minority of ties, not the majority.

### Pool exclusion of the 927 Career estimate cards

Companion instrument `measure-choose3-construction-attribution.mts` rebuilds the catalog **without** those cards and re-runs production `createDraft`/`stepDraft` (N=1,024, All-time Squad First Career):

| Threshold | Full pool | Pool exclude 927 |
| --------: | --------: | ---------------: |
| Δ≤0 | 11.09% | **14.20%** |
| Δ≤1 | 41.31% | **50.71%** |
| Δ≤2 | 74.49% | **83.68%** |
| Δ≤3 | 89.98% | **95.17%** |

**Finding:** removing estimates **increases** clustering. Those cards are not the structural source of near-ties; the remaining measured mid-band is denser. A rating pass that “declusters” estimate cards would **fabricate** separation. A rating pass that only removes them from the pool would make the player experience **worse**.

## Offer-construction diagnostic

At each player offer, remaining legal roster on the same tournament–nation entry (excluding already-drafted cards) is the available pool. Observed offer max−min vs that pool:

| Basis | Mean observed spread | Mean remaining-squad pool spread | Mean obs/pool ratio | Offers with obs ≤ pool−2 |
| ----- | -------------------: | -------------------------------: | ------------------: | -----------------------: |
| Career | 7.73 | **21.14** | **0.361** | **17,408 / 17,408** |
| Current | 5.92 | **18.68** | **0.319** | **17,408 / 17,408** |

**Finding:** the constructor **systematically leaves separation on the table**. Softened tier buckets (tiers 0/1/2 of eight) + position diversity still produce three cards whose OVRs sit in a narrow band relative to the squad’s full remaining range. This is consistent with intentional “tiered choose-3” design, but it is also why measured clustering is severe even when the squad has wide OVR range.

Uniform three-card pool baselines (existing instrument) remain lower at Δ≤2 than the shipped path for Career (~52% flat pool vs ~74% shipped) — the path reduces exact ties vs a flat draw but **increases** near-ties.

## Answer to the owner question

| Lever | How much of residual clustering can it touch? |
| ----- | --------------------------------------------- |
| **Ratings on estimate cards (927)** | **Near-zero legitimate room.** Undeclusterable by honest signal. They co-occur in ~⅓ of ties but are not the engine of the rate. |
| **Ratings on measured cards** | **Partial, only where public facts separate.** Post-estimate residual is still huge; any decluster must stay fact-bound. |
| **Offer construction** | **Primary lever.** Constructor uses ~36% of available squad spread on every measured offer. Changing tier width, soft floor, or diversity scoring can increase visible spread **without fabricating ratings**. |
| **Data-availability floor** | **Hard floor for estimate-bearing offers and for truly identical public records.** Cannot be rated away. |

**Lane recommendation (not opened here):** a **Yellow/Red construction / UX measurement-to-change lane** is higher EV than a ratings-only decluster. A ratings lane should be scoped only to measured-card facts with a zero-fabrication invariant — not to estimate cards.

## Reproduction

```bash
pnpm exec tsx packages/data/scripts/analyze-choose3-clustering.mts \
  > docs/reports/evidence-track-c-2026-07-23/choose3-full.json
pnpm exec tsx packages/data/scripts/measure-choose3-construction-attribution.mts \
  > docs/reports/evidence-track-c-2026-07-23/choose3-construction-attribution.json
```

Committed summary (no 35 MB offer dump): `choose3-clustering-remeasure.summary.json`.
