# wcdraft Player Rating — Methodology (`wc-perf-2.0.0`)

> **wc-perf-2.0.0 (Phase 1 rating recalibration):** the internal merit model is
> UNCHANGED — same era-normalized percentiles, same independent award/finish
> anchors, same honest-state semantics. A single new **display calibration
> curve** maps the internal `score_0_100` onto the documented display band
> `[66, 99]`, simultaneously reshaping `overall` AND the four sim channels.
> `baseline_anchor_estimate` cards are additionally capped into the estimate
> band `[66, 73]`. The **decoupled path** landed (plan §3.2 fallback): the sim λ in
> `packages/core/src/engine/calibration.ts` was retuned so WC-like scoreline
> distributions stay believable on the compressed channel range. The Phase 1
> change ships only the curve + retune; new stature signals (Ballon d'Or, all-
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
the curve + retune — no new ingestion.

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
   to BOTH `overall` AND the four sim channels.

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

## The display calibration curve (the Phase 1 reshape)

The curve takes the internal `score_0_100` and maps it onto the display band:

```
DISPLAY_CURVE_KIND  = "global_piecewise_power_v1"
DISPLAY_FLOOR       = 66
DISPLAY_MEDIAN      = 73
DISPLAY_P95         = 88
DISPLAY_MAX         = 99

ESTIMATE_FLOOR      = 66
ESTIMATE_CEILING    = 73
```

### Algorithm

The curve is fit on four global INTERNAL quantiles of the EMITTED dataset
(historical men's cards or projected 2026 cards, fitted separately):

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

`baseline_anchor_estimate` cards apply the curve and are then **clamped into
`[ESTIMATE_FLOOR, ESTIMATE_CEILING] = [66, 73]`** on both `overall` AND every
channel. The honest-state semantics are preserved: missing components remain
`null`, coverage stays low, the flag is kept. Estimates can never out-rate a
measured great (asserted).

### The four sim channels (decoupled, Phase 1.1)

The sim consumes only `attack / midfield / defense / goalkeeping` (never
`overall`). After the curve is applied to the card, the off-position channels
are a convex blend toward `DISPLAY_FLOOR = 66` (not the old raw floor 20):

```
display = _display_value(score_0_100, curve, estimate)
channel = round( display · spread[pos][channel] + 66 · (1 − spread[pos][channel]) )
```

| spread → | attack | midfield | defense | goalkeeping |
|---|---|---|---|---|
| FW | 1.00 | 0.60 | 0.30 | 0.00 |
| MF | 0.65 | 1.00 | 0.60 | 0.00 |
| DF | 0.35 | 0.60 | 1.00 | 0.00 |
| GK | 0.05 | 0.20 | 0.55 | 1.00 |

This is the RECOUPLED path: the rating display curve drives both display AND
sim. The sim λ in `packages/core/src/engine/calibration.ts` was retuned in the
same atomic landing to keep WC-like scoreline distributions believable on the
compressed channel range — display-only decoupling was not used. See
`packages/core/SIM_CALIBRATION.md` for the λ retune landing report.

## `overall_basis` semantics (unchanged)

- **`measured_performance`** — the card had at least one positively-weighted
  individual signal (goals for FW/MF, appearances for any position). The vast
  majority of cards, including ~1,573 pre-1970 cards whose appearances came
  from the RSSSF supplement.
- **`baseline_anchor_estimate`** — residual cards with no linkable individual
  signal: a pre-1970 DF/GK whose appearances could not be sourced. Computed
  from the replacement baseline + anchor, capped into `[66, 73]` after the
  curve, **no individual box score invented**, low coverage flagged. Exactly
  388 cards in the current dataset (unchanged from `wc-perf-1.1.0` — Phase 1
  did not change the basis logic).

## Coverage & provenance

`coverage` is the per-card signal-coverage fraction (0.6667 / 0.8333 / 1.0).
A `baseline_anchor_estimate` is always `< 1.0`. Low-coverage ratings are
**flagged, not faked**. `coverage_basis = "wc_signals"`,
`provenance = "wc_performance"`, `appearances_source` records the appearance
origin (`fjelstul_match_events` / `rsssf_starting_xi` / `null`), and
`rating_version = "wc-perf-2.0.0"` (a replay anchor — bump on any change to
weights, normalization, or the display curve).

## `components[]` transparency

Every rating carries its inputs: raw `goals`/`appearances` (weight 0,
informational), the era-normalized `goals_percentile` / `appearances_percentile`
with their **effective** base weights, and `award_score` / `team_finish` with
their anchor weights. A dropped signal shows `value: null, weight: 0.0` —
visibly **not** 0-substituted.

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

## Sanity bands (asserted, not eyeballed — Phase 1 display scale)

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

## Migration & versioning

- `rating_version` changes `wc-perf-1.1.0` → `wc-perf-2.0.0`.
- Projected 2026 ratings change `proj-career-1.0.0` → `proj-career-2.0.0`
  (same display curve and shared helpers; see `RATING_METHODOLOGY_2026.md`).
- The runtime data schema is **unchanged**; the combined-`rv` token skew
  machinery in `apps/web/lib/game/` invalidates stale persisted runs
  automatically via the existing "different build" notice.
- The sim engine version bumped `engine-2026.06.04` → `engine-2026.06.06`
  because λ retuning moves deterministic `RunResult` bytes.

## Known seam — `tournament_id` shape

Rating records carry the **canonical string** `tournament_id` (`"WC-1986"`) and
the matching `card_id`, so `ratings.json` joins 1:1 with
`player_tournaments.json`. The runtime core `Rating` zod contract wants a
**numeric** `tournament_id`; mapping the canonical string to that numeric id
is the later `packages/data` emit-lock step and is deliberately out of scope
here. Apart from that key shape, records are the core `Rating` shape
field-for-field.
