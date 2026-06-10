# RECON_DIVERGENCE — career-stature cross-check vs recon reference

> **REVIEW-ONLY.** This report cross-checks OUR career-stature ranking (`career_stature.json` → `career_stature_index`) against the independent recon career-strength reference staged under `etl/merit/external_review/recon/`. recon is a cross-check reference ONLY: it is **never** a rating source, its numbers are **never** copied per-card into our model, and this script is **not** wired into any rating path. Every divergence below feeds MODEL-level discussion only.

- recon composite column: **`career_strength_overall`** (0-100, award/fact/template-sourced; not a game rating)
- our composite: **`career_stature_index`** (0-1, merit-fact-sourced)
- merit version: `career-stature-2.1.0`

## Join coverage

Joined on **`player_id`** (shared deterministic key — no name/era fuzzy-matching needed).

- our career-stature players: **791**
- matched to recon: **791** (100.00% of ours)
- our players unmatched in recon: **0**
- recon rows with no career-stature row of ours: **7691** (of recon's 8482 total)

Our model only emits a stature row for players carrying merit facts, so the 7691 recon-only rows are players recon scores from position/era templates but for whom we hold no fact — expected, not a drop.

## Overall agreement

- **Spearman ρ (full matched cohort, n=791)**: **0.392**
- **Spearman ρ (material cohort only, n=207)**: **0.3324**
- **Top-20 overlap**: 10/20 (50.0%)
- **Top-50 overlap**: 23/50 (46.0%)

The **material cohort** is our players above the material gate (`stature_tier` ∈ {gold, silver, bronze}) — the ones our model actually differentiates; the rest sit tied near zero in our index (fact-gated: no facts → no spread), while recon assigns every player a position/era template score. The material-cohort ρ is the cleaner like-for-like number. Read both honestly: agreement here is **moderate** — the two models put a similar set of greats near the top (top-N overlap ≈ half) but rank the broad middle differently, and that disagreement is **not uniform** — it concentrates by position and era (see the read below).

## Position-stratified agreement (material cohort)

Spearman ρ within each coarse position, restricted to the material cohort (position = our `modal_position` where present, else recon's classification). Tests whether the MV2-3 position-balance repair holds evenly against recon across FW/MF/DF/GK.

| position | n | Spearman ρ |
| --- | --- | --- |
| FW | 92 | 0.3379 |
| MF | 58 | 0.4634 |
| DF | 42 | 0.2931 |
| GK | 15 | 0.529 |

## Biggest divergences — WE rank higher than recon

Material players where our percentile sits well above recon's. Columns: our index (rank, percentile) · recon strength (rank, percentile) · percentile gap.

| player | nation | pos | tier | ours | recon | Δpct |
| --- | --- | --- | --- | --- | --- | --- |
| Zizinho | Brazil | FW | gold | 0.86 (#20, 97.59p) | 52 (#782, 1.14p) | +96.5 |
| Matthias Sindelar | Austria | FW | gold | 0.84 (#28, 96.65p) | 52 (#782, 1.14p) | +95.5 |
| Stanley Matthews | England | FW | gold | 0.84 (#28, 96.65p) | 52 (#782, 1.14p) | +95.5 |
| Giampiero Boniperti | Italy | FW | silver | 0.78 (#54, 93.29p) | 52 (#782, 1.14p) | +92.2 |
| Denis Law | Scotland | FW | silver | 0.76 (#59, 92.66p) | 54 (#766, 3.16p) | +89.5 |
| Horacio Casarín | Mexico | FW | silver | 0.67 (#91, 88.61p) | 52 (#782, 1.14p) | +87.5 |
| Raúl Cárdenas | Mexico | DF | silver | 0.67 (#91, 88.61p) | 52 (#782, 1.14p) | +87.5 |
| Raymond Braine | Belgium | FW | silver | 0.67 (#91, 88.61p) | 52 (#782, 1.14p) | +87.5 |
| Fritz Szepan | Germany | FW | silver | 0.67 (#91, 88.61p) | 52 (#782, 1.14p) | +87.5 |
| Juan Carreño | Mexico | FW | silver | 0.67 (#91, 88.61p) | 52 (#782, 1.14p) | +87.5 |
| Luis Suárez | Spain | FW | silver | 0.66 (#97, 87.85p) | 54 (#766, 3.16p) | +84.7 |
| Elías Figueroa | Chile | DF | bronze | 0.61 (#109, 86.33p) | 54 (#766, 3.16p) | +83.2 |
| Virgil van Dijk | Netherlands | DF | silver | 0.74 (#68, 91.52p) | 55 (#682, 13.86p) | +77.7 |
| Ahmed Faras | Morocco | FW | bronze | 0.50 (#155, 80.51p) | 54 (#766, 3.16p) | +77.3 |
| Paul Van Himst | Belgium | FW | bronze | 0.50 (#160, 79.87p) | 54 (#766, 3.16p) | +76.7 |
| Francisco Gento | Spain | FW | bronze | 0.46 (#182, 77.03p) | 54 (#766, 3.16p) | +73.9 |
| Héctor Scarone | Uruguay | FW | gold | 0.86 (#19, 97.72p) | 67 (#599, 24.30p) | +73.4 |
| Gunnar Gren | Sweden | FW | bronze | 0.40 (#207, 73.92p) | 52 (#782, 1.14p) | +72.8 |
| Omar Sívori | Italy | FW | bronze | 0.42 (#198, 75.00p) | 54 (#766, 3.16p) | +71.8 |
| József Bozsik | Hungary | DF | gold | 0.83 (#35, 95.70p) | 67 (#599, 24.30p) | +71.4 |

## Biggest divergences — recon ranks higher than US

| player | nation | pos | tier | ours | recon | Δpct |
| --- | --- | --- | --- | --- | --- | --- |
| Gordon Banks | England | GK | bronze | 0.45 (#190, 76.14p) | 91 (#30, 96.27p) | -20.1 |
| Hristo Stoichkov | Bulgaria | FW | bronze | 0.43 (#196, 75.32p) | 89 (#62, 92.28p) | -17.0 |
| Sepp Maier | West Germany | GK | bronze | 0.45 (#190, 76.14p) | 89 (#62, 92.28p) | -16.1 |
| Dino Zoff | Italy | GK | bronze | 0.52 (#148, 81.39p) | 91 (#30, 96.27p) | -14.9 |
| Dani Alves | Brazil | DF | bronze | 0.50 (#157, 80.25p) | 89 (#62, 92.28p) | -12.0 |
| Hugo Sánchez | Mexico | FW | bronze | 0.50 (#156, 80.38p) | 89 (#62, 92.28p) | -11.9 |
| Toni Kroos | Germany | MF | bronze | 0.53 (#146, 81.65p) | 89 (#62, 92.28p) | -10.6 |
| Francesco Totti | Italy | MF | bronze | 0.48 (#168, 78.80p) | 87 (#86, 89.18p) | -10.4 |
| Peter Schmeichel | Denmark | GK | bronze | 0.57 (#122, 84.68p) | 90 (#41, 94.94p) | -10.3 |
| Franco Baresi | Italy | DF | silver | 0.63 (#104, 86.96p) | 92 (#24, 97.03p) | -10.1 |
| N'Golo Kanté | France | MF | bronze | 0.46 (#177, 77.72p) | 86 (#99, 87.59p) | -9.9 |
| Carlos Alberto | Brazil | DF | bronze | 0.49 (#164, 79.37p) | 87 (#86, 89.18p) | -9.8 |
| Ademir | Brazil | FW | bronze | 0.53 (#140, 82.47p) | 89 (#62, 92.28p) | -9.8 |
| Jan Ceulemans | Belgium | MF | bronze | 0.53 (#137, 82.78p) | 89 (#62, 92.28p) | -9.5 |
| Joshua Kimmich | Germany | DF | bronze | 0.47 (#173, 78.23p) | 86 (#99, 87.59p) | -9.4 |
| Luis Suárez | Uruguay | FW | bronze | 0.54 (#134, 83.16p) | 89 (#62, 92.28p) | -9.1 |
| Cafu | Brazil | DF | silver | 0.66 (#98, 87.72p) | 91 (#30, 96.27p) | -8.5 |
| Kevin De Bruyne | Belgium | MF | bronze | 0.55 (#129, 83.80p) | 89 (#62, 92.28p) | -8.5 |
| Bobby Moore | England | DF | silver | 0.66 (#96, 87.97p) | 91 (#30, 96.27p) | -8.3 |
| Nílton Santos | Brazil | DF | silver | 0.68 (#84, 89.49p) | 93 (#20, 97.53p) | -8.0 |

## Model-gap spotlight — recon-anchored players we leave SUB-material

Players recon backed with a **curated career-strength anchor** (award/honors/editorial override) but whom our model never lifted across its material gate — i.e. we hold no merit fact strong enough. These are the cleanest **"source a real fact" (candidate MV2-3.x)** leads: the fix is always to find the real, citable fact for our MODEL, **never** to copy recon's number. Ranked by recon strength.

| player | nation | pos | recon strength | recon basis | our index |
| --- | --- | --- | --- | --- | --- |
| Rudi Völler | West Germany | FW | 90 | career_strength_override | 0.07 |
| Cláudio Taffarel | Brazil | GK | 90 | career_strength_override | 0.10 |
| Rivellino | Brazil | MF | 90 | career_strength_override | 0.28 |
| Mário Coluna | Portugal | MF | 89 | career_strength_override | 0.36 |
| Dennis Bergkamp | Netherlands | FW | 89 | career_strength_override | 0.24 |
| Sergio Busquets | Spain | MF | 89 | career_strength_override | 0.07 |
| Gianluca Zambrotta | Italy | DF | 89 | career_strength_override | 0.34 |
| Didier Deschamps | France | MF | 89 | career_strength_override | 0.21 |
| Xabi Alonso | Spain | MF | 89 | career_strength_override | 0.05 |
| Oscar Ruggeri | Argentina | DF | 89 | career_strength_override | 0.14 |
| Jürgen Kohler | Germany | DF | 89 | career_strength_override | 0.05 |
| Patrick Vieira | France | MF | 89 | career_strength_override | 0.36 |
| Sergio Agüero | Argentina | FW | 87 | manual_legend_anchor | 0.09 |
| Jairzinho | Brazil | FW | 87 | manual_legend_anchor | 0.31 |
| Hugo Lloris | France | GK | 86 | manual_legend_anchor | 0.07 |
| Franco Armani | Argentina | GK | 86 | career_strength_override | 0.05 |
| Raphaël Varane | France | DF | 86 | manual_legend_anchor | 0.23 |
| Javier Zanetti | Argentina | DF | 86 | manual_legend_anchor | 0.17 |
| Michael Laudrup | Denmark | MF | 86 | manual_legend_anchor | 0.35 |
| Sócrates | Brazil | MF | 86 | manual_legend_anchor | 0.40 |
| Pepe | Portugal | DF | 86 | manual_legend_anchor | 0.07 |
| Juan Román Riquelme | Argentina | MF | 86 | manual_legend_anchor | 0.18 |
| Vinícius Júnior | Brazil | MF | 86 | manual_legend_anchor | 0.20 |
| Mario Mandžukić | Croatia | FW | 85 | career_strength_override | 0.05 |
| Bernardo Silva | Portugal | MF | 85 | manual_legend_anchor | 0.24 |

## Plain-language read

**Headline — moderate agreement, concentrated disagreement.** Two independently-built, differently-sourced career-strength models agree *moderately*: Spearman ρ=0.392 across all 791 matched players and ρ=0.3324 within the material cohort we differentiate, with 10/20 and 23/50 of the top names shared. About half the elite overlaps — real corroboration that both float a similar set of greats to the top, but well short of a lockstep ranking. The material ρ sitting at or below the full ρ tells us the disagreement lives *inside* the cohort we differentiate, not just in the tied tail — so it is worth dissecting, which the next points do. The disagreement is not uniform; it sorts cleanly by era and by position.

**'We rank higher' = recon under-rating history (methodology, not our gap).** The we-higher table is 16/20 forwards, and 17/20 of them are floored by recon near its **1st percentile** (recon strength ≈ 52) — pre-modern recognition-greats like Zizinho, Sindelar, Matthews, Scarone and Gento. recon's composite leans on a World-Cup-match merit score plus curated anchors, and where it never anchored a pre-1970 great it drops to a low template; our recognition archives (POY placements, all-time selections) correctly elevate them. So this whole direction is mostly recon under-crediting history, **not** us over-crediting it — it corroborates our historic coverage. The one guardrail: where a single thin fact drives a high index, confirm the fact is real (it is sourced, by construction) and not over-weighted.

**'recon ranks higher' + the DF lag = the real candidate MODEL gap.** Position-stratified agreement is uneven: best is GK (ρ=0.529, n=15), worst is **DF** (ρ=0.2931, n=42). And the we-lower table is 11/20 **defenders and goalkeepers** — Gordon Banks, Sepp Maier, Dino Zoff, Dani Alves, Peter Schmeichel, Franco Baresi, Carlos Alberto, Joshua Kimmich, Cafu, Bobby Moore, Nílton Santos. This is the report's strongest model-gap signal: our recognition-weighted families structurally under-credit elite defenders and keepers, who win far fewer individual awards (Ballon d'Or, player-of-the-year) than forwards, so a recognition-archive index under-rates them even after the MV2-3 position-balance repair. The repair narrowed the gap; the DF ρ and this table say it has not closed it — a defender-honors family (caps records, all-time-XI selections, defensive awards) is the natural MV2-3.x lift.

**Sub-material anchors sharpen the same lead — and the hard guardrail.** The recon-anchored-but-sub-material list is 9/25 keepers and defenders (Cláudio Taffarel, Gianluca Zambrotta, Oscar Ruggeri, Jürgen Kohler, Hugo Lloris, Franco Armani, Raphaël Varane, Javier Zanetti, Pepe): players recon curated from real awards/honors but for whom our merit set holds no fact strong enough to clear the gate. Each is a lead to **source a real, citable fact** into our MODEL — never to copy recon's number, blend it, or back-fit our gate to it. Net read: the cross-check validates our top and our historic coverage, attributes the bulk divergence to a defensible fact-gated-vs-template methodology split (7691 recon-only + 584 sub-material players diverge by construction), and points one clear, actionable direction for the MODEL — close the defender/keeper recognition deficit with real facts.
