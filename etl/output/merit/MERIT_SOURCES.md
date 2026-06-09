# Career-stature source coverage (merit-source-set v2)

> Career-stature records sourced from public archives — the Rec.Sport.Soccer Statistics Foundation (RSSSF, https://www.rsssf.org/), Wikipedia (https://en.wikipedia.org/, CC BY-SA), and the IFFHS (https://www.iffhs.com/) — used with acknowledgement. Each record is transcribed from a SHA-pinned snapshot and linked to a canonical player_id only when the match is unique and high-confidence; ambiguous names are withheld for human review and never assigned.

- **Source-set version:** `merit-source-set-2.0.0`
- **Scope:** coverage only — **no rating output, engine, or compact data is changed by this build.** The v2 source families are staged in `source_facts.json` for the career-stature-2.0.0 table (MV2-3).
- **Linked facts:** 2,144 across 790 distinct players (men's World Cup pool) — **2,003 parser-derived** + **141 native** World Cup awards.
- **First-class position facts:** 405 (GK/DF/MF/FW) from the position-balanced + all-time sources.
- **Withheld to review (never assigned):** 751 distinct ambiguities.


## Linked players by signal family × player era

| Signal family | pre-1956 | 1956–1990 | 1991+ | Total |
|---|---|---|---|---|
| WC legacy | 21 | 47 | 41 | 109 |
| Global annual | 2 | 47 | 34 | 83 |
| Regional annual | 0 | 39 | 81 | 120 |
| Position XI | 0 | 8 | 195 | 203 |
| Int'l record | 21 | 75 | 358 | 454 |
| Retrospective | 29 | 107 | 70 | 206 |
| captaincy | — | — | — | _reserved / legacy (no v2 source)_ |
| annual_recognition | — | — | — | _reserved / legacy (no v2 source)_ |
| club_honors | — | — | — | _reserved / legacy (no v2 source)_ |

## Linked facts per source

| Source | Family | Linked facts |
|---|---|---|
| African Player of the Year — annual winners | regional_annual_recognition | 36 |
| Asian Player of the Year — annual winners | regional_annual_recognition | 22 |
| Ballon d'Or Dream Team (2020) — all-time 1st/2nd/3rd position XIs | retrospective_selection | 24 |
| CONCACAF Player of the Year — annual winners | regional_annual_recognition | 9 |
| ESM Team of the Season — annual position XI | position_balanced_selection | 311 |
| European Player of the Year (Ballon d'Or) — annual winners | global_annual_recognition | 56 |
| FIFPro World 11 — annual player-voted position XI | position_balanced_selection | 133 |
| IFFHS Century elections — world/continental player-of-the-century polls | retrospective_selection | 181 |
| IFFHS All-Time World / continental / national dream teams | retrospective_selection | 20 |
| IFFHS World's Best Player — annual winners | global_annual_recognition | 8 |
| Players with 100+ international caps / 30+ international goals | international_record | 543 |
| 2004 living-legends list — 125 greatest living players selection | retrospective_selection | 114 |
| Onze d'Or / d'Argent / de Bronze — annual top-three | global_annual_recognition | 104 |
| South American Player of the Year (Rey de América) — annual winners | regional_annual_recognition | 52 |
| South American Player of the Year — annual top-3 placements (2nd/3rd) | regional_annual_recognition | 57 |
| UEFA Club positional awards — Best Goalkeeper/Defender/Midfielder/Forward | position_balanced_selection | 70 |
| UEFA Men's Player of the Year — annual top-three | global_annual_recognition | 11 |
| UEFA Team of the Year — annual position-normalised XI | position_balanced_selection | 209 |
| wc_individual_awards_native | wc_legacy | 141 |
| World Soccer Player of the Year — annual winners | global_annual_recognition | 43 |

## World Cup Golden Ball cross-check (native data is canonical)

- Native Golden Ball awards checked against the public list: **11/11 agree** (11 public rows).

- No divergences: every checked native Golden Ball winner matches the public list.

## Review queue (withheld — null coverage, never a zero-fact)

| Reason | Distinct names |
|---|---|
| multi_candidate | 21 |
| nation_divergent | 7 |
| nation_mismatch | 1 |
| no_candidate | 708 |
| weak_unverified | 14 |

Every row in `link_review.json` carries the source, raw name, nation token, year and any candidate ids — a human can resolve it without re-deriving the link. Missing coverage is coverage: an unlinked record is absent, never recorded as a zero-stature fact against a player.


## Defender / goalkeeper coverage (the v2 repair)

The striker-biased v1 ballots under-sourced these legends. The position-balanced (UEFA positional / ESM) and all-time (Ballon d'Or Dream Team / IFFHS) sources must now give each of them facts — and, where the source states it, a first-class position. ✓ = at least one fact.

| Defender / keeper | Era | Facts | Positions | Families |
|---|---|---:|---|---|
| Franco Baresi | 1956–1990 | 6 | DF | Retrospective |
| Paolo Maldini | 1956–1990 | 14 | DF | Global annual, Position XI, Int'l record, Retrospective |
| Lev Yashin | 1956–1990 | 3 | GK | Global annual, Retrospective |
| Gianluigi Buffon | 1991+ | 17 | GK | WC legacy, Position XI, Int'l record, Retrospective |
| Cafu | 1991+ | 7 | — | Regional annual, Position XI, Int'l record, Retrospective |
| Franz Beckenbauer | 1956–1990 | 11 | DF | WC legacy, Global annual, Int'l record, Retrospective |

_Position is read from each source's own structure (a positional section or a formation column), never inferred from a player's identity. A mononym with no corroborating nation/year (e.g. an all-time-XI 'Cafu') is withheld by the conservative linker, so a great may carry facts without a positioned row — honest under-coverage, never a guess._


## Canonical-greats checklist (the de-risk signal)

Each legend should visibly pick up stature across families. ✓ = at least one linked fact in that family.

| Great | Era | WC legacy | Global annual | Regional annual | Position XI | Int'l record | Retrospective | Families |
|---|---|---|---|---|---|---|---|---|
| Pelé | 1956–1990 | ✓ | — | ✓ | — | ✓ | ✓ | 4/6 |
| Alfredo Di Stéfano | 1956–1990 | — | ✓ | — | — | — | ✓ | 2/6 |
| Garrincha | 1956–1990 | ✓ | — | — | — | — | ✓ | 2/6 |
| Ferenc Puskás | pre-1956 | — | — | — | — | ✓ | ✓ | 2/6 |
| Lev Yashin (GK) | 1956–1990 | — | ✓ | — | — | — | ✓ | 2/6 |
| Bobby Charlton | 1956–1990 | — | ✓ | — | — | ✓ | ✓ | 3/6 |
| Eusébio | 1956–1990 | ✓ | ✓ | — | — | ✓ | ✓ | 4/6 |
| Franz Beckenbauer | 1956–1990 | ✓ | ✓ | — | — | ✓ | ✓ | 4/6 |
| Johan Cruyff | 1956–1990 | — | — | — | — | — | ✓ | 1/6 |
| Gerd Müller | 1956–1990 | ✓ | ✓ | — | — | ✓ | ✓ | 4/6 |
| Diego Maradona | 1956–1990 | ✓ | ✓ | ✓ | — | ✓ | ✓ | 5/6 |
| Michel Platini | 1956–1990 | — | ✓ | — | — | ✓ | ✓ | 3/6 |
| Zico | 1956–1990 | ✓ | ✓ | ✓ | — | ✓ | ✓ | 5/6 |
| Karl-Heinz Rummenigge | 1956–1990 | ✓ | ✓ | — | — | ✓ | ✓ | 4/6 |
| Franco Baresi (DF) | 1956–1990 | — | — | — | — | — | ✓ | 1/6 |
| Lothar Matthäus | 1956–1990 | ✓ | ✓ | — | — | ✓ | ✓ | 4/6 |
| Marco van Basten | 1956–1990 | — | ✓ | — | — | — | ✓ | 2/6 |
| Roberto Baggio | 1956–1990 | ✓ | ✓ | — | — | — | ✓ | 3/6 |
| Zinedine Zidane | 1991+ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 5/6 |
| Ronaldo | 1991+ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 5/6 |
| Ronaldinho | 1991+ | — | ✓ | ✓ | ✓ | ✓ | ✓ | 5/6 |
| Cafu (DF) | 1991+ | — | — | ✓ | ✓ | ✓ | ✓ | 4/6 |
| Gianluigi Buffon (GK) | 1991+ | ✓ | — | — | ✓ | ✓ | ✓ | 4/6 |
| Paolo Maldini (DF) | 1956–1990 | — | ✓ | — | ✓ | ✓ | ✓ | 4/6 |
| Lionel Messi | 1991+ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 5/6 |
| Cristiano Ronaldo | 1991+ | — | ✓ | — | ✓ | ✓ | ✓ | 4/6 |

**26/26** canonical greats picked up at least one linked stature fact.

