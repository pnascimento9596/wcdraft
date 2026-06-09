# Career-stature source coverage (merit-source-set v2)

> Career-stature records sourced from public archives — the Rec.Sport.Soccer Statistics Foundation (RSSSF, https://www.rsssf.org/), Wikipedia (https://en.wikipedia.org/, CC BY-SA), and the IFFHS (https://www.iffhs.com/) — used with acknowledgement. Each record is transcribed from a SHA-pinned snapshot and linked to a canonical player_id only when the match is unique and high-confidence; ambiguous names are withheld for human review and never assigned.

- **Source-set version:** `merit-source-set-2.0.0`
- **Scope:** coverage only — **no rating output, engine, or compact data is changed by this build.** The v2 source families are staged in `source_facts.json` for the career-stature-2.0.0 table (MV2-3).
- **Linked facts:** 2,169 across 791 distinct players (men's World Cup pool) — **2,003 parser-derived** + **141 native** World Cup awards + **25 research-backstop** (citation-backed, MV2-2).
- **First-class position facts:** 430 (GK/DF/MF/FW) from the position-balanced + all-time + research sources.
- **Withheld to review (never assigned):** 751 distinct ambiguities.


## Linked players by signal family × player era

| Signal family | pre-1956 | 1956–1990 | 1991+ | Total |
|---|---|---|---|---|
| WC legacy | 21 | 47 | 41 | 109 |
| Global annual | 2 | 48 | 34 | 84 |
| Regional annual | 0 | 39 | 81 | 120 |
| Position XI | 0 | 8 | 195 | 203 |
| Int'l record | 21 | 75 | 358 | 454 |
| Retrospective | 29 | 107 | 70 | 206 |
| Captaincy | 0 | 9 | 13 | 22 |
| annual_recognition | — | — | — | _reserved / legacy (no v2 source)_ |
| club_honors | — | — | — | _reserved / legacy (no v2 source)_ |

## Linked facts per source

| Source | Family | Origin | Linked facts |
|---|---|---|---|
| African Player of the Year — annual winners | regional_annual_recognition | parser | 36 |
| Asian Player of the Year — annual winners | regional_annual_recognition | parser | 22 |
| Ballon d'Or Dream Team (2020) — all-time 1st/2nd/3rd position XIs | retrospective_selection | parser | 24 |
| CONCACAF Player of the Year — annual winners | regional_annual_recognition | parser | 9 |
| ESM Team of the Season — annual position XI | position_balanced_selection | parser | 311 |
| European Player of the Year (Ballon d'Or) — annual winners | global_annual_recognition | parser | 56 |
| FIFPro World 11 — annual player-voted position XI | position_balanced_selection | parser | 133 |
| IFFHS Century elections — world/continental player-of-the-century polls | retrospective_selection | parser | 181 |
| IFFHS All-Time World / continental / national dream teams | retrospective_selection | parser | 20 |
| IFFHS World's Best Player — annual winners | global_annual_recognition | parser | 8 |
| Players with 100+ international caps / 30+ international goals | international_record | parser | 543 |
| 2004 living-legends list — 125 greatest living players selection | retrospective_selection | parser | 114 |
| Onze d'Or / d'Argent / de Bronze — annual top-three | global_annual_recognition | parser | 104 |
| National-team captaincy records (research backstop, citation-backed) | captaincy | research | 22 |
| Global annual recognition recovered under canonical names (research backstop) | global_annual_recognition | research | 3 |
| South American Player of the Year (Rey de América) — annual winners | regional_annual_recognition | parser | 52 |
| South American Player of the Year — annual top-3 placements (2nd/3rd) | regional_annual_recognition | parser | 57 |
| UEFA Club positional awards — Best Goalkeeper/Defender/Midfielder/Forward | position_balanced_selection | parser | 70 |
| UEFA Men's Player of the Year — annual top-three | global_annual_recognition | parser | 11 |
| UEFA Team of the Year — annual position-normalised XI | position_balanced_selection | parser | 209 |
| wc_individual_awards_native | wc_legacy | native | 141 |
| World Soccer Player of the Year — annual winners | global_annual_recognition | parser | 43 |

## Research backstop (MV2-2) — citation-backed gap closure

The deterministic research backstop adds **25 citation-backed** facts that parser-only public lists miss: each row carries a fetchable public citation URL and the specific claim it supports (an uncited row fails the build), and is linked by the SAME conservative linker as parser rows. It activates the `captaincy` family (no SHA-pinnable web source) and recovers global recognition the parser list holds under a non-canonical spelling.

| Family | Research facts | Distinct players |
|---|---:|---:|
| Captaincy | 22 | 22 |
| Global annual | 3 | 1 |

### Known v1 gaps — explicitly evaluated

| Player | Research facts | Families now linked |
|---|---:|---|
| Johan Cruyff | 3 | Global annual, Retrospective |
| Franco Baresi (DF) | 1 | Retrospective, Captaincy |
| Paolo Maldini (DF) | 0 | Global annual, Position XI, Int'l record, Retrospective |
| Lev Yashin (GK) | 0 | Global annual, Retrospective |
| Cafu (DF) | 1 | Regional annual, Position XI, Int'l record, Retrospective, Captaincy |
| Carlos Alberto (DF) | 1 | Retrospective, Captaincy |
| Giacinto Facchetti (DF) | 1 | Retrospective, Captaincy |
| Daniel Passarella (DF) | 1 | Retrospective, Captaincy |

_23 distinct players carry a research-backstop fact. Yashin's national-team captaincy was evaluated and WITHHELD — the cited source states he rarely captained his side — so no captaincy row was authored for him (anti-fabrication: a claim a citation does not support is never committed)._


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
| Franco Baresi | 1956–1990 | 7 | DF | Retrospective, Captaincy |
| Paolo Maldini | 1956–1990 | 14 | DF | Global annual, Position XI, Int'l record, Retrospective |
| Lev Yashin | 1956–1990 | 3 | GK | Global annual, Retrospective |
| Gianluigi Buffon | 1991+ | 17 | GK | WC legacy, Position XI, Int'l record, Retrospective |
| Cafu | 1991+ | 8 | DF | Regional annual, Position XI, Int'l record, Retrospective, Captaincy |
| Franz Beckenbauer | 1956–1990 | 12 | DF | WC legacy, Global annual, Int'l record, Retrospective, Captaincy |

_Position is read from each source's own structure (a positional section or a formation column), never inferred from a player's identity. A mononym with no corroborating nation/year (e.g. an all-time-XI 'Cafu') is withheld by the conservative linker, so a great may carry facts without a positioned row — honest under-coverage, never a guess._


## Canonical-greats checklist (the de-risk signal)

Each legend should visibly pick up stature across families. ✓ = at least one linked fact in that family.

| Great | Era | WC legacy | Global annual | Regional annual | Position XI | Int'l record | Retrospective | Captaincy | Families |
|---|---|---|---|---|---|---|---|---|---|
| Pelé | 1956–1990 | ✓ | — | ✓ | — | ✓ | ✓ | — | 4/7 |
| Alfredo Di Stéfano | 1956–1990 | — | ✓ | — | — | — | ✓ | — | 2/7 |
| Garrincha | 1956–1990 | ✓ | — | — | — | — | ✓ | — | 2/7 |
| Ferenc Puskás | pre-1956 | — | — | — | — | ✓ | ✓ | — | 2/7 |
| Lev Yashin (GK) | 1956–1990 | — | ✓ | — | — | — | ✓ | — | 2/7 |
| Bobby Charlton | 1956–1990 | — | ✓ | — | — | ✓ | ✓ | — | 3/7 |
| Eusébio | 1956–1990 | ✓ | ✓ | — | — | ✓ | ✓ | — | 4/7 |
| Franz Beckenbauer | 1956–1990 | ✓ | ✓ | — | — | ✓ | ✓ | ✓ | 5/7 |
| Johan Cruyff | 1956–1990 | — | ✓ | — | — | — | ✓ | — | 2/7 |
| Gerd Müller | 1956–1990 | ✓ | ✓ | — | — | ✓ | ✓ | — | 4/7 |
| Diego Maradona | 1956–1990 | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 6/7 |
| Michel Platini | 1956–1990 | — | ✓ | — | — | ✓ | ✓ | — | 3/7 |
| Zico | 1956–1990 | ✓ | ✓ | ✓ | — | ✓ | ✓ | — | 5/7 |
| Karl-Heinz Rummenigge | 1956–1990 | ✓ | ✓ | — | — | ✓ | ✓ | — | 4/7 |
| Franco Baresi (DF) | 1956–1990 | — | — | — | — | — | ✓ | ✓ | 2/7 |
| Lothar Matthäus | 1956–1990 | ✓ | ✓ | — | — | ✓ | ✓ | ✓ | 5/7 |
| Marco van Basten | 1956–1990 | — | ✓ | — | — | — | ✓ | — | 2/7 |
| Roberto Baggio | 1956–1990 | ✓ | ✓ | — | — | — | ✓ | — | 3/7 |
| Zinedine Zidane | 1991+ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | 5/7 |
| Ronaldo | 1991+ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | 5/7 |
| Ronaldinho | 1991+ | — | ✓ | ✓ | ✓ | ✓ | ✓ | — | 5/7 |
| Cafu (DF) | 1991+ | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | 5/7 |
| Gianluigi Buffon (GK) | 1991+ | ✓ | — | — | ✓ | ✓ | ✓ | — | 4/7 |
| Paolo Maldini (DF) | 1956–1990 | — | ✓ | — | ✓ | ✓ | ✓ | — | 4/7 |
| Lionel Messi | 1991+ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | 5/7 |
| Cristiano Ronaldo | 1991+ | — | ✓ | — | ✓ | ✓ | ✓ | — | 4/7 |

**26/26** canonical greats picked up at least one linked stature fact.

