# MV2-3.5 — defender / keeper recognition gap-fill — cohort sample

Internal shape for eyeball review (NOT final display — display is MV2-6). career-stature `career-stature-2.1.0`, rating `wc-perf-4.1.0`. BEFORE = committed base `6e662cc` (merit-v2 HEAD); AFTER = this branch. Channel column is the position-primary channel (DEF for defenders, GK for keepers) of the player's top-rated men's card.

| Player | Pos | Era | Index B→A | Tier B→A | Legend B→A | Overall B→A | Pos-channel B→A | Facts added (real, SHA-pinned) |
|---|---|---|---|---|---|---|---|---|
| Djalma Santos | DF | `pre_1956` | 0.537→0.805 | bronze→silver | —→— | 90→95 | 76→93 | WC All-Star Team WC-1954; WC All-Star Team WC-1958; WC All-Star Team WC-1962 |
| Nílton Santos | DF | `pre_1956` | 0.537→0.684 | bronze→silver | —→— | 90→92 | 76→83 | WC All-Star Team WC-1958 |
| Bobby Moore | DF | `1956_1990` | 0.558→0.663 | bronze→silver | ✓→✓ | 90→92 | 76→83 | WC All-Star Team WC-1966 |
| Giacinto Facchetti | DF | `1956_1990` | 0.521→0.630 | bronze→bronze | —→— | 89→91 | 71→82 | WC All-Star Team WC-1970 |
| Carlos Alberto | DF | `1956_1990` | 0.327→0.492 | —→bronze | —→— | 88→89 | 62→73 | WC All-Star Team WC-1970 |
| Dino Zoff | GK | `1956_1990` | 0.369→0.523 | —→bronze | —→— | 88→89 | 62→72 | WC All-Star Team WC-1982 |
| Gordon Banks | GK | `1956_1990` | 0.275→0.446 | —→bronze | —→— | 88→88 | 62→66 | WC All-Star Team WC-1966 |
| Sepp Maier | GK | `1956_1990` | 0.275→0.446 | —→bronze | —→— | 88→88 | 62→66 | WC All-Star Team WC-1974 |
| Franco Baresi | DF | `1956_1990` | 0.522→0.632 | bronze→silver | ✓→✓ | 89→91 | 75→82 | WC All-Star Team WC-1990 |
| Roberto Carlos | DF | `1991_plus` | 0.640→0.743 | silver→silver | ✓→✓ | 91→94 | 82→89 | WC All-Star Team WC-1998; WC All-Star Team WC-2002 |
| Carles Puyol | DF | `1991_plus` | 0.525→0.599 | bronze→bronze | ✓→✓ | 89→91 | 71→80 | WC All-Star Team WC-2010 |
| Gianluca Zambrotta | DF | `1991_plus` | 0.225→0.345 | —→— | —→— | 88→88 | 62→62 | WC All-Star Team WC-2006 |
| Raphaël Varane | DF | `1991_plus` | 0.225→0.345 | —→— | —→— | 88→88 | 62→62 | WC All-Star Team WC-2018 |
| Fabien Barthez | GK | `1991_plus` | 0.443→0.650 | bronze→silver | —→— | 88→91 | 66→80 | WC All-Star Team WC-1998; world_best_gk 2000 |
| Peter Schmeichel | GK | `1991_plus` | 0.450→0.575 | bronze→bronze | —→✓ | 88→90 | 67→75 | world_best_gk 1992; world_best_gk 1993 |

## Cohort selection — include / exclude (no fabrication)

Cohort = consensus-great defenders/keepers the MV2-9 recon read flags as under-credited by OUR model (the recon-ranks-higher DF/GK rows + the sub-material anchor-gap DF/GK list). A card is **INCLUDED** only when a REAL, citable, position-appropriate recognition fact exists for it; otherwise it is **LEFT where it is** and noted (the anti-fabrication rule). recon's pre-1970-floor artifacts (the forwards recon floors at ≈52 in the *we-rank-higher* direction) are not in this cohort and were not touched.

**Included (15)** — each with ≥1 real SHA-pinned fact (see table above): Djalma Santos, Nílton Santos, Bobby Moore, Giacinto Facchetti, Carlos Alberto, Dino Zoff, Gordon Banks, Sepp Maier, Franco Baresi, Roberto Carlos, Carles Puyol, Gianluca Zambrotta, Raphaël Varane, Fabien Barthez, Peter Schmeichel.

**Excluded / left in place (documented):**
- **Cláudio Taffarel** (GK) — no World Cup All-Star selection; placed 3rd (not a win) for IFFHS World's Best Goalkeeper 1991. No citable position-appropriate *win/selection* → left at index 0.096.
- **Hugo Lloris** (GK) — IFFHS World's Best Goalkeeper *runner-up* (2018), not a win; no World Cup All-Star selection. A runner-up is not a win → left at 0.067.
- **Oscar Ruggeri** (DF) — no World Cup All-Star selection; already carries his real 1991 South American Player of the Year win. No new citable selection → left at 0.140.
- **Jürgen Kohler** (DF) — only an international-caps record; no citable all-star / award selection found → left at 0.047.
- **Franco Armani** (GK) — no citable recognition selection/award → left at 0.052.
- **Javier Zanetti** (DF) — no World Cup All-Star selection; his greatness is club-led, not World-Cup-recognition-captured → left at 0.174.
- **Dani Alves** (DF) — Team-of-the-Tournament only at the Confederations Cup / Copa América, NOT the World Cup; already material (0.50) on 18 club-scope selections → left.
- **Joshua Kimmich** (DF) — no World Cup All-Star selection; already bronze (0.475) → left.
- **Cafu** (DF) — only a 2002 *Reserve* All-Star designation (reserves are excluded by rule); already silver legend (0.656) → left.
- **Pepe** (Portugal, DF) — not uniquely resolvable to a single canonical card; no fact sourced → left.
- **Cannavaro / Casillas / Buffon / Maldini / Beckenbauer** — already material/gold-or-silver legend; NOT under-credited, so correctly OUTSIDE the under-credit cohort — no facts added, ratings unchanged.

## Anti-overfit proof

1. **No card's index rose without a real fact.** The set of players whose `career_stature_index` changed vs base `6e662cc` is **exactly** the set of players given a new SHA-pinned fact — `{15} == {15}`, identical sets. Every other player's index is byte-unchanged (0 non-cohort index changes).
2. **No fabricated material members.** 0 brand-new stature rows — all 15 cohort cards pre-existed; their facts only *added* to existing rows.
3. **No recon-floor artifact was raised.** Every raised card has recon `career_strength_overall` between **86 and 93** (recon ranks them HIGH on its own curated anchors); none is a ≈52 first-percentile floor artifact. The *we-rank-higher* pre-1970 forwards (Zizinho, Sindelar, Matthews, Scarone, Gento …), which recon floors and where our model is the more-right one, were left entirely untouched.
4. **No recon numbers copied.** Facts are award/selection records transcribed from public encyclopedia pages; no recon strength value appears in any note, strength, or output. The `_WC_AWARD_STRENGTH` and `_POSITION_BALANCED_STRENGTH` entries reuse existing in-family anchors (0.45 Bronze-Boot, 0.62 UEFA-positional), not recon values.
