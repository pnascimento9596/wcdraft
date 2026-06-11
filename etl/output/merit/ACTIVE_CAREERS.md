# Active-career intake (active-career-source-set-1.0.0)

MV2-12a facts-only intake for IN-PROGRESS careers (archive peak-year ceiling 2022). Curation cutoff **2026-06-01**. STRUCTURALLY INERT: no rating-stage module reads these artifacts; no score/index is computed. Activation is MV2-12b (career-stage-normalized index, full Red chain).

- Linked active facts: **47**
- Players staged: **23**
- Withheld (review): **0**
- Identity-bridge review entries: **0**

## Facts by family

| Family | facts |
|---|---:|
| `captaincy` | 5 |
| `global_annual_recognition` | 7 |
| `international_record` | 13 |
| `position_balanced_selection` | 20 |
| `regional_annual_recognition` | 2 |

## Facts by stated position

| Position | facts |
|---|---:|
| GK | 3 |
| DF | 7 |
| MF | 5 |
| FW | 6 |
| (unstated) | 26 |

## Staged players

| Player | Identity | 2026 squad | Facts | Families |
|---|---|---|---:|---|
| Alisson (`P-21531`) | historical | ✓ | 2 | position_balanced_selection |
| José Giménez (`P-65659`) | historical | ✓ | 1 | captaincy |
| Guillermo Ochoa (`P-80826`) | historical | ✓ | 1 | international_record |
| Marko Arnautović (`P-W26-0049`) | minted_2026 | ✓ | 2 | international_record |
| David Alaba (`P-W26-0050`) | minted_2026 | ✓ | 6 | captaincy, international_record, position_balanced_selection |
| Luiz Henrique (`P-W26-0115`) | minted_2026 | ✓ | 1 | regional_annual_recognition |
| Florian Wirtz (`P-W26-0267`) | minted_2026 | ✓ | 1 | position_balanced_selection |
| Duckens Nazon (`P-W26-0291`) | minted_2026 | ✓ | 1 | international_record |
| Frantzdy Pierrot (`P-W26-0292`) | minted_2026 | ✓ | 1 | international_record |
| Franck Kessié (`P-W26-0356`) | minted_2026 | ✓ | 1 | international_record |
| Martin Ødegaard (`P-W26-0470`) | minted_2026 | ✓ | 1 | position_balanced_selection |
| Erling Haaland (`P-W26-0477`) | minted_2026 | ✓ | 11 | global_annual_recognition, international_record, position_balanced_selection |
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

## Identity-bridge review (review-only; MV2-12b seam)

(none detected)

## Curation notes (attempted-but-dropped, documented gaps)

- Recognition that the pinned parser snapshots already carry for active players (e.g. annual-XI selections, century caps lists) is NOT re-asserted here — the build recovers those withheld parser records directly against the 2026 identity space, keeping snapshot provenance.
- Federico Valverde (Uruguay) was ATTEMPTED and DROPPED on anti-fabrication grounds: his article identifies José María Giménez as Uruguay's 2026 World Cup captain (Luis Suárez at the 2024 Copa América) and credits Valverde only with a club vice-captaincy. The verifiable Uruguay captaincy fact is recorded for Giménez instead; Valverde carries no fact in this pass (missing facts stay missing).
- Ehsan Hajsafi (Iran, 145 caps per the 2026 squad table) was ATTEMPTED and DROPPED: he is absent from the pinned century-caps snapshot under any spelling, so there is no withheld parser record to recover, and the unit's bounded scope takes only snapshot-recoverable longevity records in this pass. Recorded as an open curation gap for the next active-set revision.

_Conservative linking throughout: a parser record is recovered against the minted 2026 identity space ONLY when the historical canon offers no candidate; note rows link historical-first; every ambiguity is withheld, never assigned. A staged fact may not target an identity the consumed archive already scores (build-enforced)._

