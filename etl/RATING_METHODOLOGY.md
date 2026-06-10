# wcdraft Player Rating — Methodology (`wc-perf-4.2.0`)

> **wc-perf-4.2.0 (MV2-6 — unified display curve):** the internal merit model and
> the four sim channels are UNCHANGED (channels byte-identical; the engine/λ and
> the committed compact are untouched). The single change is the **display curve**:
> instead of the historical pool and the 2026 projected pool each fitting their own
> per-pool curve, ONE monotonic low-DOF curve is now fit over the **pooled**
> historical + 2026 internal distribution (`display_curve.fit_unified_curve`) and
> applied identically to BOTH eras. MV2-5 made the two internal scales cross-era
> fair (the 2026 non-material cards are quantile-mapped onto the historical raw-only
> distribution), so one pooled curve is the honest mapping — no per-era table, no
> per-player pin. The curve form (`global` piecewise-power, three fixed exponents,
> four data anchors → 66/73/88/99) is unchanged; only the data the anchors are fit
> on changed (the pool). This is a display-`overall`-only bump: historical `overall`
> moves ≤1 for 25/10 973 cards, the 2026 display moves onto the shared curve, and
> every sim channel stays byte-identical. The same curve also maps the
> `proj-career-3.0.0` 2026 cards (whose internal-algorithm anchor is unchanged).
>
> **wc-perf-3.0.0 (ENGINE-V2 E-4 — career-stature lift):** the per-tournament
> merit model below is UNCHANGED. A new **career-stature lift** is added to the
> internal `score_0_100` **before** it is materialized, so a historical legend's
> off-tournament card and its four sim channels rise **coherently** off the raw
> floor (the channel-decoupling fix: Pelé-1966 attack no longer sits at the raw
> 54 channel). The lift is a capped **floor/lift, not an override** — a card is
> raised only toward a capped career target and only to the extent its raw
> tournament score fell short; a great tournament already above the target keeps
> its higher measured score, and a mid-tier / weakly-sourced player gets little or
> none. Career signals come EXCLUSIVELY from the public E-4.1 merit archives
> (`etl/output/merit/source_facts.json` → `etl/output/career_stature.json`); no
> proprietary rating IP is ever consumed. Because channels move, this version
> ships a sim re-lock (compact data + goldens); the engine math/λ are unchanged
> unless a realism re-fit is separately required. See **Career-stature lift**
> below and `docs/plans/merit-rating-model-2026-06-07.md`.
>
> **wc-perf-2.0.0 (Phase 1 rating recalibration):** the internal merit model is
> UNCHANGED — same era-normalized percentiles, same independent award/finish
> anchors, same honest-state semantics. A single new **display calibration
> curve** maps the internal `score_0_100` onto the documented display band
> `[66, 99]`, reshaping `overall` ONLY. `baseline_anchor_estimate` cards are
> additionally capped into the estimate band `[66, 73]` on overall. The
> **decoupled path** landed (plan §3.2 fallback): the four sim channels stay
> on the pre-recal `[FLOOR_CHANNEL, 100]` band, and
> `packages/core/src/engine/calibration.ts` (λ, channel scale, engine_version)
> is **UNCHANGED** from `origin/main` — the sim is byte-identical to main
> (verified by sim-golden.json: 0 diff). The Phase 1
> change ships only the OVERALL display curve (engine unchanged); new
> stature signals (Ballon d'Or, all-
> time list ranks) are a deliberate Phase 2 follow-on.
>
> **Prior versions** — `wc-perf-1.1.0` introduced RSSSF-sourced pre-1970
> appearances + the no-null guarantee; `wc-perf-1.0.0` was the first
> era-normalized release.

The per-card player **Rating** is wcdraft's moat: an original, era-normalized,
position-weighted, awards-anchored score computed deterministically from the
factual public signals in the canonical tables. This document is the
human-readable companion to `etl/src/wcdraft_etl/rating.py`; the code is the
source of truth and every constant below is `CALIBRATION`-flagged there
(tunable without touching the algorithm, and golden-locked when changed).

## Legal firewall (non-negotiable)

Every number is derived **only** from factual public signals — World Cup goals,
match appearances, official FIFA awards, team final placement, and listed
position. **Nothing** is ingested, mirrored, scraped, or "lightly perturbed"
from EA Sports FC or any other proprietary rating set. The formula is entirely
wcdraft's own. The output is reproducible from the cited public sources alone —
the Fjelstul database plus, for pre-1970 appearances, the RSSSF match archive
(both attributed; see README and `output/supplement/SUPPLEMENT.md`).

## Inputs (honest-state)

Read from the **committed canonical JSON** in `etl/output/` (the ingestion's
output — not the upstream CSVs), so the stage is self-contained and
byte-deterministic. Signals respect the era cliffs documented in
`etl/output/COVERAGE.md`:

| Signal | Source | Availability | When absent |
|---|---|---|---|
| Goals (excl. own goals) | `player_tournaments.goals` | 1930+ (all eras) | n/a — always present |
| Match appearances | `player_tournaments.appearances` | native **1970+**; **pre-1970 sourced from RSSSF** (WS-A supplement, `appearances_source` tags origin) | `null` → **dropped**, never 0 (still null where no RSSSF lineup links) |
| Awards | `player_tournaments.awards` | 1930+, staggered intro | `[]` = confirmed none (real 0 lift) |
| Team final placement | `manager_tournaments.final_placement` keyed by `(nation_id, tournament_id)` | **semifinalists only** (1–4) | `null` → **dropped**, never 0 |
| Coarse position | `player_tournaments.position_listed` (fallback: `players.primary_position`) | all eras | — selects the weighting, not scored |

**Deliberately not used** in Phase 1 (Phase 2 plans to ingest some of these with
pinned public-source snapshots): all-time / decade list rank, Ballon d'Or /
The Best points, captaincy (not present in the ingested
`player_tournaments`), club honours, peak transfer context. Phase 1 ships only
the display curve on OVR — no new ingestion; the sim engine is unchanged.

**Scope:** men's tournaments 1930–2022 (the contract's gameplay scope). The
canonical tables also contain 8 women's editions (2,870 cards); those are
**explicitly excluded** here — `run()` reports the rated count (10,973) so the
exclusion is surfaced, not silent.

## Two-pass build (wc-perf-2.0.0)

1. **Pass 1 — internal merit.** For each card, compute an internal
   `score_0_100` exactly as in `wc-perf-1.1.0` (the same formula below).
2. **Pass 2 — display curve.** Fit one global low-DOF monotonic curve on the
   four internal quantiles of the emitted dataset (min, p50, p95, max) and
   map them onto the fixed display targets (66, 73, 88, 99). Apply the curve
   to `overall` ONLY (decoupled — see §3.2 fallback). The four sim channels
   are derived directly from `score_0_100` via `_channel(score_0_100, spread)`
   and stay on the pre-recal `[FLOOR_CHANNEL, 100]` band; they are NOT
   passed through the display curve.

This is deterministic: same canonical input → same internal scores → same
fitted curve anchors → byte-identical `ratings.json`.

## The internal merit formula

For each card, with coarse position `pos ∈ {GK, DF, MF, FW}`:

```
internal_score (0..1) = clamp01( base + award_lift + finish_lift )
score_0_100           = 100 · internal_score        (input to the display curve)
```

### 1. Era normalization — within-cohort percentile (the equalizer)

The two era-dependent performance signals (goals, appearances) are converted to
a **mid-rank percentile within their `(tournament, position)` cohort**:

```
pct(v) = ( #cohort-values strictly < v  +  0.5 · #equal to v ) / N
```

A value is ranked against its **own contemporaries at its own position**, so a
1954 striker and a 2022 striker land on the same 0..1 scale despite very
different raw counts. Ties are split deterministically; a singleton or
all-equal cohort maps to `0.5` (neutral). Awards and team finish are **not**
normalized — they are the cross-era anchors (below).

### 2. Performance base

A position-weighted blend of the **present** normalized performance signals,
renormalized over whatever is present (honest-state drop), then mapped onto the
INTERNAL band `[REPLACEMENT_BASE, BASE_CEILING] = [0.20, 0.68]`:

```
blend = Σ wᵢ·pctᵢ / Σ wᵢ        (over present signals only)
base  = 0.20 + (0.68 − 0.20) · blend
```

| Base weights | goals | appearances |
|---|---|---|
| FW | 0.75 | 0.25 |
| MF | 0.40 | 0.60 |
| DF | 0.00 | 1.00 |
| GK | 0.00 | 1.00 |

A defender or keeper is **never rated on goals**.

`REPLACEMENT_BASE = 0.20` is the INTERNAL replacement baseline, **not** the
emitted display floor. Phase 1 maps it via the curve onto the display floor 66.
The `[0.20, 0.68]` internal band is intentional: raw box-score performance can
only carry a card to "very good" internally — reaching the top of the emitted
display range still **requires** the anchor.

### 3. Cross-era anchors (awards + team finish)

Two **independent, additive, era-invariant** lifts. Keeping them separate lets
a decorated champion correctly out-rate an undecorated one.

```
award_lift  = AWARD_WEIGHT[pos]  · award_score
finish_lift = FINISH_WEIGHT[pos] · finish_points
```

- `award_score = 1 − Π(1 − pᵢ)` over held awards (saturating, capped at 1):
  Golden Ball 1.00, Silver 0.70, Bronze 0.50; Golden Boot 0.90, Silver 0.60,
  Bronze 0.45; Golden Glove 0.85; Best Young Player 0.55. An unrecognized
  award name raises (drift protection) — never silently dropped.
- `finish_points`: champion 1.00, runner-up 0.75, third 0.55, fourth 0.40;
  non-semifinalist → `null` → contributes 0 lift (dropped, **not** a 0
  placement).

| Position | AWARD_WEIGHT | FINISH_WEIGHT |
|---|---|---|
| FW | 0.20 | 0.16 |
| MF | 0.22 | 0.16 |
| DF | 0.18 | 0.24 |
| GK | 0.22 | 0.28 |

## The display calibration curve (Phase 1 reshape; unified pool in MV2-6)

The curve takes the internal `score_0_100` and maps it onto the display band:

```
DISPLAY_CURVE_KIND  = "unified_pooled_piecewise_power_v1"
DISPLAY_FLOOR       = 66
DISPLAY_MEDIAN      = 73
DISPLAY_P95         = 88
DISPLAY_MAX         = 99

ESTIMATE_FLOOR      = 66
ESTIMATE_CEILING    = 73
```

### Algorithm

The curve is fit on four global INTERNAL quantiles of the **pooled** dataset
(historical men's cards **and** projected 2026 cards together — MV2-6 unification;
before MV2-6 each pool fitted its own curve):

```
raw_floor   = min(score_0_100)
raw_median  = p50(score_0_100)
raw_p95     = p95(score_0_100)
raw_max     = max(score_0_100)
```

It then maps each internal score onto the display band via **three monotonic
piecewise-power segments**:

```
if x ≤ raw_median:
    t = (x − raw_floor)  / (raw_median − raw_floor)
    y = DISPLAY_FLOOR  + (DISPLAY_MEDIAN − DISPLAY_FLOOR)  · t^DISPLAY_LOW_EXPONENT   (= 0.65)
elif x ≤ raw_p95:
    t = (x − raw_median) / (raw_p95 − raw_median)
    y = DISPLAY_MEDIAN + (DISPLAY_P95 − DISPLAY_MEDIAN) · t^DISPLAY_MID_EXPONENT   (= 1.00)
else:
    t = (x − raw_p95)   / (raw_max  − raw_p95)
    y = DISPLAY_P95   + (DISPLAY_MAX − DISPLAY_P95)   · t^DISPLAY_HIGH_EXPONENT  (= 1.85)
```

### Low-DOF guarantee

The curve has exactly **three free parameters** (the three exponents) and is
fit on **four measured quantiles** per dataset. There is **no per-player and
no per-era override map**. This is asserted in `etl/tests/test_rating.py`
(`test_display_curve_is_low_dof`). The curve cannot fudge individuals — it can
only reshape the global distribution.

### Estimate band

`baseline_anchor_estimate` cards have `overall` passed through the display
curve and then **clamped into `[ESTIMATE_FLOOR, ESTIMATE_CEILING] = [66, 73]`
on `overall` ONLY**. The four sim channels stay on the pre-recal sim band
`[FLOOR_CHANNEL, 100]` (materialized via `_channel(score_0_100, spread)`) —
the estimate cap is a display-overall promise, NOT a channel clamp. An
unlinked card's channels naturally sit near `FLOOR_CHANNEL` because the
underlying merit signal is at the replacement baseline; we never lift the
sim channels into the estimate band. The honest-state semantics are
preserved: missing components remain `null`, coverage stays low, the flag is
kept. Estimates can never out-rate a measured great on display OVR
(asserted).

### The four sim channels (decoupled, Phase 1.1)

The sim consumes only `attack / midfield / defense / goalkeeping` (never
`overall`). The display curve is NOT routed through the channels — they
stay on the pre-recal sim band `[FLOOR_CHANNEL=20, 100]` so the engine's λ
stays calibrated to the engine's full attack-minus-defense range. The
off-position channels are a convex blend toward `FLOOR_CHANNEL = 20`:

```
channel = round( score_0_100 · spread[pos][channel] + 20 · (1 − spread[pos][channel]) )
```

`score_0_100` is the COMPOSITE merit value (the curve's INPUT). Channels
operate on the composite, not the curve's display output — that is exactly
the decoupling. The dominant-position channel (`spread == 1.00`) reflects
the raw composite without any display reshape; an off-position channel is
suppressed toward the merit floor.

| spread → | attack | midfield | defense | goalkeeping |
|---|---|---|---|---|
| FW | 1.00 | 0.60 | 0.30 | 0.00 |
| MF | 0.65 | 1.00 | 0.60 | 0.00 |
| DF | 0.35 | 0.60 | 1.00 | 0.00 |
| GK | 0.05 | 0.20 | 0.55 | 1.00 |

This is the **DECOUPLED path** (plan §3.2 fallback): the rating display
curve drives ``overall`` ONLY. The four sim channels stay on the
pre-recalibration ``[FLOOR_CHANNEL, 100]`` band so the engine's λ
stays calibrated to the engine's full attack-minus-defense range. The
sim is **byte-identical** to ``origin/main`` (verified by
``packages/core/test/fixtures/sim-golden.json`` diffing 0 lines), so the
engine_version anchor stays unchanged.

## Stature-dominant composite (`wc-perf-4.x`)

`wc-perf-3.0.0`'s capped-lift design (raw was the base, stature could only
ADD a positive, capped fraction of the gap) is **removed**: there is no
`_career_lift`, no `CAREER_MAX_LIFT`, no `max(0, …)`. The merit-v2 inversion
(MV2-4) makes career stature the **primary base** for material-stature
players, with the per-tournament box score as a **signed, bounded modulator**
around the stature target. A recognized great's worst World Cup still reads
elite; a journeyman's best tournament does not enter the legend band.

The insertion point is the same single line in `_build_internal_rows`; the
shape is now:

```text
raw_tournament_score = clamp01(base + anchor)                   # the wc-perf-2.0.0 score
stature_target = STATURE_TARGET_FLOOR[pos]
               + STATURE_TARGET_SPAN[pos] * career_stature_index
tournament_ref = median raw_tournament_score for (tournament_id, pos) cohort
modulation     = clamp( TOURNAMENT_MOD_GAIN[pos] * (raw - tournament_ref),
                        -TOURNAMENT_DOWN_CAP[pos][tier], +TOURNAMENT_UP_CAP[pos] )
stature_path   = clamp01(stature_target + modulation)           # SIGNED — can dip below target
raw_path       = min(raw_tournament_score, RAW_ONLY_GLOBAL_CEILING)
stature_weight = ramp01(career_stature_index over the material band)   # 0 → 1, half-width 0.06
score          = clamp01( stature_weight * stature_path
                         + (1 - stature_weight) * raw_path )    # feeds OVR AND channels
```

`career_stature_index` and `coverage` come from `etl/output/career_stature.json`
(MV2-3 / MV2-3.5, `career-stature-2.1.0`, position-balanced weights over the
full `merit-source-set-2.0.0` set). The blend **ramps continuously** from
raw-only (`weight = 0`) to stature-dominant (`weight = 1`) across a small band
around the material-stature index threshold, so two near-identical cards
straddling the threshold do not land far apart (no cliff). Tournament context
is a **signed, bounded modulation**: a weak tournament lowers the stature
target within a (tier-tightened) down-cap; an apex tournament raises it within
an up-cap.

| Constant | Value | Role |
|---|---|---|
| `MATERIAL_STATURE_MIN_COVERAGE` | `0.25` | coverage gate to enter the stature-dominant path |
| `MATERIAL_STATURE_MIN_INDEX` | `0.40` | index gate to enter the stature-dominant path |
| `STATURE_RAMP_HALF_WIDTH` | `0.06` | half-width of the continuity ramp on `career_stature_index` |
| `STATURE_DOMINANT_WEIGHT` | `0.5` | weight at/above which stature path dominates the final blend |
| `STATURE_TARGET_FLOOR` | FW 0.60 · MF 0.60 · DF 0.60 · GK 0.58 | internal-score floor at the material-stature threshold |
| `STATURE_TARGET_SPAN` | FW 0.40 · MF 0.40 · DF 0.38 · GK 0.38 | headroom from the floor to the all-time peak (index ≈ 1.0) |
| `TOURNAMENT_MOD_GAIN` | FW 0.40 · MF 0.40 · DF 0.35 · GK 0.30 | gain on the (raw − cohort_median) delta |
| `TOURNAMENT_UP_CAP` | FW 0.08 · MF 0.08 · DF 0.07 · GK 0.06 | positive modulation cap |
| `TOURNAMENT_DOWN_CAP` | per-tier {gold/silver/bronze} = {0.05–0.06, 0.08–0.09, 0.11–0.12} | tier-tightened downward cap |
| `COHORT_MIN_N` | `8` | (tournament, pos) cohort size needed before using its median |
| `RAW_ONLY_GLOBAL_CEILING` | `0.62` | internal-score ceiling on `raw_path` for non-material cards |
| `CAREER_ESTIMATE_MIN_INDEX` | `0.50` | index threshold to tag a no-signal card `career_stature_estimate` |

**MV2-3.5 — defender honors (`career-stature-2.1.0`).** Two SHA-pinned
research notes (WC All-Star → `wc_legacy`, World's-Best-GK →
`position_balanced`) lift the DF/GK family coverage so the stature index no
longer systematically under-credits keepers and defenders. The `recon`
divergence cross-check (MV2-9, REVIEW-ONLY) lifted DF rank-correlation
ρ from 0.11 to 0.29 — the cohort is more honestly priced without any
proprietary anchor entering the firewall.

**Honest-state.** Missing career coverage is coverage, never a zero against
the player: a card below the material gate stays on the `raw_path` only
(weight 0), capped at `RAW_ONLY_GLOBAL_CEILING`, and records `null` career
score/coverage/index in `components[]`. Managers remain rating-unavailable.
There is **no per-player override table** — every blend is the same formula
over the same public facts.

## `overall_basis` semantics (`wc-perf-4.x` — post MV2-4.1)

`wc-perf-4.x` keeps the three-label split but the count distribution
shifted: `career_stature_estimate` is no longer the empty path it was under
`wc-perf-3.0.0`. The MV2-4.1 basis-tag fix (the stature-dominant blend
already engaged on these cards; only the LABEL was stale) re-tags every
no-signal card whose `stature_weight ≥ 0.5` to the elite-tier basis instead
of the capped baseline tier — the ratings themselves are byte-identical
across the fix; only the label moves.

- **`measured_performance`** (10101 cards) — the card had at least one
  positively-weighted individual signal (goals for FW/MF, appearances for
  any position). The vast majority of cards, including the pre-1970 cards
  whose appearances came from the RSSSF supplement.
- **`career_stature_estimate`** (485 cards) — the card lacks any individual
  tournament signal **but** the player's career row is clearly material
  (`stature_weight ≥ STATURE_DOMINANT_WEIGHT`). Exits via the unified
  display curve at its full internal score — the elite tier supports an
  above-band rating without an individual box score being invented.
- **`baseline_anchor_estimate`** (387 cards) — residual cards with no
  individual signal **and** no material career record: a pre-1970 DF/GK
  whose appearances could not be sourced. Computed from the replacement
  baseline + anchor, capped into `[66, 73]` after the curve, **no
  individual box score invented**, low coverage flagged. (Pre-MV2-10 this
  was 388 — the MV2-3/4 stature-dominant core moved one card off the
  capped tier; the compact integrity test locks this at 387.)

> A known sub-defect — a small number of `career_stature_estimate` cards
> still display the `baseline_anchor_estimate` basis on the result-screen
> tooltip (the "Maier-class basis-gate" the season gate review #2 flagged).
> The ratings are correct; only the surfaced badge string lags the blend
> decision. The fix is scoped to a separate PR — values are not pre-stated
> here.

## 2026 reconcile (`proj-career-3.0.0`, MV2-5)

The 2026 rating model (`etl/src/wcdraft_etl/rating_2026.py`) shares the
stature-dominant scale with the historical model:

- **Linked + material 2026 players** evaluate through the same
  `stature_target(pos, index)` floor/span, the same continuity ramp, and
  the same tier-tightened modulation caps. A current great's projected
  card sits on the same internal band as their historical greats.
- **Non-material 2026 cards** are placed onto the historical raw-only
  internal distribution via an **empirical quantile map**
  (`_raw_only_quantile_map`): the card's percentile within the 2026
  pure-raw-only (`weight == 0`) projected-raw cohort is read off the
  historical raw-only internal scale at the same percentile. This
  density-neutralizes the 2026 raw composite (which runs hot relative to
  the historical box score) instead of affine-rescaling its bounds — so a
  2026 reserve at percentile *p* lands at the same internal score as a
  historical raw-only card at percentile *p* (e.g. a 2026 bench defender
  aligns with a Mangala-2014-class historical reserve, not above it).
- Aging legends take **downward** projected modulation but never collapse
  below recognized stature (the down-cap is tightest at the gold tier).

Once the raw COMPONENT is on the historical scale, the rest of the 2026
formula is the SAME stature-dominant blend used historically — including
the continuity ramp through the material band.

## Unified display curve (`wc-perf-4.2.0` — MV2-6)

Phase 1 introduced one global low-DOF monotonic curve on the four internal
quantiles of the emitted dataset (min, p50, p95, max → 66, 73, 88, 99) — the
curve form is unchanged. **What MV2-6 changed** is the data the four anchors
are fit on: rather than fitting one curve on the historical pool and a
second one on the 2026 pool, a **single** curve is fit on the **pooled
historical + 2026** internal distribution
(`display_curve.fit_unified_curve`) and applied identically to BOTH eras.
MV2-5 made the two internal scales cross-era fair (2026 non-material cards
quantile-mapped onto the historical raw-only distribution), so one pooled
curve is the honest mapping — no per-era table, no per-player pin.

The curve kind in the manifest is now
`unified_pooled_piecewise_power_v1`. The 2026 cards (`proj-career-3.0.0`)
ship through the same unified curve; their internal algorithm anchor is
unchanged. This is a display-`overall`-only bump: historical `overall`
moves ≤ 1 on a small handful of cards, the 2026 display lands on the
shared curve, and every sim channel is **byte-identical** vs the per-era
fit (the channels never route through the display curve — see the
DECOUPLED path section).

## Coverage & provenance

`coverage` is the per-card signal-coverage fraction (0.6667 / 0.8333 / 1.0).
A `baseline_anchor_estimate` is always `< 1.0`. Low-coverage ratings are
**flagged, not faked**. `coverage_basis = "wc_signals"`,
`provenance = "wc_performance"`, `appearances_source` records the appearance
origin (`fjelstul_match_events` / `rsssf_starting_xi` / `null`), and
`rating_version = "wc-perf-4.2.0"` (a replay anchor — bump on any change to
weights, normalization, the display curve, the stature-dominant blend, or
the source set).

## `components[]` transparency

Every rating carries its inputs: raw `goals`/`appearances` (weight 0,
informational), the era-normalized `goals_percentile` / `appearances_percentile`
with their **effective** base weights, and `award_score` / `team_finish` with
their anchor weights. A dropped signal shows `value: null, weight: 0.0` —
visibly **not** 0-substituted. The stature-dominant composite adds the
inversion's inputs as informational entries (weight 0; `null` when no usable
career row): `career_stature_score`, `career_stature_index`,
`career_stature_coverage`, `stature_target_score`, `tournament_modulation`,
`raw_tournament_score`, `stature_model_weight`, `stature_path`, `raw_path`
— so the blend that produced `score_0_100` is fully auditable from the
emitted row alone, with no `_career_lift` field anywhere.

## Determinism & validation

Fixed canonical input → byte-identical `etl/output/ratings.json`. Guarded by
`etl/tests/test_rating.py` — the Phase 1 acceptance suite:

- determinism + committed-golden equality + sorted rows + schema bounds
- **distribution shape** (floor 66, median ~73, p95 ~88, max 99, no 100s,
  thin elite tail)
- **low-DOF curve guard** (3 exponents, 4 measured anchors, no per-player map)
- **display-curve ordering preservation** (monotonic by construction)
- **public-award TRAIN/HELD-OUT split** (Golden Ball/Boot/Glove on TRAIN;
  Silver/Bronze + Best Young Player on HELD-OUT; HELD-OUT must pass after the
  curve was fit only on the global anchors — proves no overfit)
- **pre-1982 era sanity** (Golden Ball was first awarded at WC-1978; pre-1978
  Golden Boot winners must not be systematically under-rated)
- **estimate-band integrity** (count, band, honest-state nulls, can't
  out-rate measured greats)
- honest-state nulls (appearances, team_finish)
- **proprietary-source provenance audit** — zero hits for `sofifa`, `futbin`,
  `fifa-ratings`, `easports`, `pro evolution soccer`, `efootball`, etc., in
  `etl/sources/` and `etl/supplement/raw/`

CI additionally enforces byte identity with `git diff --exit-code` after a
clean rebuild.

## Sanity bands (asserted, not eyeballed — `wc-perf-4.2.0` display scale)

| Card | overall | Band rationale |
|---|---|---|
| Maradona '86 (MF, Golden Ball, champion) | 96–99 | decorated apex |
| Zidane '06 (MF, Golden Ball, runner-up) | 96–99 | decorated apex |
| Pelé '58 (FW, Best Young Player + Silver Boot, champion) | ≥93 | youngest apex performer |
| Fontaine '58 (FW, Golden Boot, 13 goals, 3rd) | ≥90 | era-normalized within 1958 |
| Pelé '70 (FW, champion, no individual award) | ≥85 | champion, no Golden Ball in 1970 |
| Moore '66 (DF, champion, 6 apps sourced from RSSSF) | ≥88 | top of DF band |
| Puskás '54 (FW, runner-up) | ≥80 | clearly above modern journeyman |
| Mertesacker '14 (DF, champion, 6 apps, 0 goals) | ≥88 | DF not rated on goals |
| Rodrigo '18 (FW, 0 goals, 3 apps, no run) | ≤80 | modern journeyman |

Estimate-tier cards (`baseline_anchor_estimate`) land in `[66, 73]` on overall
AND every channel — the honest "no individual signal" reading, never below
the display floor and never above the estimate ceiling.

## Migration & versioning (season merge)

- `rating_version`: historical `wc-perf-2.0.0` → `wc-perf-4.2.0` (cumulative
  through the merit-v2 series — stature-dominant composite at 4.0.0,
  defender honors at 4.1.0, unified display curve at 4.2.0; no
  intermediate version shipped to prod).
- Projected 2026: `proj-career-2.0.0` → `proj-career-3.0.0` (the MV2-5
  reconcile onto the stature scale + the quantile map). See
  `RATING_METHODOLOGY_2026.md`.
- `career_stature.json` (the per-player composite the ratings consume):
  `career-stature-2.0.0` → `career-stature-2.1.0` (MV2-3.5 defender-honor
  sources, position-balanced family weights).
- Runtime data schema: `runtime-data-1.0.0` → `runtime-data-1.1.0`
  (`legend` is REQUIRED on every compact rating row — MV2-10).
- The sim `engine_version`: `engine-2026.06.04` → `engine-2026.06.09` —
  the cumulative E-3a + E-4 + MV2-11b bump landed atomically at the
  season merge. The MV2-11b λ refit is documented in
  `packages/core/SIM_CALIBRATION.md`.
- The combined-`rv` token skew machinery in `apps/web/lib/game/` (the
  `run-token` skew test pins both the pre-engine-v2 PREV anchors and the
  immediate-prior `engine-2026.06.08` + `wc-perf-3.0.0` PREV anchors)
  invalidates every outstanding `?run=` link minted against the prior
  prod build via the existing "different build" notice.

## Known seam — `tournament_id` shape

Rating records carry the **canonical string** `tournament_id` (`"WC-1986"`) and
the matching `card_id`, so `ratings.json` joins 1:1 with
`player_tournaments.json`. The runtime core `Rating` zod contract wants a
**numeric** `tournament_id`; mapping the canonical string to that numeric id
is the later `packages/data` emit-lock step and is deliberately out of scope
here. Apart from that key shape, records are the core `Rating` shape
field-for-field.
