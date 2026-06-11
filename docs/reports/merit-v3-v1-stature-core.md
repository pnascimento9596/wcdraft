# merit-v3 V1 Stature Core Report

- Branch: `merit-v3-v1-stature-core`
- Base: `origin/merit-v3` at `3f8f01a5fc1359657e857c06fdc096880c2fb0d9`
- Spec of record: `docs/plans/merit-v3-design-2026-06-11.md` sections 1, 3, 7
- Full stature delta table: `docs/reports/merit-v3-v1-stature-delta.csv`

## Scope Executed

V1 activates active-career facts inside `stature.py`, not in `active.py` and not in the
rating consumers. The old 12a inertness guards were deliberately flipped:

- `test_scoring_code_never_references_the_active_artifacts` now requires `stature.py` to
  consume `source_facts_active.json` and `career_stature_active_staging.json`, while
  rating, compact, ingest, build, and link modules still do not import `merit.active`.
- The archived-target active guard is now a merge invariant: active facts may target a
  person already present in the archive, and `stature.py` collapses historical and active
  aliases to one person row.

Near-miss bridge curation for Ró-Ró/Pedro Miguel, El Khannouss, Issahaku/Abdul Fatawu,
Baba Rahman, and Bárcenas is deferred to V2. Reason: V1 already changes scoring, source
set pins, and activation guards; mixing identity-bridge research into this diff would
make review less crisp.

## Artifact Census

| Artifact | Before | After | Notes |
|---|---:|---:|---|
| Active source set | `active-career-source-set-1.0.0` | `active-career-source-set-2.0.0` | SHA-pinned notes |
| Active facts | 47 / 23 players | 53 / 26 players | +6 `club_season_honors` facts, +3 players |
| Active review | 0 | 0 | no withheld rows |
| Active bridge review | 0 | 0 | U0 links are already real links on this base |
| Career-stature table | `career-stature-2.1.0` | `career-stature-3.0.0` | active/person merge + index controls |
| Career-stature rows | 791 | 815 | +24 active-only rows |
| Material rows | 207 | 193 | sparse/top-band controls reduce the cohort |
| Legend rows | 112 | 100 | legend/band coherence census tightened |
| Rating-consumed stature | 791 v2.1 rows | 791 `rating_compat` rows | rating outputs intentionally unchanged until V2 |

## Club-Season Honors Source

New family: `club_season_honors`.

Source id: `active_club_season_honors`.

Source-set bump: `active-career-source-set-2.0.0`.

Rows:

| Player | Year | Club/title fact | Citation |
|---|---:|---|---|
| Federico Valverde | 2022 | Real Madrid UCL title, final participation | UEFA match page: `https://www.uefa.com/uefachampionsleague/match/2034586--liverpool-vs-real-madrid/` |
| Vinícius Júnior | 2022 | Real Madrid UCL title, final goal | UEFA match page: `https://www.uefa.com/uefachampionsleague/match/2034586--liverpool-vs-real-madrid/` |
| Rodri | 2023 | Manchester City UCL title, final goal | UEFA match page: `https://www.uefa.com/uefachampionsleague/match/2037765--man-city-vs-inter/` |
| Erling Haaland | 2023 | Manchester City UCL title, final line-up | UEFA line-ups: `https://www.uefa.com/uefachampionsleague/match/2037765--man-city-vs-inter/lineups/` |
| Federico Valverde | 2024 | Real Madrid UCL title, final participation | UEFA final report: `https://www.uefa.com/uefachampionsleague/news/028e-1b07e18d875a-ba78e4b9d9fc-1000--real-madrid-win-champions-league-carvajal-and-vinicius-jun/` |
| Vinícius Júnior | 2024 | Real Madrid UCL title, final goal | UEFA final report: `https://www.uefa.com/uefachampionsleague/news/028e-1b07e18d875a-ba78e4b9d9fc-1000--real-madrid-win-champions-league-carvajal-and-vinicius-jun/` |

## Honors Weight Fit

Protocol:

- Only the `club_season_honors` family weight was fit in this unit.
- The fit target was Valverde-2022 reaching the lower Valverde peer band without moving
  no-fact controls or forcing unrelated probes.
- If the chosen weight distorted controls, the probe would be reported as missed rather
  than forced.

Chosen weights:

| Era | `club_season_honors` weight |
|---|---:|
| `pre_1956` | 0.06 |
| `1956_1990` | 0.12 |
| `1991_plus` | 0.20 |

Measured effect:

| Probe | V3 stature index | V3 rank | Notes |
|---|---:|---:|---|
| Valverde | 0.400000 | 193 | lower edge of material gate; 2 club facts; active stage factor 0.625 |
| Vinícius Júnior | 0.511400 | 136 | 2 club facts + prior ESM fact |
| Rodri | 0.614884 | 99 | historical global facts + 1 club fact |
| Haaland | 0.842791 | 21 | broad active profile + 1 club fact |
| Perlaza | no row | - | no facts, no lift |
| Anis Ayari | no row | - | no facts, no lift |
| Yasin Ayari | no row | - | no facts, no lift |

Counterfactual only, using the current frozen display curve and direct v3 stature
consumption, Valverde-2022 would be 81 with `career_stature_estimate` basis. The committed
rating artifacts do not consume this yet; V2/V3 own the rating-consumer flip.

## Index-Bias Census

| Probe | Old index | New index | Status |
|---|---:|---:|---|
| Pelé | 0.807005 | 0.878288 | PASS: top-10, rank 2, ahead of Kocsis |
| Kocsis | 0.991816 | 0.876151 | PASS: <= 0.90 and not #1; sparse shrinkage applied |
| Cruyff | 0.755159 | 0.720314 | PASS: remains above Owen |
| Michael Owen | 0.788609 | 0.676574 | PASS: below Cruyff after family re-normalization |
| Klose | 0.395750 | 0.444404 | PASS: clears the 0.40 material index gate |

Mechanism counts from the full delta CSV:

| Mechanism tag | Rows |
|---|---:|
| `rating_compat_locked_2.1.0` | 791 |
| `global_annual_recognition:pre_1995_ballondor_ineligible` | 72 |
| `active_stage_normalized` | 26 |
| `new_row` | 24 |
| `sparse_fact_count_shrinkage` | 8 |
| `club_season_honors` | 4 |
| `single_family_index_saturation` | 2 |

Index deltas across the 791 existing rows:

| Direction | Rows |
|---|---:|
| Increased | 320 |
| Decreased | 430 |
| Unchanged | 41 |

Largest up move: Vinícius Júnior, +0.311400, from active club-season honors.

Largest down move: `P-58388`, -0.161847, from family re-normalization. Full row-level
attribution is in `merit-v3-v1-stature-delta.csv`.

## Probe Positions

Committed rating display values are intentionally unchanged by V1 because `rating.py` and
`rating_2026.py` consume the row-level `rating_compat` view (`career-stature-2.1.0`) until
the later rating units flip the consumer. The table below separates V1 stature positions
from display movements owned by V2/V3.

| Probe | V1 stature result | Committed display result | Status |
|---|---|---|---|
| Yamal 2026 | index 0.641, rank 88, 5 active facts | 79, measured path | not yet expected to move; V3 owns minted/person consumer |
| Haaland 2026 | index 0.843, rank 21, 12 active facts | 88, measured path | not yet expected to move; V3 owns minted/person consumer |
| Valverde 2026 | index 0.400, rank 193, 2 active facts | 88, measured path | stature lower edge hit; projected display deferred |
| Valverde 2022 | index 0.400, rank 193, 2 active facts | 76, measured path | counterfactual direct v3 consumption = 81, in band |
| Rodri 2026 | index 0.615, rank 99, legend true | 90, career stature estimate | already linked by U0; V1 stature moves to v3 |
| Neymar 2026 | rating-compat path still consumed | 93, career stature estimate | not a V1 mover |
| Vinícius Júnior 2026 | index 0.511, rank 136, 2 club facts | 87, measured path | counterfactual direct v3 consumption = 90 |
| Klose 2014 | index 0.444, rank 177 | 88, measured path | V1 stature clears gate; display deferred |
| Pelé index | 0.878, rank 2 | Pelé-1970 remains 97 | PASS for V1 index gate |
| Kocsis index | 0.876, rank 3 | Kocsis-1954 remains 99 | PASS for V1 index gate; display ceiling owned by V2/V4 |
| Cruyff vs Owen | 0.720 > 0.677 | Cruyff-1974 95, Owen-1998 96 | PASS for V1 index ordering; display curve deferred |
| Perlaza / Ayari | no stature rows | no V1 rating lift | PASS: no facts, no row, no lift |

## Validation

Executed:

- `cd etl && uv run --extra dev ruff check src tests` - pass.
- `cd etl && uv run --extra dev pytest -q` - 202 passed.
- Focused merit suite before full run: 76 passed.
- `tests/test_rating.py` - 35 passed, confirms historical rating output is unchanged.
- `tests/test_ingest_2026.py` - 37 passed, confirms projected output is unchanged.
- `tests/test_unified_display.py tests/test_identity_links_2026.py` - 28 passed.
- Active/stature determinism replay: rebuilt active manifest/artifacts and stature artifacts
  twice; SHA-256 hashes matched across the two rebuilds.

Not executed in V1:

- Compact regeneration, canary regeneration, rating version bumps, lambda refit. Those are
  explicitly V6/V7 season units.
