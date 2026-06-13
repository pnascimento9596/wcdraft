# Career-stature composite (career-stature-3.1.0)

Per-player career-stature BASE consumed by the stature-dominant rating stage (MV2-4). NOT a rating. Built deterministically from the committed `merit/source_facts.json` (merit-source-set-2.1.0), `merit/source_facts_active.json` (active-career-source-set-2.1.0), and canonical men's World Cup years. Active facts are merged by person identity and stage-normalized in this table; rating-output consumption remains locked to `career-stature-2.1.0` through each row's `rating_compat` field until the later merit-v3 rating units flip the consumer deliberately.

- Players scored: **845**
- Rows with active facts: **30**
- Material-stature (coverage ≥ 0.25 AND index ≥ 0.4): **199** (the cohort the rating stage ramps onto the stature-dominant path; the rest stay raw-tournament)
- Factual legends: **110**
- Tier cuts (index quantiles of the material cohort): gold ≥ `0.772217`, silver ≥ `0.61763`, bronze = qualifying remainder

## Score / index distribution by era bucket

| Era | players | score min/med/max | index min/med/max |
|---|---:|---|---|
| `pre_1956` | 63 | 0.027 / 0.234 / 0.652 | 0.054 / 0.468 / 0.876 |
| `1956_1990` | 224 | 0.000 / 0.179 / 0.597 | 0.000 / 0.357 / 0.928 |
| `1991_plus` | 558 | 0.012 / 0.057 / 0.527 | 0.024 / 0.113 / 0.867 |

## Material-cohort index by modal position

| Position | material players | index min/med/max |
|---|---:|---|
| GK | 14 | 0.424 / 0.582 / 0.710 |
| DF | 21 | 0.401 / 0.587 / 0.862 |
| MF | 27 | 0.400 / 0.615 / 0.928 |
| FW | 29 | 0.438 / 0.626 / 0.867 |

## Legend reason-code breakdown

| Reason code | players |
|---|---:|
| `global_annual_multi_winner` | 32 |
| `global_annual_winner_with_corroboration` | 22 |
| `approved_all_time_selection` | 54 |
| `position_balanced_world_xi_3plus` | 29 |
| `retrospective_plus_major_fact` | 70 |
| `pre_1967_retrospective_consensus` | 25 |

## Canonical-greats checklist (de-risk signal)

| Great | Era | Score | Index | Cov | Tier | Legend |
|---|---|---:|---:|---:|---|---|
| Pelé | `1956_1990` | 0.540 | 0.878 | 0.79 | gold | ✓ |
| Alfredo Di Stéfano | `1956_1990` | 0.411 | 0.741 | 0.47 | silver | ✓ |
| Garrincha | `1956_1990` | 0.477 | 0.824 | 0.58 | gold | ✓ |
| Ferenc Puskás | `pre_1956` | 0.545 | 0.860 | 0.64 | gold | ✓ |
| Lev Yashin (GK) | `1956_1990` | 0.390 | 0.710 | 0.47 | silver | ✓ |
| Bobby Charlton | `1956_1990` | 0.406 | 0.734 | 0.54 | silver | ✓ |
| Eusébio | `1956_1990` | 0.514 | 0.855 | 0.74 | gold | ✓ |
| Franz Beckenbauer | `1956_1990` | 0.522 | 0.862 | 0.78 | gold | ✓ |
| Johan Cruyff | `1956_1990` | 0.407 | 0.735 | 0.47 | silver | ✓ |
| Gerd Müller | `1956_1990` | 0.522 | 0.862 | 0.74 | gold | ✓ |
| Diego Maradona | `1956_1990` | 0.597 | 0.928 | 0.88 | gold | ✓ |
| Michel Platini | `1956_1990` | 0.431 | 0.772 | 0.54 | silver | ✓ |
| Zico | `1956_1990` | 0.498 | 0.842 | 0.84 | gold | ✓ |
| Karl-Heinz Rummenigge | `1956_1990` | 0.523 | 0.863 | 0.74 | gold | ✓ |
| Franco Baresi (DF) | `1956_1990` | 0.328 | 0.618 | 0.49 | silver | ✓ |
| Lothar Matthäus | `1956_1990` | 0.524 | 0.864 | 0.78 | gold | ✓ |
| Marco van Basten | `1956_1990` | 0.415 | 0.748 | 0.47 | silver | ✓ |
| Roberto Baggio | `1956_1990` | 0.488 | 0.833 | 0.67 | gold | ✓ |
| Zinedine Zidane | `1991_plus` | 0.507 | 0.849 | 0.70 | gold | ✓ |
| Ronaldo | `1991_plus` | 0.499 | 0.843 | 0.70 | gold | ✓ |
| Ronaldinho | `1991_plus` | 0.422 | 0.758 | 0.60 | silver | ✓ |
| Cafu (DF) | `1991_plus` | 0.157 | 0.314 | 0.25 | — | ✓ |
| Gianluigi Buffon (GK) | `1991_plus` | 0.370 | 0.680 | 0.50 | silver | ✓ |
| Paolo Maldini (DF) | `1956_1990` | 0.397 | 0.721 | 0.54 | silver | ✓ |
| Lionel Messi | `1991_plus` | 0.527 | 0.867 | 0.70 | gold | ✓ |
| Cristiano Ronaldo | `1991_plus` | 0.430 | 0.770 | 0.53 | silver | ✓ |

## Defender / goalkeeper checklist (the v2 repair target)

| Player | Era | Index | Cov | Tier | Legend | Reason codes |
|---|---|---:|---:|---|---|---|
| Paolo Maldini (DF) | `1956_1990` | 0.721 | 0.54 | silver | ✓ | global_annual_winner_with_corroboration, approved_all_time_selection, position_balanced_world_xi_3plus, retrospective_plus_major_fact |
| Franco Baresi (DF) | `1956_1990` | 0.618 | 0.49 | silver | ✓ | approved_all_time_selection, retrospective_plus_major_fact |
| Franz Beckenbauer (DF) | `1956_1990` | 0.862 | 0.78 | gold | ✓ | global_annual_multi_winner, approved_all_time_selection, retrospective_plus_major_fact |
| Cafu (DF) | `1991_plus` | 0.314 | 0.25 | — | ✓ | approved_all_time_selection |
| Lev Yashin (GK) | `1956_1990` | 0.710 | 0.47 | silver | ✓ | global_annual_winner_with_corroboration, approved_all_time_selection, retrospective_plus_major_fact |
| Dino Zoff (GK) | — | — | — | — | — | (no linked facts) |
| Gianluigi Buffon (GK) | `1991_plus` | 0.680 | 0.50 | silver | ✓ | approved_all_time_selection, position_balanced_world_xi_3plus, retrospective_plus_major_fact |
| Iker Casillas (GK) | — | — | — | — | — | (no linked facts) |

_Thin-coverage / low-index rows are withheld from the stature-dominant rating path (they keep their raw tournament score — missing coverage is coverage, never a zero against the player) and listed in `career_stature_review.json`. Legend is SOURCE-derived and never inspects a rating; the Route-4 index floor (a documented in-spirit tightening of the plan) keeps the broad living-legends long-tail out of the badge._

