# Career-stature source coverage (ENGINE-V2 E-4.1)

> Career-stature records sourced from public archives — the Rec.Sport.Soccer Statistics Foundation (RSSSF, https://www.rsssf.org/) and Wikipedia (https://en.wikipedia.org/, CC BY-SA) — used with acknowledgement. Each record is transcribed from a SHA-pinned snapshot and linked to a canonical player_id only when the match is unique and high-confidence; ambiguous names are withheld for human review and never assigned.

- **Intake version:** `career-stature-1.0.0`
- **Scope:** coverage proof only — **no rating output, engine, or compact data is changed by this build.**
- **Linked facts:** 950 across 646 distinct players (men's World Cup pool).
- **Withheld to review (never assigned):** 605 distinct ambiguities.


## Linked players by signal family × player era

| Signal family | pre-1956 | 1956–1990 | 1991+ | Total |
|---|---|---|---|---|
| wc_legacy | 21 | 47 | 41 | 109 |
| annual_recognition | 2 | 42 | 36 | 80 |
| international_record | 21 | 75 | 358 | 454 |
| retrospective_selection | 31 | 107 | 63 | 201 |
| club_honors | — | — | — | _deferred (E-4b), weight 0.0_ |

## Linked facts per source

| Source | Family | Linked facts |
|---|---|---|
| European Player of the Year (Ballon d'Or) — annual winners | annual_recognition | 56 |
| IFFHS Century elections — world/continental player-of-the-century polls | retrospective_selection | 123 |
| IFFHS World's Best Player — annual winners | annual_recognition | 8 |
| Players with 100+ international caps / 30+ international goals | international_record | 454 |
| 2004 living-legends list — 125 greatest living players selection | retrospective_selection | 116 |
| South American Player of the Year — annual winners | annual_recognition | 52 |
| wc_individual_awards_native | wc_legacy | 141 |

## World Cup Golden Ball cross-check (native data is canonical)

- Native Golden Ball awards checked against the public list: **11/11 agree** (11 public rows).

- No divergences: every checked native Golden Ball winner matches the public list.

## Review queue (withheld — null coverage, never a zero-fact)

| Reason | Distinct names |
|---|---|
| multi_candidate | 3 |
| nation_mismatch | 1 |
| no_candidate | 599 |
| weak_unverified | 2 |

Every row in `link_review.json` carries the source, raw name, nation token, year and any candidate ids — a human can resolve it without re-deriving the link. Missing coverage is coverage: an unlinked record is absent, never recorded as a zero-stature fact against a player.


## Canonical-greats checklist (the de-risk signal)

Each legend should visibly pick up stature across families before the lift is integrated. ✓ = at least one linked fact in that family.

| Great | Era | WC legacy | Annual | Int'l record | Retrospective | Families |
|---|---|---|---|---|---|---|
| Pelé | 1956–1990 | ✓ | ✓ | ✓ | ✓ | 4/4 |
| Alfredo Di Stéfano | 1956–1990 | — | ✓ | — | ✓ | 2/4 |
| Garrincha | 1956–1990 | ✓ | — | — | ✓ | 2/4 |
| Ferenc Puskás | pre-1956 | — | — | ✓ | ✓ | 2/4 |
| Lev Yashin (GK) | 1956–1990 | — | ✓ | — | — | 1/4 |
| Bobby Charlton | 1956–1990 | — | ✓ | ✓ | ✓ | 3/4 |
| Eusébio | 1956–1990 | ✓ | ✓ | ✓ | ✓ | 4/4 |
| Franz Beckenbauer | 1956–1990 | ✓ | ✓ | ✓ | ✓ | 4/4 |
| Johan Cruyff | 1956–1990 | — | — | — | ✓ | 1/4 |
| Gerd Müller | 1956–1990 | ✓ | ✓ | ✓ | ✓ | 4/4 |
| Diego Maradona | 1956–1990 | ✓ | ✓ | ✓ | ✓ | 4/4 |
| Michel Platini | 1956–1990 | — | ✓ | ✓ | ✓ | 3/4 |
| Zico | 1956–1990 | ✓ | ✓ | ✓ | ✓ | 4/4 |
| Karl-Heinz Rummenigge | 1956–1990 | ✓ | ✓ | ✓ | ✓ | 4/4 |
| Franco Baresi (DF) | 1956–1990 | — | — | — | ✓ | 1/4 |
| Lothar Matthäus | 1956–1990 | ✓ | ✓ | ✓ | ✓ | 4/4 |
| Marco van Basten | 1956–1990 | — | ✓ | — | ✓ | 2/4 |
| Roberto Baggio | 1956–1990 | ✓ | ✓ | — | ✓ | 3/4 |
| Zinedine Zidane | 1991+ | ✓ | ✓ | ✓ | ✓ | 4/4 |
| Ronaldo | 1991+ | ✓ | ✓ | ✓ | ✓ | 4/4 |
| Ronaldinho | 1991+ | — | ✓ | ✓ | ✓ | 3/4 |
| Cafu (DF) | 1991+ | — | ✓ | ✓ | ✓ | 3/4 |
| Gianluigi Buffon (GK) | 1991+ | ✓ | — | ✓ | ✓ | 3/4 |
| Paolo Maldini (DF) | 1956–1990 | — | — | ✓ | ✓ | 2/4 |
| Lionel Messi | 1991+ | ✓ | ✓ | ✓ | — | 3/4 |
| Cristiano Ronaldo | 1991+ | — | ✓ | ✓ | — | 2/4 |

**26/26** canonical greats picked up at least one linked stature fact.

