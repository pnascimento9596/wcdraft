# Career-stature composite (career-stature-1.0.0)

Per-player career-stature BASE consumed by the rating stage (E-4.3) as a capped lift. NOT a rating. Built deterministically from the committed `merit/source_facts.json` + canonical men's World Cup years.

- Players scored: **644**
- Lift-eligible (coverage ≥ 0.25): **226** (the rest carry a real score but get little/no lift — honest thin coverage)

## Score distribution by era bucket

| Era | players | min | median | max |
|---|---:|---:|---:|---:|
| `pre_1956` | 58 | 0.059 | 0.270 | 0.664 |
| `1956_1990` | 177 | 0.028 | 0.138 | 0.658 |
| `1991_plus` | 409 | 0.055 | 0.075 | 0.657 |

## Canonical-greats checklist (de-risk signal)

| Great | Era | Score | Coverage | Families with facts |
|---|---|---:|---:|---|
| Pelé | `1956_1990` | 0.590 | 1.00 | wc_legacy, annual_recognition, international_record, retrospective_selection |
| Alfredo Di Stéfano | `1956_1990` | 0.517 | 0.60 | annual_recognition, retrospective_selection |
| Garrincha | `1956_1990` | 0.380 | 0.45 | wc_legacy, retrospective_selection |
| Ferenc Puskás | `pre_1956` | 0.434 | 0.55 | international_record, retrospective_selection |
| Lev Yashin (GK) | `1956_1990` | 0.383 | 0.45 | annual_recognition |
| Bobby Charlton | `1956_1990` | 0.497 | 0.70 | annual_recognition, international_record, retrospective_selection |
| Eusébio | `1956_1990` | 0.632 | 1.00 | wc_legacy, annual_recognition, international_record, retrospective_selection |
| Franz Beckenbauer | `1956_1990` | 0.642 | 1.00 | wc_legacy, annual_recognition, international_record, retrospective_selection |
| Johan Cruyff | `1956_1990` | 0.083 | 0.15 | retrospective_selection |
| Gerd Müller | `1956_1990` | 0.640 | 1.00 | wc_legacy, annual_recognition, international_record, retrospective_selection |
| Diego Maradona | `1956_1990` | 0.658 | 1.00 | wc_legacy, annual_recognition, international_record, retrospective_selection |
| Michel Platini | `1956_1990` | 0.550 | 0.70 | annual_recognition, international_record, retrospective_selection |
| Zico | `1956_1990` | 0.605 | 1.00 | wc_legacy, annual_recognition, international_record, retrospective_selection |
| Karl-Heinz Rummenigge | `1956_1990` | 0.654 | 1.00 | wc_legacy, annual_recognition, international_record, retrospective_selection |
| Franco Baresi (DF) | `1956_1990` | 0.150 | 0.15 | retrospective_selection |
| Lothar Matthäus | `1956_1990` | 0.638 | 1.00 | wc_legacy, annual_recognition, international_record, retrospective_selection |
| Marco van Basten | `1956_1990` | 0.532 | 0.60 | annual_recognition, retrospective_selection |
| Roberto Baggio | `1956_1990` | 0.583 | 0.90 | wc_legacy, annual_recognition, retrospective_selection |
| Zinedine Zidane | `1991_plus` | 0.608 | 1.00 | wc_legacy, annual_recognition, international_record, retrospective_selection |
| Ronaldo | `1991_plus` | 0.648 | 1.00 | wc_legacy, annual_recognition, international_record, retrospective_selection |
| Ronaldinho | `1991_plus` | 0.496 | 0.75 | annual_recognition, international_record, retrospective_selection |
| Cafu (DF) | `1991_plus` | 0.406 | 0.75 | annual_recognition, international_record, retrospective_selection |
| Gianluigi Buffon (GK) | `1991_plus` | 0.333 | 0.55 | wc_legacy, international_record, retrospective_selection |
| Paolo Maldini (DF) | `1956_1990` | 0.162 | 0.25 | international_record, retrospective_selection |
| Lionel Messi | `1991_plus` | 0.657 | 0.90 | wc_legacy, annual_recognition, international_record |
| Cristiano Ronaldo | `1991_plus` | 0.541 | 0.65 | annual_recognition, international_record |

_Thin-coverage greats (single World Cup, sparse public recognition) score low by design: missing coverage is coverage, never a zero against the player, and the rating lift gate (`MIN_CAREER_COVERAGE_FOR_LIFT`) withholds lift where the public record is too thin to support it._

