# G1/V1 Override Channel-Scale Coherence

Date: 2026-07-17

Base: `origin/main` at `8a06b12d64ac053f3310ee924a841258fbcb7b0f`

Risk: YELLOW, read-only measurement of shipped artifacts

Verdict: **RETIRE**

## Summary

G1/V1 is retired. The defect was real in merit-v4.5, and merit-v4.6 fixed it
deliberately—not incidentally. The shipped runtime bundle contains 12,219 cards and both
Career and Current bases (24,438 basis observations). All 97,752 channel values reproduce from
their basis's stored internal score without passing through the display curve. All 4,956
effective override/basis observations preserve the owner-authored display target, carry the
frozen curve inverse internally within `1e-5`, and materialize channels from that same internal
score. There are zero failures in each check.

The dispatch's source-location premise was false. No `G1/V1` identifier or verbatim finding is
present in the current repository or any reachable Git revision. The recoverable finding is in
the owner's earlier teardown backlog at
`/Users/paulo/Downloads/wcdraft-teardown-synthesis-backlog.md`; the committed later Fable
synthesis instead says override inversion is proven solid. This discrepancy is recorded rather
than silently substituting the dispatch's summary for the actual finding.

## G1/V1 Verbatim

Source: `/Users/paulo/Downloads/wcdraft-teardown-synthesis-backlog.md`, under
`Independently verified (both confirmed against the live build)`:

> **[V1] Override channel-scale discontinuity — CONFIRMED from the live bundle.** Re-derived: internal `score_0_100` vs display `overall` is bimodal — **2,358 cards (19.3%)** have internal ≈ display (pinned-to-display; ≈ the ~2,300 merit-v4.5 overrides), 9,581 (78.4%) have internal ~30 below display (natural curve). On-position channel gap at matched display OVR: **+34.9 @70, +30.8 @74, +29.8 @80, +26.9 @88** — an override "70" out-sims a natural "88". The sim keys on channels, so override-heavy squads punch ~30 pts above their displayed weight. **Contradicts the Architecture-doc "internal = curve⁻¹(value)" contract** — the overrides skipped curve-inversion. Determinism/forgery unaffected; this is a coherence/competitive-fairness break for ~1/5 of the pool. Owner decision: confirm intended semantics (default: internal = curve⁻¹(display), per the doc) → Red-tier re-application lane (λ refit + realism re-lock + canary). High · Gated · [ENG-01]

The backlog's Gated table labels the item `G1`, severity `High`, with the instruction
`verify first, then pin-semantics decision → Red lane [ENG-01]`. The finding was measured against
frozen commit `23056b3`, engine merit-v4.5, and season suffix `e0542bd8`. It asked whether
owner-authored display pins were incorrectly reused as internal/channel inputs, and—if verified—to
choose the intended internal semantics before a Red rating correction.

## Mechanical Path

The owner input begins in `etl/overrides/manual-ratings-v4.3.csv`; merit-v4.5 conservatively adds
36 recovered rows from `manual-ratings-v4.5-recovered.csv`. The resolver folds both into one
effective Career+Current map. Duplicate source rows that resolve to one card are averaged by the
resolver, so the measured counts distinguish source rows from effective cards.

`manual_overrides.apply_to_internal_rows` applies the resolved v4.3/v4.5 display target to both
`score_0_100` and `current_score_0_100`. Since merit-v4.6, it first calls
`_override_internal_score`, which uses the frozen pooled curve's `_inverse_display_value`; targets
below the attainable display floor remain exact display pins while their internal score clamps to
the curve floor. The later v4.4 owner layer supersedes Current only and uses the same inverse path.
See `etl/src/wcdraft_etl/manual_overrides.py:790-942`.

The historical and projected materializers then:

1. choose the exact manual display value when present, otherwise curve the internal score for
   `overall`;
2. derive ATT/MID/DEF/GK directly as `_channel(internal, CHANNEL_SPREAD[position][channel])`;
3. store the same internal score in `basis_metadata.score_0_100`.

The historical path is `etl/src/wcdraft_etl/rating.py:700-779`; the projected path is
`etl/src/wcdraft_etl/rating_2026.py:625-690`. The display-curve contract explicitly limits the
curve to OVERALL in `etl/src/wcdraft_etl/rating_display.py:1-38`.

## What merit-v4.6 Changed

Commit `eed5c4e` (`fix(rating): curve-invert manual override channels (#179)`) touched the override
resolver, added the inverse helper, updated both rating paths and their guards, regenerated the
rating/runtime artifacts, re-fit lambda, regenerated the strategic-pick canary, and re-locked the
realism/golden cascade. Its report states the same order: fit the natural curve, inverse each owner
display target, materialize channels from the inverse, preserve the target for display.

This is the exact G1/V1 path. The theory that v4.6 fixed the issue incidentally is therefore
wrong: merit-v4.6 was the intentional Red correction for this precise merit-v4.5 defect.

## Pre-existing Guards

- `etl/tests/test_unified_display.py:77-120` pins the frozen pooled curve to a live refit and proves
  the full union population is used.
- `etl/tests/test_unified_display.py:123-129` proves every attainable integer display target
  round-trips through the inverse.
- `etl/tests/test_unified_display.py:132-181` proves manual display authority, shared-curve mapping
  across both eras, and fresh channel materialization from internal scores.
- `manual_overrides.manual_overall` and `manual_current_overall` reject stored internal drift over
  `1e-5` (`etl/src/wcdraft_etl/manual_overrides.py:945-985`).
- `packages/core/src/choice-overall-invariant.guard.test.ts:1-69` statically forbids
  `choice_overall` reads outside offer generation. The only production read is the explicit
  choose-from-3 offer-tier path in `packages/core/src/draft.ts:779-838`; scoring, best-XI, team
  strength, and simulation consume rating channels instead.
- `apps/web/lib/game/__tests__/provenance-inventory.test.ts:11-105` exhaustively maps both estimate
  bases to the `estimate` badge and locks the orange hue.

Those guards already proved the construction path. This lane closes the remaining artifact gap by
joining the shipped bundle back to the authoritative override CSVs over every card and both bases.

## Full-Population Measurement

The deterministic analyzer reads the shipped Brotli bundle directly; it does not rebuild ETL or
compact data. Its input bundle is 68,380,413 raw bytes with raw SHA-256
`ae5376c917377b00ac9dee7a166dcaceb28dd1416fc9fbe8b00b1116ca8e8d07`; the compressed tracked
artifact is 1,311,661 bytes with SHA-256
`76a5833748f34968b2666ae8c8f346d8d7e440a7f5f73f83de19c488c307b36d`.

### Population

| Population                                              |        Measured |
| ------------------------------------------------------- | --------------: |
| Runtime cards / ratings                                 | 12,219 / 12,219 |
| Career observations                                     |          12,219 |
| Current observations                                    |          12,219 |
| Total basis observations                                |          24,438 |
| v4.3+v4.5 owner source rows                             |           2,516 |
| Resolved source rows                                    |           2,336 |
| Honest unmatched source rows                            |             180 |
| Effective Career override cards after duplicate folding |           2,265 |
| v4.4 Current-only effective cards                       |             515 |
| Effective override/basis observations checked           |           4,956 |
| Career-stature-estimate Career cards                    |             541 |
| Baseline-anchor-estimate Career cards                   |             386 |
| Baseline-anchor-estimate Current cards                  |             388 |

The dispatch's `386` premise is correct for the manifest and Career basis. Current has 388
baseline-anchor estimates, so the union over both requested bases is 388 cards / 774 observations;
this is basis-specific honest provenance, not drift.

### Inversion coherence

Every non-capped observation forward-round-trips its stored internal through the frozen curve to
its shipped integer OVERALL; every capped baseline estimate forward-round-trips through the
documented `[66,73]` cap. Failures: **0**.

For all 23,664 non-capped observations, the requested centered residual
`abs(internal - curve^-1(integer OVERALL))` is:

| Scope      |         max |         p99 |         p50 |
| ---------- | ----------: | ----------: | ----------: |
| Both bases | 8.435675614 | 2.051511106 | 0.294545976 |
| Career     | 8.435675614 | 2.713101865 | 0.306774110 |
| Current    | 8.435675614 | 1.262246774 | 0.278194431 |

This distribution is not a drift signal because natural rows store integer OVERALL, making the
mapping many-to-one. The maximum occurs at OVERALL 88 near the shallow start of the high curve
segment: a broad internal interval rounds to the same integer. The corresponding continuous
display residual has max `0.499997803`, p99 `0.492930891`, and p50 `0.181645219`, exactly within
the half-point integer-quantization envelope, with zero forward-roundtrip failures.

For the contract-sensitive override population, where internal is intentionally set to the exact
curve inverse rather than merely landing in an integer bin, the 4,956 residuals are max
`0.000000494`, p99 `0.000000494`, p50 `0.000000198`; **0 exceed `1e-5`**.

### Channel non-reshaping and override authority

- Channel values checked: **97,752** (`24,438 × 4`); failures: **0**.
- Override/basis observations checked: **4,956** (2,265 Career + 2,691 Current); display,
  internal, or channel failures: **0**.
- The display curve therefore reshapes OVERALL only. No shipped channel matches a curved-display
  derivation in place of its required internal-score derivation.

### Honest misses and estimate provenance

- The 180 unmatched source rows remain in the unmatched artifact, overlap zero resolved source
  lines, and create zero unexpected manual-override components on non-effective cards. They were
  not force-matched.
- All 541 Career-stature-estimate observations and all 774 baseline-anchor-estimate observations
  pass display and channel coherence: **0 failures**.
- `provenanceBadgeKind` routes both bases to `estimate`; the existing full compact inventory test
  locks the `Estimate` label and orange hue rather than a grey/unknown fallback.

## Verdict

**RETIRE.** The evidence directly answers the actual V1 claim: merit-v4.5 reused owner display
pins as internal/channel scale, and merit-v4.6 intentionally corrected that exact discontinuity.
The current shipped artifact preserves owner display authority while using curve-inverted internal
scores and natural-scale channels over the full population and both bases. G1/V1 is neither a
false positive nor an incidental side effect; it is a real historical defect already fixed by
merit-v4.6.

## Reproduction

Run from a clean clone after dependencies are available:

```bash
node packages/data/scripts/analyze-g1v1-coherence.mjs > /tmp/g1v1.json
cmp /tmp/g1v1.json docs/reports/g1v1-override-channel-coherence-2026-07-17.json
```

The committed JSON includes every input path, byte count, and SHA-256. Two consecutive executions
must be byte-identical. The analyzer uses only Node built-ins and does not write or regenerate any
rating/data artifact.

## Architect-Delegated Decisions

1. **Recovered source location.** Because the promised in-repo finding does not exist, use the
   full earlier `[V1]` paragraph from the owner's recoverable Downloads backlog rather than the
   dispatch's second-hand summary. This is the least-behavior-changing honest interpretation: it
   preserves the blocking requirement to quote the actual finding and records the false premise.
2. **Integer inversion semantics.** Apply the `>1e-5` exact-inverse tripwire to owner overrides,
   where the implementation contract deliberately sets the internal to `curve^-1(target)`.
   Natural integer OVERALL values are many-to-one, and capped estimates are non-invertible, so
   they are adjudicated by forward round-trip plus the continuous half-point quantization bound.
   Treating every natural row as an exact inverse would manufacture thousands of false failures
   from expected rounding.
3. **Override population accounting.** Report both 2,336 resolved source rows and 2,265 effective
   cards after canonical duplicate averaging; include v4.4's 515 Current-only targets when checking
   the Current basis. Collapsing these distinct counts would hide either resolver coverage or the
   actual runtime population.

## Scope and Invariants

No rating changed and no generated artifact is part of the diff. During focused validation,
`pnpm --filter @wcdraft/data build` invoked the repository's clean-checkout
`ensure-generated-artifacts` prerequisite: it transiently reproduced the ignored
`etl/output/ratings.json` and raw compact bundle, then reported that the canonical tracked Brotli
artifact was reused. No tracked byte moved or golden was re-locked, but this means the stricter
literal statement "no local data regeneration command ran" is not available; the event is
recorded rather than hidden. No curve, channel, lambda, canary, score distribution, Daily salt
map, runtime bundle, or product code changed. Historical/projected rating anchors remain
`wc-perf-6.6.0` / `proj-career-5.6.0`; runtime schema is `runtime-data-2.10.0`; engine is
`engine-2026.07.14-squad-depth`; ratings payload SHA remains
`896301819a2988e4e93b3038b35ffa44bcef4182b4a55ac82c7569241801cee0`; draft-pool SHA remains
`ae5376c917377b00ac9dee7a166dcaceb28dd1416fc9fbe8b00b1116ca8e8d07`.
