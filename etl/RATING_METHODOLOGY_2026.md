# wcdraft 2026 Projected Rating — Methodology (`proj-career-5.2.0`)

> **proj-career-5.2.0 (merit-v4.2):** the projected formula shares the
> historical `wc-perf-6.2.0` national-strength raw-only ceiling prior,
> `career-stature-4.1.0` objective-achievement evidence, and the same unified
> display curve. Non-material raw-only rows now use per-player public context
> from the pinned 2026 squad table (caps, international goals, club nation)
> inside the existing raw-only band; tournament role is omitted because no 2026
> minutes exist yet. Citation-backed active objective records can still open a
> projected-only stature path for under-covered AFC/CAF/CONCACAF standouts.
> Incomplete active-career projected rows still carry an explicit read-time
> stature cap so young active stars can project elite without turning sparse
> career evidence into an unbounded all-time peak. The rating/channel movement
> required a λ refit and the runtime engine stamp is
> `engine-2026.06.15-merit-v4.2`. Runtime 2026 rows still use the Career
> compatibility surface at top level and carry `basis_ratings.current` for the
> at-tournament basis. Final emitted 2026 counts are 1,246 ratings:
> 1,185 `measured_performance`, 61 `career_stature_estimate`, 12 legends,
> and 18 cards at OVR 90+ (1.445%).

> **MV2-6 (unified display curve):** the 2026 `rating_version` stays
> `proj-career-3.0.0` — the projected INTERNAL algorithm is unchanged. What changed
> is the **display** `overall`: it is no longer fit on the 2026 pool alone but is
> now mapped by the ONE shared monotonic curve fit over the **pooled** historical +
> 2026 internal distribution (`display_curve.fit_unified_curve`, carried by the
> `wc-perf-4.2.0` historical anchor). MV2-5's quantile mapping made the two internal
> scales cross-era fair, so the same curve maps both eras honestly. The four sim
> channels are byte-identical (the curve touches `overall` only); the four
> previously-spurious OVR-99 projected MF cards now display in the mid-80s.

The 2026 World Cup opponents are **real** (the 48 final squads, group draw, and
knockout bracket were published 2026-06-02). But the 2026 players have **no
World Cup performance yet**, so their ratings are **projected from factual
career signals** — `provenance = 'projected_career'`, a sibling of the
1930-2022 `wc-perf-2.0.0` rating ([RATING_METHODOLOGY.md](RATING_METHODOLOGY.md)),
not a replacement.

> **proj-career-2.0.0 (Phase 1 rating recalibration):** the internal merit
> formula is UNCHANGED from `proj-career-1.0.0`. The projected pool now shares
> the **same display calibration curve** as the historical pool — fitted on
> projected raw quantiles (per-pool fit, shared helpers, same target display
> anchors, same exponents). The curve drives **`overall` ONLY** under the
> decoupled path (plan §3.2 fallback): the four sim channels stay on the
> pre-recal `[FLOOR_CHANNEL, 100]` band, identical to `proj-career-1.0.0`.
> Historical and projected measured rows emit `overall` on the same display
> band `[60, 99]` and channels on the same pre-recal sim band, so the engine's λ
> stays calibrated to the engine's full attack-minus-defense range and
> `packages/core/src/engine/calibration.ts` is UNCHANGED from `origin/main`.
> No new ingestion; Phase 2 will add Ballon d'Or / all-time list signals
> separately.

> **proj-career-3.0.0 (merit-v2 MV2-5 — 2026 stature reconciliation):** linked
> players (`link_status == "linked"`) whose canonical `career_stature.json` row
> clears the material gate are reconciled onto the **same stature scale** as the
> historical `wc-perf-4.x` cards: `projected_final = stature_target(pos, index) +
bounded projected-context modulation`, using the identical stature target,
> continuity ramp, and tier-tightened caps as the historical model (imported, not
> re-implemented). This fixes the headline gap — linked Messi-2026 was age-pinned
> at 79 on the old raw formula and now reads on the stature scale; the 2026 legend
> count is no longer 0. Minted / unlinked / ambiguous / linked-but-below-material
> players **never** consult career stature and stay on the honest projected raw
> path, with the projected raw composite **quantile-mapped onto the historical
> raw-only internal distribution** (read read-only from the generated, lockfile-pinned `ratings.json`)
> so a strong-caps-plus-top-league role player **cannot** occupy the recognized-
> greats / legend band on the projection alone (the fix for the spurious OVR-99
> projected MF cards) **and** a 2026 reserve lands at the same internal score as a
> comparable historical reserve cross-era. Rows now
> carry `overall_basis` (`career_stature_estimate` | `measured_performance`, never
> `baseline_anchor_estimate`) and a first-class `legend` boolean joined from the
> linked player's career row. The materialized `overall` is now the **final**
> unified display (MV2-6 landed the shared historical+projected pooled curve); the
> INTERNAL (pre-display) score behavior MV2-5 asserts is unchanged.
> `calibration.ts` is still UNCHANGED.
>
> **Cross-era density note (the MV2-5 raw-only divergence):** the projected raw
> composite runs HOT relative to the historical tournament box score (2026
> projected-raw median ≈0.66 vs ≈0.43 historically; ≈58% of 2026 cards exceed the
> 0.62 ceiling vs ≈12% historically). Two mechanisms are therefore wrong: the
> historical hard clip `min(raw, ceiling)` flattens the majority of 2026 cards to an
> identical point; and an **affine rescale onto `[REPLACEMENT_BASE, ceiling]`**
> matches only the BOUNDS — it leaves the 2026 floor lifted (≈0.34 vs the historical
> 0.20) and the whole non-material distribution sitting systematically above
> comparable historical journeymen, which MV2-6's single monotonic display curve
> (fit over the pooled internal scores) **cannot** pull back down. So MV2-5 uses
> **empirical quantile mapping** (density neutralization): a non-material card's
> percentile within the 2026 pure-raw-only (`weight == 0`) projected-raw cohort is
> read off the historical raw-only internal scores at the SAME percentile. The 2026
> non-material internal **distribution then matches the historical raw-only
> quantiles** (per-quantile cross-era gap ≈0, not merely the bounds), so a 2026
> reserve at percentile _p_ lands at the same internal score as a historical raw-only
> card at _p_ (e.g. a 2026 bench defender aligns with a Mangala-2014-class reserve,
> not above it). Monotonic in projected raw ⇒ within-2026 rank preserved. The
> per-cohort raw-only ceiling (the global elite cap, ≈0.62) still bounds the result
> below the recognized-greats band — confirmed full-scan. NB: the continuity-ramp
> blend means a strong _linked-below-material_ card can brush an anomalously-low
> marginal-material card at the `weight≈0.5` boundary; this is the cliff-free ramp
> working and is a property shared with — and far milder than — the historical engine
> (where non-material reaches 64.8 vs a 44.8 marginal-material floor). The cap that
> matters — pure raw-only / minted / unlinked cards never reaching the band — holds
> at the 0.62 ceiling.

This document is the companion to `etl/src/wcdraft_etl/rating_2026.py`; the
code is the source of truth and every constant is `CALIBRATION`-flagged there.

## Legal firewall (non-negotiable)

Every number is derived **only** from the factual public career signals on the
pinned Wikipedia squad lists — international caps, international goals, date
of birth, listed position, and club. **Nothing** is ingested, mirrored, or
"lightly perturbed" from EA Sports FC or any proprietary rating set. The
league-strength prior is wcdraft's own transparent calibration table, not a
copied dataset. The output is reproducible from the cited Wikipedia revisions
alone.

## Sources (pinned, CC-BY-SA 4.0)

Raw wikitext snapshots committed under `etl/sources/wikipedia_2026/` (see
`SOURCES.json`): **squads** (oldid 1357762108), **draw** (oldid 1357747592),
**knockout stage** (oldid 1357752786), retrieved 2026-06-04. Committing the
snapshots makes the ingest self-contained and byte-deterministic with no live
fetch. ShareAlike propagates: derived 2026 data is redistributed under
CC-BY-SA 4.0.

## Same methodology family as `wc-perf-2.0.0`

`rating_2026.py` **imports** the `wc-perf` machinery rather than
re-implementing it, so "same family" is literal: position `BASE_WEIGHTS`, the
`[REPLACEMENT_BASE, BASE_CEILING]` internal band, the within-cohort mid-rank
percentile (`_percentile_map`), the four-channel `CHANNEL_SPREAD`, the
pre-recal `_channel(score_0_100, spread)` channel materializer, and the
**new display curve helpers** (`_fit_display_curve`, `_display_score`) are
all shared code. Decoupling means `_display_score` drives `overall` only;
channels are computed by `_channel` and stay on the pre-recal sim band. The era-fairness principle is
preserved: a signal is normalized within its `(tournament, position)` cohort
— for 2026 that is **(position) across all 48 squads**, so a striker is
ranked against every other 2026 striker. A defender / keeper is **NEVER**
rated on goals.

## The signal swap (career, not single-tournament box score)

| `wc-perf` role                          | 2026 projected signal    | Why                        |
| --------------------------------------- | ------------------------ | -------------------------- |
| goals (box score)                       | **international goals**  | career productivity        |
| appearances (minutes proxy)             | **international caps**   | career experience / trust  |
| awards + team finish (cross-era anchor) | **club-league strength** | the quality anchor (below) |
| —                                       | **age curve**            | career-stage positioner    |

## The two-pass formula

```
internal_score (0..1) = clamp01( base + league_anchor )
base                  = REPLACEMENT_BASE + (BASE_CEILING − REPLACEMENT_BASE) · perf_blend · age_factor
perf_blend            = Σ wᵢ·pctᵢ / Σ wᵢ      over present signals (caps, intl goals), position-weighted
league_anchor         = LEAGUE_WEIGHT[pos] · league_strength
projected_raw         = internal_score         (the projected CONTEXT signal, not the final)
```

Under MV2-5 `projected_raw` is no longer the final score: it is the context signal
into the stature reconciliation. For **linked + material** cards the final is the
stature blend (`stature_target + bounded projected modulation`); for **non-material**
cards the final is `projected_raw` **quantile-mapped onto the historical raw-only
internal distribution** (see the summary's cross-era density note). `score_0_100 =
100 · final` is the input to the SHARED display curve.

The **display curve** then maps `score_0_100` onto the measured-row band
`[60, 99]` for the emitted `overall` only, via the same `DisplayCurve` / `_display_score`
helpers as `wc-perf-2.0.0`. Channels are derived from `score_0_100` via
`_channel(score_0_100, spread)` (unchanged pre-recal formula) — they do NOT
pass through the display curve. Under **MV2-6** the projected pool no longer fits
its own curve: the display `overall` is mapped by the ONE curve fit over the
**pooled** historical + 2026 internal scores (`display_curve.fit_unified_curve`),
identical for both eras. The merit-v4.2 measured-row TARGET anchors are
60/73/88/99 and, because MV2-5
made the internal scales cross-era fair, historical and projected display values
sit on the same honest scale with no per-era table.

### Why a league anchor (the projection-sanity fix, unchanged from 1.0.0)

Caps and international goals measure experience and productivity, which
over-reward longevity (a minnow veteran out-caps a young elite). League
strength is the strongest **factual** quality proxy available before a ball
is kicked, and it plays the role the award/finish anchor plays in `wc-perf`.
A player whose club is **unknown** drops the anchor entirely (honest-state —
never a fabricated baseline applied to a club we don't know).

### The tournament anchors are honestly DROPPED

`wc-perf`'s award and team-finish anchors are unearned before the tournament
is played. They are emitted as components with `value: null, weight: 0` —
visibly **dropped, never substituted with 0**. A projected card therefore
cannot reach the legendary tail on tournament distinction it has not earned;
WS-B reconciles 2026-opponent strength with the historical draft pool at
aggregation time.

### Age curve (unchanged)

A factual career-stage multiplier in `[0.80, 1.0]`, flat across the prime
plateau (24-30) and ramping down toward the very young and the older. Age
is computed as of the opening match (2026-06-11).

## Honest-state

- Every current player has caps and international goals (real measured
  integers, possibly 0), so 2026 cards never take the baseline-anchor estimate
  path. Projected rows now carry `overall_basis`: most remain
  `measured_performance`, while source-linked material careers can emit
  `career_stature_estimate`; every runtime 2026 row also carries
  `basis_ratings.career` and `basis_ratings.current`.
- `coverage_basis = "career_signals"`; `coverage = 5/7 ≈ 0.7143` reflects the
  five signals we have against an ideal that also wants club-competition
  minutes and a qualification box-score — neither is in the source.
- Assists, minutes, club-competition appearances, qualification stats are
  not in the squad source and are omitted entirely, never invented.

## Identity linkage (unchanged)

- **Players**: a 2026 player who already has a 1930-2022 card **links** to
  that canonical `player_id`; the linker is **conservative** — ambiguity
  mints a new id rather than risk a wrong merge. New ids namespaced
  `P-W26-*`.
- **Nations**: 43 of 48 teams match an existing canonical nation by name; 5
  debutants (Cape Verde, Curaçao, DR Congo, Jordan, Uzbekistan) are minted
  (`T-W26-*`). DR Congo is minted fresh with Zaire (`T-88`) recorded as
  predecessor.

## Emitted artifacts (`etl/output/*_2026.json`)

`nations_2026`, `players_2026` (minted only), `player_tournaments_2026`
(1,246 cards, `card_id = player_id:WC-2026`), `ratings_2026` (now with
`overall` on the shared merit-v4.2 display band), `teams_2026` (48
`Team2026`, aggregate re-derived on the projected v5.2 channels),
`bracket_2026`, `tournaments_2026`, plus `manifest_2026.json`. The
1930-2022 historical tables ship under their separate `wc-perf-6.2.0`
replay anchor.

### `Team2026.aggregate_rating`

Best-available-XI semantics: the 11 cards with the highest projected
`overall`, averaged per sim channel + coverage. Under the decoupled path,
the display curve still drives `overall` only; the four sim channels are
derived from internal projected scores on the `[FLOOR_CHANNEL, 100]` channel
band. merit-v4.2 re-derives those channel inputs after factual declustering
and objective-record movement, then refits λ before realism bands are
re-locked.

## Determinism & validation

Fixed snapshots + canonical tables → byte-identical `*_2026.json`. Guarded
by `tests/test_ingest_2026.py` — the Phase 1 acceptance suite:

- determinism + committed-golden equality + 48-team/squad-size/3-GK structure
- link correctness incl. no-wrong-merge and twins guards
- **projected rating version** check (`proj-career-5.2.0`)
- **projected distribution shape** (floor 60, median ~73, p95 ~88, max 99,
  no 100s)
- **projected basis** is `career_stature_estimate` | `measured_performance`,
  never `baseline_anchor_estimate`; both paths exercised by the real squads
- **MV2-5 stature reconciliation (INTERNAL-score assertions):** minted/non-linked
  never consume career stature; linked-material rides the stature scale (Messi no
  longer age-dominated); the 4 previously-spurious OVR-99 cards are capped on the
  raw-only band below the greats; the top of the internal distribution is material,
  not raw artifacts; legend joins linked-material only; DF/GK legends are position-
  channel-shaped; `link_status` missing fails loudly
- projected rating bounds on the new band + honest-state nulls
- **strong-nations-aggregate-higher invariant** holds on the compressed
  channel scale: every traditional power outranks every debutant/minnow
  with a clear basket-mean margin (≥ 2.5 on the new scale)
- full bracket integrity

## Sanity results (Phase 1, asserted)

- All 48 teams present, 12 groups × 4, every squad 23-26 with ≥3 GK.
- Projected `overall` on the recalibrated band `[60, 99]`; **zero** null
  overalls; **zero** at the 100 ceiling.
- Every traditional power (Brazil, Argentina, France, Spain, Germany,
  England, Portugal, Netherlands) aggregates higher than every
  debutant/minnow (Curaçao, Cape Verde, Haiti, Uzbekistan, Jordan, New
  Zealand, South Africa) with a clear basket-mean gap on the compressed
  scale.
- 352 of 1,246 cards link to a canonical 1930-2022 player id (Messi, Ronaldo,
  Modrić — one id across 2014/18/22 + 2026); no canonical id is reused for
  two different 2026 players.

## Migration & versioning

- `rating_version` changes `proj-career-1.0.0` -> `proj-career-2.0.0` ->
  `proj-career-5.0.0` -> `proj-career-5.1.0` -> `proj-career-5.2.0`
  (merit-v4.2 factual per-player declustering replay anchor).
- Rows gain `overall_basis` and a first-class `legend` boolean (joined from
  `career_stature.json` for linked players). `ratings_2026.json` and
  `teams_2026.json` regenerate; the unified display curve is MV2-6.
- See `RATING_METHODOLOGY.md` for the historical-pool curve details and the
  shared display-curve helpers.
