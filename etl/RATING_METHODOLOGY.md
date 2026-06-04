# wcdraft Player Rating — Methodology (`wc-perf-1.1.0`)

> **wc-perf-1.1.0 (WS-A supplement):** two changes from 1.0.0 — (1) pre-1970
> tournament **appearances are now sourced** from the RSSSF match archive and
> linked to `player_id` (see `etl/output/supplement/SUPPLEMENT.md`), so the
> era-dependent appearance signal exists for most pre-1970 cards; (2) **`overall`
> is never null** — a card with no linkable individual signal is rated from the
> replacement baseline + the era anchor as an honest, flagged *estimate* rather
> than withheld. The integrity firewall below is unchanged: no stat is invented.

The per-card player **Rating** is wcdraft's moat: an original, era-normalized,
position-weighted, awards-anchored score computed deterministically from the
factual public signals in the canonical tables. This document is the
human-readable companion to `etl/src/wcdraft_etl/rating.py`; the code is the
source of truth and every constant below is `CALIBRATION`-flagged there (tunable
without touching the algorithm, and golden-locked when changed).

## Legal firewall (non-negotiable)

Every number is derived **only** from factual public signals — World Cup goals,
match appearances, official FIFA awards, team final placement, and listed
position. **Nothing** is ingested, mirrored, scraped, or "lightly perturbed"
from EA Sports FC or any other proprietary rating set. A perturbed copy of a
proprietary rating would still be a derivative; this formula is entirely
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

**Deliberately not used** (absent at every era — never fabricated): assists,
minutes, career caps, club. **Captaincy** is listed as a candidate signal in the
brief but is **not present** in the ingested `player_tournaments` table, so it is
honestly dropped here rather than invented.

**Scope:** men's tournaments 1930–2022 (the contract's gameplay scope). The
canonical tables also contain 8 women's editions (2,870 cards); those are
**explicitly excluded** here — `run()` reports the rated count (10,973) so the
exclusion is surfaced, not silent. Projected 2026 ratings are a separate
follow-on (no 2026 squads ingested yet).

## The formula

For each card, with coarse position `pos ∈ {GK, DF, MF, FW}`:

```
overall_score (0..1) = clamp01( base + award_lift + finish_lift )
```

### 1. Era normalization — within-cohort percentile (the equalizer)

The two era-dependent performance signals (goals, appearances) are converted to a
**mid-rank percentile within their `(tournament, position)` cohort**:

```
pct(v) = ( #cohort-values strictly < v  +  0.5 · #equal to v ) / N
```

A value is ranked against its **own contemporaries at its own position**, so a
1954 striker and a 2022 striker land on the same 0..1 scale despite very
different raw counts — this is what stops data-rich modern players from dwarfing
pre-1990 greats. Ties are split deterministically; a singleton or all-equal
cohort maps to `0.5` (neutral). Awards and team finish are **not** normalized —
they are the cross-era anchors (below).

### 2. Performance base

A position-weighted blend of the **present** normalized performance signals,
renormalized over whatever is present (honest-state drop), then mapped onto the
band `[0.20, 0.68]`:

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

A defender or keeper is **never rated on goals**. For FW/MF cards with absent
pre-1970 appearances, the present-signal blend uses goals only; for DF/GK, goals
remain zero-weight and are never a fallback.
The `[0.20, 0.68]` band is intentional: raw box-score performance can only carry a
card to "very good" — reaching the top of the scale **requires** the anchor.

### 3. Cross-era anchors (awards + team finish)

Two **independent, additive, era-invariant** lifts. Keeping them separate is
deliberate: if they shared one saturating term, a champion's finish alone would
max it and an additional Golden Ball would add nothing — letting a squad
defender tie Maradona. Separated, a decorated champion correctly out-rates an
undecorated one.

```
award_lift  = AWARD_WEIGHT[pos]  · award_score
finish_lift = FINISH_WEIGHT[pos] · finish_points
```

- `award_score = 1 − Π(1 − pᵢ)` over held awards (saturating, capped at 1):
  Golden Ball 1.00, Silver 0.70, Bronze 0.50; Golden Boot 0.90, Silver 0.60,
  Bronze 0.45; Golden Glove 0.85; Best Young Player 0.55. An unrecognized award
  name raises (drift protection) — never silently dropped.
- `finish_points`: champion 1.00, runner-up 0.75, third 0.55, fourth 0.40;
  non-semifinalist → `null` → contributes 0 lift (dropped, **not** a 0 placement).

| Position | AWARD_WEIGHT | FINISH_WEIGHT |
|---|---|---|
| FW | 0.20 | 0.16 |
| MF | 0.22 | 0.16 |
| DF | 0.18 | 0.24 |
| GK | 0.22 | 0.28 |

Finish is weighted **up** for DF/GK (team defensive success is their headline
signal) and **down** for FW (whose own box score already carries the base).

### 4. The four sim channels

The sim consumes only `attack / midfield / defense / goalkeeping` (never
`overall`). Each card's own-position channel gets the full score; off-position
channels are a convex blend toward a replacement floor (20), with outfielders
floored in goalkeeping:

```
channel = round( score·100 · spread[pos][channel] + 20 · (1 − spread[pos][channel]) )
```

| spread → | attack | midfield | defense | goalkeeping |
|---|---|---|---|---|
| FW | 1.00 | 0.60 | 0.30 | 0.00 |
| MF | 0.65 | 1.00 | 0.60 | 0.00 |
| DF | 0.35 | 0.60 | 1.00 | 0.00 |
| GK | 0.05 | 0.20 | 0.55 | 1.00 |

### 5. `overall` is always real — measured, or an honest flagged estimate

`overall = round(score·100)` for **every** card; there is no null path.

- **`overall_basis = "measured_performance"`** — the card had at least one
  positively-weighted individual signal (goals for FW/MF, appearances for any
  position). This is the vast majority (10,585 of 10,973), including the ~1,573
  pre-1970 cards whose appearances the WS-A supplement sourced from RSSSF.
- **`overall_basis = "baseline_anchor_estimate"`** — the residual cards with no
  linkable individual signal: a pre-1970 DF/GK whose appearances could not be
  sourced (goals carry zero weight for them). Rather than withhold the number
  (the old 1.0.0 null path), it is computed from the **replacement baseline +
  the era-invariant team-finish / award anchor**. This is an honest *estimate*,
  not a fabricated stat: **no individual box score is invented** — the absent
  appearances stay `null` in `components` — and the estimate is flagged here and
  carried at **low coverage** (< 1.0). In the current dataset this is exactly
  388 pre-1970 DF/GK cards (down from 933 in 1.0.0, because sourcing filled the
  rest), and **only** those (asserted in tests). A non-placed, undecorated such
  card sits on the replacement floor (`overall = 20`), which is the honest
  "replacement-level, unmeasured" reading — not a confident score.

The four sim channels are emitted for all cards exactly as in 1.0.0.

## Coverage & provenance

`coverage` is the per-card signal-coverage fraction (0.6667 / 0.8333 / 1.0). It
now **rises for a pre-1970 card once its appearances are sourced** (the
appearance signal becomes present), so it directly encodes confidence:
a `baseline_anchor_estimate` is always < 1.0. Low-coverage ratings are
**flagged, not faked**. `coverage_basis = "wc_signals"`,
`provenance = "wc_performance"`, `appearances_source` records the appearance
origin (`fjelstul_match_events` / `rsssf_starting_xi` / `null`), and
`rating_version = "wc-perf-1.1.0"` (a replay anchor — bump on any change to
weights, normalization, or channel mapping).

## `components[]` transparency

Every rating carries its inputs: raw `goals`/`appearances` (weight 0,
informational), the era-normalized `goals_percentile` / `appearances_percentile`
with their **effective** base weights, and `award_score` / `team_finish` with
their anchor weights. A dropped signal shows `value: null, weight: 0.0` — visibly
**not** 0-substituted.

## Known seam — `tournament_id` shape

Rating records carry the **canonical string** `tournament_id` (`"WC-1986"`) and
the matching `card_id`, so `ratings.json` joins 1:1 with `player_tournaments.json`.
The runtime core `Rating` zod contract wants a **numeric** `tournament_id`;
mapping the canonical string to that numeric id is the later `packages/data`
emit-lock step and is deliberately out of scope here. Apart from that key shape,
records are the core `Rating` shape field-for-field.

## Determinism & validation

Fixed canonical input → byte-identical `etl/output/ratings.json`. Guarded by
`etl/tests/test_rating.py` (determinism, golden-equality, schema bounds,
honest-state no-0-substitution, the **no-null guarantee**, the estimate-path
invariants, and the sanity assertions) plus a CI `git diff --exit-code`
regeneration guard. All tests are self-contained (read committed JSON; no
upstream CSV clone needed).

## Sanity results (asserted, not eyeballed)

| Card | overall | Why it's right |
|---|---|---|
| Maradona '86 (MF, Golden Ball, champion) | 100 | decorated apex (post-1970, unchanged) |
| Zidane '06 (MF, Golden Ball, runner-up) | 100 | decorated apex (post-1970, unchanged) |
| Pelé '58 (FW, Best Young Player + Silver Boot) | 97 | top of the elite band; now reflects 4-of-6 appearances (was a clamped 100) |
| Fontaine '58 (FW, 13 goals, Golden Boot, 3rd) | 94 | era-normalized within 1958; started all 6 |
| Pelé '70 (FW, champion, **no award in source**) | 82 | Golden Ball didn't exist in 1970 — carried by box score + anchor (unchanged) |
| Zidane '98 (MF, champion) | 81 | undecorated champion (post-1970, unchanged) |
| Moore '66 (DF, champion, **6 apps sourced**) | 90 | **was `null` in 1.0.0** — now measured on RSSSF appearances + champion finish |
| Puskás '54 (FW, runner-up, pre-1970) | 75 | **not dwarfed** by modern average; now reflects his 3 (injury-shortened) appearances |
| Mertesacker '14 (DF, champion, 6 apps, **0 goals**) | 90 | rated on appearances + team finish, **not goals** (post-1970, unchanged) |
| Rodrigo '18 (FW, 0 goals, 3 apps, no run) | 40 | modern journeyman baseline (unchanged) |

Distribution over 10,973 men's cards: min 20, median 43, mean 45.7, 21 cards at
the apex 100 (≈0.2% — all decorated peak performances), **0 with `overall: null`**
(was 933), 388 `baseline_anchor_estimate` (honest low-coverage estimates).

## WS-A deltas (why pre-1970 numbers moved — signal-driven, not a regression)

Adding the appearance signal to pre-1970 cards re-cohorts and re-bases them, so
some pre-1970 ratings shifted from 1.0.0. Each is explained by the new signal,
not a bug; **post-1970 cards are untouched** (cohorts are per-(tournament,
position), and pre-1970 sourcing only re-cohorts pre-1970 cards):

- **Pelé '58: 100 → 97.** In 1.0.0 pre-1970 FW had no appearance signal, so his
  base rode goals alone and clamped at 100. He played 4 of Brazil's 6 matches
  (missed the first two injured); the appearance percentile now pulls the base
  just off the ceiling. Still apex-tier, BYP + Silver Boot intact.
- **Fontaine '58: 95 → 94.** Started all 6; tiny base re-blend with appearances
  alongside his record 13 goals + Golden Boot.
- **Puskás '54: 78 → 75.** Played only ~3 matches around his injury; a lower
  appearance percentile within the 1954 FW cohort trims the base, still well
  clear of a modern journeyman (the era-fairness invariant the tests assert).
- **933 → 0 null overalls.** ~1,573 pre-1970 cards (incl. 545 of the formerly-
  null DF/GK like Moore '66) gained measured appearances; the remaining 388
  unlinked DF/GK became flagged low-coverage estimates instead of nulls.
