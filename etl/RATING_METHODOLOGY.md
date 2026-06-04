# wcdraft Player Rating — Methodology (`wc-perf-1.0.0`)

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
wcdraft's own. The output is reproducible from the cited Fjelstul source alone.

## Inputs (honest-state)

Read from the **committed canonical JSON** in `etl/output/` (the ingestion's
output — not the upstream CSVs), so the stage is self-contained and
byte-deterministic. Signals respect the era cliffs documented in
`etl/output/COVERAGE.md`:

| Signal | Source | Availability | When absent |
|---|---|---|---|
| Goals (excl. own goals) | `player_tournaments.goals` | 1930+ (all eras) | n/a — always present |
| Match appearances | `player_tournaments.appearances` | **1970+ only** | `null` → **dropped**, never 0 |
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

### 5. `overall` and the honest null path

`overall = round(score·100)` **except** when a card has **no individually
measured performance signal** — a pre-1970 DF/GK (appearances `null`, and goals
carry zero weight for defenders and keepers). Placing such a card on a 0–100
display scale would be fabrication, so `overall = null` (the contract's
"insufficient signal" path). The four sim channels are still emitted (floored on
the replacement base + any award/team-finish anchor) because the sim requires
them — but the display number is honestly withheld. In the current men's dataset
this triggers for exactly the 628 pre-1970 defenders plus 305 pre-1970 keepers
(933 cards), and **only** for them (asserted in tests).

## Coverage & provenance

`coverage` reuses the ingestion's per-card tier (0.6667 / 0.8333 / 1.0) — the
honest-state flag for low-coverage eras. Low-coverage ratings are **flagged, not
faked**. `coverage_basis = "wc_signals"`, `provenance = "wc_performance"`,
`rating_version = "wc-perf-1.0.0"` (a replay anchor — bump on any change to
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
honest-state no-0-substitution, the null-path invariant, and the sanity
assertions) plus a CI `git diff --exit-code` regeneration guard. All tests are
self-contained (read committed JSON; no upstream CSV clone needed).

## Sanity results (asserted, not eyeballed)

| Card | overall | Why it's right |
|---|---|---|
| Maradona '86 (MF, Golden Ball, champion) | 100 | decorated apex |
| Zidane '06 (MF, Golden Ball, runner-up) | 100 | decorated apex |
| Pelé '58 (FW, Best Young Player + Silver Boot) | 100 | decorated apex |
| Fontaine '58 (FW, 13 goals, Golden Boot, 3rd) | 95 | era-normalized within 1958 |
| Pelé '70 (FW, champion, **no award in source**) | 82 | Golden Ball didn't exist in 1970 — honestly carried by box score + anchor |
| Zidane '98 (MF, champion) | 81 | undecorated champion |
| Puskás '54 (FW, runner-up, pre-1970) | 78 | **not dwarfed** by modern average |
| Mertesacker '14 (DF, champion, 6 apps, **0 goals**) | 90 | rated on appearances + team finish, **not goals**; below decorated apex cards |
| Rodrigo '18 (FW, 0 goals, 3 apps, no run) | 40 | modern journeyman baseline |

Distribution over 10,973 men's cards: min 24, median 43, mean 46.4, 22 cards at
the apex 100 (≈0.2% — all decorated peak performances), 933 with `overall: null`.
