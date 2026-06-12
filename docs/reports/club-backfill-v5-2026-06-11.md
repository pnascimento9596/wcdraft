# Club-at-Tournament Backfill V5 Report

- **Date:** 2026-06-11
- **Branch:** `merit-v3-v5-club-backfill`
- **Base:** `origin/merit-v3` at `3f8f01a5fc1359657e857c06fdc096880c2fb0d9`
- **Scope:** ETL-only historical club backfill for men's `WC-1930` through `WC-2022`.
- **Compact regen / version bumps:** none. V6 carries the populated field into compact data.

Note: the dispatch/manifest prose says 21 historical tournaments, but the canonical men's
World Cup set from 1930 through 2022 contains 22 editions. This unit pinned all 22; skipping
one would have left a real canonical tournament unbackfilled.

## Outcome

`player_tournaments.club_at_tournament` now populates from pinned Wikipedia squad-page
wikitext where a factual club name joins unambiguously to the canonical card. No crests,
badges, kits, images, or proprietary rating inputs are parsed or emitted.

Field-scoped output proof against `origin/merit-v3`:

| Check | Result |
|---|---:|
| Card IDs unchanged | 13,843 |
| Non-club field diffs in `player_tournaments.json` | 0 |
| `club_at_tournament: null -> value` | 10,957 |
| Other `club_at_tournament` changes | 0 |
| Rating/stature/identity output diff | 0 tracked files changed |

## Pinned Revisions

Raw wikitext is committed under `etl/sources/wikipedia_<year>/`; SHA and oldid metadata
is pinned in `etl/sources/wikipedia_historical_squads/fetch_manifest.json`. Each selected
revision was checked by parser/table sanity against the canonical tournament card count.
Rows that still do not map are withheld as honest nulls.

| Year | oldid | Timestamp | sha256 prefix | Parsed / canonical rows | Pin note |
|---:|---:|---|---|---:|---|
| 1930 | 1353483110 | 2026-05-10T15:15:15Z | `0d5e01af7b63` | 241 / 245 | source roster delta |
| 1934 | 1353865802 | 2026-05-12T21:22:02Z | `10c5c0f3c2d5` | 342 / 342 | total count exact; 4 canonical rows remain unmatched |
| 1938 | 1353856728 | 2026-05-12T20:16:30Z | `a441ab1bbf20` | 318 / 320 | source roster delta |
| 1950 | 1356560048 | 2026-05-28T14:30:36Z | `11e998a7a196` | 278 / 281 | source roster delta |
| 1954 | 1358745390 | 2026-06-10T17:46:00Z | `2f18836ad1ca` | 350 / 350 | exact |
| 1958 | 1339292356 | 2026-02-19T21:49:01Z | `1e1f4de4adb6` | 352 / 352 | exact |
| 1962 | 1353878277 | 2026-05-12T23:03:48Z | `61588f25a293` | 352 / 352 | exact |
| 1966 | 1357688662 | 2026-06-04T02:18:27Z | `c5581b439dfb` | 352 / 352 | exact |
| 1970 | 1357688548 | 2026-06-04T02:17:23Z | `f1116bcfe5d7` | 349 / 349 | exact |
| 1974 | 1351911642 | 2026-04-30T22:01:09Z | `2856183c091b` | 352 / 352 | exact |
| 1978 | 1357688426 | 2026-06-04T02:16:32Z | `629434447ccb` | 352 / 352 | exact |
| 1982 | 1351911459 | 2026-04-30T21:59:53Z | `bce6a2b43039` | 526 / 526 | exact |
| 1986 | 1357686244 | 2026-06-04T01:59:37Z | `5907e73d8d78` | 528 / 528 | exact |
| 1990 | 1353497818 | 2026-05-10T16:43:34Z | `bda7a51b415e` | 530 / 528 | source has two extra replacement/alternate rows; canonical rows complete |
| 1994 | 1358218012 | 2026-06-07T09:37:29Z | `b0aff2aec97e` | 528 / 528 | exact |
| 1998 | 1358659668 | 2026-06-10T03:25:09Z | `8035e7a2a96e` | 705 / 705 | exact count; 1 roster disagreement remains null |
| 2002 | 1358712206 | 2026-06-10T13:06:09Z | `75390d280389` | 736 / 736 | exact |
| 2006 | 1357069147 | 2026-05-31T15:49:23Z | `06eb1bb4562d` | 736 / 736 | exact |
| 2010 | 1357685786 | 2026-06-04T01:55:35Z | `fdc2430b0769` | 736 / 736 | exact count; 1 roster disagreement remains null |
| 2014 | 1357685684 | 2026-06-04T01:54:39Z | `2c10ed0801d5` | 736 / 736 | exact |
| 2018 | 1358324683 | 2026-06-08T00:47:01Z | `1eb9702305af` | 736 / 736 | exact |
| 2022 | 1357405491 | 2026-06-02T12:44:30Z | `b6585538431b` | 831 / 831 | exact |

## Coverage

Before V5, every historical men's card was `null` for `club_at_tournament`.

| Tournament | Before | After | Honest nulls |
|---|---:|---:|---:|
| WC-1930 | 0/245 (0.00%) | 241/245 (98.37%) | 4 |
| WC-1934 | 0/342 (0.00%) | 338/342 (98.83%) | 4 |
| WC-1938 | 0/320 (0.00%) | 318/320 (99.38%) | 2 |
| WC-1950 | 0/281 (0.00%) | 276/281 (98.22%) | 5 |
| WC-1954 | 0/350 (0.00%) | 350/350 (100.00%) | 0 |
| WC-1958 | 0/352 (0.00%) | 352/352 (100.00%) | 0 |
| WC-1962 | 0/352 (0.00%) | 352/352 (100.00%) | 0 |
| WC-1966 | 0/352 (0.00%) | 352/352 (100.00%) | 0 |
| WC-1970 | 0/349 (0.00%) | 349/349 (100.00%) | 0 |
| WC-1974 | 0/352 (0.00%) | 352/352 (100.00%) | 0 |
| WC-1978 | 0/352 (0.00%) | 352/352 (100.00%) | 0 |
| WC-1982 | 0/526 (0.00%) | 526/526 (100.00%) | 0 |
| WC-1986 | 0/528 (0.00%) | 528/528 (100.00%) | 0 |
| WC-1990 | 0/528 (0.00%) | 528/528 (100.00%) | 0 |
| WC-1994 | 0/528 (0.00%) | 528/528 (100.00%) | 0 |
| WC-1998 | 0/705 (0.00%) | 705/705 (100.00%) | 0 |
| WC-2002 | 0/736 (0.00%) | 736/736 (100.00%) | 0 |
| WC-2006 | 0/736 (0.00%) | 736/736 (100.00%) | 0 |
| WC-2010 | 0/736 (0.00%) | 735/736 (99.86%) | 1 |
| WC-2014 | 0/736 (0.00%) | 736/736 (100.00%) | 0 |
| WC-2018 | 0/736 (0.00%) | 736/736 (100.00%) | 0 |
| WC-2022 | 0/831 (0.00%) | 831/831 (100.00%) | 0 |

Total: **10,957/10,973 = 99.85% populated**, with 16 honest nulls.

## Tail Re-Audit Census

All 21 rows from the previous tail were re-audited against the pinned source rows with
alias awareness. The build still uses only committed wikitext and the explicit
`CLUB_ALIAS_BRIDGES` table; live redirect checks were review-time corroboration, not a
runtime resolution mechanism.

| Bucket | Count | Meaning |
|---|---:|---|
| `bridged` | 5 | A reviewer-verified alias maps one canonical card to one pinned source row. |
| `unresolved_alias` | 0 | No remaining club-bearing source row had enough alias evidence to stay visibly unresolved. |
| `source_lacks_club` | 16 | No trustworthy club-bearing pinned source row exists for the canonical card; fuzzy same-squad neighbors without name/DOB corroboration remain null. |

### Bridged

| Tournament | Nation | Card player | player_id | Pinned source row | Club | Corroboration |
|---|---|---|---|---|---|---|
| WC-1930 | Mexico | Alfredo Viejo Sánchez | `P-83291` | Alfredo Sánchez | Club América | Review verified redirect-equivalence; same Mexico 1930 squad context. Pinned DOB differs, so this is explicit bridge-only evidence. |
| WC-1930 | Peru | Luis Souza Ferreira | `P-44010` | Luis de Souza | Universitario de Deportes | Review verified redirect-equivalence; same Peru 1930 squad context. Pinned DOB differs, so this is explicit bridge-only evidence. |
| WC-1930 | Romania | Miklós Kovács | `P-70294` | Nicolae Kovács | Banatul Timișoara | Review verified redirect-equivalence; same Romania 1930 squad context with the six-day DOB discrepancy recorded. |
| WC-1938 | Dutch East Indies | Frans Hu Kon | `P-56198` | Frans G. Hukom | Sparta Bandung | Review verified redirect-equivalence; same Dutch East Indies 1938 squad context. Canonical DOB is absent. |
| WC-1998 | Saudi Arabia | Ibrahim Al-Shahrani | `P-92151` | Ibrahim Suwayed | Al-Ahli | Review verified redirect-equivalence; same Saudi Arabia 1998 squad, matching DOB, and matching shirt number 7. |

### Unresolved Alias

None. Same-shirt or fuzzy-name neighbors that contradicted the canonical name/DOB were
classified as roster/source disagreement rather than as unresolved alias matches.

### Source Lacks Club

| Tournament | Nation | Player | player_id |
|---|---|---|---|
| WC-1930 | Brazil | not applicable Benvenuto | `P-11648` |
| WC-1930 | Brazil | not applicable Doca | `P-58460` |
| WC-1930 | Peru | Jorge Góngora | `P-29687` |
| WC-1930 | Peru | Juan Alfonso Valle | `P-41536` |
| WC-1934 | Brazil | not applicable Almeida | `P-63886` |
| WC-1934 | Sweden | Carl Johnsson | `P-01918` |
| WC-1934 | Sweden | Erik Granath | `P-92190` |
| WC-1934 | Switzerland | Max Weiler | `P-44740` |
| WC-1938 | Dutch East Indies | not applicable Dorst | `P-16278` |
| WC-1938 | Dutch East Indies | not applicable Teilherber | `P-92120` |
| WC-1950 | Bolivia | Eulogio Sandoval | `P-54466` |
| WC-1950 | Bolivia | Juan Arricio | `P-46561` |
| WC-1950 | Sweden | Kjell Rosén | `P-79649` |
| WC-1950 | Switzerland | Felice Soldini | `P-71162` |
| WC-1950 | United States | Frank Moniz | `P-53883` |
| WC-2010 | North Korea | Il-gwan Jong | `P-79551` |

## Spot-Check Sample

Random sample seed: `20260611`. Each listed row was checked against the pinned wikitext
template for the oldid shown; the listed club is the source table's factual text value.

| Tournament | Nation | Player | Parsed club | oldid |
|---|---|---|---|---:|
| WC-2018 | Panama | Álex Rodríguez | San Francisco | 1358324683 |
| WC-2006 | United States | Bobby Convey | Reading | 1357069147 |
| WC-1998 | Jamaica | Warren Barrett | Violet Kickers | 1358659668 |
| WC-1994 | Colombia | Víctor Aristizábal | Valencia | 1358218012 |
| WC-1958 | Soviet Union | Anatoli Ilyin | Spartak Moscow | 1339292356 |
| WC-1982 | Northern Ireland | Martin O'Neill | Norwich City | 1351911459 |
| WC-2006 | Mexico | Pável Pardo | América | 1357069147 |
| WC-2002 | Nigeria | Isaac Okoronkwo | Shakhtar Donetsk | 1358712206 |
| WC-2006 | Saudi Arabia | Saad Al-Harthi | Al Nassr | 1357069147 |
| WC-2006 | Australia | Lucas Neill | Blackburn Rovers | 1357069147 |
| WC-1986 | France | Yannick Stopyra | Toulouse | 1357686244 |
| WC-2022 | Spain | Jordi Alba | Barcelona | 1357405491 |
| WC-2006 | Poland | Radosław Sobolewski | Wisła Kraków | 1357069147 |
| WC-2002 | Cameroon | Raymond Kalla | Extremadura | 1358712206 |
| WC-1962 | Soviet Union | Givi Chokheli | Dinamo Tbilisi | 1353878277 |
| WC-1998 | Paraguay | Arístides Rojas | Unión de Santa Fe | 1358659668 |
| WC-1970 | El Salvador | Saturnino Osorio | Águila | 1357688548 |
| WC-1982 | Algeria | Chaabane Merzekane | MA Hussein Dey | 1351911459 |
| WC-2022 | Cameroon | André Onana | Inter Milan | 1357405491 |
| WC-1994 | Morocco | Smahi Triki | Châteauroux | 1358218012 |
| WC-2006 | Mexico | Rafael Márquez | Barcelona | 1357069147 |
| WC-1986 | Scotland | Andy Goram | Oldham Athletic | 1357686244 |
| WC-1990 | South Korea | Tae-ho Lee | Daewoo Royals | 1353497818 |
| WC-1994 | Morocco | Mustapha Hadji | Nancy | 1358218012 |
| WC-2014 | Greece | Lazaros Christodoulopoulos | Bologna | 1357685684 |
| WC-1962 | England | Roger Hunt | Liverpool | 1353878277 |
| WC-2014 | Japan | Yasuyuki Konno | Gamba Osaka | 1357685684 |
| WC-2014 | Russia | Sergei Ignashevich | CSKA Moscow | 1357685684 |
| WC-1970 | Romania | Necula Răducanu | Rapid București | 1357688548 |
| WC-1998 | South Korea | Dae-il Jang | Cheonan Ilhwa Chunma | 1358659668 |

## Validation Evidence

Commands run locally:

| Gate | Result |
|---|---|
| `uv run --project etl python -m wcdraft_etl.historical_clubs --verify` | OK |
| `uv run --project etl ruff check etl/src etl/tests` | passed |
| `uv run --project etl pytest -q etl/tests` | 228 passed |
| Run `uv run --project etl python -m wcdraft_etl` twice and compare `etl/output` SHA256 manifests | OK |
| Field-scoped diff against `origin/merit-v3:etl/output/player_tournaments.json` | only 10,957 `club_at_tournament` null-to-value changes |
| Field-scoped delta against `90c796b` | exactly 5 `club_at_tournament` null-to-value changes; zero non-club diffs |
| `git diff --quiet` for ratings/stature/identity outputs | exit 0 |

Deterministic touched-output hashes after the run-twice proof:

| File | sha256 |
|---|---|
| `etl/output/player_tournaments.json` | `be93b57ef9b4945081daab3e39c409d4d0d16efe50c0ef5c7429077e5b8930fc` |
| `etl/output/manifest.json` | `bd51f92a8e291129ea110e78061e2e34e9f994e02dea68e4dbbbfac5561530a3` |
| `etl/output/COVERAGE.md` | `09dc44c5a65dbb79887f2683ecb41b236cfba82a1e2ee9b0569d90f267f3699c` |
