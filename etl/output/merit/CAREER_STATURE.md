# Career-stature composite (career-stature-2.1.0)

Per-player career-stature BASE consumed by the stature-dominant rating stage (MV2-4). NOT a rating. Built deterministically from the committed `merit/source_facts.json` (merit-source-set-2.0.0) + canonical men's World Cup years.

- Players scored: **791**
- Material-stature (coverage ≥ 0.25 AND index ≥ 0.4): **207** (the cohort the rating stage ramps onto the stature-dominant path; the rest stay raw-tournament)
- Factual legends: **112**
- Tier cuts (index quantiles of the material cohort): gold ≥ `0.809391`, silver ≥ `0.631647`, bronze = qualifying remainder

## Score / index distribution by era bucket

| Era | players | score min/med/max | index min/med/max |
|---|---:|---|---|
| `pre_1956` | 58 | 0.044 / 0.360 / 0.671 | 0.089 / 0.665 / 0.992 |
| `1956_1990` | 200 | 0.000 / 0.180 / 0.625 | 0.000 / 0.360 / 0.952 |
| `1991_plus` | 533 | 0.020 / 0.060 / 0.609 | 0.040 / 0.121 / 0.938 |

## Material-cohort index by modal position

| Position | material players | index min/med/max |
|---|---:|---|
| GK | 15 | 0.446 / 0.552 / 0.777 |
| DF | 31 | 0.430 / 0.598 / 0.889 |
| MF | 36 | 0.413 / 0.643 / 0.952 |
| FW | 27 | 0.410 / 0.682 / 0.938 |

## Legend reason-code breakdown

| Reason code | players |
|---|---:|
| `global_annual_multi_winner` | 31 |
| `global_annual_winner_with_corroboration` | 21 |
| `approved_all_time_selection` | 54 |
| `position_balanced_world_xi_3plus` | 50 |
| `retrospective_plus_major_fact` | 60 |

## Canonical-greats checklist (de-risk signal)

| Great | Era | Score | Index | Cov | Tier | Legend |
|---|---|---:|---:|---:|---|---|
| Pelé | `1956_1990` | 0.458 | 0.807 | 0.68 | silver | ✓ |
| Alfredo Di Stéfano | `1956_1990` | 0.433 | 0.774 | 0.53 | silver | ✓ |
| Garrincha | `1956_1990` | 0.399 | 0.723 | 0.49 | silver | ✓ |
| Ferenc Puskás | `pre_1956` | 0.549 | 0.886 | 0.65 | gold | ✓ |
| Lev Yashin (GK) | `1956_1990` | 0.408 | 0.738 | 0.53 | silver | ✓ |
| Bobby Charlton | `1956_1990` | 0.415 | 0.748 | 0.61 | silver | ✓ |
| Eusébio | `1956_1990` | 0.541 | 0.879 | 0.84 | gold | ✓ |
| Franz Beckenbauer | `1956_1990` | 0.552 | 0.889 | 0.89 | gold | ✓ |
| Johan Cruyff | `1956_1990` | 0.420 | 0.755 | 0.53 | silver | ✓ |
| Gerd Müller | `1956_1990` | 0.550 | 0.887 | 0.84 | gold | ✓ |
| Diego Maradona | `1956_1990` | 0.625 | 0.952 | 1.00 | gold | ✓ |
| Michel Platini | `1956_1990` | 0.455 | 0.804 | 0.61 | silver | ✓ |
| Zico | `1956_1990` | 0.518 | 0.859 | 0.95 | gold | ✓ |
| Karl-Heinz Rummenigge | `1956_1990` | 0.552 | 0.889 | 0.84 | gold | ✓ |
| Franco Baresi (DF) | `1956_1990` | 0.338 | 0.632 | 0.55 | silver | ✓ |
| Lothar Matthäus | `1956_1990` | 0.554 | 0.891 | 0.89 | gold | ✓ |
| Marco van Basten | `1956_1990` | 0.438 | 0.781 | 0.53 | silver | ✓ |
| Roberto Baggio | `1956_1990` | 0.512 | 0.854 | 0.76 | gold | ✓ |
| Zinedine Zidane | `1991_plus` | 0.597 | 0.928 | 0.85 | gold | ✓ |
| Ronaldo | `1991_plus` | 0.580 | 0.913 | 0.85 | gold | ✓ |
| Ronaldinho | `1991_plus` | 0.531 | 0.870 | 0.80 | gold | ✓ |
| Cafu (DF) | `1991_plus` | 0.354 | 0.656 | 0.58 | silver | ✓ |
| Gianluigi Buffon (GK) | `1991_plus` | 0.435 | 0.777 | 0.58 | silver | ✓ |
| Paolo Maldini (DF) | `1956_1990` | 0.417 | 0.750 | 0.61 | silver | ✓ |
| Lionel Messi | `1991_plus` | 0.609 | 0.938 | 0.85 | gold | ✓ |
| Cristiano Ronaldo | `1991_plus` | 0.540 | 0.878 | 0.70 | gold | ✓ |

## Defender / goalkeeper checklist (the v2 repair target)

| Player | Era | Index | Cov | Tier | Legend | Reason codes |
|---|---|---:|---:|---|---|---|
| Paolo Maldini (DF) | `1956_1990` | 0.750 | 0.61 | silver | ✓ | global_annual_winner_with_corroboration, approved_all_time_selection, position_balanced_world_xi_3plus, retrospective_plus_major_fact |
| Franco Baresi (DF) | `1956_1990` | 0.632 | 0.55 | silver | ✓ | approved_all_time_selection, retrospective_plus_major_fact |
| Franz Beckenbauer (DF) | `1956_1990` | 0.889 | 0.89 | gold | ✓ | global_annual_multi_winner, approved_all_time_selection, retrospective_plus_major_fact |
| Cafu (DF) | `1991_plus` | 0.656 | 0.58 | silver | ✓ | approved_all_time_selection, retrospective_plus_major_fact |
| Lev Yashin (GK) | `1956_1990` | 0.738 | 0.53 | silver | ✓ | global_annual_winner_with_corroboration, approved_all_time_selection |
| Dino Zoff (GK) | — | — | — | — | — | (no linked facts) |
| Gianluigi Buffon (GK) | `1991_plus` | 0.777 | 0.58 | silver | ✓ | approved_all_time_selection, position_balanced_world_xi_3plus, retrospective_plus_major_fact |
| Iker Casillas (GK) | — | — | — | — | — | (no linked facts) |

_Thin-coverage / low-index rows are withheld from the stature-dominant rating path (they keep their raw tournament score — missing coverage is coverage, never a zero against the player) and listed in `career_stature_review.json`. Legend is SOURCE-derived and never inspects a rating; the Route-4 index floor (a documented in-spirit tightening of the plan) keeps the broad living-legends long-tail out of the badge._

