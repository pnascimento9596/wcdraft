# wcdraft Player Rating — Methodology (`wc-perf-6.2.0`)

> **wc-perf-6.2.0 / proj-career-5.2.0 / career-stature-4.1.0
> (merit-v4.2):** historical tournament scoring keeps the merit-v4
> stature-dominant formula family, but raw-only rows now consume public factual
> per-player context from pinned squad tables: caps, international goals where
> present, club-league context, and tournament role. The context term only
> allocates inside each row's existing replacement-to-raw-ceiling band; it is
> inactive for career-stature-dominant and award-headroom rows, so it cannot
> manufacture new elite ratings. The measured display floor widens from 66 to
> 60 for non-estimate rows so weak-squad differences remain visible instead of
> rounding into identical filler clusters. Fan votes and proprietary ratings
> remain excluded. merit-v4.2 refits λ after the rating/channel movement; runtime
> stamp is `engine-2026.06.15-merit-v4.2`. Measured emitted counts:
> 10,973 historical rows + 1,246 projected rows = 12,219 runtime ratings;
> top-level Career basis counts are `measured_performance=11,292`,
> `career_stature_estimate=541`, `baseline_anchor_estimate=386`; compact
> legend census is 295.
>
> **wc-perf-4.2.1 (basis-gate stature alignment):** the internal merit model, the
> four sim channels, the display curve, and the engine were unchanged. The single
> change was the `overall_basis` classifier. Under wc-perf-4.2.0 the classifier
> keyed `is_material_elite` on `career_stature_index ≥ 0.50` — a strictly
> TIGHTER predicate than the v4 ramp's dominance threshold
> (`stature_model_weight ≥ STATURE_DOMINANT_WEIGHT = 0.5`, which the ramp
> reaches at `career_stature_index ≥ MATERIAL_STATURE_MIN_INDEX = 0.40`). A
> no-individual-signal card with index in `[0.40, 0.50)` had stature drive its
> internal score yet was mislabeled `baseline_anchor_estimate` and display-capped
> into `[66, 73]`. The classifier was reordered to make the dominance check
> primary — `if weight ≥ STATURE_DOMINANT_WEIGHT → career_stature_estimate;
elif not has_individual_signal → baseline_anchor_estimate; else
measured_performance` — and the now-dead `CAREER_ESTIMATE_MIN_INDEX` constant
> was removed. **Population delta:** exactly one card moved
> (Sepp Maier P-14080:WC-1966, GK, `career_stature_index=0.446`,
> `stature_model_weight=0.881`, `score_0_100=62.19`), with `overall`
> 73 → 88 and basis `baseline_anchor_estimate` → `career_stature_estimate`.
>
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

| Signal                  | Source                                                                      | Availability                                                                                          | When absent                                                            |
| ----------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Goals (excl. own goals) | `player_tournaments.goals`                                                  | 1930+ (all eras)                                                                                      | n/a — always present                                                   |
| Match appearances       | `player_tournaments.appearances`                                            | native **1970+**; **pre-1970 sourced from RSSSF** (WS-A supplement, `appearances_source` tags origin) | `null` → **dropped**, never 0 (still null where no RSSSF lineup links) |
| Awards                  | `player_tournaments.awards`                                                 | 1930+, staggered intro                                                                                | `[]` = confirmed none (real 0 lift)                                    |
| Team final placement    | `manager_tournaments.final_placement` keyed by `(nation_id, tournament_id)` | **semifinalists only** (1–4)                                                                          | `null` → **dropped**, never 0                                          |
| Coarse position         | `player_tournaments.position_listed` (fallback: `players.primary_position`) | all eras                                                                                              | — selects the weighting, not scored                                    |

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
   map them onto the fixed display targets. In merit-v4.2 the measured-row
   targets are (60, 73, 88, 99); older wc-perf-2.x/4.x display curves used
   a 66 floor. Apply the curve
   to `overall` ONLY (decoupled — see §3.2 fallback). The four sim channels
   are derived directly from `score_0_100` via `_channel(score_0_100, spread)`
   and stay on the pre-recal `[FLOOR_CHANNEL, 100]` band; they are NOT
   passed through the display curve.

This is deterministic: same canonical input -> same internal scores -> same
fitted curve anchors -> byte-identical `ratings.json`, with the oversized file
locked by `etl/output/ratings.lock.json` rather than tracked by normal git.

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
| ------------ | ----- | ----------- |
| FW           | 0.75  | 0.25        |
| MF           | 0.40  | 0.60        |
| DF           | 0.00  | 1.00        |
| GK           | 0.00  | 1.00        |

A defender or keeper is **never rated on goals**.

`REPLACEMENT_BASE = 0.20` is the INTERNAL replacement baseline, **not** the
emitted display floor. merit-v4.2 maps it via the curve onto the measured
display floor 60.
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
| -------- | ------------ | ------------- |
| FW       | 0.20         | 0.16          |
| MF       | 0.22         | 0.16          |
| DF       | 0.18         | 0.24          |
| GK       | 0.22         | 0.28          |

## The display calibration curve (Phase 1 reshape; unified pool in MV2-6)

The curve takes the internal `score_0_100` and maps it onto the display band:

```
DISPLAY_CURVE_KIND  = "unified_pooled_piecewise_power_v2"
DISPLAY_FLOOR       = 60
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
    y = DISPLAY_P95   + (DISPLAY_MAX − DISPLAY_P95)   · t^DISPLAY_HIGH_EXPONENT  (= 2.00)
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
| -------- | ------ | -------- | ------- | ----------- |
| FW       | 1.00   | 0.60     | 0.30    | 0.00        |
| MF       | 0.65   | 1.00     | 0.60    | 0.00        |
| DF       | 0.35   | 0.60     | 1.00    | 0.00        |
| GK       | 0.05   | 0.20     | 0.55    | 1.00        |

This is the **DECOUPLED path** (plan §3.2 fallback): the rating display
curve drives `overall` ONLY. The four sim channels stay on the
pre-recalibration `[FLOOR_CHANNEL, 100]` band so the engine's λ
stays calibrated to the engine's full attack-minus-defense range. When
semantic rating changes move the internal scores/channels, lambda must be
re-fit before realism bands are re-locked; merit-v4, merit-v4.1, and
merit-v4.2 all did that, with merit-v4.2 stamping the result as
`engine-2026.06.15-merit-v4.2`.

## Stature-dominant composite (`wc-perf-6.2.0`)

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
(`career-stature-4.1.0`, 847 person-identity rows, 209 material rows,
114 source-derived legend rows, active-career facts, eligibility
normalization, sparse-fact saturation, club-season honors, and objective
club-honors facts over the locked merit source sets). The blend **ramps continuously** from
raw-only (`weight = 0`) to stature-dominant (`weight = 1`) across a small band
around the material-stature index threshold, so two near-identical cards
straddling the threshold do not land far apart (no cliff). Tournament context
is a **signed, bounded modulation**: a weak tournament lowers the stature
target within a (tier-tightened) down-cap; an apex tournament raises it within
an up-cap.

| Constant                        | Value                                                               | Role                                                                                        |
| ------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `MATERIAL_STATURE_MIN_COVERAGE` | `0.25`                                                              | coverage gate to enter the stature-dominant path                                            |
| `MATERIAL_STATURE_MIN_INDEX`    | `0.40`                                                              | index gate to enter the stature-dominant path                                               |
| `STATURE_RAMP_HALF_WIDTH`       | `0.06`                                                              | half-width of the continuity ramp on `career_stature_index`                                 |
| `STATURE_DOMINANT_WEIGHT`       | `0.5`                                                               | weight at/above which stature path dominates the final blend                                |
| `STATURE_TARGET_FLOOR`          | FW 0.60 · MF 0.60 · DF 0.60 · GK 0.58                               | internal-score floor at the material-stature threshold                                      |
| `STATURE_TARGET_SPAN`           | FW 0.40 · MF 0.40 · DF 0.38 · GK 0.38                               | headroom from the floor to the all-time peak (index ≈ 1.0)                                  |
| `TOURNAMENT_MOD_GAIN`           | FW 0.40 · MF 0.40 · DF 0.35 · GK 0.30                               | gain on the (raw − cohort_median) delta                                                     |
| `TOURNAMENT_UP_CAP`             | FW 0.08 · MF 0.08 · DF 0.07 · GK 0.06                               | positive modulation cap                                                                     |
| `TOURNAMENT_DOWN_CAP`           | per-tier {gold/silver/bronze} = {0.05–0.06, 0.08–0.09, 0.11–0.12}   | tier-tightened downward cap                                                                 |
| `COHORT_MIN_N`                  | `8`                                                                 | (tournament, pos) cohort size needed before using its median                                |
| `RAW_ONLY_GLOBAL_CEILING`       | top prior `0.625`; per-card national-strength prior `0.500`-`0.625` | internal-score ceiling on `raw_path` for non-material/no-award cards                        |
| `RAW_AWARD_HEADROOM`            | `0.18`                                                              | award-gated soft headroom above the raw-only ceiling for documented major individual awards |

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

## `overall_basis` semantics (`wc-perf-6.2.0`)

The three-label split now describes the Career compatibility surface emitted
in top-level `ratings[]`; `basis_ratings.current` carries its own basis label
for the at-tournament path.

- **`measured_performance`** (11,292 runtime cards: 10,107 historical + 1,185 projected) — the card had at least one
  positively-weighted individual signal (goals for FW/MF, appearances for
  any position), or a projected raw path in 2026. The vast majority of cards,
  including the pre-1970 cards whose appearances came from the RSSSF supplement.
- **`career_stature_estimate`** (541 runtime cards: 480 historical + 61 projected) — the
  player's career row is material and the stature path dominates the Career
  blend (`stature_weight ≥ STATURE_DOMINANT_WEIGHT`). This can apply even when
  the card has measured tournament signals: the label reports what primarily
  drives the Career score, not whether a box score exists.
- **`baseline_anchor_estimate`** (386 runtime cards, all historical) — residual cards with no
  individual signal **and** no material career record: a pre-1970 DF/GK
  whose appearances could not be sourced. Computed from the replacement
  baseline + anchor, capped into `[66, 73]` after the curve, **no
  individual box score invented**, low coverage flagged. (Pre-MV2-10 this
  was 388 before the merit-v2 basis fixes; the compact integrity test locks
  this at 386.)

> The "Maier-class basis-gate" sub-defect the season gate review #2 flagged
> (the classifier keyed on the legacy `CAREER_ESTIMATE_MIN_INDEX = 0.50`
> instead of the ramp's dominance threshold, so a no-signal card with
> `index ∈ [0.40, 0.50)` kept the stale baseline label and the `[66, 73]`
> cap) is FIXED in `wc-perf-4.2.1` — see the top-of-file changelog. The
> label now tracks the blend decision exactly:
> `stature_model_weight ≥ STATURE_DOMINANT_WEIGHT ⇔ career_stature_estimate`
> for no-signal cards.

## 2026 reconcile (`proj-career-5.2.0`, merit-v4.2)

The 2026 rating model (`etl/src/wcdraft_etl/rating_2026.py`) shares the
stature-dominant scale with the historical model:

- **Linked and minted material 2026 players** evaluate through the same
  `stature_target(pos, index)` floor/span, the same continuity ramp, and
  the same tier-tightened modulation caps. A current great's projected
  card sits on the same internal band as their historical greats.
- **Age-conditioned evidence** replaces all-age caps/goals percentiles and
  removes the former `age_factor`; youth no longer gets punished once by
  all-age accumulation and again by an age multiplier.
- **League-of-employment strength** remains present but is no longer a
  dominant pre-tournament prior: `FW/MF/DF/GK` weights move from
  `0.31/0.34/0.31/0.28` to `0.18/0.20/0.18/0.16`, so objective individual
  record can overcome club-league context while ordinary weak-league players
  still stay on the measured raw path.
- **Projected objective-record material entry** is 2026-only and conservative.
  It requires a linked career-stature row with minimum coverage/index plus
  active current facts or membership in the under-covered AFC/CAF/CONCACAF
  2026 squad set, and it is limited to citation-backed objective families
  such as continental club titles, continental/international objective awards,
  captaincy, and high caps/goals records. Ambiguous names stay withheld.
- **Non-material 2026 cards** are placed onto the historical raw-only
  internal distribution via an **empirical quantile map**
  (`_raw_only_quantile_map`): the card's percentile within the 2026
  pure-raw-only (`weight == 0`) projected-raw cohort is read off the
  historical raw-only internal scale at the same percentile. This
  density-neutralizes the 2026 raw composite (which runs hot relative to
  the historical box score) instead of affine-rescaling its bounds — so a
  2026 reserve at percentile _p_ lands at the same internal score as a
  historical raw-only card at percentile _p_ (e.g. a 2026 bench defender
  aligns with a Mangala-2014-class historical reserve, not above it).
- **Factual context declustering** then allocates non-material/no-award rows
  inside that existing raw-only band using caps, international goals, and
  club-league context. The 2026 model deliberately omits tournament role because
  no 2026 tournament minutes exist yet.
- Aging legends take **downward** projected modulation but never collapse
  below recognized stature (the down-cap is tightest at the gold tier).

Once the raw COMPONENT is on the historical scale, the rest of the 2026
formula is the SAME stature-dominant blend used historically — including
the continuity ramp through the material band. The Current basis is the
age-conditioned projected raw path with no career-stature blend.

## Unified display curve (`wc-perf-6.2.0` — merit-v4.2 curve)

Phase 1 introduced one global low-DOF monotonic curve on the four internal
quantiles of the emitted dataset. In merit-v4.2 those anchors map to
60, 73, 88, 99 for measured rows while the curve form is unchanged.
**What MV2-6 changed** is the data the four anchors
are fit on: rather than fitting one curve on the historical pool and a
second one on the 2026 pool, a **single** curve is fit on the **pooled
historical + 2026** internal distribution
(`display_curve.fit_unified_curve`) and applied identically to BOTH eras.
MV2-5 made the two internal scales cross-era fair (2026 non-material cards
quantile-mapped onto the historical raw-only distribution), so one pooled
curve is the honest mapping — no per-era table, no per-player pin.

For merit-v4.2 the curve kind is
`unified_pooled_piecewise_power_v2`, fit over the union of both bases'
internal pools (historical Career + historical Current + projected Career +
projected Current; n=24,438). The 2026 cards (`proj-career-5.2.0`) ship
through the same unified curve. merit-v4.2 refits against the factual
declustering distribution and widens the measured floor to 60 without
introducing a per-player map. This remains a display-`overall` mapping;
the sim channels are still derived from internal scores, not from the
display curve.

## Coverage & provenance

`coverage` is the per-card signal-coverage fraction (0.6667 / 0.8333 / 1.0).
A `baseline_anchor_estimate` is always `< 1.0`. Low-coverage ratings are
**flagged, not faked**. `coverage_basis = "wc_signals"`,
`provenance = "wc_performance"`, `appearances_source` records the appearance
origin (`fjelstul_match_events` / `rsssf_starting_xi` / `null`), and
`rating_version = "wc-perf-6.2.0"` (a replay anchor — bump on any change to
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

Fixed canonical input -> byte-identical `etl/output/ratings.json`, locked by
the tracked `etl/output/ratings.lock.json` sha256/byte-count fingerprint.
Guarded by `etl/tests/test_rating.py` — the Phase 1 acceptance suite:

- determinism + tracked-lock equality + sorted rows + schema bounds
- **distribution shape** (measured floor 60, median ~73, p95 ~88, max 99, no 100s,
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

CI additionally regenerates the artifact and enforces that the tracked lockfile
does not drift after a clean rebuild.

## Sanity bands (asserted, not eyeballed — `wc-perf-6.2.0` display scale)

| Card                                                     | overall | Band rationale                   |
| -------------------------------------------------------- | ------- | -------------------------------- |
| Maradona '86 (MF, Golden Ball, champion)                 | 96–99   | decorated apex                   |
| Zidane '06 (MF, Golden Ball, runner-up)                  | 96–99   | decorated apex                   |
| Pelé '58 (FW, Best Young Player + Silver Boot, champion) | ≥93     | youngest apex performer          |
| Fontaine '58 (FW, Golden Boot, 13 goals, 3rd)            | ≥90     | era-normalized within 1958       |
| Pelé '70 (FW, champion, no individual award)             | ≥85     | champion, no Golden Ball in 1970 |
| Moore '66 (DF, champion, 6 apps sourced from RSSSF)      | ≥88     | top of DF band                   |
| Puskás '54 (FW, runner-up)                               | ≥80     | clearly above modern journeyman  |
| Mertesacker '14 (DF, champion, 6 apps, 0 goals)          | ≥88     | DF not rated on goals            |
| Rodrigo '18 (FW, 0 goals, 3 apps, no run)                | ≤80     | modern journeyman                |

Estimate-tier cards (`baseline_anchor_estimate`) land in `[66, 73]` on overall.
Their sim channels remain on the `[FLOOR_CHANNEL, 100]` channel scale described
above and naturally sit near the floor because the underlying merit signal is
low. The estimate band is a display-overall promise, not a channel clamp.

## Migration & versioning (merit-v4.2)

- Historical `rating_version`: `wc-perf-6.1.0` -> `wc-perf-6.2.0`.
- Projected 2026 `rating_version`: `proj-career-5.1.0` ->
  `proj-career-5.2.0`.
- `career_stature.json` remains `career-stature-4.1.0`; source set remains
  `merit-source-set-2.2.0`; active source set remains
  `active-career-source-set-2.2.0`.
- Runtime data schema: `runtime-data-2.3.0` -> `runtime-data-2.4.0`.
- Sim `engine_version`: `engine-2026.06.14-merit-v4.1` ->
  `engine-2026.06.15-merit-v4.2` after the λ refit documented in
  `packages/core/SIM_CALIBRATION.md`.
- Compact candidate counts: 12,219 ratings, 295 runtime legends,
  541 Career `career_stature_estimate`, 386 Career `baseline_anchor_estimate`.
- Strategic-pick canary was regenerated after the rating/channel movement.

## Migration & versioning (merit-v4)

- Historical `rating_version`: `wc-perf-5.1.0` → `wc-perf-6.0.0`.
- Projected 2026 `rating_version`: `proj-career-4.1.0` →
  `proj-career-5.0.0`.
- `career_stature.json`: `career-stature-3.1.0` →
  `career-stature-4.0.0`; source set is `merit-source-set-2.2.0`;
  active source set remains `active-career-source-set-2.1.0`.
- Runtime data schema: `runtime-data-2.1.0` → `runtime-data-2.2.0`.
- Sim `engine_version`: `engine-2026.06.13` →
  `engine-2026.06.13-merit-v4` after the λ refit documented in
  `packages/core/SIM_CALIBRATION.md`.
- Compact candidate counts: 12,219 ratings, 295 runtime legends,
  505 Career `career_stature_estimate`, 386 Career `baseline_anchor_estimate`,
  1,434,342 total brotli bytes.

## Migration & versioning (merit-v3.1 candidate)

- Historical `rating_version`: `wc-perf-5.0.0` → `wc-perf-5.1.0`.
- Projected 2026 `rating_version`: `proj-career-4.0.0` →
  `proj-career-4.1.0`.
- `career_stature.json`: `career-stature-3.0.0` →
  `career-stature-3.1.0`; source set is `merit-source-set-2.1.0`;
  active source set is `active-career-source-set-2.1.0`.
- Runtime data schema: `runtime-data-2.0.0` → `runtime-data-2.1.0`.
- Sim `engine_version`: unchanged at `engine-2026.06.12`; W3 stopped before
  any 88-wall implementation and the display curve/lambda path stayed unchanged.
- Compact candidate counts: 12,219 ratings, 287 runtime legends,
  482 Career `career_stature_estimate`, 386 Career `baseline_anchor_estimate`.

## Migration & versioning (merit-v3 season merge)

- Historical `rating_version`: `wc-perf-4.2.1` → `wc-perf-5.0.0`.
- Projected 2026 `rating_version`: `proj-career-3.0.0` →
  `proj-career-4.0.0`.
- `career_stature.json`: `career-stature-2.1.0` →
  `career-stature-3.0.0`; active source set is
  `active-career-source-set-2.0.0`.
- Runtime data schema: `runtime-data-1.2.0` → `runtime-data-2.0.0`
  (dual-basis rating payload; top-level `ratings[]` remains the Career
  alias).
- Sim `engine_version`: `engine-2026.06.11` → `engine-2026.06.12` in V8,
  after the V7 λ refit documented in `packages/core/SIM_CALIBRATION.md`.
- Token skew fixtures now include the real post-draft-config production
  manifest (`engine-2026.06.11` / `runtime-data-1.2.0`) as a committed PREV
  case so old production tokens surface an honest different-build notice
  against the merit-v3 anchors.

## Known seam — `tournament_id` shape

Rating records carry the **canonical string** `tournament_id` (`"WC-1986"`) and
the matching `card_id`, so `ratings.json` joins 1:1 with
`player_tournaments.json`. The runtime core `Rating` zod contract wants a
**numeric** `tournament_id`; mapping the canonical string to that numeric id
is the later `packages/data` emit-lock step and is deliberately out of scope
here. Apart from that key shape, records are the core `Rating` shape
field-for-field.
