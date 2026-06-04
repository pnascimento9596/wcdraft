# wcdraft 2026 Projected Rating — Methodology (`proj-career-1.0.0`)

The 2026 World Cup opponents are **real** (the 48 final squads, group draw, and
knockout bracket were published 2026-06-02). But the 2026 players have **no World
Cup performance yet**, so their ratings are **projected from factual career
signals** — `provenance = 'projected_career'`, a sibling of the 1930-2022
`wc-perf-1.0.0` rating ([RATING_METHODOLOGY.md](RATING_METHODOLOGY.md)), not a
replacement. This document is the companion to `etl/src/wcdraft_etl/rating_2026.py`;
the code is the source of truth and every constant is `CALIBRATION`-flagged there.

## Legal firewall (non-negotiable)

Every number is derived **only** from the factual public career signals on the
pinned Wikipedia squad lists — international caps, international goals, date of
birth, listed position, and club. **Nothing** is ingested, mirrored, or "lightly
perturbed" from EA Sports FC or any proprietary rating set. The league-strength
prior is wcdraft's own transparent calibration table, not a copied dataset. The
output is reproducible from the cited Wikipedia revisions alone.

## Sources (pinned, CC-BY-SA 4.0)

Raw wikitext snapshots committed under `etl/sources/wikipedia_2026/` (see
`SOURCES.json`): **squads** (oldid 1357762108), **draw** (oldid 1357747592),
**knockout stage** (oldid 1357752786), retrieved 2026-06-04. Committing the
snapshots makes the ingest self-contained and byte-deterministic with no live
fetch (the CI git-diff guard enforces it). ShareAlike propagates: derived 2026
data is redistributed under CC-BY-SA 4.0.

## Same methodology family as `wc-perf`

`rating_2026.py` **imports** the `wc-perf` machinery rather than re-implementing
it, so "same family" is literal: the position `BASE_WEIGHTS`, the
`[REPLACEMENT_BASE, BASE_CEILING]` band, the within-cohort mid-rank percentile
(`_percentile_map`), the four-channel `CHANNEL_SPREAD`, and the channel/clamp
helpers are shared code. The **era-fairness** principle is preserved: a signal is
normalized within its `(tournament, position)` cohort — for 2026 that is
**(position) across all 48 squads**, so a striker is ranked against every other
2026 striker. A **defender / keeper is NEVER rated on goals** (goals weight 0 for
DF/GK), exactly as in `wc-perf`.

## The signal swap (career, not single-tournament box score)

| `wc-perf` role | 2026 projected signal | Why |
|---|---|---|
| goals (box score) | **international goals** | career productivity |
| appearances (minutes proxy) | **international caps** | career experience / trust |
| awards + team finish (cross-era anchor) | **club-league strength** | the quality anchor (below) |
| — | **age curve** | career-stage positioner |

## The formula

```
overall (0..1) = clamp01( base + league_anchor )
base           = REPLACEMENT_BASE + (BASE_CEILING − REPLACEMENT_BASE) · perf_blend · age_factor
perf_blend     = Σ wᵢ·pctᵢ / Σ wᵢ      over present signals (caps, intl goals), position-weighted
league_anchor  = LEAGUE_WEIGHT[pos] · league_strength
```

### Why a league anchor (the projection-sanity fix)

Caps and international goals measure **experience and productivity**, which
**over-reward longevity**: a 33-year-old minnow veteran out-caps a 23-year-old
elite, and a striker who farms goals against weak opposition out-scores a rotated
forward in a deep squad. On caps + goals alone, the team ordering **inverts**
(minnows on top). The club a player holds down is the strongest **factual** quality
proxy available before a ball is kicked, so league strength plays the role the
**award / finish anchor** plays in `wc-perf`: an absolute, position-weighted lift
that supplies the headroom above `BASE_CEILING`. It is deliberately the **dominant**
quality signal (weighted above wc-perf's award weights) precisely because, for a
projection, club level beats longevity. League strength is a transparent tiered
prior over the club's nation code (ENG/ESP 1.00 → developing leagues 0.42),
golden-locked and tunable — wcdraft's own, not a proprietary rating. A player whose
club is **unknown** drops the anchor entirely (honest-state — never a fabricated
baseline applied to a club we don't know).

This still does not make a young elite squad (Brazil, France) out-aggregate a
veteran top-club squad (Switzerland) — caps genuinely favor the experienced side,
and projecting otherwise would inject a prior the public signals don't support. The
honest, asserted claim is the **robust** one: every traditional power aggregates
higher than every debutant/minnow, with a clear basket-mean margin.

### The tournament anchors are honestly DROPPED

`wc-perf`'s award and team-finish anchors are **unearned** before the tournament
is played. They are emitted as components with `value: null, weight: 0` — visibly
**dropped, never substituted with 0**. A projected card therefore cannot reach the
legendary tail on tournament distinction it has not earned; WS-B reconciles
2026-opponent strength with the historical draft pool at aggregation time.

### Age curve

A factual career-stage multiplier in `[0.80, 1.0]`, flat across the prime plateau
(24-30) and ramping down toward the very young and the older. Age is computed as of
the opening match (2026-06-11), exactly as the squad source lists it.

## Honest-state

* Every current player has caps and international goals (real measured integers,
  possibly 0), so the appearance-role signal is **always present** — no 2026 card
  takes the `overall = null` insufficient-signal path (asserted in tests).
* `coverage_basis = "career_signals"` (a different denominator from `wc_signals`);
  `coverage = 5/7 ≈ 0.7143` reflects the five signals we have against an ideal that
  also wants **club-competition minutes** and a **qualification box-score** —
  neither is in the source, so both are absent, never fabricated.
* **Assists, minutes, club-competition appearances, qualification stats** are not
  in the squad source and are omitted entirely, never invented.

## Identity linkage

* **Players**: a 2026 player who already has a 1930-2022 card **links** to that
  canonical `player_id` (a 2022+2026 player shares one id); linking keys on
  (nation, date of birth) + a normalized family/given-name corroboration and a
  unique survivor. It is **conservative** — ambiguity (e.g. the Timber twins: same
  nation, DOB, surname) **mints** a new id rather than risk a wrong merge. New ids
  are namespaced `P-W26-*`.
* **Nations**: 43 of 48 teams match an existing canonical nation by name; 5
  debutants (Cape Verde, Curaçao, DR Congo, Jordan, Uzbekistan) are minted
  (`T-W26-*`). DR Congo is minted **fresh** with Zaire (`T-88`) recorded as
  predecessor — the repo's "historical entities are never merged" invariant holds.

## Emitted artifacts (`etl/output/*_2026.json`)

`nations_2026`, `players_2026` (minted only), `player_tournaments_2026` (1,246
cards, `card_id = player_id:WC-2026`), `ratings_2026`, `teams_2026` (48 `Team2026`),
`bracket_2026` (`Bracket2026`), `tournaments_2026`, plus `manifest_2026.json`. The
locked 1930-2022 tables are left **byte-for-byte untouched**.

### `Team2026.squad_status`

Emitted as **`locked`**, not `final`. The core lifecycle defines `locked` =
"official roster published but tournament has not started" and `final` = "roster +
tournament started". The 26-man lists were published 2026-06-02, but the opening
match is 2026-06-11, and an injury replacement is still permitted up to 24h before a
team's first match — so as of the pinned 2026-06-04 snapshot the contract-correct
state is `locked`. It flips to `final` on a re-pin after kickoff.

### `Team2026.aggregate_rating`

Best-available-XI semantics: the 11 cards with the highest projected `overall`,
averaged per sim channel + coverage. A stronger squad's best XI carries higher
channels. This is the **opponent** squad aggregation; the user-XI aggregator
(core `aggregateUserXiStrength`, which folds Synergy + manager) is a separate WS-B
concern, and the averaging choice is re-calibratable there.

### `Bracket2026`

`knockout_slots` faithfully encode the real R32→Final tree: the 24 group
winner/runner-up seats use the core `group_position` source and the R16+ seats use
`match_winner`. The **8 best-third R32 seats cannot be a single `group_position`** —
FIFA resolves the qualifying group at runtime from a fixed candidate set — so they
use a `best_third { candidate_groups }` source. This variant (and an optional
`match_id` on `Slot`) were **added to the core `SlotSource` union**
(`packages/core/src/types/tournament.ts`) as part of this workstream so the emitted
bracket is representable by the declared `Bracket2026` type.

## Determinism & validation

Fixed snapshots + canonical tables → byte-identical `*_2026.json`. Guarded by
`tests/test_ingest_2026.py` (determinism, golden-equality, 48-team/squad-size/3-GK
structure, link correctness incl. the no-wrong-merge and twins guards, projected
rating bounds + honest-state, the strong-nations-aggregate-higher invariant, and
full bracket integrity) plus the CI `git diff --exit-code` regeneration guard.

## Sanity results (asserted, not eyeballed)

* All 48 teams present, 12 groups × 4, every squad 23-26 with ≥3 GK.
* Projected `overall`: min 33, median 66, max 99; **zero** null overalls.
* **Every** traditional power (Brazil, Argentina, France, Spain, Germany, England,
  Portugal, Netherlands) aggregates **higher than every** debutant/minnow
  (Curaçao, Cape Verde, Haiti, Uzbekistan, Jordan, New Zealand, South Africa) —
  power basket mean 53.2 vs minnow basket mean 46.2 (weakest power 52.0 > strongest
  minnow 49.0).
* 335 of 1,246 cards link to a canonical 1930-2022 player id (e.g. Messi, Ronaldo,
  Modrić — one id across 2014/18/22 + 2026); no canonical id is reused for two
  different 2026 players.
