# Active-career intake (active-career-source-set-2.0.0)

MV2-12a facts-only intake for IN-PROGRESS careers (archive peak-year ceiling 2022). Curation cutoff **2026-06-01**. Activated by career-stature-3.0.0: stature.py consumes these artifacts, while this module still emits facts + identity only and no rating output.

- Linked active facts: **53**
- Players staged: **26**
- Withheld (review): **0**
- Identity-bridge review entries: **0**

## Facts by family

| Family | facts |
|---|---:|
| `captaincy` | 5 |
| `club_season_honors` | 6 |
| `global_annual_recognition` | 7 |
| `international_record` | 13 |
| `position_balanced_selection` | 20 |
| `regional_annual_recognition` | 2 |

## Facts by stated position

| Position | facts |
|---|---:|
| GK | 3 |
| DF | 7 |
| MF | 8 |
| FW | 9 |
| (unstated) | 26 |

## Staged players

| Player | Identity | 2026 squad | Facts | Families |
|---|---|---|---:|---|
| Federico Valverde (`P-05174`) | historical | ✓ | 2 | club_season_honors |
| Alisson (`P-21531`) | historical | ✓ | 2 | position_balanced_selection |
| Rodri (`P-62341`) | historical | ✓ | 1 | club_season_honors |
| José Giménez (`P-65659`) | historical | ✓ | 1 | captaincy |
| Guillermo Ochoa (`P-80826`) | historical | ✓ | 1 | international_record |
| Vinícius Júnior (`P-92812`) | historical | ✓ | 2 | club_season_honors |
| Marko Arnautović (`P-W26-0049`) | minted_2026 | ✓ | 2 | international_record |
| David Alaba (`P-W26-0050`) | minted_2026 | ✓ | 6 | captaincy, international_record, position_balanced_selection |
| Luiz Henrique (`P-W26-0115`) | minted_2026 | ✓ | 1 | regional_annual_recognition |
| Florian Wirtz (`P-W26-0267`) | minted_2026 | ✓ | 1 | position_balanced_selection |
| Duckens Nazon (`P-W26-0291`) | minted_2026 | ✓ | 1 | international_record |
| Frantzdy Pierrot (`P-W26-0292`) | minted_2026 | ✓ | 1 | international_record |
| Franck Kessié (`P-W26-0356`) | minted_2026 | ✓ | 1 | international_record |
| Martin Ødegaard (`P-W26-0470`) | minted_2026 | ✓ | 1 | position_balanced_selection |
| Erling Haaland (`P-W26-0477`) | minted_2026 | ✓ | 12 | club_season_honors, global_annual_recognition, international_record, position_balanced_selection |
| Alberto Quintero (`P-W26-0486`) | minted_2026 | ✓ | 1 | international_record |
| Adalberto Carrasquilla (`P-W26-0500`) | minted_2026 | ✓ | 1 | regional_annual_recognition |
| Gustavo Gómez (`P-W26-0512`) | minted_2026 | ✓ | 1 | captaincy |
| Pedro Miguel (`P-W26-0543`) | minted_2026 | ✓ | 1 | international_record |
| Andy Robertson (`P-W26-0574`) | minted_2026 | ✓ | 3 | captaincy, position_balanced_selection |
| Scott McTominay (`P-W26-0587`) | minted_2026 | ✓ | 1 | position_balanced_selection |
| Álex Grimaldo (`P-W26-0651`) | minted_2026 | ✓ | 1 | position_balanced_selection |
| Lamine Yamal (`P-W26-0663`) | minted_2026 | ✓ | 5 | global_annual_recognition, position_balanced_selection |
| Hakan Çalhanoğlu (`P-W26-0716`) | minted_2026 | ✓ | 2 | captaincy, international_record |
| Chancel Mbemba (`P-W26-0822`) | minted_2026 | ✓ | 1 | international_record |
| Eldor Shomurodov (`P-W26-0876`) | minted_2026 | ✓ | 1 | international_record |

## Identity-bridge review (review-only; stature resolver input)

(none detected)

## Curation notes (attempted-but-dropped, documented gaps)

- Recognition that the pinned parser snapshots already carry for active players (e.g. annual-XI selections, century caps lists) is NOT re-asserted here — the build recovers those withheld parser records directly against the 2026 identity space, keeping snapshot provenance.
- Federico Valverde (Uruguay) was ATTEMPTED and DROPPED on anti-fabrication grounds: his article identifies José María Giménez as Uruguay's 2026 World Cup captain (Luis Suárez at the 2024 Copa América) and credits Valverde only with a club vice-captaincy. The verifiable Uruguay captaincy fact is recorded for Giménez instead; Valverde carries no captaincy fact in this pass (missing captaincy stays missing).
- Ehsan Hajsafi (Iran, 145 caps per the 2026 squad table) was ATTEMPTED and DROPPED: he is absent from the pinned century-caps snapshot under any spelling, so there is no withheld parser record to recover, and the unit's bounded scope takes only snapshot-recoverable longevity records in this pass. Recorded as an open curation gap for the next active-set revision.
- Bounded near-miss bridge curation for Ró-Ró/Pedro Miguel, El Khannouss, Issahaku/Abdul Fatawu, Baba Rahman, and Bárcenas is deferred to V2: V1 already changes the scoring table and activation guards, so mixing identity-bridge research into the same diff would make review less crisp.

_Conservative linking throughout: a parser record is recovered against the minted 2026 identity space ONLY when the historical canon offers no candidate; note rows link historical-first; every ambiguity is withheld, never assigned. Archived-target staged facts are merged by stature.py's person resolver, which enforces one row per person._

