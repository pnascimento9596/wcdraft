# wcdraft ETL — Coverage Report

Per-era signal availability and null-rates for the canonical tables built
from the Fjelstul World Cup Database. **Honest-state:** a signal absent for
an era is `null`, never `0`/`false`/`""`. This report is generated from the
emitted tables, so it cannot drift from what was shipped.

> Contains information from The Fjelstul World Cup Database (v1.2.0) by Joshua C. Fjelstul, Ph.D., © 2023 Joshua C. Fjelstul, Ph.D., used under CC-BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/legalcode). Source: https://www.github.com/jfjelstul/worldcup (pinned commit f41e9437a007498bdbf3751305818101f96cb6fb). Modifications by wcdraft: normalized into canonical nation/player/card/manager/tournament tables; derived coarse positions, per-card goal/appearance/award aggregates and a per-card coverage score; added a curated historical-entity / alias reference for nations. No upstream values were altered, imputed, or back-filled; absent signals are preserved as null. wcdraft derived data is redistributed under CC-BY-SA 4.0 (ShareAlike).

## The two era cliffs

| Signal | Available from | Before that |
|---|---|---|
| Goals, squad selection, awards, standings, managers | **1930** | — (full history) |
| Match appearances / lineups, bookings, substitutions | **1970** | `null` (no match-level data) |
| Shirt numbers | **1954** | `null` (no squad numbers assigned) |
| Club at tournament | **pinned Wikipedia squad pages (men's 1930–2022)** | `null` where the pinned source lacks a club row/value or no unambiguous join exists |
| **Assists, minutes played** | **never** | permanently absent — omitted, not fabricated |


Two distinct cliffs drive card coverage: squad numbers begin in **1954**
and match-level appearances begin in **1970**. Goals/selection/awards reach
back to **1930**.

## Row counts per table

| Table | Rows |
|---|---|
| appearances | 27,432 |
| awards | 200 |
| goals | 3,637 |
| manager_tournaments | 637 |
| managers | 475 |
| nations | 88 |
| player_tournaments | 13,843 |
| players | 10,401 |
| tournaments | 30 |

## Null-rate per nullable column

Only honest-state nullable columns are listed. `club_at_tournament` is
populated only where the pinned Wikipedia squad source carries a factual
club name and the row joins unambiguously to a canonical card; managers'
`birth_date` is **100% null** (no birth_date column upstream); and
`final_placement` is null except for semifinalists, because the upstream
`tournament_standings` ranks only positions 1–4 per tournament. These are
absences in the source, surfaced — not data-quality defects.

| Table | Column | Null rate |
|---|---|---|
| manager_tournaments | matches | 0.0% (0/637) |
| manager_tournaments | final_placement | 80.7% (514/637) |
| managers | full_name | 0.0% (0/475) |
| managers | nation_id | 0.0% (0/475) |
| managers | birth_date | 100.0% (475/475) |
| nations | canonical_name | 0.0% (0/88) |
| nations | code | 0.0% (0/88) |
| nations | successor | 90.9% (80/88) |
| player_tournaments | shirt | 8.6% (1,188/13,843) |
| player_tournaments | position_listed | 0.0% (0/13,843) |
| player_tournaments | club_at_tournament | 20.9% (2,891/13,843) |
| player_tournaments | appearances | 7.3% (1,016/13,843) |
| players | full_name | 0.0% (0/10,401) |
| players | birth_date | 0.0% (1/10,401) |
| players | primary_position | 0.0% (0/10,401) |
| tournaments | name | 0.0% (0/30) |
| tournaments | year | 0.0% (0/30) |
| tournaments | host_country | 0.0% (0/30) |
| tournaments | champion | 0.0% (0/30) |
| tournaments | count_teams | 0.0% (0/30) |

## Card coverage by era

`coverage` = fraction of the per-card signal universe {selection, position_listed, goals, awards, appearances, shirt} present
for that card. Signals outside the rating-input universe (club, assists, minutes) are excluded: club is optional display metadata,
while assists/minutes are absent. The values cluster at
three tiers matching the cliffs.

| Era | Cards | Mean coverage | Typical |
|---|---|---|---|
| pre-1954 | 1,188 | 0.7663 | 0.6667 (4/6) |
| 1954–1969 | 1,406 | 0.9362 | 0.8333 (5/6) |
| 1970+ | 11,249 | 1.0000 | 1.0000 (6/6) |

