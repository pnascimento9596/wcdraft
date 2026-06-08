# WS-B Sim + Scoring — Calibration

> **Display recalibration landed (wc-perf-2.1.0 / proj-career-2.1.0 — WS-RATING/FLOOR-60)
> via the DECOUPLED path (plan §3.2 fallback):** the rating display curve is
> applied to `overall` ONLY; the four sim channels (`attack`, `midfield`,
> `defense`, `goalkeeping`) stay on the pre-recalibration `[FLOOR_CHANNEL, 100]`
> band so the engine's λ stays calibrated to the full attack-minus-defense
> range. The λ tuple below is therefore **byte-identical to the pre-Phase-1
> first-cut values** — the engine is unchanged. All OTHER constants (chance
> budget, incidents, injuries, shootout band, scoring, synergy, manager
> modifier) likewise remain as pre-Phase-1 first-cut values and are a flagged
> follow-on. Every value lives in
> [`src/engine/calibration.ts`](src/engine/calibration.ts) and is locked by
> golden fixtures — changing any of them moves a golden `RunResult` byte and
> therefore **requires an `engine_version` bump**. Phase 1 did NOT bump
> the engine (sim is byte-identical to `origin/main`); it stays at
> `engine-2026.06.04`.

## Determinism

The engine is pure + seeded (cyrb128 + sfc32 via `createRng` / `deriveSubseed`).
No `Date` / `Math.random` / `crypto` / `performance`. **No transcendental math**
(`exp` / `log` / fractional `pow`): λ is a clamped LINEAR map and goal counts
are drawn as a **binomial over a fixed chance budget** (rational arithmetic
only), never a Knuth-Poisson sampler (which would need `exp(-λ)`). Substreams
(`match_sim` / `event_gen` / `opponent_selection` / `narrative`) are all
derived from the run seed via `deriveSubseed`. Sampling pools are canonically
sorted before any draw.

## Expected goals (λ) — pre-Phase-1 first-cut values, unchanged

`λ_for = clamp(BASE + SPREAD · (attackFor − defenseAgainst)/100, MIN, MAX)`

| Constant | **Current** |
|---|---|
| `LAMBDA.BASE` | **1.3** |
| `LAMBDA.SPREAD` | **1.7** |
| `LAMBDA.MIN` | **0.25** |
| `LAMBDA.MAX` | **3.6** |
| `LAMBDA.ET_FRACTION` | **30/90** |

### Why these values

These are the pre-Phase-1 first-cut values, deliberately preserved through
the rating recalibration via the decoupled path. Decoupling channels from
the display curve means the engine continues to see the full `[0, 100]`
attack-minus-defense range, so the original `SPREAD = 1.7` keeps producing
the favourite/underdog separation it always did.

- `BASE = 1.3` keeps an evenly-matched expected total near 2.6 goals per
  match (close to the 1998-2022 WC norm of 2.54).
- `SPREAD = 1.7` lets a strong attack vs weak defense move λ up to ~3.0
  while an evenly matched pairing stays near `BASE`.
- `MIN = 0.25` keeps even outmatched attacks alive (meaningful underdog
  upset rate).
- `MAX = 3.6` caps the binomial well below saturation.
- `ET_FRACTION = 30/90` is a pro-rata of regulation λ across 30' of ET.

### Realism gate

The realism control is committed as
[`packages/data/test/realism-modern-norms.golden.test.ts`](../data/test/realism-modern-norms.golden.test.ts).
It runs a 3,006-match symmetric coherent-XI sweep (2,256 group + 750
knockout, fixed seeds, canonical team_id ordering) through the engine and
validates the aggregate metrics against pinned modern-era (1998-2022) WC
norms — [`test/fixtures/modern-wc-norms.json`](../data/test/fixtures/modern-wc-norms.json),
derived from upstream `f41e9437`. The bands accept the current
pre-Phase-1 engine behavior with structural-gap rationale documented inline
in the test; any future λ / channel / aggregate change must keep the
control in band or land a justified band update.

Measured landing on the decoupled Phase 1 build (3,006 matches, fixed
seeds, byte-identical to `origin/main` engine output):

| Metric | Sweep | Modern WC norm (1998-2022) | In band |
|---|---|---|---|
| mean goals/match (regulation) | 2.44 | 2.54 | ✅ (band [2.20, 2.90]) |
| group draw rate | 28.7% | 24.7% | ✅ (band [20.0%, 30.0%]) |
| regulation margin ≥ 4 (blowout) | 2.30% | 4.9% | ✅ (band [1.5%, 6.0%]) |
| KO → ET | 28.5% | 33.0% | ✅ (band [22%, 36%]) |
| KO → shootout | 14.3% | 21.4% | ✅ (band [10%, 27%]) |

The residual gap from norm (especially margin ≥ 4 and KO shootout) is
**pre-existing engine behavior carried forward from `origin/main`** —
neither introduced nor amplified by Phase 1 recalibration. The bands
accommodate it explicitly with rationale; tightening the engine to land
nearer the norms (BASE/SPREAD/ET tune) is a flagged follow-on, NOT in
scope for the rating-recalibration PR.

