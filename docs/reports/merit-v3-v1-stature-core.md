# merit-v3 V1 Stature Core Fix-Forward Report

- Branch: `merit-v3-v1-stature-core`
- Fix-forward base: `cfd6822`
- Rebased onto merit-v3: `7dd9509`
- Spec of record: `docs/plans/merit-v3-design-2026-06-11.md` sections 1, 3, 7
- Full stature delta table: `docs/reports/merit-v3-v1-stature-delta.csv`

## Scope Executed

V1 remains a stature-source unit. `stature.py` consumes active facts, applies the
person resolver, and emits `career-stature-3.0.0`; `rating.py`, `rating_2026.py`,
compact data, and goldens still consume the row-level `rating_compat` view until the
later rating/compact units flip those consumers. The compact-data CI red remains the
declared mid-season skew and was not touched.

## Delta vs `cfd6822`

| Artifact                      | `cfd6822` |  New head | Notes                                       |
| ----------------------------- | --------: | --------: | ------------------------------------------- |
| Active facts                  |        53 |        61 | +8 honors facts from exhaustive census      |
| Active players                |        26 |        26 | same active scope                           |
| Club-season honors rows       |         6 |        14 | selective UEFA-only rows replaced by census |
| Active review                 |         0 |         0 | no withheld note rows                       |
| Active bridge review          |         0 |         0 | U0 identity links still promoted            |
| Career-stature rows           |       815 |       815 | no row-count expansion vs failed head       |
| Material rows                 |       193 |       197 | fuller honors lift five active profiles     |
| Legend rows                   |       100 |       101 | David Alaba reaches factual legend route    |
| Rating outputs / compact data | unchanged | unchanged | compatibility lock preserved                |

Delta CSV reconciliation against `cfd6822`: 815 byte-level rows, 5 index movers,
2 tier-label-only changes, and 808 fully unchanged rows. The index movers are
Alisson `0.308016 -> 0.508290`, David Alaba `0.391024 -> 0.644168`, Luiz
Henrique `0.140000 -> 0.509000`, Gustavo Gomez `0.024000 -> 0.378100`, and Andy
Robertson `0.296350 -> 0.522494`. The tier-label-only changes are Franco Baresi
`bronze -> silver` and Djalma Santos `silver -> gold`; both keep
`rating_compat_locked_2.1.0`.

## Honors Census

Raw-source rule and scope are written into
`etl/merit/raw/active/club-season-honors.json` and summarized in
`etl/merit/raw/active/manifest.json`.

Rule: credit top-tier continental club titles, Champions League and Libertadores
class across every confederation with a top-tier equivalent, only with documented
final participation for the winning club. Scope: the MV2-12a active 23 plus V1
additions Federico Valverde, Rodri, and Vinicius Junior, 26 players total. The
competition registry covers AFC, CAF, CONCACAF, CONMEBOL, OFC, and UEFA top-tier
club competitions.

| Player            | Scope id     | Year | Competition           | Club            | Citation            |
| ----------------- | ------------ | ---: | --------------------- | --------------- | ------------------- |
| David Alaba       | `P-W26-0050` | 2013 | UEFA Champions League | Bayern Munich   | UEFA final line-ups |
| Alisson           | `P-21531`    | 2019 | UEFA Champions League | Liverpool       | UEFA final line-ups |
| Andy Robertson    | `P-W26-0574` | 2019 | UEFA Champions League | Liverpool       | UEFA final line-ups |
| David Alaba       | `P-W26-0050` | 2020 | UEFA Champions League | Bayern Munich   | UEFA final line-ups |
| Gustavo Gomez     | `P-W26-0512` | 2020 | Copa Libertadores     | Palmeiras       | final-detail page   |
| Gustavo Gomez     | `P-W26-0512` | 2021 | Copa Libertadores     | Palmeiras       | final-detail page   |
| Federico Valverde | `P-05174`    | 2022 | UEFA Champions League | Real Madrid     | UEFA final line-ups |
| Vinicius Junior   | `P-92812`    | 2022 | UEFA Champions League | Real Madrid     | UEFA final line-ups |
| David Alaba       | `P-W26-0050` | 2022 | UEFA Champions League | Real Madrid     | UEFA final line-ups |
| Rodri             | `P-62341`    | 2023 | UEFA Champions League | Manchester City | UEFA match page     |
| Erling Haaland    | `P-W26-0477` | 2023 | UEFA Champions League | Manchester City | UEFA final line-ups |
| Federico Valverde | `P-05174`    | 2024 | UEFA Champions League | Real Madrid     | UEFA final report   |
| Vinicius Junior   | `P-92812`    | 2024 | UEFA Champions League | Real Madrid     | UEFA final report   |
| Luiz Henrique     | `P-W26-0115` | 2024 | Copa Libertadores     | Botafogo        | ESPN match page     |

Reviewer-named omissions are resolved as follows: Alaba 2013/2020/2022, Alisson
2019, Robertson 2019, Gustavo Gomez 2020/2021, and Luiz Henrique 2024 are included.
Luiz Henrique is explicitly in active scope as `P-W26-0115`. Marko Arnautovic is
excluded because Inter's 2010 title lacks documented final participation for him;
Hakan Calhanoglu is excluded because Inter were losing finalists in 2023.

Completeness assertion: `test_club_season_honors_census_matches_scope_and_registry`
recomputes the expected row set from the 26-player scope plus the pinned finals
registry and asserts equality with the ingested rows. Future scope additions cannot
silently recreate selective intake without changing the registry/test.

## Weight Fit

The pre-registered family weights remain:

| Era         | `club_season_honors` weight |
| ----------- | --------------------------: |
| `pre_1956`  |                        0.06 |
| `1956_1990` |                        0.12 |
| `1991_plus` |                        0.20 |

The full census was re-evaluated against the same gates. Valverde still lands at
index `0.400000`, rank 197, coverage `0.32`, active stage factor `0.625`, and two
club-season facts. The frozen direct-full-V3 counterfactual for Valverde-2022 is
`81` with `career_stature_estimate` basis, so the 81-86 probe band remains hit after
honest curation. No no-fact control moved; the expanded honors intake lifts only the
newly documented honors holders listed in the delta section.

## Guard Change

Design consequence now documented in the test header: post-activation, active facts
may legitimately reach archived identities through the person resolver. Therefore
`active.py` no longer rejects every archived active target. The replacement guard is
in `stature.py`: if `career_stature_active_staging.json` carries non-empty
`identity_bridge_review`, scoring fails before merging facts.

Mutation proof: `test_unresolved_active_identity_bridge_fails_stature_merge`
constructs an archived Rodri identity plus an unmerged active alias and an
`identity_bridge_review` entry. `_merge_active_channel` raises
`ValueError: active staging has unresolved identity bridges...`. The positive control
`test_person_identity_resolver_and_merge_prevent_double_credit` still proves a real
identity merge collapses historical and active facts into one person row.

## Probe Table

Committed display values are V1-locked through `rating_compat`. The `Full V3`
column is an in-memory counterfactual that bypasses only the compatibility row to
show where the current stature table would land on the frozen display curve.

|   # | Probe                                   | Pos      | Owner                         | V1 stature / index landing               | Committed display                    | Full V3 counterfactual                                |
| --: | --------------------------------------- | -------- | ----------------------------- | ---------------------------------------- | ------------------------------------ | ----------------------------------------------------- |
|   1 | Yamal 2026                              | FW       | V2/V3-owned movement          | idx `0.641`, rank 89, 5 active facts     | 79 measured                          | 79 measured; minted consumer not flipped              |
|   2 | Haaland 2026                            | FW       | V2/V3-owned movement          | idx `0.842791`, rank 21, 12 active facts | 88 measured                          | 88 measured; minted consumer not flipped              |
|   3 | Valverde 2026                           | MF       | V2/V3-owned display           | idx `0.400000`, rank 197, 2 active facts | 88 measured                          | 88 `career_stature_estimate`                          |
|   4 | Valverde 2022                           | MF       | V1-final counterfactual       | idx `0.400000`, rank 197                 | 76 measured                          | 81 `career_stature_estimate` - PASS band              |
|   5 | Rodri 2026                              | MF       | V2/V3-owned movement          | idx `0.614884`, rank 100, legend true    | 90 `career_stature_estimate`         | 91 `career_stature_estimate`, legend true             |
|   6 | Neymar 2026                             | FW       | V2/V3-owned movement          | idx `0.600323`, rank 104, legend true    | 93 `career_stature_estimate`         | 91 under full V3 renorm; display refit deferred       |
|   7 | Vinicius Junior 2026                    | FW       | V2/V3-owned movement          | idx `0.511400`, rank 138, 2 club facts   | 87 measured                          | 90 `career_stature_estimate`                          |
|   8 | E. Martinez 2022                        | GK       | V4/V7 headroom                | idx `0.289000`, rank 273                 | 88 measured                          | 88 measured                                           |
|   9 | Schumacher 1986                         | GK       | V4/V7 headroom                | idx `0.280000`, rank 280                 | 88 measured                          | 88 measured                                           |
|  10 | Forlan 2010                             | FW       | V4/V7 headroom                | idx `0.423122`, rank 191                 | 88 measured                          | 88 `career_stature_estimate`                          |
|  11 | Vava 1962 / Jairzinho 1970 / Klose 2006 | FW       | V4/V7 headroom                | idx `0.461538` / `0.357052` / `0.444404` | 88 / 88 / 88                         | 89 / 88 / 89                                          |
|  12 | Klose 2014                              | FW       | V1-final index, V4 display    | idx `0.444404`, rank 181                 | 88 measured                          | 89 `career_stature_estimate`                          |
|  13 | Lukaku 2022                             | FW       | V2/V3 citable-facts unit      | idx `0.281704`, rank 279                 | 71 measured                          | 71 measured; no V1 fact landed                        |
|  14 | B. Fernandes 2018                       | MF       | V2/V3 citable-facts unit      | idx `0.144000`, rank 419                 | 72 measured                          | 72 measured; no V1 fact landed                        |
|  15 | Ait-Nouri 2026 / Gavi 2026              | DF/MF    | V2/V3 D1 age unit             | no V1 stature rows                       | 83 / 84 measured                     | 83 / 84 measured                                      |
|  16 | Pele index / Pele 1970                  | FW       | V1-final index, V4 display    | idx `0.878288`, rank 2, ahead of Kocsis  | 97 `career_stature_estimate`         | 99 `career_stature_estimate`                          |
|  17 | Kocsis index / 1954                     | FW       | V1-final index, V4 display    | idx `0.876151`, rank 3, not #1, <= 0.90  | 99 `career_stature_estimate`         | 99 `career_stature_estimate`; display shrink deferred |
|  18 | Cruyff vs Owen                          | MF/FW    | V1-final ordering, V4 display | `0.720314 > 0.676574`                    | 95 / 96                              | 94 / 93; ordering fixed                               |
|  19 | Rossi 1986 / Zidane 2002 / Messi 2010   | FW/MF/FW | V4 participation down-cap     | idx `0.850902` / `0.852982` / `0.866823` | 94 / 95 / 98                         | 93 / 93 / 95                                          |
|  20 | 0-app champion reserves                 | GK       | V4 participation down-cap     | no material V1 change                    | Rulli 88, Armani 88, Ado 87, Leao 87 | unchanged                                             |

## Controls

| Control                      | Pos   | Owner                   | V1 result                                                                           |
| ---------------------------- | ----- | ----------------------- | ----------------------------------------------------------------------------------- |
| Perlaza 2026                 | DF    | V1-final no-fact guard  | no current 2026 card in `player_tournaments_2026.json`; no stature row, no lift     |
| Khalil Ayari 2026            | MF    | V1-final no-fact guard  | 71 measured, unchanged                                                              |
| Dempsey 2010                 | FW    | V1-final conservatism   | 88 measured, unchanged                                                              |
| Boufal 2022                  | FW    | V1-final conservatism   | 88 measured, unchanged                                                              |
| Messi 2022 / Messi 2010 band | FW    | V4 owns 2010 down-cap   | Messi 2022 remains 99; Messi 2010 full-V3 counterfactual 95 as listed in mover #19  |
| Cesare Maldini 1962          | DF    | V1-final conservatism   | 71 measured, unchanged                                                              |
| Q. Timber 2026               | MF    | V1-final identity guard | 72 measured, unchanged; no twin merge                                               |
| baseline_anchor cohort       | mixed | V1-final conservatism   | 386 rows remain capped in `[66, 73]` in committed and full-V3 counterfactual builds |

## Validation

Executed:

- `cd etl && uv run --extra dev ruff check src tests` - pass.
- `cd etl && uv run --extra dev pytest -q tests/test_merit_active.py tests/test_career_stature.py` - 42 passed.
- `cd etl && uv run --extra dev pytest -q` - 233 passed.
- Club-season citation verifier: 14/14 rows checked against the pinned citation URLs; Alaba 2020 is re-pinned to UEFA match `2030150`.
- Run-twice determinism: `active`, `active --pin`, and `stature` were run twice; SHA-256 hashes matched for the active manifest, active facts, active staging, `ACTIVE_CAREERS.md`, `career_stature.json`, `career_stature_review.json`, and `CAREER_STATURE.md`.
- Conservatism boundary vs `origin/merit-v3`: `ratings.json`, `ratings_2026.json`, `packages/data/src/generated`, and `apps/web/public/data` have no diff.

Not executed by design: compact regeneration, compact goldens, canary regeneration,
rating version bumps, and lambda refit. V6/V7 own those units.
