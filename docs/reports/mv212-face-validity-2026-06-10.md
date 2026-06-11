# MV2-12 Audit-2 — Face-Validity Sweep (REPORT-ONLY)

- **Date:** 2026-06-10 · **Branch:** `ws-etl/mv212-face-validity-audit` off main `b4f8651`
- **Scope:** report + queue link + STATE.md only. ZERO changes to engine, data bundles,
  ratings, or app code. Flags below are **advisory candidates for owner review** — per
  project rule, individual ratings only ever change via model changes (MV2-12b) with
  full provenance; this audit recommends no hand-edits.
- **Method:** every number was computed by executing the production rating code
  (`rating.build_internal_view`, `rating_2026._build_internal_rows`,
  `display_curve.fit_unified_curve`) against the committed canonical tables in
  `etl/output/`. **Determinism proof (re-executed this audit):** rebuilt internals +
  rebuilt unified curve reproduce the committed `overall` for **12,219 / 12,219 cards
  (0 mismatches)**. Curve anchors 20.0 / 43.2551552 / 62.0 / 100.0 (identical to
  Audit-1). World knowledge is used ONLY to judge plausibility; every flag prints the
  card's in-repo merit inputs so the owner judges flag-vs-model on evidence. No
  external rating system consulted (IP firewall respected).
- **Versions:** historical `wc-perf-4.2.1` · projected `proj-career-3.0.0` · curve
  `unified_pooled_piecewise_power_v1` · stature source set `career-stature-2.1.0`
  (791 players).
- **Prerequisite:** `mv212-ratings-audit-2026-06-10.md` (Audit-1). Its mechanisms
  (raw-path 0.62 ceiling, frozen stature archive, youth double penalty, 88 pile-up)
  are taken as established and NOT re-derived here.

## TL;DR

1. **NEW DEFECT (P0, live today, independent of MV2-12b): 17 identity-seam link
   misses among "minted" 2026 cards** — including **Neymar (2026 OVR 88; his three
   historical cards are 93, archive index 0.682, legend)** and **Rodri (2026 OVR 88;
   the reigning Ballon d'Or holder, archive index 0.527, legend)**. The 2026 link
   seam fails on mononyms/nicknames (Brazilian mononyms: Casemiro, Alisson, Ederson,
   Marquinhos, Fabinho, Raphinha, Weverton, Bremer, Danilo; Spanish nicknames: Rodri,
   Pedri, Gavi) and on the **474 historical players whose `given_name` is the literal
   placeholder `"not applicable"`** (which pollutes `full_name`, e.g.
   `"not applicable Rodri"`). Verified by exact birth-date + surname join; the
   Timber twins and 4 same-name different-person collisions were checked and are NOT
   misses (§H.3). This is a data-identity defect, not a rating-model defect — it
   deserves its own small fix unit ahead of/alongside 12b.
2. **NEW MECHANISM for 12b design (within-archive, not cross-era): the career-stature
   index itself is era/eligibility biased.** Pelé's index is **0.807 — rank 45 of the
   archive, silver tier**, below Hanappi (0.809), Ocwirk (0.809), Bozsik (0.829) and
   Owen (0.789); Cruyff is **0.755 (rank 60)**, Garrincha 0.723, while **Kocsis 0.992
   is the #1 index of all time**. The fact-family columns show the driver: Pelé has NO
   `global_annual_recognition` score (the Ballon d'Or was Europeans-only until 1995),
   and sparse 2–3-fact retrospective-only entries (Boniperti, Scarone, Ocwirk,
   Hanappi) reach 0.78–0.86. Audit-1's mechanisms do not explain this; it changes
   what 12b's index re-normalization must handle (§C, §H.4).
3. **Ceiling census (T4):** of the 1,469 cards displaying exactly 88, the strongest
   uncapped inputs are **World-Cup-winning award performances the measured path
   cannot express** — Schumacher-1986 (Silver Ball GK, raw 100), **E. "Dibu"
   Martínez-2022 (Golden Glove, champion, raw 100)**, Vavá-1962 (Golden Boot,
   champion, raw 100) — plus the 2026 elite (Haaland 94.6, Valverde 95.7, Rodri 90.1,
   B. Fernandes 98.9). These are 12b's expected-movers (§E).
4. **T6 Valverde counterfactual confirms the owner's instinct numerically:** giving
   Valverde-2022 a career-stature row at index **0.42 displays 84** (0.398 → 81,
   0.46 → 88) on the production curve. 0.42 sits exactly in the in-archive peer band
   for "national-team captain + major club honors, no global award podium" (Godín
   0.398 · C. Alberto 0.492 · Zoff 0.523 · Passarella 0.529). **D2 fixes him
   organically; he is a named acceptance probe** (§G).
5. **Archive holes for unsung-role greats** extend MV2-9's DF/GK under-credit to
   holding midfielders and captains-without-podiums: Busquets **0.066**, Xabi Alonso
   **0.052**, Lloris **0.067**, Deschamps 0.209, Klose **0.395** (one fact short of
   the 0.40 material gate → his WC-record card displays 88) (§F).
6. **Advisory (design choices the owner should consciously ratify, not bugs):**
   (a) stature down-cap insensitivity — legends' no-show tournaments still display
   89–98 (Rossi-1986: 94 with 0 apps; Zidane-2002: 95 with 1 app; Messi-2010: 98 with
   0 goals); (b) champion-squad reserve compression — 0-app reserves on champion
   squads display 87–88 via the team-finish anchor (Brazil-1970 3rd GK 87,
   Argentina-2022 backup GKs 88) (§D, §F).

---

## A. Method notes (what each table measures)

- **Era buckets:** ≤1958 · 1962–70 · 1974–82 · 1986–94 · 1998–2006 · 2010–2018 ·
  2022–2026 (the last bucket contains both WC-2022 historical and WC-2026 projected
  cards; percentile cohorts split them by era so the two raw scales never mix).
- **`raw(uncap)`** = the card's own uncapped merit-input composite on the internal
  scale ×100 (historical: `raw_tournament_score`; 2026: `projected_raw_score` — NOTE
  the 2026 value is pre-quantile-map and not directly comparable to historical raw).
- **`internal`** = the production pre-display score (post ceiling/blend).
- **basis:** `measured` = raw tournament path drove the score · `stature` =
  career-stature path dominated (weight ≥ 0.5) · `baseline` = no individual signal.
- **T3 divergence** = `input-implied OVR` (the display the card's own uncapped input
  composite would earn on the production curve; 2026 inputs quantile-mapped first)
  minus actual OVR. The dispatch's percentile formulation is shown as columns; the
  ranking uses the display-unit delta because within-cohort midrank percentiles
  degenerate on the huge tie groups (hundreds of 0-app reserves share identical
  inputs) and surface tie-grain noise instead of misratings.

---

## B. T1 — Top-of-pool review

### Annotations (facially implausible / notable, with the in-repo evidence)

- **Kocsis (1954) is the #1 card AND the #1 stature index of all time (0.992)** —
  above Maradona 0.952, Messi 0.938, Pelé 0.807. Kocsis's tournament inputs are
  monstrous (11 goals, Golden Boot) so a 99 *card* is defensible; the *index ordering*
  is not — it ranks him the greatest career in football history. Flagged as the
  sharpest symptom of the archive-normalization defect (§C, §H.4).
- **Piola 99 / Albert 99 / Scarone 98 / Zizinho 98 / Schiaffino 98 vs Pelé's best 97**:
  five pre-1966 entries outrank the consensus GOAT's best card. Each carries 2–6
  facts, mostly `retrospective_selection` + `international_record`. Facially inverted
  at the top; same root cause as above.
- **Owen (England) best 96 > Cruyff best 95.** Owen idx 0.789 > Cruyff 0.755.
  Facially indefensible ordering — Cruyff is consensus top-5 all-time; Owen is not in
  most top-100s. Cruyff has only 5 facts in the archive (his 3 Ballons d'Or compress
  into one family score).
- **Keegan (England 1982) 92** with 1 app / 0 goals at his only WC; idx 0.781 (2×
  Ballon d'Or). High but explainable by design (stature-dominant); listed for owner
  judgment alongside the down-cap advisory (§H.5).
- **Rivera (Italy 1962) 91** (1 app, age 18) and **Matthews (England 1950) 93 /
  (1954) 94** (1–2 apps, 0 goals) — same down-cap class.
- **GK band tops at 93 (Buffon).** No GK above 93 while 10 FW/MF sit at 99. Era-
  appropriate GK greats (Yashin 92, Kahn 92, Neuer 92, Casillas 92) cluster tightly;
  consistent with MV2-9's recognition-award bias against GK/DF. Owner call whether a
  GK ceiling of 93 is acceptable face validity.
- **2022–2026 bucket:** top-25 contains no Rodri (88, link-missed — §H.3), no
  Vinícius Júnior (87, archive idx **0.200** under the frozen archive — 2× CL winner,
  2024 Ballon d'Or runner-up; named 12b mover), no Haaland (88, minted, ceiling).
  The bucket's stature entries (Messi/Modrić/Mbappé/Salah/van Dijk/De Bruyne/Kane)
  are facially fine.
- **≤1958 top-25**: 10 of 25 are Hungary-1954/Austria-1954/Uruguay-1930 entries from
  2–3-fact archive rows (Bozsik 97, Ocwirk 97, Andrade 97, Hanappi 96, Cea 97,
  Boniperti 94). The era's density of 96–99s exceeds any modern era's — consistent
  with sparse-fact index inflation, not with a plausible all-time ranking.

## T1-a Top 50 overall (pooled, both eras)
| # | card | pos | OVR | basis | internal | raw(uncap) | merit inputs |
|---|---|---|---|---|---|---|---|
| 1 | Kocsis (Hungary 1954) ★ | FW | 99 | stature | 100.0 | 97.2 | apps 5 (p0.94), goals 11 (p1.00), award 0.90, finish 0.75 [Golden Boot] · stature idx 0.992/w 1.00 |
| 2 | Puskás (Hungary 1954) ★ | FW | 99 | stature | 100.0 | 74.9 | apps 3 (p0.71), goals 4 (p0.95), award 0.00, finish 0.75 · stature idx 0.886/w 1.00 |
| 3 | Messi (Argentina 2006) ★ | FW | 99 | stature | 100.0 | 55.0 | apps 3 (p0.60), goals 1 (p0.77), award 0.00, finish — · stature idx 0.938/w 1.00 |
| 4 | Messi (Argentina 2014) ★ | FW | 99 | stature | 100.0 | 99.2 | apps 7 (p0.99), goals 4 (p0.98), award 1.00, finish 0.75 [Golden Ball] · stature idx 0.938/w 1.00 |
| 5 | Messi (Argentina 2018) ★ | FW | 99 | stature | 100.0 | 58.3 | apps 4 (p0.81), goals 1 (p0.79), award 0.00, finish — · stature idx 0.938/w 1.00 |
| 6 | Messi (Argentina 2022) ★ | FW | 99 | stature | 100.0 | 100.0 | apps 7 (p0.98), goals 7 (p0.99), award 1.00, finish 1.00 [Golden Ball,Silver Boot] · stature idx 0.938/w 1.00 |
| 7 | Messi (Argentina 2026) ★ | FW | 99 | stature | 100.0 | 76.2 | caps 198 (p1.00), goals 116 (p1.00), age 38 (af 0.80), lg 0.58 · stature idx 0.938/w 1.00 |
| 8 | Modrić (Croatia 2018) ★ | MF | 99 | stature | 100.0 | 100.0 | apps 7 (p0.99), goals 2 (p0.99), award 1.00, finish 0.75 [Golden Ball] · stature idx 0.898/w 1.00 |
| 9 | Modrić (Croatia 2022) ★ | MF | 99 | stature | 100.0 | 76.5 | apps 7 (p0.98), goals 0 (p0.44), award 0.50, finish 0.55 [Bronze Ball] · stature idx 0.898/w 1.00 |
| 10 | Modrić (Croatia 2026) ★ | MF | 99 | stature | 100.0 | 88.8 | caps 197 (p1.00), goals 28 (p0.99), age 40 (af 0.80), lg 0.90 · stature idx 0.898/w 1.00 |
| 11 | Matthäus (West Germany 1986) ★ | MF | 99 | stature | 100.0 | 77.2 | apps 7 (p0.98), goals 1 (p0.88), award 0.00, finish 0.75 · stature idx 0.891/w 1.00 |
| 12 | Matthäus (West Germany 1990) ★ | MF | 99 | stature | 100.0 | 98.8 | apps 7 (p0.98), goals 4 (p0.99), award 0.70, finish 1.00 [Silver Ball] · stature idx 0.891/w 1.00 |
| 13 | Matthäus (Germany 1994) ★ | MF | 99 | stature | 100.0 | 63.0 | apps 5 (p0.89), goals 1 (p0.90), award 0.00, finish — · stature idx 0.891/w 1.00 |
| 14 | Zidane (France 1998) ★ | MF | 99 | stature | 100.0 | 80.6 | apps 5 (p0.90), goals 2 (p0.97), award 0.00, finish 1.00 · stature idx 0.928/w 1.00 |
| 15 | Zidane (France 2006) ★ | MF | 99 | stature | 100.0 | 100.0 | apps 6 (p0.95), goals 3 (p1.00), award 1.00, finish 0.75 [Golden Ball] · stature idx 0.928/w 1.00 |
| 16 | Rummenigge (West Germany 1978) ★ | FW | 99 | stature | 100.0 | 63.2 | apps 5 (p0.80), goals 3 (p0.93), award 0.00, finish — · stature idx 0.889/w 1.00 |
| 17 | Rummenigge (West Germany 1982) ★ | FW | 99 | stature | 100.0 | 95.4 | apps 7 (p0.98), goals 5 (p0.99), award 0.80, finish 0.75 [Bronze Ball,Silver Boot] · stature idx 0.889/w 1.00 |
| 18 | Rummenigge (West Germany 1986) ★ | FW | 99 | stature | 100.0 | 71.8 | apps 7 (p0.98), goals 1 (p0.78), award 0.00, finish 0.75 · stature idx 0.889/w 1.00 |
| 19 | Ronaldo (Brazil 1998) ★ | FW | 99 | stature | 100.0 | 98.7 | apps 7 (p0.98), goals 4 (p0.97), award 1.00, finish 0.75 [Golden Ball] · stature idx 0.913/w 1.00 |
| 20 | Ronaldo (Brazil 2002) ★ | FW | 99 | stature | 100.0 | 100.0 | apps 7 (p0.98), goals 8 (p1.00), award 0.97, finish 1.00 [Golden Boot,Silver Ball] · stature idx 0.913/w 1.00 |
| 21 | Ronaldo (Brazil 2006) ★ | FW | 99 | stature | 100.0 | 75.2 | apps 5 (p0.92), goals 3 (p0.97), award 0.45, finish — [Bronze Boot] · stature idx 0.913/w 1.00 |
| 22 | Piola (Italy 1938) | FW | 99 | stature | 100.0 | 94.9 | apps 4 (p0.96), goals 5 (p0.98), award 0.60, finish 1.00 [Silver Boot] · stature idx 0.911/w 1.00 |
| 23 | Müller (West Germany 1970) ★ | FW | 99 | stature | 100.0 | 94.0 | apps 6 (p0.95), goals 10 (p0.99), award 0.90, finish 0.55 [Golden Boot] · stature idx 0.887/w 1.00 |
| 24 | Müller (West Germany 1974) ★ | FW | 99 | stature | 100.0 | 82.1 | apps 7 (p0.96), goals 4 (p0.96), award 0.00, finish 1.00 · stature idx 0.887/w 1.00 |
| 25 | Beckenbauer (West Germany 1966) ★ | MF | 99 | stature | 100.0 | 94.8 | apps 6 (p0.94), goals 4 (p1.00), award 0.75, finish 0.75 [Best Young Player,Bronze Boot] · stature idx 0.889/w 1.00 |
| 26 | Beckenbauer (West Germany 1970) ★ | MF | 99 | stature | 100.0 | 71.1 | apps 5 (p0.89), goals 1 (p0.87), award 0.00, finish 0.55 · stature idx 0.889/w 1.00 |
| 27 | Maradona (Argentina 1982) ★ | MF | 99 | stature | 100.0 | 63.3 | apps 5 (p0.87), goals 2 (p0.95), award 0.00, finish — · stature idx 0.952/w 1.00 |
| 28 | Maradona (Argentina 1986) ★ | MF | 99 | stature | 100.0 | 100.0 | apps 7 (p0.98), goals 5 (p1.00), award 1.00, finish 1.00 [Golden Ball,Silver Boot] · stature idx 0.952/w 1.00 |
| 29 | Maradona (Argentina 1990) ★ | MF | 99 | stature | 100.0 | 79.1 | apps 7 (p0.98), goals 0 (p0.41), award 0.50, finish 0.75 [Bronze Ball] · stature idx 0.952/w 1.00 |
| 30 | Eusébio (Portugal 1966) ★ | FW | 99 | stature | 100.0 | 94.1 | apps 6 (p0.96), goals 9 (p0.99), award 0.90, finish 0.55 [Golden Boot] · stature idx 0.879/w 1.00 |
| 31 | Rossi (Italy 1978) ★ | FW | 99 | stature | 99.9 | 85.6 | apps 7 (p0.97), goals 3 (p0.93), award 0.70, finish 0.40 [Silver Ball] · stature idx 0.879/w 1.00 |
| 32 | Rossi (Italy 1982) ★ | FW | 99 | stature | 99.9 | 100.0 | apps 7 (p0.98), goals 6 (p1.00), award 1.00, finish 1.00 [Golden Ball,Golden Boot] · stature idx 0.879/w 1.00 |
| 33 | Ronaldo (Portugal 2006) ★ | FW | 99 | stature | 99.9 | 65.5 | apps 6 (p0.95), goals 1 (p0.77), award 0.00, finish 0.40 · stature idx 0.878/w 1.00 |
| 34 | Ronaldo (Portugal 2018) ★ | FW | 99 | stature | 99.9 | 65.0 | apps 4 (p0.81), goals 4 (p0.98), award 0.00, finish — · stature idx 0.878/w 1.00 |
| 35 | Ronaldo (Portugal 2022) ★ | FW | 99 | stature | 99.8 | 57.8 | apps 5 (p0.89), goals 1 (p0.75), award 0.00, finish — · stature idx 0.878/w 1.00 |
| 36 | Albert (Hungary 1962) | FW | 99 | stature | 99.5 | 82.2 | apps 3 (p0.67), goals 4 (p0.98), award 0.95, finish — [Best Young Player,Golden Boot] · stature idx 0.872/w 1.00 |
| 37 | Ronaldo (Portugal 2010) ★ | FW | 99 | stature | 99.4 | 58.7 | apps 4 (p0.81), goals 1 (p0.81), award 0.00, finish — · stature idx 0.878/w 1.00 |
| 38 | Ronaldinho (Brazil 2002) ★ | MF | 99 | stature | 99.4 | 81.3 | apps 5 (p0.92), goals 2 (p0.98), award 0.00, finish 1.00 · stature idx 0.870/w 1.00 |
| 39 | Meazza (Italy 1934) ★ | MF | 98 | stature | 99.0 | 83.2 | apps 5 (p0.98), goals 2 (p0.99), award 0.00, finish 1.00 · stature idx 0.865/w 1.00 |
| 40 | Meazza (Italy 1938) ★ | MF | 98 | stature | 99.0 | 81.8 | apps 4 (p0.94), goals 1 (p0.98), award 0.00, finish 1.00 · stature idx 0.865/w 1.00 |
| 41 | Scarone (Uruguay 1930) ★ | FW | 98 | stature | 98.9 | 73.2 | apps 3 (p0.78), goals 1 (p0.77), award 0.00, finish 1.00 · stature idx 0.864/w 1.00 |
| 42 | Zizinho (Brazil 1950) ★ | FW | 98 | stature | 98.9 | 73.8 | apps 4 (p0.84), goals 2 (p0.88), award 0.00, finish 0.75 · stature idx 0.863/w 1.00 |
| 43 | Romário (Brazil 1994) ★ | FW | 98 | stature | 98.8 | 100.0 | apps 7 (p0.96), goals 5 (p0.96), award 1.00, finish 1.00 [Bronze Boot,Golden Ball] · stature idx 0.862/w 1.00 |
| 44 | Zico (Brazil 1978) ★ | MF | 98 | stature | 98.6 | 70.2 | apps 6 (p0.86), goals 1 (p0.86), award 0.00, finish 0.55 · stature idx 0.859/w 1.00 |
| 45 | Zico (Brazil 1982) ★ | MF | 98 | stature | 98.6 | 74.1 | apps 5 (p0.87), goals 4 (p1.00), award 0.45, finish — [Bronze Boot] · stature idx 0.859/w 1.00 |
| 46 | Mbappé (France 2018) ★ | FW | 98 | stature | 98.5 | 94.1 | apps 7 (p0.98), goals 4 (p0.98), award 0.55, finish 1.00 [Best Young Player] · stature idx 0.858/w 1.00 |
| 47 | Mbappé (France 2022) ★ | FW | 98 | stature | 98.5 | 99.0 | apps 7 (p0.98), goals 8 (p1.00), award 0.97, finish 0.75 [Golden Boot,Silver Ball] · stature idx 0.858/w 1.00 |
| 48 | Mbappé (France 2026) ★ | FW | 98 | stature | 98.5 | 97.1 | caps 96 (p0.92), goals 56 (p0.97), age 27 (af 1.00), lg 1.00 · stature idx 0.858/w 1.00 |
| 49 | Henry (France 1998) ★ | FW | 98 | stature | 98.5 | 81.4 | apps 6 (p0.96), goals 3 (p0.94), award 0.00, finish 1.00 · stature idx 0.857/w 1.00 |
| 50 | Henry (France 2006) ★ | FW | 98 | stature | 98.5 | 78.8 | apps 7 (p0.98), goals 3 (p0.97), award 0.00, finish 0.75 · stature idx 0.857/w 1.00 |

## T1-b Top 25 — era <=1958 (n=1890)
| # | card | pos | OVR | basis | internal | raw(uncap) | merit inputs |
|---|---|---|---|---|---|---|---|
| 1 | Kocsis (Hungary 1954) ★ | FW | 99 | stature | 100.0 | 97.2 | apps 5 (p0.94), goals 11 (p1.00), award 0.90, finish 0.75 [Golden Boot] · stature idx 0.992/w 1.00 |
| 2 | Puskás (Hungary 1954) ★ | FW | 99 | stature | 100.0 | 74.9 | apps 3 (p0.71), goals 4 (p0.95), award 0.00, finish 0.75 · stature idx 0.886/w 1.00 |
| 3 | Piola (Italy 1938) | FW | 99 | stature | 100.0 | 94.9 | apps 4 (p0.96), goals 5 (p0.98), award 0.60, finish 1.00 [Silver Boot] · stature idx 0.911/w 1.00 |
| 4 | Meazza (Italy 1934) ★ | MF | 98 | stature | 99.0 | 83.2 | apps 5 (p0.98), goals 2 (p0.99), award 0.00, finish 1.00 · stature idx 0.865/w 1.00 |
| 5 | Meazza (Italy 1938) ★ | MF | 98 | stature | 99.0 | 81.8 | apps 4 (p0.94), goals 1 (p0.98), award 0.00, finish 1.00 · stature idx 0.865/w 1.00 |
| 6 | Scarone (Uruguay 1930) ★ | FW | 98 | stature | 98.9 | 73.2 | apps 3 (p0.78), goals 1 (p0.77), award 0.00, finish 1.00 · stature idx 0.864/w 1.00 |
| 7 | Zizinho (Brazil 1950) ★ | FW | 98 | stature | 98.9 | 73.8 | apps 4 (p0.84), goals 2 (p0.88), award 0.00, finish 0.75 · stature idx 0.863/w 1.00 |
| 8 | Sindelar (Austria 1934) ★ | FW | 98 | stature | 97.6 | 65.0 | apps 3 (p0.80), goals 1 (p0.81), award 0.00, finish 0.40 · stature idx 0.843/w 1.00 |
| 9 | Schiaffino (Uruguay 1950) ★ | FW | 98 | stature | 97.6 | 79.8 | apps 4 (p0.84), goals 3 (p0.94), award 0.00, finish 1.00 · stature idx 0.843/w 1.00 |
| 10 | Schiaffino (Uruguay 1954) ★ | FW | 98 | stature | 97.6 | 67.6 | apps 5 (p0.94), goals 2 (p0.83), award 0.00, finish 0.40 · stature idx 0.843/w 1.00 |
| 11 | Kopa (France 1958) ★ | MF | 98 | stature | 97.6 | 74.8 | apps 6 (p0.94), goals 3 (p0.98), award 0.00, finish 0.55 · stature idx 0.843/w 1.00 |
| 12 | Walter (West Germany 1954) | FW | 97 | stature | 96.8 | 80.1 | apps 6 (p0.99), goals 3 (p0.89), award 0.00, finish 1.00 · stature idx 0.832/w 1.00 |
| 13 | Bozsik (Hungary 1954) | MF | 97 | stature | 96.6 | 67.1 | apps 5 (p0.91), goals 0 (p0.47), award 0.00, finish 0.75 · stature idx 0.829/w 1.00 |
| 14 | Cea (Uruguay 1930) | FW | 97 | stature | 96.1 | 95.0 | apps 4 (p0.96), goals 5 (p0.99), award 0.60, finish 1.00 [Silver Boot] · stature idx 0.822/w 1.00 |
| 15 | Kopa (France 1954) ★ | FW | 97 | stature | 95.3 | 51.2 | apps 2 (p0.42), goals 1 (p0.73), award 0.00, finish — · stature idx 0.843/w 1.00 |
| 16 | Ocwirk (Austria 1954) | MF | 97 | stature | 95.3 | 73.7 | apps 5 (p0.91), goals 2 (p0.98), award 0.00, finish 0.55 · stature idx 0.809/w 1.00 |
| 17 | Andrade (Uruguay 1930) | MF | 97 | stature | 95.3 | 72.3 | apps 4 (p0.94), goals 0 (p0.48), award 0.00, finish 1.00 · stature idx 0.809/w 1.00 |
| 18 | Pelé (Brazil 1958) ★ | FW | 97 | stature | 95.1 | 97.2 | apps 4 (p0.78), goals 6 (p0.99), award 0.82, finish 1.00 [Best Young Player,Silver Boot] · stature idx 0.807/w 1.00 |
| 19 | Walter (West Germany 1958) | MF | 96 | stature | 95.0 | 58.1 | apps 5 (p0.80), goals 0 (p0.45), award 0.00, finish 0.40 · stature idx 0.832/w 1.00 |
| 20 | Hanappi (Austria 1954) | DF | 96 | stature | 92.9 | 76.9 | apps 5 (p0.91), goals 0 (p0.48), award 0.00, finish 0.55 · stature idx 0.809/w 1.00 |
| 21 | Fontaine (France 1958) ★ | FW | 95 | stature | 91.0 | 94.4 | apps 6 (p0.97), goals 13 (p1.00), award 0.90, finish 0.55 [Golden Boot] · stature idx 0.744/w 1.00 |
| 22 | Santos (Brazil 1954) | DF | 94 | stature | 90.5 | 48.3 | apps 3 (p0.59), goals 1 (p0.97), award 0.00, finish — · stature idx 0.805/w 1.00 |
| 23 | Boniperti (Italy 1954) | FW | 94 | stature | 89.6 | 47.3 | apps 1 (p0.10), goals 1 (p0.73), award 0.00, finish — · stature idx 0.780/w 1.00 |
| 24 | Matthews (England 1954) ★ | FW | 94 | stature | 89.6 | 36.7 | apps 2 (p0.42), goals 0 (p0.32), award 0.00, finish — · stature idx 0.843/w 1.00 |
| 25 | Hidegkuti (Hungary 1954) | FW | 94 | stature | 89.3 | 76.4 | apps 4 (p0.84), goals 4 (p0.95), award 0.00, finish 0.75 · stature idx 0.719/w 1.00 |

## T1-b Top 25 — era 1962-70 (n=1053)
| # | card | pos | OVR | basis | internal | raw(uncap) | merit inputs |
|---|---|---|---|---|---|---|---|
| 1 | Müller (West Germany 1970) ★ | FW | 99 | stature | 100.0 | 94.0 | apps 6 (p0.95), goals 10 (p0.99), award 0.90, finish 0.55 [Golden Boot] · stature idx 0.887/w 1.00 |
| 2 | Beckenbauer (West Germany 1966) ★ | MF | 99 | stature | 100.0 | 94.8 | apps 6 (p0.94), goals 4 (p1.00), award 0.75, finish 0.75 [Best Young Player,Bronze Boot] · stature idx 0.889/w 1.00 |
| 3 | Beckenbauer (West Germany 1970) ★ | MF | 99 | stature | 100.0 | 71.1 | apps 5 (p0.89), goals 1 (p0.87), award 0.00, finish 0.55 · stature idx 0.889/w 1.00 |
| 4 | Eusébio (Portugal 1966) ★ | FW | 99 | stature | 100.0 | 94.1 | apps 6 (p0.96), goals 9 (p0.99), award 0.90, finish 0.55 [Golden Boot] · stature idx 0.879/w 1.00 |
| 5 | Albert (Hungary 1962) | FW | 99 | stature | 99.5 | 82.2 | apps 3 (p0.67), goals 4 (p0.98), award 0.95, finish — [Best Young Player,Golden Boot] · stature idx 0.872/w 1.00 |
| 6 | Albert (Hungary 1966) | MF | 97 | stature | 95.5 | 51.0 | apps 4 (p0.79), goals 0 (p0.44), award 0.00, finish — · stature idx 0.872/w 1.00 |
| 7 | Pelé (Brazil 1962) ★ | FW | 97 | stature | 95.1 | 70.0 | apps 2 (p0.41), goals 1 (p0.81), award 0.00, finish 1.00 · stature idx 0.807/w 1.00 |
| 8 | Pelé (Brazil 1970) ★ | FW | 97 | stature | 95.1 | 81.8 | apps 6 (p0.95), goals 4 (p0.96), award 0.00, finish 1.00 · stature idx 0.807/w 1.00 |
| 9 | Cubillas (Peru 1970) ★ | FW | 96 | stature | 93.7 | 79.9 | apps 4 (p0.82), goals 5 (p0.97), award 0.75, finish — [Best Young Player,Bronze Boot] · stature idx 0.786/w 1.00 |
| 10 | Santos (Brazil 1962) | DF | 95 | stature | 92.7 | 88.3 | apps 6 (p0.92), goals 0 (p0.49), award 0.00, finish 1.00 · stature idx 0.805/w 1.00 |
| 11 | Pelé (Brazil 1966) ★ | FW | 95 | stature | 92.5 | 54.1 | apps 2 (p0.42), goals 1 (p0.81), award 0.00, finish — · stature idx 0.807/w 1.00 |
| 12 | Puskás (Spain 1962) ★ | FW | 95 | stature | 92.4 | 40.9 | apps 3 (p0.67), goals 0 (p0.36), award 0.00, finish — · stature idx 0.886/w 1.00 |
| 13 | Charlton (England 1966) ★ | MF | 95 | stature | 91.2 | 83.1 | apps None (p—), goals 3 (p0.98), award 0.00, finish 1.00 · stature idx 0.748/w 1.00 |
| 14 | Masopust (Czechoslovakia 1962) ★ | MF | 95 | stature | 90.6 | 75.4 | apps 6 (p0.94), goals 1 (p0.86), award 0.00, finish 0.75 · stature idx 0.739/w 1.00 |
| 15 | Charlton (England 1962) ★ | FW | 94 | stature | 90.4 | 59.0 | apps 4 (p0.83), goals 1 (p0.81), award 0.00, finish — · stature idx 0.748/w 1.00 |
| 16 | Rivera (Italy 1970) ★ | MF | 94 | stature | 89.9 | 74.0 | apps 4 (p0.81), goals 2 (p0.97), award 0.00, finish 0.75 · stature idx 0.729/w 1.00 |
| 17 | Garrincha (Brazil 1962) ★ | FW | 94 | stature | 89.5 | 100.0 | apps 6 (p0.96), goals 4 (p0.98), award 0.90, finish 1.00 [Golden Boot] · stature idx 0.723/w 1.00 |
| 18 | Garrincha (Brazil 1966) ★ | FW | 93 | stature | 86.9 | 54.1 | apps 2 (p0.42), goals 1 (p0.81), award 0.00, finish — · stature idx 0.723/w 1.00 |
| 19 | Santos (Brazil 1966) | DF | 93 | stature | 85.7 | 39.4 | apps 2 (p0.40), goals 0 (p0.48), award 0.00, finish — · stature idx 0.805/w 1.00 |
| 20 | Charlton (England 1970) ★ | MF | 93 | stature | 85.5 | 50.8 | apps 4 (p0.81), goals 0 (p0.39), award 0.00, finish — · stature idx 0.748/w 1.00 |
| 21 | Yashin (Soviet Union 1962) ★ | GK | 92 | stature | 85.4 | 54.1 | apps 4 (p0.71), goals 0 (p0.50), award 0.00, finish — · stature idx 0.738/w 1.00 |
| 22 | Yashin (Soviet Union 1966) ★ | GK | 92 | stature | 85.4 | 68.4 | apps 4 (p0.78), goals 0 (p0.50), award 0.00, finish 0.40 · stature idx 0.738/w 1.00 |
| 23 | Santos (Brazil 1962) | DF | 92 | stature | 85.0 | 88.3 | apps 6 (p0.92), goals 0 (p0.49), award 0.00, finish 1.00 · stature idx 0.684/w 1.00 |
| 24 | Moore (England 1966) ★ | DF | 92 | stature | 83.7 | 89.7 | apps 6 (p0.95), goals 0 (p0.48), award 0.00, finish 1.00 · stature idx 0.663/w 1.00 |
| 25 | Di Stéfano (Spain 1962) ★ | FW | 92 | stature | 83.5 | 37.2 | apps None (p—), goals 0 (p0.36), award 0.00, finish — · stature idx 0.774/w 1.00 |

## T1-b Top 25 — era 1974-82 (n=1230)
| # | card | pos | OVR | basis | internal | raw(uncap) | merit inputs |
|---|---|---|---|---|---|---|---|
| 1 | Rummenigge (West Germany 1978) ★ | FW | 99 | stature | 100.0 | 63.2 | apps 5 (p0.80), goals 3 (p0.93), award 0.00, finish — · stature idx 0.889/w 1.00 |
| 2 | Rummenigge (West Germany 1982) ★ | FW | 99 | stature | 100.0 | 95.4 | apps 7 (p0.98), goals 5 (p0.99), award 0.80, finish 0.75 [Bronze Ball,Silver Boot] · stature idx 0.889/w 1.00 |
| 3 | Müller (West Germany 1974) ★ | FW | 99 | stature | 100.0 | 82.1 | apps 7 (p0.96), goals 4 (p0.96), award 0.00, finish 1.00 · stature idx 0.887/w 1.00 |
| 4 | Maradona (Argentina 1982) ★ | MF | 99 | stature | 100.0 | 63.3 | apps 5 (p0.87), goals 2 (p0.95), award 0.00, finish — · stature idx 0.952/w 1.00 |
| 5 | Rossi (Italy 1978) ★ | FW | 99 | stature | 99.9 | 85.6 | apps 7 (p0.97), goals 3 (p0.93), award 0.70, finish 0.40 [Silver Ball] · stature idx 0.879/w 1.00 |
| 6 | Rossi (Italy 1982) ★ | FW | 99 | stature | 99.9 | 100.0 | apps 7 (p0.98), goals 6 (p1.00), award 1.00, finish 1.00 [Golden Ball,Golden Boot] · stature idx 0.879/w 1.00 |
| 7 | Zico (Brazil 1978) ★ | MF | 98 | stature | 98.6 | 70.2 | apps 6 (p0.86), goals 1 (p0.86), award 0.00, finish 0.55 · stature idx 0.859/w 1.00 |
| 8 | Zico (Brazil 1982) ★ | MF | 98 | stature | 98.6 | 74.1 | apps 5 (p0.87), goals 4 (p1.00), award 0.45, finish — [Bronze Boot] · stature idx 0.859/w 1.00 |
| 9 | Beckenbauer (West Germany 1974) ★ | DF | 98 | stature | 97.9 | 89.2 | apps 7 (p0.94), goals 0 (p0.47), award 0.00, finish 1.00 · stature idx 0.889/w 1.00 |
| 10 | Kempes (Argentina 1978) ★ | FW | 97 | stature | 96.6 | 100.0 | apps 7 (p0.97), goals 6 (p0.99), award 1.00, finish 1.00 [Golden Ball,Golden Boot] · stature idx 0.829/w 1.00 |
| 11 | Matthäus (West Germany 1982) ★ | MF | 97 | stature | 95.6 | 51.8 | apps 2 (p0.42), goals 0 (p0.40), award 0.00, finish 0.75 · stature idx 0.891/w 1.00 |
| 12 | Platini (France 1982) ★ | MF | 96 | stature | 95.0 | 69.7 | apps 5 (p0.87), goals 2 (p0.95), award 0.00, finish 0.40 · stature idx 0.804/w 1.00 |
| 13 | Cubillas (Peru 1978) ★ | MF | 96 | stature | 93.7 | 77.1 | apps 6 (p0.86), goals 5 (p1.00), award 0.60, finish — [Silver Boot] · stature idx 0.786/w 1.00 |
| 14 | Cruyff (Netherlands 1974) ★ | MF | 95 | stature | 91.7 | 78.3 | apps 7 (p0.96), goals 3 (p0.97), award 0.00, finish 0.75 · stature idx 0.755/w 1.00 |
| 15 | Platini (France 1978) ★ | MF | 94 | stature | 90.6 | 52.2 | apps 3 (p0.54), goals 1 (p0.86), award 0.00, finish — · stature idx 0.804/w 1.00 |
| 16 | Kempes (Argentina 1974) ★ | FW | 94 | stature | 90.0 | 42.8 | apps 6 (p0.86), goals 0 (p0.35), award 0.00, finish — · stature idx 0.829/w 1.00 |
| 17 | Kempes (Argentina 1982) ★ | FW | 94 | stature | 89.6 | 41.2 | apps 5 (p0.87), goals 0 (p0.30), award 0.00, finish — · stature idx 0.829/w 1.00 |
| 18 | Rensenbrink (Netherlands 1974) ★ | FW | 94 | stature | 88.4 | 69.8 | apps 6 (p0.86), goals 1 (p0.76), award 0.00, finish 0.75 · stature idx 0.705/w 1.00 |
| 19 | Rensenbrink (Netherlands 1978) ★ | FW | 94 | stature | 88.4 | 88.0 | apps 7 (p0.97), goals 5 (p0.98), award 0.45, finish 0.75 [Bronze Boot] · stature idx 0.705/w 1.00 |
| 20 | Falcão (Brazil 1982) | MF | 93 | stature | 87.1 | 79.4 | apps 5 (p0.87), goals 3 (p0.99), award 0.70, finish — [Silver Ball] · stature idx 0.686/w 1.00 |
| 21 | Lato (Poland 1974) | FW | 93 | stature | 87.0 | 94.2 | apps 7 (p0.96), goals 7 (p0.99), award 0.90, finish 0.55 [Golden Boot] · stature idx 0.685/w 1.00 |
| 22 | Lato (Poland 1978) | FW | 93 | stature | 87.0 | 62.7 | apps 6 (p0.88), goals 2 (p0.89), award 0.00, finish — · stature idx 0.685/w 1.00 |
| 23 | Lato (Poland 1982) | FW | 93 | stature | 87.0 | 66.9 | apps 7 (p0.98), goals 1 (p0.73), award 0.00, finish 0.55 · stature idx 0.685/w 1.00 |
| 24 | Cubillas (Peru 1982) ★ | MF | 93 | stature | 85.7 | 44.6 | apps 3 (p0.59), goals 0 (p0.40), award 0.00, finish — · stature idx 0.786/w 1.00 |
| 25 | Keegan (England 1982) ★ | FW | 92 | stature | 83.2 | 33.3 | apps 1 (p0.21), goals 0 (p0.30), award 0.00, finish — · stature idx 0.781/w 1.00 |

## T1-b Top 25 — era 1986-94 (n=1584)
| # | card | pos | OVR | basis | internal | raw(uncap) | merit inputs |
|---|---|---|---|---|---|---|---|
| 1 | Matthäus (West Germany 1986) ★ | MF | 99 | stature | 100.0 | 77.2 | apps 7 (p0.98), goals 1 (p0.88), award 0.00, finish 0.75 · stature idx 0.891/w 1.00 |
| 2 | Matthäus (West Germany 1990) ★ | MF | 99 | stature | 100.0 | 98.8 | apps 7 (p0.98), goals 4 (p0.99), award 0.70, finish 1.00 [Silver Ball] · stature idx 0.891/w 1.00 |
| 3 | Matthäus (Germany 1994) ★ | MF | 99 | stature | 100.0 | 63.0 | apps 5 (p0.89), goals 1 (p0.90), award 0.00, finish — · stature idx 0.891/w 1.00 |
| 4 | Rummenigge (West Germany 1986) ★ | FW | 99 | stature | 100.0 | 71.8 | apps 7 (p0.98), goals 1 (p0.78), award 0.00, finish 0.75 · stature idx 0.889/w 1.00 |
| 5 | Maradona (Argentina 1986) ★ | MF | 99 | stature | 100.0 | 100.0 | apps 7 (p0.98), goals 5 (p1.00), award 1.00, finish 1.00 [Golden Ball,Silver Boot] · stature idx 0.952/w 1.00 |
| 6 | Maradona (Argentina 1990) ★ | MF | 99 | stature | 100.0 | 79.1 | apps 7 (p0.98), goals 0 (p0.41), award 0.50, finish 0.75 [Bronze Ball] · stature idx 0.952/w 1.00 |
| 7 | Romário (Brazil 1994) ★ | FW | 98 | stature | 98.8 | 100.0 | apps 7 (p0.96), goals 5 (p0.96), award 1.00, finish 1.00 [Bronze Boot,Golden Ball] · stature idx 0.862/w 1.00 |
| 8 | Baggio (Italy 1990) ★ | FW | 98 | stature | 98.2 | 72.6 | apps 5 (p0.91), goals 2 (p0.91), award 0.00, finish 0.55 · stature idx 0.854/w 1.00 |
| 9 | Baggio (Italy 1994) ★ | FW | 98 | stature | 98.2 | 92.3 | apps 7 (p0.96), goals 5 (p0.96), award 0.70, finish 0.75 [Silver Ball] · stature idx 0.854/w 1.00 |
| 10 | Maradona (Argentina 1994) ★ | MF | 98 | stature | 98.2 | 47.0 | apps 2 (p0.34), goals 1 (p0.90), award 0.00, finish — · stature idx 0.952/w 1.00 |
| 11 | Ronaldo (Brazil 1994) ★ | FW | 98 | stature | 97.2 | 47.6 | apps 0 (p0.07), goals 0 (p0.30), award 0.00, finish 1.00 · stature idx 0.913/w 1.00 |
| 12 | Platini (France 1986) ★ | MF | 96 | stature | 95.0 | 74.6 | apps 6 (p0.94), goals 2 (p0.97), award 0.00, finish 0.55 · stature idx 0.804/w 1.00 |
| 13 | Gullit (Netherlands 1990) ★ | MF | 95 | stature | 91.5 | 58.7 | apps 4 (p0.75), goals 1 (p0.89), award 0.00, finish — · stature idx 0.780/w 1.00 |
| 14 | Zico (Brazil 1986) ★ | MF | 95 | stature | 90.6 | 43.2 | apps 3 (p0.54), goals 0 (p0.41), award 0.00, finish — · stature idx 0.859/w 1.00 |
| 15 | Rossi (Italy 1986) ★ | FW | 94 | stature | 89.4 | 33.2 | apps 0 (p0.07), goals 0 (p0.34), award 0.00, finish — · stature idx 0.879/w 1.00 |
| 16 | Maldini (Italy 1990) ★ | DF | 94 | stature | 89.2 | 80.0 | apps 7 (p0.97), goals 0 (p0.47), award 0.00, finish 0.55 · stature idx 0.750/w 1.00 |
| 17 | Maldini (Italy 1994) ★ | DF | 94 | stature | 89.2 | 85.0 | apps 7 (p0.98), goals 0 (p0.48), award 0.00, finish 0.75 · stature idx 0.750/w 1.00 |
| 18 | Romário (Brazil 1990) ★ | FW | 94 | stature | 89.1 | 36.0 | apps 1 (p0.26), goals 0 (p0.36), award 0.00, finish — · stature idx 0.862/w 1.00 |
| 19 | Lineker (England 1986) | FW | 94 | stature | 88.4 | 84.8 | apps 5 (p0.91), goals 6 (p1.00), award 0.90, finish — [Golden Boot] · stature idx 0.706/w 1.00 |
| 20 | Lineker (England 1990) | FW | 94 | stature | 88.4 | 82.2 | apps 7 (p0.99), goals 4 (p0.97), award 0.45, finish 0.40 [Bronze Boot] · stature idx 0.706/w 1.00 |
| 21 | Milla (Cameroon 1990) ★ | FW | 93 | stature | 87.9 | 74.9 | apps 5 (p0.91), goals 4 (p0.97), award 0.45, finish — [Bronze Boot] · stature idx 0.698/w 1.00 |
| 22 | Papin (France 1986) ★ | FW | 93 | stature | 86.4 | 70.7 | apps 4 (p0.79), goals 2 (p0.90), award 0.00, finish 0.55 · stature idx 0.676/w 1.00 |
| 23 | van Basten (Netherlands 1990) ★ | FW | 93 | stature | 86.3 | 42.5 | apps 4 (p0.80), goals 0 (p0.36), award 0.00, finish — · stature idx 0.781/w 1.00 |
| 24 | Milla (Cameroon 1994) ★ | FW | 92 | stature | 84.1 | 50.7 | apps 2 (p0.43), goals 1 (p0.71), award 0.00, finish — · stature idx 0.698/w 1.00 |
| 25 | Cafu (Brazil 1994) ★ | DF | 92 | stature | 83.2 | 71.6 | apps 3 (p0.58), goals 0 (p0.48), award 0.00, finish 1.00 · stature idx 0.656/w 1.00 |

## T1-b Top 25 — era 1998-2006 (n=2177)
| # | card | pos | OVR | basis | internal | raw(uncap) | merit inputs |
|---|---|---|---|---|---|---|---|
| 1 | Messi (Argentina 2006) ★ | FW | 99 | stature | 100.0 | 55.0 | apps 3 (p0.60), goals 1 (p0.77), award 0.00, finish — · stature idx 0.938/w 1.00 |
| 2 | Zidane (France 1998) ★ | MF | 99 | stature | 100.0 | 80.6 | apps 5 (p0.90), goals 2 (p0.97), award 0.00, finish 1.00 · stature idx 0.928/w 1.00 |
| 3 | Zidane (France 2006) ★ | MF | 99 | stature | 100.0 | 100.0 | apps 6 (p0.95), goals 3 (p1.00), award 1.00, finish 0.75 [Golden Ball] · stature idx 0.928/w 1.00 |
| 4 | Ronaldo (Brazil 1998) ★ | FW | 99 | stature | 100.0 | 98.7 | apps 7 (p0.98), goals 4 (p0.97), award 1.00, finish 0.75 [Golden Ball] · stature idx 0.913/w 1.00 |
| 5 | Ronaldo (Brazil 2002) ★ | FW | 99 | stature | 100.0 | 100.0 | apps 7 (p0.98), goals 8 (p1.00), award 0.97, finish 1.00 [Golden Boot,Silver Ball] · stature idx 0.913/w 1.00 |
| 6 | Ronaldo (Brazil 2006) ★ | FW | 99 | stature | 100.0 | 75.2 | apps 5 (p0.92), goals 3 (p0.97), award 0.45, finish — [Bronze Boot] · stature idx 0.913/w 1.00 |
| 7 | Ronaldo (Portugal 2006) ★ | FW | 99 | stature | 99.9 | 65.5 | apps 6 (p0.95), goals 1 (p0.77), award 0.00, finish 0.40 · stature idx 0.878/w 1.00 |
| 8 | Ronaldinho (Brazil 2002) ★ | MF | 99 | stature | 99.4 | 81.3 | apps 5 (p0.92), goals 2 (p0.98), award 0.00, finish 1.00 · stature idx 0.870/w 1.00 |
| 9 | Henry (France 1998) ★ | FW | 98 | stature | 98.5 | 81.4 | apps 6 (p0.96), goals 3 (p0.94), award 0.00, finish 1.00 · stature idx 0.857/w 1.00 |
| 10 | Henry (France 2006) ★ | FW | 98 | stature | 98.5 | 78.8 | apps 7 (p0.98), goals 3 (p0.97), award 0.00, finish 0.75 · stature idx 0.857/w 1.00 |
| 11 | Baggio (Italy 1998) ★ | FW | 98 | stature | 98.2 | 62.1 | apps 4 (p0.84), goals 2 (p0.89), award 0.00, finish — · stature idx 0.854/w 1.00 |
| 12 | Rivaldo (Brazil 1998) ★ | MF | 97 | stature | 96.7 | 79.4 | apps 7 (p0.98), goals 3 (p1.00), award 0.00, finish 0.75 · stature idx 0.830/w 1.00 |
| 13 | Rivaldo (Brazil 2002) ★ | MF | 97 | stature | 96.7 | 96.6 | apps 7 (p0.98), goals 5 (p1.00), award 0.60, finish 1.00 [Silver Boot] · stature idx 0.830/w 1.00 |
| 14 | Shevchenko (Ukraine 2006) ★ | FW | 97 | stature | 96.2 | 64.5 | apps 5 (p0.92), goals 2 (p0.93), award 0.00, finish — · stature idx 0.823/w 1.00 |
| 15 | Ronaldinho (Brazil 2006) ★ | MF | 97 | stature | 95.1 | 54.1 | apps 5 (p0.90), goals 0 (p0.43), award 0.00, finish — · stature idx 0.870/w 1.00 |
| 16 | Figo (Portugal 2006) ★ | MF | 96 | stature | 95.1 | 62.9 | apps 7 (p0.98), goals 0 (p0.43), award 0.00, finish 0.40 · stature idx 0.816/w 1.00 |
| 17 | Matthäus (Germany 1998) ★ | DF | 96 | stature | 94.6 | 59.0 | apps 4 (p0.81), goals 0 (p0.47), award 0.00, finish — · stature idx 0.891/w 1.00 |
| 18 | Kaká (Brazil 2006) ★ | MF | 96 | stature | 94.1 | 63.4 | apps 5 (p0.90), goals 1 (p0.91), award 0.00, finish — · stature idx 0.799/w 1.00 |
| 19 | Cannavaro (Italy 2006) ★ | DF | 96 | stature | 94.0 | 100.0 | apps 7 (p0.99), goals 0 (p0.47), award 0.70, finish 1.00 [Silver Ball] · stature idx 0.827/w 1.00 |
| 20 | Owen (England 1998) ★ | FW | 96 | stature | 93.9 | 73.1 | apps 4 (p0.84), goals 2 (p0.89), award 0.55, finish — [Best Young Player] · stature idx 0.789/w 1.00 |
| 21 | Owen (England 2002) ★ | FW | 96 | stature | 93.9 | 63.3 | apps 5 (p0.91), goals 2 (p0.90), award 0.00, finish — · stature idx 0.789/w 1.00 |
| 22 | Cannavaro (Italy 1998) ★ | DF | 95 | stature | 92.2 | 63.7 | apps 5 (p0.91), goals 0 (p0.47), award 0.00, finish — · stature idx 0.827/w 1.00 |
| 23 | Zidane (France 2002) ★ | MF | 95 | stature | 90.7 | 35.1 | apps 1 (p0.23), goals 0 (p0.43), award 0.00, finish — · stature idx 0.928/w 1.00 |
| 24 | Drogba (Ivory Coast 2006) ★ | FW | 94 | stature | 90.4 | 52.0 | apps 2 (p0.35), goals 1 (p0.77), award 0.00, finish — · stature idx 0.776/w 1.00 |
| 25 | Modrić (Croatia 2006) ★ | MF | 94 | stature | 90.3 | 37.3 | apps 2 (p0.31), goals 0 (p0.43), award 0.00, finish — · stature idx 0.898/w 1.00 |

## T1-b Top 25 — era 2010-2018 (n=2208)
| # | card | pos | OVR | basis | internal | raw(uncap) | merit inputs |
|---|---|---|---|---|---|---|---|
| 1 | Messi (Argentina 2014) ★ | FW | 99 | stature | 100.0 | 99.2 | apps 7 (p0.99), goals 4 (p0.98), award 1.00, finish 0.75 [Golden Ball] · stature idx 0.938/w 1.00 |
| 2 | Messi (Argentina 2018) ★ | FW | 99 | stature | 100.0 | 58.3 | apps 4 (p0.81), goals 1 (p0.79), award 0.00, finish — · stature idx 0.938/w 1.00 |
| 3 | Modrić (Croatia 2018) ★ | MF | 99 | stature | 100.0 | 100.0 | apps 7 (p0.99), goals 2 (p0.99), award 1.00, finish 0.75 [Golden Ball] · stature idx 0.898/w 1.00 |
| 4 | Ronaldo (Portugal 2018) ★ | FW | 99 | stature | 99.9 | 65.0 | apps 4 (p0.81), goals 4 (p0.98), award 0.00, finish — · stature idx 0.878/w 1.00 |
| 5 | Ronaldo (Portugal 2010) ★ | FW | 99 | stature | 99.4 | 58.7 | apps 4 (p0.81), goals 1 (p0.81), award 0.00, finish — · stature idx 0.878/w 1.00 |
| 6 | Mbappé (France 2018) ★ | FW | 98 | stature | 98.5 | 94.1 | apps 7 (p0.98), goals 4 (p0.98), award 0.55, finish 1.00 [Best Young Player] · stature idx 0.858/w 1.00 |
| 7 | Messi (Argentina 2010) ★ | FW | 98 | stature | 97.5 | 43.8 | apps 5 (p0.92), goals 0 (p0.36), award 0.00, finish — · stature idx 0.938/w 1.00 |
| 8 | Iniesta (Spain 2010) ★ | MF | 98 | stature | 97.3 | 82.1 | apps 6 (p0.95), goals 2 (p0.98), award 0.00, finish 1.00 · stature idx 0.839/w 1.00 |
| 9 | Ronaldo (Portugal 2014) ★ | FW | 97 | stature | 96.8 | 52.5 | apps 3 (p0.54), goals 1 (p0.72), award 0.00, finish — · stature idx 0.878/w 1.00 |
| 10 | Xavi (Spain 2010) ★ | MF | 97 | stature | 95.7 | 72.4 | apps 7 (p0.98), goals 0 (p0.43), award 0.00, finish 1.00 · stature idx 0.815/w 1.00 |
| 11 | Salah (Egypt 2018) ★ | FW | 96 | stature | 93.4 | 56.6 | apps 2 (p0.33), goals 2 (p0.91), award 0.00, finish — · stature idx 0.800/w 1.00 |
| 12 | Modrić (Croatia 2014) ★ | MF | 96 | stature | 93.2 | 45.9 | apps 3 (p0.62), goals 0 (p0.41), award 0.00, finish — · stature idx 0.898/w 1.00 |
| 13 | Iniesta (Spain 2018) ★ | MF | 95 | stature | 91.9 | 50.9 | apps 4 (p0.79), goals 0 (p0.42), award 0.00, finish — · stature idx 0.839/w 1.00 |
| 14 | Drogba (Ivory Coast 2010) ★ | FW | 95 | stature | 91.6 | 56.1 | apps 3 (p0.59), goals 1 (p0.81), award 0.00, finish — · stature idx 0.776/w 1.00 |
| 15 | Pogba (France 2014) ★ | MF | 94 | stature | 90.2 | 75.9 | apps 5 (p0.92), goals 1 (p0.90), award 0.55, finish — [Best Young Player] · stature idx 0.733/w 1.00 |
| 16 | Pogba (France 2018) ★ | MF | 94 | stature | 90.2 | 81.5 | apps 6 (p0.97), goals 1 (p0.91), award 0.00, finish 1.00 · stature idx 0.733/w 1.00 |
| 17 | Benzema (France 2014) ★ | FW | 94 | stature | 89.9 | 65.2 | apps 5 (p0.89), goals 3 (p0.96), award 0.00, finish — · stature idx 0.728/w 1.00 |
| 18 | Mané (Senegal 2018) ★ | FW | 94 | stature | 89.6 | 55.6 | apps 3 (p0.59), goals 1 (p0.79), award 0.00, finish — · stature idx 0.749/w 1.00 |
| 19 | Iniesta (Spain 2014) ★ | MF | 94 | stature | 89.3 | 45.9 | apps 3 (p0.62), goals 0 (p0.41), award 0.00, finish — · stature idx 0.839/w 1.00 |
| 20 | Henry (France 2010) ★ | FW | 94 | stature | 89.2 | 36.7 | apps 2 (p0.32), goals 0 (p0.36), award 0.00, finish — · stature idx 0.857/w 1.00 |
| 21 | Kaká (Brazil 2010) ★ | MF | 94 | stature | 89.2 | 52.2 | apps 4 (p0.83), goals 0 (p0.43), award 0.00, finish — · stature idx 0.799/w 1.00 |
| 22 | Lewandowski (Poland 2018) ★ | FW | 94 | stature | 88.7 | 39.7 | apps 3 (p0.59), goals 0 (p0.35), award 0.00, finish — · stature idx 0.831/w 1.00 |
| 23 | Cannavaro (Italy 2010) ★ | DF | 93 | stature | 87.0 | 50.8 | apps 3 (p0.64), goals 0 (p0.46), award 0.00, finish — · stature idx 0.827/w 1.00 |
| 24 | Neymar (Brazil 2014) ★ | FW | 93 | stature | 86.8 | 81.5 | apps 5 (p0.89), goals 4 (p0.98), award 0.45, finish 0.40 [Bronze Boot] · stature idx 0.682/w 1.00 |
| 25 | Neymar (Brazil 2018) ★ | FW | 93 | stature | 86.8 | 63.4 | apps 5 (p0.89), goals 2 (p0.91), award 0.00, finish — · stature idx 0.682/w 1.00 |

## T1-b Top 25 — era 2022-2026 (n=2077)
| # | card | pos | OVR | basis | internal | raw(uncap) | merit inputs |
|---|---|---|---|---|---|---|---|
| 1 | Messi (Argentina 2022) ★ | FW | 99 | stature | 100.0 | 100.0 | apps 7 (p0.98), goals 7 (p0.99), award 1.00, finish 1.00 [Golden Ball,Silver Boot] · stature idx 0.938/w 1.00 |
| 2 | Messi (Argentina 2026) ★ | FW | 99 | stature | 100.0 | 76.2 | caps 198 (p1.00), goals 116 (p1.00), age 38 (af 0.80), lg 0.58 · stature idx 0.938/w 1.00 |
| 3 | Modrić (Croatia 2022) ★ | MF | 99 | stature | 100.0 | 76.5 | apps 7 (p0.98), goals 0 (p0.44), award 0.50, finish 0.55 [Bronze Ball] · stature idx 0.898/w 1.00 |
| 4 | Modrić (Croatia 2026) ★ | MF | 99 | stature | 100.0 | 88.8 | caps 197 (p1.00), goals 28 (p0.99), age 40 (af 0.80), lg 0.90 · stature idx 0.898/w 1.00 |
| 5 | Ronaldo (Portugal 2022) ★ | FW | 99 | stature | 99.8 | 57.8 | apps 5 (p0.89), goals 1 (p0.75), award 0.00, finish — · stature idx 0.878/w 1.00 |
| 6 | Mbappé (France 2022) ★ | FW | 98 | stature | 98.5 | 99.0 | apps 7 (p0.98), goals 8 (p1.00), award 0.97, finish 0.75 [Golden Boot,Silver Ball] · stature idx 0.858/w 1.00 |
| 7 | Mbappé (France 2026) ★ | FW | 98 | stature | 98.5 | 97.1 | caps 96 (p0.92), goals 56 (p0.97), age 27 (af 1.00), lg 1.00 · stature idx 0.858/w 1.00 |
| 8 | Lewandowski (Poland 2022) ★ | FW | 97 | stature | 96.7 | 61.6 | apps 4 (p0.78), goals 2 (p0.90), award 0.00, finish — · stature idx 0.831/w 1.00 |
| 9 | Ronaldo (Portugal 2026) ★ | FW | 97 | stature | 96.1 | 76.3 | caps 226 (p1.00), goals 143 (p1.00), age 41 (af 0.80), lg 0.58 · stature idx 0.878/w 1.00 |
| 10 | Salah (Egypt 2026) ★ | FW | 96 | stature | 94.7 | 94.2 | caps 115 (p0.95), goals 67 (p0.98), age 33 (af 0.93), lg 1.00 · stature idx 0.800/w 1.00 |
| 11 | Mané (Senegal 2026) ★ | FW | 94 | stature | 88.8 | 79.6 | caps 127 (p0.97), goals 55 (p0.96), age 34 (af 0.90), lg 0.58 · stature idx 0.749/w 1.00 |
| 12 | van Dijk (Netherlands 2026) ★ | DF | 94 | stature | 88.3 | 92.0 | caps 91 (p0.95), goals 12 (p0.99), age 34 (af 0.90), lg 1.00 · stature idx 0.737/w 1.00 |
| 13 | Neymar (Brazil 2022) ★ | FW | 93 | stature | 86.8 | 58.8 | apps 3 (p0.54), goals 2 (p0.90), award 0.00, finish — · stature idx 0.682/w 1.00 |
| 14 | van Dijk (Netherlands 2022) ★ | DF | 93 | stature | 86.2 | 64.4 | apps 5 (p0.92), goals 0 (p0.46), award 0.00, finish — · stature idx 0.737/w 1.00 |
| 15 | Neuer (Germany 2022) ★ | GK | 92 | stature | 85.1 | 57.6 | apps 3 (p0.78), goals 0 (p0.50), award 0.00, finish — · stature idx 0.733/w 1.00 |
| 16 | Neuer (Germany 2026) ★ | GK | 92 | stature | 85.1 | 82.7 | caps 124 (p0.98), goals 0 (p0.50), age 40 (af 0.80), lg 0.90 · stature idx 0.733/w 1.00 |
| 17 | Benzema (France 2022) ★ | FW | 92 | stature | 84.3 | 44.2 | apps 0 (p0.03), goals 0 (p0.33), award 0.00, finish 0.75 · stature idx 0.728/w 1.00 |
| 18 | Griezmann (France 2022) | FW | 92 | stature | 82.5 | 55.5 | apps 7 (p0.98), goals 0 (p0.33), award 0.00, finish 0.75 · stature idx 0.634/w 1.00 |
| 19 | De Bruyne (Belgium 2026) ★ | MF | 90 | stature | 78.0 | 93.2 | caps 118 (p0.98), goals 36 (p1.00), age 34 (af 0.90), lg 0.90 · stature idx 0.551/w 1.00 |
| 20 | Kane (England 2022) | FW | 90 | stature | 78.0 | 63.0 | apps 5 (p0.89), goals 2 (p0.90), award 0.00, finish — · stature idx 0.550/w 1.00 |
| 21 | Kane (England 2026) | FW | 90 | stature | 78.0 | 92.4 | caps 112 (p0.94), goals 78 (p0.99), age 32 (af 0.95), lg 0.90 · stature idx 0.550/w 1.00 |
| 22 | Hazard (Belgium 2022) ★ | FW | 90 | stature | 75.3 | 38.2 | apps 3 (p0.54), goals 0 (p0.33), award 0.00, finish — · stature idx 0.629/w 1.00 |
| 23 | Dembélé (France 2022) ★ | FW | 89 | stature | 74.1 | 55.5 | apps 7 (p0.98), goals 0 (p0.33), award 0.00, finish 0.75 · stature idx 0.507/w 1.00 |
| 24 | Rodríguez (Colombia 2026) | MF | 89 | stature | 73.9 | 82.4 | caps 125 (p0.98), goals 31 (p1.00), age 34 (af 0.90), lg 0.58 · stature idx 0.524/w 1.00 |
| 25 | Courtois (Belgium 2022) | GK | 89 | stature | 73.6 | 57.6 | apps 3 (p0.78), goals 0 (p0.50), award 0.00, finish — · stature idx 0.552/w 1.00 |

## T1-c Top 25 — GK (n=1547)
| # | card | pos | OVR | basis | internal | raw(uncap) | merit inputs |
|---|---|---|---|---|---|---|---|
| 1 | Buffon (Italy 2002) ★ | GK | 93 | stature | 87.9 | 62.2 | apps 4 (p0.88), goals 0 (p0.50), award 0.00, finish — · stature idx 0.777/w 1.00 |
| 2 | Buffon (Italy 2006) ★ | GK | 93 | stature | 87.9 | 100.0 | apps 7 (p0.98), goals 0 (p0.50), award 0.85, finish 1.00 [Golden Glove] · stature idx 0.777/w 1.00 |
| 3 | Buffon (Italy 2010) ★ | GK | 93 | stature | 86.6 | 50.5 | apps 1 (p0.64), goals 0 (p0.50), award 0.00, finish — · stature idx 0.777/w 1.00 |
| 4 | Yashin (Soviet Union 1958) ★ | GK | 92 | stature | 85.4 | 62.8 | apps 5 (p0.89), goals 0 (p0.50), award 0.00, finish — · stature idx 0.738/w 1.00 |
| 5 | Yashin (Soviet Union 1962) ★ | GK | 92 | stature | 85.4 | 54.1 | apps 4 (p0.71), goals 0 (p0.50), award 0.00, finish — · stature idx 0.738/w 1.00 |
| 6 | Yashin (Soviet Union 1966) ★ | GK | 92 | stature | 85.4 | 68.4 | apps 4 (p0.78), goals 0 (p0.50), award 0.00, finish 0.40 · stature idx 0.738/w 1.00 |
| 7 | Neuer (Germany 2010) ★ | GK | 92 | stature | 85.1 | 81.7 | apps 6 (p0.96), goals 0 (p0.50), award 0.00, finish 0.55 · stature idx 0.733/w 1.00 |
| 8 | Neuer (Germany 2014) ★ | GK | 92 | stature | 85.1 | 100.0 | apps 7 (p0.98), goals 0 (p0.50), award 0.85, finish 1.00 [Golden Glove] · stature idx 0.733/w 1.00 |
| 9 | Neuer (Germany 2018) ★ | GK | 92 | stature | 85.1 | 57.5 | apps 3 (p0.78), goals 0 (p0.50), award 0.00, finish — · stature idx 0.733/w 1.00 |
| 10 | Neuer (Germany 2022) ★ | GK | 92 | stature | 85.1 | 57.6 | apps 3 (p0.78), goals 0 (p0.50), award 0.00, finish — · stature idx 0.733/w 1.00 |
| 11 | Neuer (Germany 2026) ★ | GK | 92 | stature | 85.1 | 82.7 | caps 124 (p0.98), goals 0 (p0.50), age 40 (af 0.80), lg 0.90 · stature idx 0.733/w 1.00 |
| 12 | Buffon (Italy 2014) ★ | GK | 92 | stature | 84.6 | 53.5 | apps 2 (p0.70), goals 0 (p0.50), award 0.00, finish — · stature idx 0.777/w 1.00 |
| 13 | Kahn (Germany 2002) ★ | GK | 92 | stature | 84.2 | 100.0 | apps 7 (p0.98), goals 0 (p0.50), award 1.00, finish 0.75 [Golden Ball,Golden Glove] · stature idx 0.719/w 1.00 |
| 14 | Kahn (Germany 2006) ★ | GK | 92 | stature | 84.2 | 65.2 | apps 1 (p0.62), goals 0 (p0.50), award 0.00, finish 0.55 · stature idx 0.719/w 1.00 |
| 15 | Casillas (Spain 2002) ★ | GK | 92 | stature | 83.6 | 65.0 | apps 5 (p0.94), goals 0 (p0.50), award 0.00, finish — · stature idx 0.710/w 1.00 |
| 16 | Casillas (Spain 2010) ★ | GK | 92 | stature | 83.6 | 100.0 | apps 7 (p0.98), goals 0 (p0.50), award 0.85, finish 1.00 [Golden Glove] · stature idx 0.710/w 1.00 |
| 17 | Casillas (Spain 2006) ★ | GK | 92 | stature | 83.0 | 57.3 | apps 3 (p0.78), goals 0 (p0.50), award 0.00, finish — · stature idx 0.710/w 1.00 |
| 18 | Buffon (Italy 1998) ★ | GK | 91 | stature | 81.9 | 34.8 | apps 0 (p0.31), goals 0 (p0.50), award 0.00, finish — · stature idx 0.777/w 1.00 |
| 19 | Casillas (Spain 2014) ★ | GK | 91 | stature | 80.3 | 53.5 | apps 2 (p0.70), goals 0 (p0.50), award 0.00, finish — · stature idx 0.710/w 1.00 |
| 20 | Barthez (France 1998) | GK | 91 | stature | 79.8 | 100.0 | apps 7 (p0.98), goals 0 (p0.50), award 0.85, finish 1.00 [Golden Glove] · stature idx 0.650/w 1.00 |
| 21 | Barthez (France 2002) | GK | 91 | stature | 79.8 | 57.0 | apps 3 (p0.77), goals 0 (p0.50), award 0.00, finish — · stature idx 0.650/w 1.00 |
| 22 | Barthez (France 2006) | GK | 91 | stature | 79.8 | 88.2 | apps 7 (p0.98), goals 0 (p0.50), award 0.00, finish 0.75 · stature idx 0.650/w 1.00 |
| 23 | Kahn (Germany 1998) ★ | GK | 90 | stature | 78.2 | 34.8 | apps 0 (p0.31), goals 0 (p0.50), award 0.00, finish — · stature idx 0.719/w 1.00 |
| 24 | Schmeichel (Denmark 1998) ★ | GK | 90 | stature | 75.1 | 64.9 | apps 5 (p0.94), goals 0 (p0.50), award 0.00, finish — · stature idx 0.575/w 1.00 |
| 25 | Yashin (Soviet Union 1970) ★ | GK | 89 | stature | 74.6 | 32.5 | apps 0 (p0.26), goals 0 (p0.50), award 0.00, finish — · stature idx 0.738/w 1.00 |

## T1-c Top 25 — DF (n=3772)
| # | card | pos | OVR | basis | internal | raw(uncap) | merit inputs |
|---|---|---|---|---|---|---|---|
| 1 | Beckenbauer (West Germany 1974) ★ | DF | 98 | stature | 97.9 | 89.2 | apps 7 (p0.94), goals 0 (p0.47), award 0.00, finish 1.00 · stature idx 0.889/w 1.00 |
| 2 | Matthäus (Germany 1998) ★ | DF | 96 | stature | 94.6 | 59.0 | apps 4 (p0.81), goals 0 (p0.47), award 0.00, finish — · stature idx 0.891/w 1.00 |
| 3 | Cannavaro (Italy 2006) ★ | DF | 96 | stature | 94.0 | 100.0 | apps 7 (p0.99), goals 0 (p0.47), award 0.70, finish 1.00 [Silver Ball] · stature idx 0.827/w 1.00 |
| 4 | Hanappi (Austria 1954) | DF | 96 | stature | 92.9 | 76.9 | apps 5 (p0.91), goals 0 (p0.48), award 0.00, finish 0.55 · stature idx 0.809/w 1.00 |
| 5 | Santos (Brazil 1962) | DF | 95 | stature | 92.7 | 88.3 | apps 6 (p0.92), goals 0 (p0.49), award 0.00, finish 1.00 · stature idx 0.805/w 1.00 |
| 6 | Cannavaro (Italy 1998) ★ | DF | 95 | stature | 92.2 | 63.7 | apps 5 (p0.91), goals 0 (p0.47), award 0.00, finish — · stature idx 0.827/w 1.00 |
| 7 | Santos (Brazil 1954) | DF | 94 | stature | 90.5 | 48.3 | apps 3 (p0.59), goals 1 (p0.97), award 0.00, finish — · stature idx 0.805/w 1.00 |
| 8 | Maldini (Italy 1990) ★ | DF | 94 | stature | 89.2 | 80.0 | apps 7 (p0.97), goals 0 (p0.47), award 0.00, finish 0.55 · stature idx 0.750/w 1.00 |
| 9 | Maldini (Italy 1994) ★ | DF | 94 | stature | 89.2 | 85.0 | apps 7 (p0.98), goals 0 (p0.48), award 0.00, finish 0.75 · stature idx 0.750/w 1.00 |
| 10 | Santos (Brazil 1958) | DF | 94 | stature | 88.9 | 47.9 | apps 1 (p0.08), goals 0 (p0.48), award 0.00, finish 1.00 · stature idx 0.805/w 1.00 |
| 11 | Carlos (Brazil 1998) ★ | DF | 94 | stature | 88.7 | 85.2 | apps 7 (p0.98), goals 0 (p0.47), award 0.00, finish 0.75 · stature idx 0.743/w 1.00 |
| 12 | Carlos (Brazil 2002) ★ | DF | 94 | stature | 88.7 | 89.9 | apps 6 (p0.96), goals 1 (p0.96), award 0.00, finish 1.00 · stature idx 0.743/w 1.00 |
| 13 | van Dijk (Netherlands 2026) ★ | DF | 94 | stature | 88.3 | 92.0 | caps 91 (p0.95), goals 12 (p0.99), age 34 (af 0.90), lg 1.00 · stature idx 0.737/w 1.00 |
| 14 | Carlos (Brazil 2006) ★ | DF | 93 | stature | 88.0 | 60.9 | apps 4 (p0.85), goals 0 (p0.47), award 0.00, finish — · stature idx 0.743/w 1.00 |
| 15 | Bozsik (Hungary 1958) | DF | 93 | stature | 87.4 | 39.4 | apps 3 (p0.40), goals 1 (p0.98), award 0.00, finish — · stature idx 0.829/w 1.00 |
| 16 | Maldini (Italy 1998) ★ | DF | 93 | stature | 87.4 | 63.7 | apps 5 (p0.91), goals 0 (p0.47), award 0.00, finish — · stature idx 0.750/w 1.00 |
| 17 | Cannavaro (Italy 2002) ★ | DF | 93 | stature | 87.0 | 49.6 | apps 3 (p0.62), goals 0 (p0.46), award 0.00, finish — · stature idx 0.827/w 1.00 |
| 18 | Cannavaro (Italy 2010) ★ | DF | 93 | stature | 87.0 | 50.8 | apps 3 (p0.64), goals 0 (p0.46), award 0.00, finish — · stature idx 0.827/w 1.00 |
| 19 | van Dijk (Netherlands 2022) ★ | DF | 93 | stature | 86.2 | 64.4 | apps 5 (p0.92), goals 0 (p0.46), award 0.00, finish — · stature idx 0.737/w 1.00 |
| 20 | Hanappi (Austria 1958) | DF | 93 | stature | 86.2 | 39.4 | apps 3 (p0.40), goals 0 (p0.48), award 0.00, finish — · stature idx 0.809/w 1.00 |
| 21 | Santos (Brazil 1966) | DF | 93 | stature | 85.7 | 39.4 | apps 2 (p0.40), goals 0 (p0.48), award 0.00, finish — · stature idx 0.805/w 1.00 |
| 22 | Maldini (Italy 2002) ★ | DF | 93 | stature | 85.7 | 59.5 | apps 4 (p0.82), goals 0 (p0.46), award 0.00, finish — · stature idx 0.750/w 1.00 |
| 23 | Santos (Brazil 1958) | DF | 92 | stature | 85.0 | 87.7 | apps 6 (p0.91), goals 1 (p0.98), award 0.00, finish 1.00 · stature idx 0.684/w 1.00 |
| 24 | Santos (Brazil 1962) | DF | 92 | stature | 85.0 | 88.3 | apps 6 (p0.92), goals 0 (p0.49), award 0.00, finish 1.00 · stature idx 0.684/w 1.00 |
| 25 | Happel (Austria 1954) | DF | 92 | stature | 83.8 | 70.0 | apps 4 (p0.77), goals 0 (p0.48), award 0.00, finish 0.55 · stature idx 0.665/w 1.00 |

## T1-c Top 25 — MF (n=3741)
| # | card | pos | OVR | basis | internal | raw(uncap) | merit inputs |
|---|---|---|---|---|---|---|---|
| 1 | Modrić (Croatia 2018) ★ | MF | 99 | stature | 100.0 | 100.0 | apps 7 (p0.99), goals 2 (p0.99), award 1.00, finish 0.75 [Golden Ball] · stature idx 0.898/w 1.00 |
| 2 | Modrić (Croatia 2022) ★ | MF | 99 | stature | 100.0 | 76.5 | apps 7 (p0.98), goals 0 (p0.44), award 0.50, finish 0.55 [Bronze Ball] · stature idx 0.898/w 1.00 |
| 3 | Modrić (Croatia 2026) ★ | MF | 99 | stature | 100.0 | 88.8 | caps 197 (p1.00), goals 28 (p0.99), age 40 (af 0.80), lg 0.90 · stature idx 0.898/w 1.00 |
| 4 | Matthäus (West Germany 1986) ★ | MF | 99 | stature | 100.0 | 77.2 | apps 7 (p0.98), goals 1 (p0.88), award 0.00, finish 0.75 · stature idx 0.891/w 1.00 |
| 5 | Matthäus (West Germany 1990) ★ | MF | 99 | stature | 100.0 | 98.8 | apps 7 (p0.98), goals 4 (p0.99), award 0.70, finish 1.00 [Silver Ball] · stature idx 0.891/w 1.00 |
| 6 | Matthäus (Germany 1994) ★ | MF | 99 | stature | 100.0 | 63.0 | apps 5 (p0.89), goals 1 (p0.90), award 0.00, finish — · stature idx 0.891/w 1.00 |
| 7 | Zidane (France 1998) ★ | MF | 99 | stature | 100.0 | 80.6 | apps 5 (p0.90), goals 2 (p0.97), award 0.00, finish 1.00 · stature idx 0.928/w 1.00 |
| 8 | Zidane (France 2006) ★ | MF | 99 | stature | 100.0 | 100.0 | apps 6 (p0.95), goals 3 (p1.00), award 1.00, finish 0.75 [Golden Ball] · stature idx 0.928/w 1.00 |
| 9 | Beckenbauer (West Germany 1966) ★ | MF | 99 | stature | 100.0 | 94.8 | apps 6 (p0.94), goals 4 (p1.00), award 0.75, finish 0.75 [Best Young Player,Bronze Boot] · stature idx 0.889/w 1.00 |
| 10 | Beckenbauer (West Germany 1970) ★ | MF | 99 | stature | 100.0 | 71.1 | apps 5 (p0.89), goals 1 (p0.87), award 0.00, finish 0.55 · stature idx 0.889/w 1.00 |
| 11 | Maradona (Argentina 1982) ★ | MF | 99 | stature | 100.0 | 63.3 | apps 5 (p0.87), goals 2 (p0.95), award 0.00, finish — · stature idx 0.952/w 1.00 |
| 12 | Maradona (Argentina 1986) ★ | MF | 99 | stature | 100.0 | 100.0 | apps 7 (p0.98), goals 5 (p1.00), award 1.00, finish 1.00 [Golden Ball,Silver Boot] · stature idx 0.952/w 1.00 |
| 13 | Maradona (Argentina 1990) ★ | MF | 99 | stature | 100.0 | 79.1 | apps 7 (p0.98), goals 0 (p0.41), award 0.50, finish 0.75 [Bronze Ball] · stature idx 0.952/w 1.00 |
| 14 | Ronaldinho (Brazil 2002) ★ | MF | 99 | stature | 99.4 | 81.3 | apps 5 (p0.92), goals 2 (p0.98), award 0.00, finish 1.00 · stature idx 0.870/w 1.00 |
| 15 | Meazza (Italy 1934) ★ | MF | 98 | stature | 99.0 | 83.2 | apps 5 (p0.98), goals 2 (p0.99), award 0.00, finish 1.00 · stature idx 0.865/w 1.00 |
| 16 | Meazza (Italy 1938) ★ | MF | 98 | stature | 99.0 | 81.8 | apps 4 (p0.94), goals 1 (p0.98), award 0.00, finish 1.00 · stature idx 0.865/w 1.00 |
| 17 | Zico (Brazil 1978) ★ | MF | 98 | stature | 98.6 | 70.2 | apps 6 (p0.86), goals 1 (p0.86), award 0.00, finish 0.55 · stature idx 0.859/w 1.00 |
| 18 | Zico (Brazil 1982) ★ | MF | 98 | stature | 98.6 | 74.1 | apps 5 (p0.87), goals 4 (p1.00), award 0.45, finish — [Bronze Boot] · stature idx 0.859/w 1.00 |
| 19 | Maradona (Argentina 1994) ★ | MF | 98 | stature | 98.2 | 47.0 | apps 2 (p0.34), goals 1 (p0.90), award 0.00, finish — · stature idx 0.952/w 1.00 |
| 20 | Kopa (France 1958) ★ | MF | 98 | stature | 97.6 | 74.8 | apps 6 (p0.94), goals 3 (p0.98), award 0.00, finish 0.55 · stature idx 0.843/w 1.00 |
| 21 | Iniesta (Spain 2010) ★ | MF | 98 | stature | 97.3 | 82.1 | apps 6 (p0.95), goals 2 (p0.98), award 0.00, finish 1.00 · stature idx 0.839/w 1.00 |
| 22 | Rivaldo (Brazil 1998) ★ | MF | 97 | stature | 96.7 | 79.4 | apps 7 (p0.98), goals 3 (p1.00), award 0.00, finish 0.75 · stature idx 0.830/w 1.00 |
| 23 | Rivaldo (Brazil 2002) ★ | MF | 97 | stature | 96.7 | 96.6 | apps 7 (p0.98), goals 5 (p1.00), award 0.60, finish 1.00 [Silver Boot] · stature idx 0.830/w 1.00 |
| 24 | Bozsik (Hungary 1954) | MF | 97 | stature | 96.6 | 67.1 | apps 5 (p0.91), goals 0 (p0.47), award 0.00, finish 0.75 · stature idx 0.829/w 1.00 |
| 25 | Xavi (Spain 2010) ★ | MF | 97 | stature | 95.7 | 72.4 | apps 7 (p0.98), goals 0 (p0.43), award 0.00, finish 1.00 · stature idx 0.815/w 1.00 |

## T1-c Top 25 — FW (n=3159)
| # | card | pos | OVR | basis | internal | raw(uncap) | merit inputs |
|---|---|---|---|---|---|---|---|
| 1 | Kocsis (Hungary 1954) ★ | FW | 99 | stature | 100.0 | 97.2 | apps 5 (p0.94), goals 11 (p1.00), award 0.90, finish 0.75 [Golden Boot] · stature idx 0.992/w 1.00 |
| 2 | Puskás (Hungary 1954) ★ | FW | 99 | stature | 100.0 | 74.9 | apps 3 (p0.71), goals 4 (p0.95), award 0.00, finish 0.75 · stature idx 0.886/w 1.00 |
| 3 | Messi (Argentina 2006) ★ | FW | 99 | stature | 100.0 | 55.0 | apps 3 (p0.60), goals 1 (p0.77), award 0.00, finish — · stature idx 0.938/w 1.00 |
| 4 | Messi (Argentina 2014) ★ | FW | 99 | stature | 100.0 | 99.2 | apps 7 (p0.99), goals 4 (p0.98), award 1.00, finish 0.75 [Golden Ball] · stature idx 0.938/w 1.00 |
| 5 | Messi (Argentina 2018) ★ | FW | 99 | stature | 100.0 | 58.3 | apps 4 (p0.81), goals 1 (p0.79), award 0.00, finish — · stature idx 0.938/w 1.00 |
| 6 | Messi (Argentina 2022) ★ | FW | 99 | stature | 100.0 | 100.0 | apps 7 (p0.98), goals 7 (p0.99), award 1.00, finish 1.00 [Golden Ball,Silver Boot] · stature idx 0.938/w 1.00 |
| 7 | Messi (Argentina 2026) ★ | FW | 99 | stature | 100.0 | 76.2 | caps 198 (p1.00), goals 116 (p1.00), age 38 (af 0.80), lg 0.58 · stature idx 0.938/w 1.00 |
| 8 | Rummenigge (West Germany 1978) ★ | FW | 99 | stature | 100.0 | 63.2 | apps 5 (p0.80), goals 3 (p0.93), award 0.00, finish — · stature idx 0.889/w 1.00 |
| 9 | Rummenigge (West Germany 1982) ★ | FW | 99 | stature | 100.0 | 95.4 | apps 7 (p0.98), goals 5 (p0.99), award 0.80, finish 0.75 [Bronze Ball,Silver Boot] · stature idx 0.889/w 1.00 |
| 10 | Rummenigge (West Germany 1986) ★ | FW | 99 | stature | 100.0 | 71.8 | apps 7 (p0.98), goals 1 (p0.78), award 0.00, finish 0.75 · stature idx 0.889/w 1.00 |
| 11 | Ronaldo (Brazil 1998) ★ | FW | 99 | stature | 100.0 | 98.7 | apps 7 (p0.98), goals 4 (p0.97), award 1.00, finish 0.75 [Golden Ball] · stature idx 0.913/w 1.00 |
| 12 | Ronaldo (Brazil 2002) ★ | FW | 99 | stature | 100.0 | 100.0 | apps 7 (p0.98), goals 8 (p1.00), award 0.97, finish 1.00 [Golden Boot,Silver Ball] · stature idx 0.913/w 1.00 |
| 13 | Ronaldo (Brazil 2006) ★ | FW | 99 | stature | 100.0 | 75.2 | apps 5 (p0.92), goals 3 (p0.97), award 0.45, finish — [Bronze Boot] · stature idx 0.913/w 1.00 |
| 14 | Piola (Italy 1938) | FW | 99 | stature | 100.0 | 94.9 | apps 4 (p0.96), goals 5 (p0.98), award 0.60, finish 1.00 [Silver Boot] · stature idx 0.911/w 1.00 |
| 15 | Müller (West Germany 1970) ★ | FW | 99 | stature | 100.0 | 94.0 | apps 6 (p0.95), goals 10 (p0.99), award 0.90, finish 0.55 [Golden Boot] · stature idx 0.887/w 1.00 |
| 16 | Müller (West Germany 1974) ★ | FW | 99 | stature | 100.0 | 82.1 | apps 7 (p0.96), goals 4 (p0.96), award 0.00, finish 1.00 · stature idx 0.887/w 1.00 |
| 17 | Eusébio (Portugal 1966) ★ | FW | 99 | stature | 100.0 | 94.1 | apps 6 (p0.96), goals 9 (p0.99), award 0.90, finish 0.55 [Golden Boot] · stature idx 0.879/w 1.00 |
| 18 | Rossi (Italy 1978) ★ | FW | 99 | stature | 99.9 | 85.6 | apps 7 (p0.97), goals 3 (p0.93), award 0.70, finish 0.40 [Silver Ball] · stature idx 0.879/w 1.00 |
| 19 | Rossi (Italy 1982) ★ | FW | 99 | stature | 99.9 | 100.0 | apps 7 (p0.98), goals 6 (p1.00), award 1.00, finish 1.00 [Golden Ball,Golden Boot] · stature idx 0.879/w 1.00 |
| 20 | Ronaldo (Portugal 2006) ★ | FW | 99 | stature | 99.9 | 65.5 | apps 6 (p0.95), goals 1 (p0.77), award 0.00, finish 0.40 · stature idx 0.878/w 1.00 |
| 21 | Ronaldo (Portugal 2018) ★ | FW | 99 | stature | 99.9 | 65.0 | apps 4 (p0.81), goals 4 (p0.98), award 0.00, finish — · stature idx 0.878/w 1.00 |
| 22 | Ronaldo (Portugal 2022) ★ | FW | 99 | stature | 99.8 | 57.8 | apps 5 (p0.89), goals 1 (p0.75), award 0.00, finish — · stature idx 0.878/w 1.00 |
| 23 | Albert (Hungary 1962) | FW | 99 | stature | 99.5 | 82.2 | apps 3 (p0.67), goals 4 (p0.98), award 0.95, finish — [Best Young Player,Golden Boot] · stature idx 0.872/w 1.00 |
| 24 | Ronaldo (Portugal 2010) ★ | FW | 99 | stature | 99.4 | 58.7 | apps 4 (p0.81), goals 1 (p0.81), award 0.00, finish — · stature idx 0.878/w 1.00 |
| 25 | Scarone (Uruguay 1930) ★ | FW | 98 | stature | 98.9 | 73.2 | apps 3 (p0.78), goals 1 (p0.77), award 0.00, finish 1.00 · stature idx 0.864/w 1.00 |

---

## C. T2 — All-time-greats coverage checklist

Archive = 791 players (career-stature-2.1.0). Legend band = **302 legend cards over
112 distinct players** (292 historical + 10 projected cards).

### Annotations

- **Consensus greats whose index is facially too LOW for their tier:** Pelé 0.807
  (rank 45, **silver** — below 8 entries that are not in any serious all-time top-50),
  Cruyff 0.755 (rank 60), Garrincha 0.723, Di Stéfano 0.774, Yashin 0.738,
  Charlton 0.748, van Basten 0.781. Common signature: pre-1995 non-European-club or
  non-European players (Ballon d'Or eligibility), or careers whose recognition
  predates the structured-award era.
- **Entries facially too HIGH for their index neighborhood:** Kocsis 0.992 (#1),
  Piola 0.911 (#6), Albert 0.872 (#16), Scarone 0.864, Zizinho 0.863,
  Schiaffino/Matthews/Kopa 0.843, Owen 0.789 (#50 — above Cruyff), Boniperti 0.780
  (2 facts), Ocwirk/Andrade/Hanappi 0.809 (2 facts each). Sparse-fact,
  retrospective-selection-heavy profiles.
- **NOT-LEGEND inconsistencies (94–99 cards without the badge):** Piola (99), Albert
  (99), Walter (97), Bozsik (97), Cea (97), Ocwirk (97), Andrade (97), Hanappi (96),
  Santos (95), Boniperti (94). Whatever 12b does to the index, the legend flag and
  the 90+ display band should not disagree this often at the top.
- **Consensus great with best card BELOW 90:** none inside the archive top-60 (floor
  is Rijkaard 88 just outside it, §T2-b) — but **Klose** (WC all-time top scorer)
  never enters this table at all: index 0.395, one fact short of the 0.40 material
  gate, best card 88 (§F).

## T2-a Top 60 by career-stature index
| # | player | pos | index | tier | legend | best hist card (yr) | 2026 card | facts | fact families | flag |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Kocsis | None | 0.992 | gold | Y | 99 (1954) | — | 5 | international_record,retrospective_selection,wc_legacy | ok |
| 2 | Maradona | MF | 0.952 | gold | Y | 99 (1982) | — | 20 | captaincy,global_annual_recognition,international_record,regional_annual_recognition,retrospective_selection,wc_legacy | ok |
| 3 | Messi | FW | 0.938 | gold | Y | 99 (2006) | 99 | 69 | global_annual_recognition,international_record,position_balanced_selection,retrospective_selection,wc_legacy | ok |
| 4 | Zidane | MF | 0.928 | gold | Y | 99 (1998) | — | 23 | global_annual_recognition,international_record,position_balanced_selection,retrospective_selection,wc_legacy | ok |
| 5 | Ronaldo | FW | 0.913 | gold | Y | 99 (1998) | — | 16 | global_annual_recognition,international_record,position_balanced_selection,retrospective_selection,wc_legacy | ok |
| 6 | Piola | None | 0.911 | gold | n | 99 (1938) | — | 4 | international_record,retrospective_selection,wc_legacy | NOT-LEGEND |
| 7 | Modrić | MF | 0.898 | gold | Y | 99 (2018) | 99 | 19 | captaincy,global_annual_recognition,international_record,position_balanced_selection,wc_legacy | ok |
| 8 | Matthäus | MF | 0.891 | gold | Y | 99 (1986) | — | 14 | captaincy,global_annual_recognition,international_record,retrospective_selection,wc_legacy | ok |
| 9 | Rummenigge | None | 0.889 | gold | Y | 99 (1978) | — | 11 | global_annual_recognition,international_record,retrospective_selection,wc_legacy | ok |
| 10 | Beckenbauer | DF | 0.889 | gold | Y | 99 (1966) | — | 12 | captaincy,global_annual_recognition,international_record,retrospective_selection,wc_legacy | ok |
| 11 | Müller | None | 0.887 | gold | Y | 99 (1970) | — | 7 | global_annual_recognition,international_record,retrospective_selection,wc_legacy | ok |
| 12 | Puskás | None | 0.886 | gold | Y | 99 (1954) | — | 6 | international_record,retrospective_selection | ok |
| 13 | Eusébio | None | 0.879 | gold | Y | 99 (1966) | — | 6 | global_annual_recognition,international_record,retrospective_selection,wc_legacy | ok |
| 14 | Rossi | None | 0.879 | gold | Y | 99 (1978) | — | 8 | global_annual_recognition,retrospective_selection,wc_legacy | ok |
| 15 | Ronaldo | FW | 0.878 | gold | Y | 99 (2006) | 97 | 56 | global_annual_recognition,international_record,position_balanced_selection,retrospective_selection | ok |
| 16 | Albert | None | 0.872 | gold | n | 99 (1962) | — | 6 | global_annual_recognition,international_record,retrospective_selection,wc_legacy | NOT-LEGEND |
| 17 | Ronaldinho | MF | 0.870 | gold | Y | 99 (2002) | — | 20 | global_annual_recognition,international_record,position_balanced_selection,regional_annual_recognition,retrospective_selection | ok |
| 18 | Meazza | None | 0.865 | gold | Y | 98 (1934) | — | 4 | international_record,retrospective_selection | ok |
| 19 | Scarone | None | 0.864 | gold | Y | 98 (1930) | — | 2 | international_record,retrospective_selection | ok |
| 20 | Zizinho | None | 0.863 | gold | Y | 98 (1950) | — | 2 | international_record,retrospective_selection | ok |
| 21 | Romário | None | 0.862 | gold | Y | 98 (1994) | — | 8 | global_annual_recognition,international_record,regional_annual_recognition,retrospective_selection,wc_legacy | ok |
| 22 | Zico | None | 0.859 | gold | Y | 98 (1978) | — | 9 | global_annual_recognition,international_record,regional_annual_recognition,retrospective_selection,wc_legacy | ok |
| 23 | Mbappé | FW | 0.858 | gold | Y | 98 (2018) | 98 | 17 | global_annual_recognition,international_record,position_balanced_selection,wc_legacy | ok |
| 24 | Henry | FW | 0.857 | gold | Y | 98 (1998) | — | 15 | global_annual_recognition,international_record,position_balanced_selection,retrospective_selection | ok |
| 25 | Baggio | None | 0.854 | gold | Y | 98 (1990) | — | 6 | global_annual_recognition,retrospective_selection,wc_legacy | ok |
| 26 | Sindelar | None | 0.843 | gold | Y | 98 (1934) | — | 3 | retrospective_selection | ok |
| 27 | Schiaffino | None | 0.843 | gold | Y | 98 (1950) | — | 3 | retrospective_selection | ok |
| 28 | Matthews | None | 0.843 | gold | Y | 94 (1954) | — | 4 | global_annual_recognition,retrospective_selection | ok |
| 29 | Kopa | None | 0.843 | gold | Y | 98 (1958) | — | 5 | global_annual_recognition,retrospective_selection | ok |
| 30 | Iniesta | MF | 0.839 | gold | Y | 98 (2010) | — | 22 | global_annual_recognition,international_record,position_balanced_selection,retrospective_selection | ok |
| 31 | Walter | None | 0.832 | gold | n | 97 (1954) | — | 3 | international_record,retrospective_selection | NOT-LEGEND |
| 32 | Lewandowski | FW | 0.831 | gold | Y | 97 (2022) | — | 16 | global_annual_recognition,international_record,position_balanced_selection | ok |
| 33 | Rivaldo | MF | 0.830 | gold | Y | 97 (1998) | — | 8 | global_annual_recognition,international_record,position_balanced_selection,retrospective_selection,wc_legacy | ok |
| 34 | Kempes | None | 0.829 | gold | Y | 97 (1978) | — | 5 | global_annual_recognition,regional_annual_recognition,retrospective_selection,wc_legacy | ok |
| 35 | Bozsik | None | 0.829 | gold | n | 97 (1954) | — | 3 | international_record,retrospective_selection | NOT-LEGEND |
| 36 | Cannavaro | DF | 0.827 | gold | Y | 96 (2006) | — | 7 | captaincy,global_annual_recognition,international_record,position_balanced_selection,wc_legacy | ok |
| 37 | Shevchenko | FW | 0.823 | gold | Y | 97 (2006) | — | 10 | global_annual_recognition,international_record,position_balanced_selection,retrospective_selection | ok |
| 38 | Cea | None | 0.822 | gold | n | 97 (1930) | — | 2 | retrospective_selection,wc_legacy | NOT-LEGEND |
| 39 | Nedvěd | MF | 0.818 | gold | Y | 93 (2006) | — | 9 | global_annual_recognition,position_balanced_selection,retrospective_selection | ok |
| 40 | Figo | MF | 0.816 | gold | Y | 96 (2006) | — | 9 | global_annual_recognition,international_record,position_balanced_selection,retrospective_selection | ok |
| 41 | Xavi | MF | 0.815 | gold | Y | 97 (2010) | — | 18 | global_annual_recognition,international_record,position_balanced_selection,retrospective_selection | ok |
| 42 | Ocwirk | None | 0.809 | gold | n | 97 (1954) | — | 2 | retrospective_selection | NOT-LEGEND |
| 43 | Andrade | None | 0.809 | gold | n | 97 (1930) | — | 2 | retrospective_selection | NOT-LEGEND |
| 44 | Hanappi | None | 0.809 | gold | n | 96 (1954) | — | 2 | retrospective_selection | NOT-LEGEND |
| 45 | Pelé | None | 0.807 | silver | Y | 97 (1958) | — | 8 | international_record,regional_annual_recognition,retrospective_selection,wc_legacy | ok |
| 46 | Santos | DF | 0.805 | silver | n | 95 (1962) | — | 4 | retrospective_selection,wc_legacy | NOT-LEGEND |
| 47 | Platini | MF | 0.804 | silver | Y | 96 (1982) | — | 16 | global_annual_recognition,international_record,retrospective_selection | ok |
| 48 | Salah | FW | 0.800 | silver | Y | 96 (2018) | 96 | 9 | captaincy,global_annual_recognition,international_record,position_balanced_selection,regional_annual_recognition | ok |
| 49 | Kaká | MF | 0.799 | silver | Y | 96 (2006) | — | 11 | global_annual_recognition,position_balanced_selection | ok |
| 50 | Owen | FW | 0.789 | silver | Y | 96 (1998) | — | 7 | global_annual_recognition,international_record,position_balanced_selection,retrospective_selection,wc_legacy | ok |
| 51 | Cubillas | None | 0.786 | silver | Y | 96 (1970) | — | 7 | regional_annual_recognition,retrospective_selection,wc_legacy | ok |
| 52 | van Basten | None | 0.781 | silver | Y | 93 (1990) | — | 16 | global_annual_recognition,retrospective_selection | ok |
| 53 | Keegan | None | 0.781 | silver | Y | 92 (1982) | — | 10 | global_annual_recognition,retrospective_selection | ok |
| 54 | Boniperti | None | 0.780 | silver | n | 94 (1954) | — | 2 | retrospective_selection | NOT-LEGEND |
| 55 | Gullit | None | 0.780 | silver | Y | 95 (1990) | — | 9 | global_annual_recognition,retrospective_selection | ok |
| 56 | Buffon | GK | 0.777 | silver | Y | 93 (2002) | — | 17 | international_record,position_balanced_selection,retrospective_selection,wc_legacy | ok |
| 57 | Drogba | FW | 0.776 | silver | Y | 95 (2010) | — | 8 | global_annual_recognition,international_record,position_balanced_selection,regional_annual_recognition | ok |
| 58 | Di Stéfano | MF | 0.774 | silver | Y | 92 (1962) | — | 6 | global_annual_recognition,retrospective_selection | ok |
| 59 | Law | None | 0.760 | silver | Y | 91 (1974) | — | 4 | global_annual_recognition,international_record,retrospective_selection | ok |
| 60 | Cruyff | FW | 0.755 | silver | Y | 95 (1974) | — | 5 | global_annual_recognition,retrospective_selection | ok |

## T2-b Legend-band members with the WEAKEST best card (bottom 20 of the band)
| # | best card | pos | OVR | basis | cs index |
|---|---|---|---|---|---|
| 1 | Rijkaard (Netherlands 1994) ★ | MF | 88 | stature | 0.487 |
| 2 | van Nistelrooy (Netherlands 2006) ★ | FW | 89 | stature | 0.517 |
| 3 | Sánchez (Mexico 1986) ★ | FW | 89 | stature | 0.500 |
| 4 | Silva (Brazil 2014) ★ | DF | 89 | stature | 0.521 |
| 5 | Čech (Czech Republic 2006) ★ | GK | 89 | stature | 0.528 |
| 6 | Rodri (Spain 2022) ★ | MF | 89 | stature | 0.527 |
| 7 | Ibrahimović (Sweden 2006) ★ | FW | 89 | stature | 0.560 |
| 8 | Fàbregas (Spain 2010) ★ | MF | 89 | stature | 0.504 |
| 9 | Seedorf (Netherlands 1998) ★ | MF | 89 | stature | 0.537 |
| 10 | Dembélé (France 2018) ★ | FW | 89 | stature | 0.507 |
| 11 | Sammer (Germany 1994) ★ | DF | 90 | stature | 0.600 |
| 12 | Suárez (Uruguay 2010) ★ | FW | 90 | stature | 0.537 |
| 13 | Schmeichel (Denmark 1998) ★ | GK | 90 | stature | 0.575 |
| 14 | Kroos (Germany 2014) ★ | MF | 90 | stature | 0.525 |
| 15 | De Bruyne (Belgium 2018) ★ | MF | 90 | stature | 0.551 |
| 16 | Nesta (Italy 2006) ★ | DF | 90 | stature | 0.542 |
| 17 | Thuram (France 1998) ★ | DF | 90 | stature | 0.560 |
| 18 | Seeler (West Germany 1958) ★ | FW | 90 | stature | 0.537 |
| 19 | Piqué (Spain 2010) ★ | DF | 90 | stature | 0.526 |
| 20 | Passarella (Argentina 1978) ★ | DF | 90 | stature | 0.529 |

### T2-b annotations

The band floor (88–90) members above are all plausible legend-band *members*; the
question they raise is compression (legend floor 88 = the ceiling pile display), not
membership. Weakest membership on face: **Dembélé (France 2018) 89** — a fine career
but `legend` next to Rijkaard/Sammer/Passarella reads loose. **Rodri (Spain 2022) 89
as the band entry for the reigning Ballon d'Or holder** is the inverse problem: his
2024 award postdates the frozen archive (peak-year max 2022 — Audit-1 C1), and his
2026 card lost the badge entirely to the link miss (§H.3).


---

## D. T3 — Divergence lists

### T3-a annotations (underrated — top 25)

The list is exactly what the ceiling predicts, with names attached:

- **#1–3 are championship-final award/anchor performances clamped from 99 to 88:**
  Schumacher-1986 (7 apps, Silver Ball, finalist), **E. Martínez-2022 (Golden Glove,
  CHAMPION — the model's single largest input-vs-display gap among winners)**,
  Vavá-1962 (Golden Boot-class champion FW). All three: stature idx below material →
  weight 0 → `min(raw, 0.62)`.
- **#4–10 include stature cards whose great tournament outruns their stature target**
  (Courtois-2018 89 vs implied 99, T. Müller-2014 90, Villa-2010 90, Barthez-1998 91,
  Thuram-1998 90): the up-modulation cap (+0.06..0.08) cannot express a
  tournament-defining performance by a mid-index player. Plausibility: these six are
  the strongest "should be 92–95" candidates in the historical pool on pure face.
- **The 7-app champion GK block** (Marcos-2002, Pumpido-1986, Illgner-1990,
  Gilmar-1958, Taffarel-1994, Félix-1970, Fillol-1978… raw 94–95 → 88): winning-GK
  careers systematically lack archive rows (MV2-9 bias) so ALL ride the capped raw
  path. A whole face-validity class, not individual noise.
- 2026 entries in the list (B. Fernandes raw 98.9, Hwang 98.9, Tielemans 98.5…)
  reproduce Audit-1 §B.2's longevity-detector caveat: career-totals percentiles
  reward accumulation; treat the 2026 members as *candidates*, not a ranking.

### T3-b annotations (overrated — top 25)

Every top-25 entry is `stature` basis: display above inputs IS the stature design
working. The face-validity question is per-card:

- **Facially fine (great player, weak/injured tournament, stature carries):**
  Messi-2010 98, Zidane-2002 95, Maradona-1994 98, Ronaldo-1994 98 (squad member at
  17), Puskás-1962 95, Henry-2002/2010 94, Romário-1990 94, Zico-1986 95,
  Modrić-2006 94, Lewandowski-2018 94, Iniesta-2006 92, Xavi-2014 92.
  Whether a 0–2-app tournament should display within ~5 of the player's peak is the
  **down-cap design question** (§H.5), not an input error.
- **Facially questionable (the stature index itself is the doubt):** Matthews-1950 93
  / -1954 94, Boniperti-1950 91, Hidegkuti-1958 91, Keegan-1982 92, Law-1974 91,
  Rivera-1962 91 (age 18, 1 app), Cárdenas-1954 90, Braine-1938 90, Jonquet-1954 89,
  Szepan-1938 90 — sparse-fact archive rows expressing 89–94 on near-empty
  tournaments.
- **Eto'o-2014 89 / Šuker-2002 89 / Sánchez-1994 88 / Kahn-1994 89:** legends'
  end-of-career cameo cards displaying at/above the measured ceiling. Same down-cap
  class; listed because a drafter reads these as "this card's tournament was good",
  which is false.

## T3-a Underrated-100 — display furthest BELOW what the card's own merit inputs imply
(input-implied OVR = the display the card's uncapped input composite would earn on the production curve — historical: raw tournament composite; 2026: quantile-mapped projected raw WITHOUT the raw-only ceiling. The 2026 quantile-map target itself saturates at the historical raw-only ceiling, so 2026 ceiling victims rank by raw strength in T4 instead. Min-signal filter: ≥2 apps or ≥1 goal historical, ≥10 caps projected.)

| # | card | pos | cohort | OVR | input-implied OVR | Δ | basis | input pct | OVR pct | merit inputs |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Schumacher (West Germany 1986) | GK | 1986-94 | 88 | 99 | +11 | measured | 1.00 | 0.93 | apps 7 (p0.98), goals 0 (p0.50), award 0.70, finish 0.75 [Silver Ball] · stature idx 0.308/w 0.00 |
| 2 | Martínez (Argentina 2022) | GK | 2022-2026 | 88 | 99 | +11 | measured | 0.99 | 0.87 | apps 7 (p0.99), goals 0 (p0.50), award 0.85, finish 1.00 [Golden Glove] · stature idx 0.255/w 0.00 |
| 3 | Vavá (Brazil 1962) | FW | 1962-70 | 88 | 99 | +11 | measured | 1.00 | 0.88 | apps 6 (p0.96), goals 4 (p0.98), award 0.90, finish 1.00 [Golden Boot] · stature idx 0.396/w 0.00 |
| 4 | Courtois (Belgium 2018) | GK | 2010-2018 | 89 | 99 | +10 | stature | 0.99 | 0.97 | apps 7 (p0.99), goals 0 (p0.50), award 0.85, finish 0.55 [Golden Glove] · stature idx 0.552/w 1.00 |
| 5 | Müller (Germany 2014) | FW | 2010-2018 | 90 | 99 | +9 | stature | 1.00 | 0.95 | apps 7 (p0.99), goals 5 (p1.00), award 0.88, finish 1.00 [Silver Ball,Silver Boot] · stature idx 0.535/w 1.00 |
| 6 | Villa (Spain 2010) | FW | 2010-2018 | 90 | 99 | +9 | stature | 1.00 | 0.95 | apps 7 (p0.98), goals 5 (p0.99), award 0.80, finish 1.00 [Bronze Ball,Silver Boot] · stature idx 0.504/w 1.00 |
| 7 | Barthez (France 1998) | GK | 1998-2006 | 91 | 99 | +8 | stature | 0.99 | 0.97 | apps 7 (p0.98), goals 0 (p0.50), award 0.85, finish 1.00 [Golden Glove] · stature idx 0.650/w 1.00 |
| 8 | Thuram (France 1998) ★ | DF | 1998-2006 | 90 | 98 | +8 | stature | 1.00 | 0.98 | apps 6 (p0.95), goals 2 (p0.99), award 0.50, finish 1.00 [Bronze Ball] · stature idx 0.560/w 1.00 |
| 9 | Ademir (Brazil 1950) | FW | <=1958 | 90 | 98 | +8 | stature | 1.00 | 0.96 | apps 6 (p0.98), goals 9 (p1.00), award 0.90, finish 0.75 [Golden Boot] · stature idx 0.530/w 1.00 |
| 10 | Stábile (Argentina 1930) | FW | <=1958 | 90 | 98 | +8 | stature | 1.00 | 0.96 | apps 4 (p0.96), goals 8 (p1.00), award 0.90, finish 0.75 [Golden Boot] · stature idx 0.530/w 1.00 |
| 11 | Marcos (Brazil 2002) | GK | 1998-2006 | 88 | 96 | +8 | measured | 0.99 | 0.88 | apps 7 (p0.98), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 12 | Pumpido (Argentina 1986) | GK | 1986-94 | 88 | 96 | +8 | measured | 0.99 | 0.93 | apps 7 (p0.98), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 13 | Illgner (West Germany 1990) | GK | 1986-94 | 88 | 96 | +8 | measured | 0.99 | 0.93 | apps 7 (p0.98), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 14 | Gilmar (Brazil 1958) | GK | <=1958 | 88 | 96 | +8 | measured | 1.00 | 0.94 | apps 6 (p0.98), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 15 | Taffarel (Brazil 1994) | GK | 1986-94 | 88 | 96 | +8 | measured | 0.98 | 0.93 | apps 7 (p0.98), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx 0.096/w 0.00 |
| 16 | Morlock (West Germany 1954) | FW | <=1958 | 88 | 96 | +8 | measured | 0.99 | 0.89 | apps 5 (p0.94), goals 6 (p0.99), award 0.60, finish 1.00 [Silver Boot] · stature idx 0.360/w 0.17 |
| 17 | Jairzinho (Brazil 1970) | FW | 1962-70 | 88 | 96 | +8 | measured | 0.99 | 0.88 | apps 6 (p0.95), goals 7 (p0.98), award 0.60, finish 1.00 [Silver Boot] · stature idx 0.309/w 0.00 |
| 18 | Lloris (France 2018) | GK | 2010-2018 | 88 | 96 | +8 | measured | 0.99 | 0.88 | apps 6 (p0.97), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx 0.067/w 0.00 |
| 19 | Félix (Brazil 1970) | GK | 1962-70 | 88 | 96 | +8 | measured | 1.00 | 0.91 | apps 6 (p0.97), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 20 | Olivieri (Italy 1938) | GK | <=1958 | 88 | 96 | +8 | measured | 0.99 | 0.94 | apps 4 (p0.97), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 21 | Fillol (Argentina 1978) | GK | 1974-82 | 88 | 96 | +8 | measured | 0.99 | 0.90 | apps 7 (p0.97), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 22 | Klose (Germany 2006) | FW | 1998-2006 | 88 | 96 | +8 | measured | 0.99 | 0.87 | apps 7 (p0.98), goals 5 (p1.00), award 0.90, finish 0.55 [Golden Boot] · stature idx 0.395/w 0.00 |
| 23 | Combi (Italy 1934) | GK | <=1958 | 88 | 96 | +8 | measured | 0.99 | 0.94 | apps 5 (p0.97), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 24 | Schiavio (Italy 1934) | FW | <=1958 | 88 | 96 | +8 | measured | 0.99 | 0.89 | apps 4 (p0.90), goals 4 (p0.99), award 0.60, finish 1.00 [Silver Boot] · stature idx 0.360/w 0.17 |
| 25 | Fernández (Argentina 2022) | MF | 2022-2026 | 88 | 96 | +8 | measured | 1.00 | 0.93 | apps 7 (p0.98), goals 1 (p0.93), award 0.55, finish 1.00 [Best Young Player] · stature idx 0.165/w 0.00 |
| 26 | Maier (West Germany 1974) | GK | 1974-82 | 88 | 96 | +8 | stature | 0.99 | 0.90 | apps 7 (p0.96), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx 0.446/w 0.88 |
| 27 | Forlán (Uruguay 2010) | FW | 2010-2018 | 88 | 96 | +8 | measured | 0.99 | 0.89 | apps 7 (p0.98), goals 5 (p0.99), award 1.00, finish 0.40 [Golden Ball] · stature idx 0.376/w 0.00 |
| 28 | Míguez (Uruguay 1950) | FW | <=1958 | 88 | 96 | +8 | measured | 0.99 | 0.89 | apps 4 (p0.84), goals 5 (p0.99), award 0.60, finish 1.00 [Silver Boot] · stature idx 0.360/w 0.17 |
| 29 | Banks (England 1966) | GK | 1962-70 | 88 | 96 | +8 | stature | 0.99 | 0.91 | apps 6 (p0.95), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx 0.446/w 0.88 |
| 30 | Sánchez (Chile 1962) | FW | 1962-70 | 88 | 96 | +8 | measured | 0.98 | 0.88 | apps 6 (p0.96), goals 4 (p0.98), award 0.90, finish 0.55 [Golden Boot] · stature idx 0.396/w 0.00 |
| 31 | Neuer (Germany 2014) ★ | GK | 2010-2018 | 92 | 99 | +7 | stature | 0.99 | 0.99 | apps 7 (p0.98), goals 0 (p0.50), award 0.85, finish 1.00 [Golden Glove] · stature idx 0.733/w 1.00 |
| 32 | Kahn (Germany 2002) ★ | GK | 1998-2006 | 92 | 99 | +7 | stature | 0.99 | 0.99 | apps 7 (p0.98), goals 0 (p0.50), award 1.00, finish 0.75 [Golden Ball,Golden Glove] · stature idx 0.719/w 1.00 |
| 33 | Casillas (Spain 2010) ★ | GK | 2010-2018 | 92 | 99 | +7 | stature | 0.99 | 0.99 | apps 7 (p0.98), goals 0 (p0.50), award 0.85, finish 1.00 [Golden Glove] · stature idx 0.710/w 1.00 |
| 34 | Griezmann (France 2018) | FW | 2010-2018 | 92 | 99 | +7 | stature | 0.99 | 0.96 | apps 7 (p0.98), goals 4 (p0.98), award 0.80, finish 1.00 [Bronze Ball,Silver Boot] · stature idx 0.634/w 1.00 |
| 35 | Nejedlý (Czechoslovakia 1934) | FW | <=1958 | 90 | 97 | +7 | stature | 0.99 | 0.96 | apps 4 (p0.90), goals 5 (p1.00), award 0.90, finish 0.75 [Golden Boot] · stature idx 0.530/w 1.00 |
| 36 | Müller (Germany 2010) | MF | 2010-2018 | 90 | 97 | +7 | stature | 1.00 | 0.98 | apps 6 (p0.95), goals 5 (p1.00), award 0.95, finish 0.55 [Best Young Player,Golden Boot] · stature idx 0.535/w 1.00 |
| 37 | Zoff (Italy 1982) | GK | 1974-82 | 89 | 96 | +7 | stature | 1.00 | 0.99 | apps 7 (p0.98), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx 0.523/w 1.00 |
| 38 | Stoichkov (Bulgaria 1994) | FW | 1986-94 | 88 | 95 | +7 | stature | 0.99 | 0.88 | apps 7 (p0.96), goals 6 (p0.99), award 0.95, finish 0.40 [Bronze Ball,Golden Boot] · stature idx 0.426/w 0.71 |
| 39 | Gilmar (Brazil 1962) | GK | 1962-70 | 88 | 95 | +7 | measured | 0.98 | 0.91 | apps 6 (p0.92), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 40 | Turek (West Germany 1954) | GK | <=1958 | 88 | 95 | +7 | measured | 0.98 | 0.94 | apps 5 (p0.92), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 41 | Otamendi (Argentina 2022) | DF | 2022-2026 | 88 | 95 | +7 | measured | 0.99 | 0.93 | apps 7 (p0.99), goals 0 (p0.46), award 0.00, finish 1.00 · stature idx 0.253/w 0.00 |
| 42 | Romero (Argentina 2022) | DF | 2022-2026 | 88 | 95 | +7 | measured | 0.99 | 0.93 | apps 7 (p0.99), goals 0 (p0.46), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 43 | Molina (Argentina 2022) | DF | 2022-2026 | 88 | 95 | +7 | measured | 0.99 | 0.93 | apps 7 (p0.99), goals 1 (p0.96), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 44 | Varane (France 2018) | DF | 2010-2018 | 88 | 95 | +7 | measured | 1.00 | 0.92 | apps 7 (p0.99), goals 1 (p0.94), award 0.00, finish 1.00 · stature idx 0.225/w 0.00 |
| 45 | Hernandez (France 2018) | DF | 2010-2018 | 88 | 95 | +7 | measured | 1.00 | 0.92 | apps 7 (p0.99), goals 0 (p0.45), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 46 | Klose (Germany 2002) | FW | 1998-2006 | 88 | 95 | +7 | measured | 0.99 | 0.87 | apps 7 (p0.98), goals 5 (p0.99), award 0.60, finish 0.75 [Silver Boot] · stature idx 0.395/w 0.00 |
| 47 | Allemandi (Italy 1934) | DF | <=1958 | 88 | 95 | +7 | measured | 1.00 | 0.91 | apps 5 (p0.99), goals 0 (p0.48), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 48 | Lúcio (Brazil 2002) | DF | 1998-2006 | 88 | 95 | +7 | stature | 1.00 | 0.92 | apps 7 (p0.98), goals 0 (p0.46), award 0.00, finish 1.00 · stature idx 0.430/w 0.75 |
| 49 | Desailly (France 1998) | DF | 1998-2006 | 88 | 95 | +7 | measured | 0.99 | 0.92 | apps 7 (p0.98), goals 0 (p0.47), award 0.00, finish 1.00 · stature idx 0.160/w 0.00 |
| 50 | Sárosi (Hungary 1938) | FW | <=1958 | 88 | 95 | +7 | measured | 0.98 | 0.89 | apps None (p—), goals 5 (p0.98), award 0.60, finish 0.75 [Silver Boot] · stature idx 0.360/w 0.17 |
| 51 | Capdevila (Spain 2010) | DF | 2010-2018 | 88 | 95 | +7 | measured | 0.99 | 0.92 | apps 7 (p0.98), goals 0 (p0.46), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 52 | Boateng (Germany 2014) | DF | 2010-2018 | 88 | 95 | +7 | measured | 0.99 | 0.92 | apps 7 (p0.98), goals 0 (p0.47), award 0.00, finish 1.00 · stature idx 0.225/w 0.00 |
| 53 | Höwedes (Germany 2014) | DF | 2010-2018 | 88 | 95 | +7 | measured | 0.99 | 0.92 | apps 7 (p0.98), goals 0 (p0.47), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 54 | Jerković (Yugoslavia 1962) | FW | 1962-70 | 88 | 95 | +7 | measured | 0.98 | 0.88 | apps 6 (p0.96), goals 4 (p0.98), award 0.90, finish 0.40 [Golden Boot] · stature idx 0.396/w 0.00 |
| 55 | Santos (Brazil 1994) | DF | 1986-94 | 88 | 95 | +7 | measured | 1.00 | 0.90 | apps 7 (p0.98), goals 1 (p0.97), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 56 | Jorginho (Brazil 1994) | DF | 1986-94 | 88 | 95 | +7 | measured | 1.00 | 0.90 | apps 7 (p0.98), goals 0 (p0.48), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 57 | Aldair (Brazil 1994) | DF | 1986-94 | 88 | 95 | +7 | measured | 1.00 | 0.90 | apps 7 (p0.98), goals 0 (p0.48), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 58 | Zsengellér (Hungary 1938) | FW | <=1958 | 88 | 95 | +7 | stature | 0.98 | 0.89 | apps 4 (p0.96), goals 5 (p0.98), award 0.60, finish 0.75 [Silver Boot] · stature idx 0.438/w 0.82 |
| 59 | Augenthaler (West Germany 1990) | DF | 1986-94 | 88 | 95 | +7 | measured | 0.99 | 0.90 | apps 7 (p0.97), goals 0 (p0.47), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 60 | Buchwald (West Germany 1990) | DF | 1986-94 | 88 | 95 | +7 | measured | 0.99 | 0.90 | apps 7 (p0.97), goals 0 (p0.47), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 61 | Berthold (West Germany 1990) | DF | 1986-94 | 88 | 95 | +7 | measured | 0.99 | 0.90 | apps 7 (p0.97), goals 0 (p0.47), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 62 | Olarticoechea (Argentina 1986) | DF | 1986-94 | 88 | 95 | +7 | measured | 0.99 | 0.90 | apps 7 (p0.97), goals 0 (p0.47), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 63 | Brown (Argentina 1986) | DF | 1986-94 | 88 | 95 | +7 | measured | 0.99 | 0.90 | apps 7 (p0.97), goals 1 (p0.96), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 64 | Ruggeri (Argentina 1986) | DF | 1986-94 | 88 | 95 | +7 | measured | 0.99 | 0.90 | apps 7 (p0.97), goals 1 (p0.96), award 0.00, finish 1.00 · stature idx 0.140/w 0.00 |
| 65 | Rava (Italy 1938) | DF | <=1958 | 88 | 95 | +7 | measured | 0.99 | 0.91 | apps 4 (p0.97), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 66 | Buffon (Italy 2006) ★ | GK | 1998-2006 | 93 | 99 | +6 | stature | 0.99 | 1.00 | apps 7 (p0.98), goals 0 (p0.50), award 0.85, finish 1.00 [Golden Glove] · stature idx 0.777/w 1.00 |
| 67 | Sneijder (Netherlands 2010) ★ | MF | 2010-2018 | 92 | 98 | +6 | stature | 1.00 | 0.99 | apps 7 (p0.98), goals 5 (p1.00), award 0.83, finish 0.75 [Bronze Boot,Silver Ball] · stature idx 0.647/w 1.00 |
| 68 | Schillaci (Italy 1990) | FW | 1986-94 | 91 | 97 | +6 | stature | 1.00 | 0.96 | apps 7 (p0.99), goals 6 (p1.00), award 1.00, finish 0.55 [Golden Ball,Golden Boot] · stature idx 0.572/w 1.00 |
| 69 | Leônidas (Brazil 1938) | FW | <=1958 | 90 | 96 | +6 | stature | 0.99 | 0.96 | apps 4 (p0.96), goals 7 (p1.00), award 0.90, finish 0.55 [Golden Boot] · stature idx 0.530/w 1.00 |
| 70 | Haller (West Germany 1966) | FW | 1962-70 | 88 | 94 | +6 | measured | 0.98 | 0.88 | apps 5 (p0.91), goals 6 (p0.98), award 0.60, finish 0.75 [Silver Boot] · stature idx 0.264/w 0.00 |
| 71 | Cabrini (Italy 1982) | DF | 1974-82 | 88 | 94 | +6 | measured | 1.00 | 0.90 | apps 7 (p0.97), goals 1 (p0.95), award 0.00, finish 1.00 · stature idx 0.242/w 0.00 |
| 72 | Collovati (Italy 1982) | DF | 1974-82 | 88 | 94 | +6 | measured | 1.00 | 0.90 | apps 7 (p0.97), goals 0 (p0.45), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 73 | Scirea (Italy 1982) | DF | 1974-82 | 88 | 94 | +6 | measured | 1.00 | 0.90 | apps 7 (p0.97), goals 0 (p0.45), award 0.00, finish 1.00 · stature idx 0.360/w 0.17 |
| 74 | Tagliafico (Argentina 2022) | DF | 2022-2026 | 88 | 94 | +6 | measured | 0.99 | 0.93 | apps 6 (p0.96), goals 0 (p0.46), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 75 | Pavard (France 2018) | DF | 2010-2018 | 88 | 94 | +6 | measured | 0.99 | 0.92 | apps 6 (p0.96), goals 1 (p0.94), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 76 | Umtiti (France 2018) | DF | 2010-2018 | 88 | 94 | +6 | measured | 0.99 | 0.92 | apps 6 (p0.96), goals 1 (p0.94), award 0.00, finish 1.00 · stature idx 0.200/w 0.00 |
| 77 | Zambrotta (Italy 2006) | DF | 1998-2006 | 88 | 94 | +6 | measured | 0.99 | 0.92 | apps 6 (p0.96), goals 1 (p0.96), award 0.00, finish 1.00 · stature idx 0.345/w 0.04 |
| 78 | Grosso (Italy 2006) | DF | 1998-2006 | 88 | 94 | +6 | measured | 0.99 | 0.92 | apps 6 (p0.96), goals 1 (p0.96), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 79 | Ghiggia (Uruguay 1950) | FW | <=1958 | 88 | 94 | +6 | measured | 0.98 | 0.89 | apps 4 (p0.84), goals 4 (p0.97), award 0.45, finish 1.00 [Bronze Boot] · stature idx 0.270/w 0.00 |
| 80 | Edmílson (Brazil 2002) | DF | 1998-2006 | 88 | 94 | +6 | measured | 0.99 | 0.92 | apps 6 (p0.96), goals 1 (p0.96), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 81 | Júnior (Brazil 2002) | DF | 1998-2006 | 88 | 94 | +6 | measured | 0.99 | 0.92 | apps 6 (p0.96), goals 0 (p0.46), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 82 | Galván (Argentina 1978) | DF | 1974-82 | 88 | 94 | +6 | measured | 0.99 | 0.90 | apps 7 (p0.95), goals 0 (p0.46), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 83 | Olguín (Argentina 1978) | DF | 1974-82 | 88 | 94 | +6 | measured | 0.99 | 0.90 | apps 7 (p0.95), goals 0 (p0.46), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 84 | Tarantini (Argentina 1978) | DF | 1974-82 | 88 | 94 | +6 | measured | 0.99 | 0.90 | apps 7 (p0.95), goals 1 (p0.95), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 85 | Lizarazu (France 1998) | DF | 1998-2006 | 88 | 94 | +6 | measured | 0.99 | 0.92 | apps 6 (p0.95), goals 1 (p0.96), award 0.00, finish 1.00 · stature idx 0.335/w 0.00 |
| 86 | Wilson (England 1966) | DF | 1962-70 | 88 | 94 | +6 | measured | 0.99 | 0.90 | apps 6 (p0.95), goals 0 (p0.48), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 87 | Charlton (England 1966) | DF | 1962-70 | 88 | 94 | +6 | measured | 0.99 | 0.90 | apps 6 (p0.95), goals 0 (p0.48), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 88 | Cohen (England 1966) | DF | 1962-70 | 88 | 94 | +6 | measured | 0.99 | 0.90 | apps 6 (p0.95), goals 0 (p0.48), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 89 | Brito (Brazil 1970) | DF | 1962-70 | 88 | 94 | +6 | measured | 0.98 | 0.90 | apps 6 (p0.95), goals 0 (p0.46), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 90 | Mertesacker (Germany 2014) | DF | 2010-2018 | 88 | 94 | +6 | measured | 0.98 | 0.92 | apps 6 (p0.95), goals 0 (p0.47), award 0.00, finish 1.00 · stature idx 0.047/w 0.00 |
| 91 | Hummels (Germany 2014) | DF | 2010-2018 | 88 | 94 | +6 | measured | 0.98 | 0.92 | apps 6 (p0.95), goals 2 (p1.00), award 0.00, finish 1.00 · stature idx 0.320/w 0.00 |
| 92 | Schwarzenbeck (West Germany 1974) | DF | 1974-82 | 88 | 94 | +6 | measured | 0.98 | 0.90 | apps 7 (p0.94), goals 0 (p0.47), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 93 | Vogts (West Germany 1974) | DF | 1974-82 | 88 | 94 | +6 | measured | 0.98 | 0.90 | apps 7 (p0.94), goals 0 (p0.47), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 94 | Brehme (West Germany 1990) | DF | 1986-94 | 88 | 94 | +6 | measured | 0.98 | 0.90 | apps 6 (p0.93), goals 3 (p1.00), award 0.00, finish 1.00 · stature idx 0.360/w 0.17 |
| 95 | Reuter (West Germany 1990) | DF | 1986-94 | 88 | 94 | +6 | measured | 0.98 | 0.90 | apps 6 (p0.93), goals 0 (p0.47), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 96 | Cuciuffo (Argentina 1986) | DF | 1986-94 | 88 | 94 | +6 | measured | 0.98 | 0.90 | apps 6 (p0.93), goals 0 (p0.47), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 97 | Martínez (Argentina 2022) | DF | 2022-2026 | 88 | 94 | +6 | measured | 0.98 | 0.93 | apps 5 (p0.92), goals 0 (p0.46), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 98 | Gentile (Italy 1982) | DF | 1974-82 | 88 | 94 | +6 | measured | 0.97 | 0.90 | apps 6 (p0.92), goals 0 (p0.45), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 99 | Zózimo (Brazil 1962) | DF | 1962-70 | 88 | 94 | +6 | measured | 0.98 | 0.90 | apps 6 (p0.92), goals 0 (p0.49), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 100 | Żmuda (Poland 1974) | DF | 1974-82 | 88 | 94 | +6 | measured | 0.97 | 0.90 | apps 7 (p0.94), goals 0 (p0.47), award 0.55, finish 0.55 [Best Young Player] · stature idx 0.242/w 0.00 |

## T3-b Overrated-100 — display furthest ABOVE what the card's own merit inputs imply
(Display above inputs = the career-stature path is carrying the card. EXPECTED for true greats in weak tournaments — the annotations call out which entries are facially fine and which are not.)

| # | card | pos | cohort | OVR | input-implied OVR | Δ | basis | input pct | OVR pct | merit inputs |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Messi (Argentina 2010) ★ | FW | 2010-2018 | 98 | 73 | -25 | stature | 0.61 | 0.99 | apps 5 (p0.92), goals 0 (p0.36), award 0.00, finish — · stature idx 0.938/w 1.00 |
| 2 | Zidane (France 2002) ★ | MF | 1998-2006 | 95 | 71 | -24 | stature | 0.20 | 0.99 | apps 1 (p0.23), goals 0 (p0.43), award 0.00, finish — · stature idx 0.928/w 1.00 |
| 3 | Henry (France 2002) ★ | FW | 1998-2006 | 94 | 71 | -23 | stature | 0.25 | 0.97 | apps 2 (p0.31), goals 0 (p0.32), award 0.00, finish — · stature idx 0.857/w 1.00 |
| 4 | Romário (Brazil 1990) ★ | FW | 1986-94 | 94 | 71 | -23 | stature | 0.29 | 0.98 | apps 1 (p0.26), goals 0 (p0.36), award 0.00, finish — · stature idx 0.862/w 1.00 |
| 5 | Rossi (Italy 1986) ★ | FW | 1986-94 | 94 | 71 | -23 | stature | 0.06 | 0.98 | apps 0 (p0.07), goals 0 (p0.34), award 0.00, finish — · stature idx 0.879/w 1.00 |
| 6 | Ronaldo (Brazil 1994) ★ | FW | 1986-94 | 98 | 76 | -22 | stature | 0.61 | 0.99 | apps 0 (p0.07), goals 0 (p0.30), award 0.00, finish 1.00 · stature idx 0.913/w 1.00 |
| 7 | Maradona (Argentina 1994) ★ | MF | 1986-94 | 98 | 76 | -22 | stature | 0.57 | 0.99 | apps 2 (p0.34), goals 1 (p0.90), award 0.00, finish — · stature idx 0.952/w 1.00 |
| 8 | Puskás (Spain 1962) ★ | FW | 1962-70 | 95 | 73 | -22 | stature | 0.50 | 0.98 | apps 3 (p0.67), goals 0 (p0.36), award 0.00, finish — · stature idx 0.886/w 1.00 |
| 9 | Zico (Brazil 1986) ★ | MF | 1986-94 | 95 | 73 | -22 | stature | 0.40 | 0.98 | apps 3 (p0.54), goals 0 (p0.41), award 0.00, finish — · stature idx 0.859/w 1.00 |
| 10 | Lewandowski (Poland 2018) ★ | FW | 2010-2018 | 94 | 72 | -22 | stature | 0.45 | 0.98 | apps 3 (p0.59), goals 0 (p0.35), award 0.00, finish — · stature idx 0.831/w 1.00 |
| 11 | Modrić (Croatia 2006) ★ | MF | 1998-2006 | 94 | 72 | -22 | stature | 0.31 | 0.98 | apps 2 (p0.31), goals 0 (p0.43), award 0.00, finish — · stature idx 0.898/w 1.00 |
| 12 | Matthews (England 1954) ★ | FW | <=1958 | 94 | 72 | -22 | stature | 0.35 | 0.98 | apps 2 (p0.42), goals 0 (p0.32), award 0.00, finish — · stature idx 0.843/w 1.00 |
| 13 | Henry (France 2010) ★ | FW | 2010-2018 | 94 | 72 | -22 | stature | 0.33 | 0.98 | apps 2 (p0.32), goals 0 (p0.36), award 0.00, finish — · stature idx 0.857/w 1.00 |
| 14 | Matthews (England 1950) ★ | FW | <=1958 | 93 | 71 | -22 | stature | 0.05 | 0.98 | apps 1 (p0.15), goals 0 (p0.32), award 0.00, finish — · stature idx 0.843/w 1.00 |
| 15 | Modrić (Croatia 2014) ★ | MF | 2010-2018 | 96 | 75 | -21 | stature | 0.63 | 1.00 | apps 3 (p0.62), goals 0 (p0.41), award 0.00, finish — · stature idx 0.898/w 1.00 |
| 16 | Kempes (Argentina 1974) ★ | FW | 1974-82 | 94 | 73 | -21 | stature | 0.57 | 0.97 | apps 6 (p0.86), goals 0 (p0.35), award 0.00, finish — · stature idx 0.829/w 1.00 |
| 17 | Kempes (Argentina 1982) ★ | FW | 1974-82 | 94 | 73 | -21 | stature | 0.53 | 0.97 | apps 5 (p0.87), goals 0 (p0.30), award 0.00, finish — · stature idx 0.829/w 1.00 |
| 18 | Owen (England 2006) ★ | FW | 1998-2006 | 93 | 72 | -21 | stature | 0.47 | 0.97 | apps 3 (p0.60), goals 0 (p0.32), award 0.00, finish — · stature idx 0.789/w 1.00 |
| 19 | Santos (Brazil 1966) | DF | 1962-70 | 93 | 72 | -21 | stature | 0.45 | 1.00 | apps 2 (p0.40), goals 0 (p0.48), award 0.00, finish — · stature idx 0.805/w 1.00 |
| 20 | Bozsik (Hungary 1958) | DF | <=1958 | 93 | 72 | -21 | stature | 0.60 | 0.99 | apps 3 (p0.40), goals 1 (p0.98), award 0.00, finish — · stature idx 0.829/w 1.00 |
| 21 | Hanappi (Austria 1958) | DF | <=1958 | 93 | 72 | -21 | stature | 0.60 | 0.99 | apps 3 (p0.40), goals 0 (p0.48), award 0.00, finish — · stature idx 0.809/w 1.00 |
| 22 | Xavi (Spain 2014) ★ | MF | 2010-2018 | 92 | 71 | -21 | stature | 0.18 | 0.99 | apps 1 (p0.20), goals 0 (p0.41), award 0.00, finish — · stature idx 0.815/w 1.00 |
| 23 | Keegan (England 1982) ★ | FW | 1974-82 | 92 | 71 | -21 | stature | 0.08 | 0.96 | apps 1 (p0.21), goals 0 (p0.30), award 0.00, finish — · stature idx 0.781/w 1.00 |
| 24 | Iniesta (Spain 2006) ★ | MF | 1998-2006 | 92 | 71 | -21 | stature | 0.16 | 0.97 | apps 1 (p0.16), goals 0 (p0.43), award 0.00, finish — · stature idx 0.839/w 1.00 |
| 25 | Jonquet (France 1954) | DF | <=1958 | 89 | 68 | -21 | stature | 0.30 | 0.97 | apps 1 (p0.07), goals 0 (p0.48), award 0.00, finish — · stature idx 0.665/w 1.00 |
| 26 | van Basten (Netherlands 1990) ★ | FW | 1986-94 | 93 | 73 | -20 | stature | 0.57 | 0.97 | apps 4 (p0.80), goals 0 (p0.36), award 0.00, finish — · stature idx 0.781/w 1.00 |
| 27 | Di Stéfano (Spain 1962) ★ | FW | 1962-70 | 92 | 72 | -20 | stature | 0.22 | 0.96 | apps None (p—), goals 0 (p0.36), award 0.00, finish — · stature idx 0.774/w 1.00 |
| 28 | Drogba (Ivory Coast 2014) ★ | FW | 2010-2018 | 92 | 72 | -20 | stature | 0.39 | 0.96 | apps 3 (p0.54), goals 0 (p0.30), award 0.00, finish — · stature idx 0.776/w 1.00 |
| 29 | Hidegkuti (Hungary 1958) | FW | <=1958 | 91 | 71 | -20 | stature | 0.11 | 0.97 | apps 2 (p0.32), goals 0 (p0.32), award 0.00, finish — · stature idx 0.719/w 1.00 |
| 30 | Charlton (England 1958) ★ | FW | <=1958 | 91 | 71 | -20 | stature | 0.17 | 0.97 | apps None (p—), goals 0 (p0.32), award 0.00, finish — · stature idx 0.748/w 1.00 |
| 31 | Buffon (Italy 1998) ★ | GK | 1998-2006 | 91 | 71 | -20 | stature | 0.44 | 0.97 | apps 0 (p0.31), goals 0 (p0.50), award 0.00, finish — · stature idx 0.777/w 1.00 |
| 32 | Law (Scotland 1974) ★ | FW | 1974-82 | 91 | 71 | -20 | stature | 0.25 | 0.95 | apps 1 (p0.22), goals 0 (p0.35), award 0.00, finish — · stature idx 0.760/w 1.00 |
| 33 | Rivera (Italy 1962) ★ | FW | 1962-70 | 91 | 71 | -20 | stature | 0.07 | 0.96 | apps 1 (p0.14), goals 0 (p0.36), award 0.00, finish — · stature idx 0.729/w 1.00 |
| 34 | Boniperti (Italy 1950) | FW | <=1958 | 91 | 71 | -20 | stature | 0.05 | 0.97 | apps 1 (p0.15), goals 0 (p0.32), award 0.00, finish — · stature idx 0.780/w 1.00 |
| 35 | Messi (Argentina 2026) ★ | FW | 2022-2026/26 | 99 | 80 | -19 | stature | 0.71 | 1.00 | caps 198 (p1.00), goals 116 (p1.00), age 38 (af 0.80), lg 0.58 · stature idx 0.938/w 1.00 |
| 36 | Iniesta (Spain 2014) ★ | MF | 2010-2018 | 94 | 75 | -19 | stature | 0.63 | 0.99 | apps 3 (p0.62), goals 0 (p0.41), award 0.00, finish — · stature idx 0.839/w 1.00 |
| 37 | Nedvěd (Czech Republic 2006) ★ | MF | 1998-2006 | 93 | 74 | -19 | stature | 0.54 | 0.98 | apps 3 (p0.57), goals 0 (p0.43), award 0.00, finish — · stature idx 0.818/w 1.00 |
| 38 | Cubillas (Peru 1982) ★ | MF | 1974-82 | 93 | 74 | -19 | stature | 0.49 | 0.98 | apps 3 (p0.59), goals 0 (p0.40), award 0.00, finish — · stature idx 0.786/w 1.00 |
| 39 | Milla (Cameroon 1982) ★ | FW | 1974-82 | 91 | 72 | -19 | stature | 0.41 | 0.95 | apps 3 (p0.59), goals 0 (p0.30), award 0.00, finish — · stature idx 0.698/w 1.00 |
| 40 | Rivera (Italy 1966) ★ | FW | 1962-70 | 91 | 72 | -19 | stature | 0.40 | 0.96 | apps 2 (p0.42), goals 0 (p0.36), award 0.00, finish — · stature idx 0.729/w 1.00 |
| 41 | Kahn (Germany 1998) ★ | GK | 1998-2006 | 90 | 71 | -19 | stature | 0.44 | 0.96 | apps 0 (p0.31), goals 0 (p0.50), award 0.00, finish — · stature idx 0.719/w 1.00 |
| 42 | Happel (Austria 1958) | DF | <=1958 | 89 | 70 | -19 | stature | 0.42 | 0.97 | apps 2 (p0.23), goals 0 (p0.48), award 0.00, finish — · stature idx 0.665/w 1.00 |
| 43 | Cárdenas (Mexico 1958) | DF | <=1958 | 89 | 70 | -19 | stature | 0.42 | 0.97 | apps 2 (p0.23), goals 0 (p0.48), award 0.00, finish — · stature idx 0.665/w 1.00 |
| 44 | Albert (Hungary 1966) | MF | 1962-70 | 97 | 79 | -18 | stature | 0.75 | 0.99 | apps 4 (p0.79), goals 0 (p0.44), award 0.00, finish — · stature idx 0.872/w 1.00 |
| 45 | Kopa (France 1954) ★ | FW | <=1958 | 97 | 79 | -18 | stature | 0.67 | 0.99 | apps 2 (p0.42), goals 1 (p0.73), award 0.00, finish — · stature idx 0.843/w 1.00 |
| 46 | Boniperti (Italy 1954) | FW | <=1958 | 94 | 76 | -18 | stature | 0.62 | 0.98 | apps 1 (p0.10), goals 1 (p0.73), award 0.00, finish — · stature idx 0.780/w 1.00 |
| 47 | Xavi (Spain 2002) ★ | MF | 1998-2006 | 93 | 75 | -18 | stature | 0.63 | 0.98 | apps 3 (p0.62), goals 0 (p0.43), award 0.00, finish — · stature idx 0.815/w 1.00 |
| 48 | Figo (Portugal 2002) ★ | MF | 1998-2006 | 93 | 75 | -18 | stature | 0.63 | 0.98 | apps 3 (p0.62), goals 0 (p0.43), award 0.00, finish — · stature idx 0.816/w 1.00 |
| 49 | Benzema (France 2022) ★ | FW | 2022-2026 | 92 | 74 | -18 | stature | 0.60 | 0.97 | apps 0 (p0.03), goals 0 (p0.33), award 0.00, finish 0.75 · stature idx 0.728/w 1.00 |
| 50 | Falcão (Brazil 1986) | MF | 1986-94 | 90 | 72 | -18 | stature | 0.27 | 0.97 | apps 2 (p0.34), goals 0 (p0.41), award 0.00, finish — · stature idx 0.686/w 1.00 |
| 51 | Suárez (Spain 1962) | FW | 1962-70 | 90 | 72 | -18 | stature | 0.36 | 0.95 | apps 2 (p0.41), goals 0 (p0.36), award 0.00, finish — · stature idx 0.656/w 1.00 |
| 52 | Suárez (Spain 1966) | FW | 1962-70 | 90 | 72 | -18 | stature | 0.40 | 0.95 | apps 2 (p0.42), goals 0 (p0.36), award 0.00, finish — · stature idx 0.656/w 1.00 |
| 53 | Cárdenas (Mexico 1954) | MF | <=1958 | 90 | 72 | -18 | stature | 0.21 | 0.98 | apps 2 (p0.41), goals 0 (p0.47), award 0.00, finish — · stature idx 0.665/w 1.00 |
| 54 | Hazard (Belgium 2022) ★ | FW | 2022-2026 | 90 | 72 | -18 | stature | 0.43 | 0.96 | apps 3 (p0.54), goals 0 (p0.33), award 0.00, finish — · stature idx 0.629/w 1.00 |
| 55 | Santos (Brazil 1950) | DF | <=1958 | 90 | 72 | -18 | stature | 0.57 | 0.98 | apps None (p—), goals 0 (p0.49), award 0.00, finish 0.75 · stature idx 0.684/w 1.00 |
| 56 | Braine (Belgium 1938) | FW | <=1958 | 90 | 72 | -18 | stature | 0.24 | 0.96 | apps 1 (p0.26), goals 0 (p0.37), award 0.00, finish — · stature idx 0.665/w 1.00 |
| 57 | Szepan (Germany 1938) | FW | <=1958 | 90 | 72 | -18 | stature | 0.45 | 0.96 | apps None (p—), goals 0 (p0.37), award 0.00, finish — · stature idx 0.665/w 1.00 |
| 58 | Yashin (Soviet Union 1970) ★ | GK | 1962-70 | 89 | 71 | -18 | stature | 0.42 | 0.98 | apps 0 (p0.26), goals 0 (p0.50), award 0.00, finish — · stature idx 0.738/w 1.00 |
| 59 | Kahn (Germany 1994) ★ | GK | 1986-94 | 89 | 71 | -18 | stature | 0.07 | 1.00 | apps 0 (p0.25), goals 0 (p0.50), award 0.00, finish — · stature idx 0.719/w 1.00 |
| 60 | Šuker (Yugoslavia 1990) ★ | FW | 1986-94 | 89 | 71 | -18 | stature | 0.17 | 0.95 | apps 0 (p0.09), goals 0 (p0.36), award 0.00, finish — · stature idx 0.643/w 1.00 |
| 61 | Šuker (Croatia 2002) ★ | FW | 1998-2006 | 89 | 71 | -18 | stature | 0.10 | 0.94 | apps 1 (p0.15), goals 0 (p0.32), award 0.00, finish — · stature idx 0.643/w 1.00 |
| 62 | Eto'o (Cameroon 1998) ★ | FW | 1998-2006 | 89 | 71 | -18 | stature | 0.20 | 0.94 | apps 1 (p0.18), goals 0 (p0.33), award 0.00, finish — · stature idx 0.605/w 1.00 |
| 63 | Eto'o (Cameroon 2014) ★ | FW | 2010-2018 | 89 | 71 | -18 | stature | 0.04 | 0.93 | apps 1 (p0.13), goals 0 (p0.30), award 0.00, finish — · stature idx 0.605/w 1.00 |
| 64 | Ibrahimović (Sweden 2002) ★ | FW | 1998-2006 | 89 | 71 | -18 | stature | 0.25 | 0.94 | apps 2 (p0.31), goals 0 (p0.32), award 0.00, finish — · stature idx 0.560/w 1.00 |
| 65 | Messi (Argentina 2006) ★ | FW | 1998-2006 | 99 | 82 | -17 | stature | 0.76 | 0.99 | apps 3 (p0.60), goals 1 (p0.77), award 0.00, finish — · stature idx 0.938/w 1.00 |
| 66 | Matthäus (West Germany 1982) ★ | MF | 1974-82 | 97 | 80 | -17 | stature | 0.67 | 0.99 | apps 2 (p0.42), goals 0 (p0.40), award 0.00, finish 0.75 · stature idx 0.891/w 1.00 |
| 67 | Ronaldo (Portugal 2014) ★ | FW | 2010-2018 | 97 | 80 | -17 | stature | 0.68 | 0.99 | apps 3 (p0.54), goals 1 (p0.72), award 0.00, finish — · stature idx 0.878/w 1.00 |
| 68 | Ronaldo (Portugal 2026) ★ | FW | 2022-2026/26 | 97 | 80 | -17 | stature | 0.72 | 0.99 | caps 226 (p1.00), goals 143 (p1.00), age 41 (af 0.80), lg 0.58 · stature idx 0.878/w 1.00 |
| 69 | Santos (Brazil 1954) | DF | <=1958 | 94 | 77 | -17 | stature | 0.72 | 1.00 | apps 3 (p0.59), goals 1 (p0.97), award 0.00, finish — · stature idx 0.805/w 1.00 |
| 70 | Santos (Brazil 1958) | DF | <=1958 | 94 | 77 | -17 | stature | 0.68 | 1.00 | apps 1 (p0.08), goals 0 (p0.48), award 0.00, finish 1.00 · stature idx 0.805/w 1.00 |
| 71 | Masopust (Czechoslovakia 1958) ★ | MF | <=1958 | 92 | 75 | -17 | stature | 0.63 | 0.98 | apps 4 (p0.60), goals 0 (p0.45), award 0.00, finish — · stature idx 0.739/w 1.00 |
| 72 | Cárdenas (Mexico 1962) | DF | 1962-70 | 91 | 74 | -17 | stature | 0.58 | 0.98 | apps 3 (p0.51), goals 0 (p0.49), award 0.00, finish — · stature idx 0.665/w 1.00 |
| 73 | Griezmann (France 2014) | FW | 2010-2018 | 90 | 73 | -17 | stature | 0.56 | 0.95 | apps 5 (p0.89), goals 0 (p0.30), award 0.00, finish — · stature idx 0.634/w 1.00 |
| 74 | Suárez (Uruguay 2022) ★ | FW | 2022-2026 | 89 | 72 | -17 | stature | 0.43 | 0.94 | apps 3 (p0.54), goals 0 (p0.33), award 0.00, finish — · stature idx 0.537/w 1.00 |
| 75 | Ibrahimović (Sweden 2006) ★ | FW | 1998-2006 | 89 | 72 | -17 | stature | 0.47 | 0.94 | apps 3 (p0.60), goals 0 (p0.32), award 0.00, finish — · stature idx 0.560/w 1.00 |
| 76 | ter Stegen (Germany 2018) | GK | 2010-2018 | 88 | 71 | -17 | stature | 0.25 | 0.88 | apps 0 (p0.29), goals 0 (p0.50), award 0.00, finish — · stature idx 0.464/w 1.00 |
| 77 | ter Stegen (Germany 2022) | GK | 2022-2026 | 88 | 71 | -17 | stature | 0.26 | 0.87 | apps 0 (p0.29), goals 0 (p0.50), award 0.00, finish — · stature idx 0.464/w 1.00 |
| 78 | Crespo (Argentina 1998) | FW | 1998-2006 | 88 | 71 | -17 | stature | 0.20 | 0.87 | apps 1 (p0.18), goals 0 (p0.33), award 0.00, finish — · stature idx 0.494/w 1.00 |
| 79 | Sánchez (Mexico 1994) ★ | FW | 1986-94 | 88 | 71 | -17 | stature | 0.12 | 0.88 | apps 1 (p0.26), goals 0 (p0.30), award 0.00, finish — · stature idx 0.500/w 1.00 |
| 80 | Piqué (Spain 2014) ★ | DF | 2010-2018 | 88 | 71 | -17 | stature | 0.20 | 0.92 | apps 1 (p0.27), goals 0 (p0.47), award 0.00, finish — · stature idx 0.526/w 1.00 |
| 81 | Lampard (England 2014) | MF | 2010-2018 | 88 | 71 | -17 | stature | 0.18 | 0.91 | apps 1 (p0.20), goals 0 (p0.41), award 0.00, finish — · stature idx 0.496/w 1.00 |
| 82 | Pirlo (Italy 2010) ★ | MF | 2010-2018 | 88 | 71 | -17 | stature | 0.23 | 0.91 | apps 1 (p0.20), goals 0 (p0.43), award 0.00, finish — · stature idx 0.590/w 1.00 |
| 83 | Silva (Brazil 2010) ★ | DF | 2010-2018 | 85 | 68 | -17 | stature | 0.14 | 0.74 | apps 0 (p0.09), goals 0 (p0.46), award 0.00, finish — · stature idx 0.521/w 1.00 |
| 84 | Iniesta (Spain 2018) ★ | MF | 2010-2018 | 95 | 79 | -16 | stature | 0.70 | 0.99 | apps 4 (p0.79), goals 0 (p0.42), award 0.00, finish — · stature idx 0.839/w 1.00 |
| 85 | Ribéry (France 2010) ★ | MF | 2010-2018 | 91 | 75 | -16 | stature | 0.55 | 0.98 | apps 3 (p0.61), goals 0 (p0.43), award 0.00, finish — · stature idx 0.717/w 1.00 |
| 86 | Butragueño (Spain 1990) | FW | 1986-94 | 89 | 73 | -16 | stature | 0.57 | 0.95 | apps 4 (p0.80), goals 0 (p0.36), award 0.00, finish — · stature idx 0.607/w 1.00 |
| 87 | Gento (Spain 1966) | FW | 1962-70 | 88 | 72 | -16 | stature | 0.40 | 0.88 | apps 2 (p0.42), goals 0 (p0.36), award 0.00, finish — · stature idx 0.461/w 1.00 |
| 88 | Alves (Brazil 2022) | DF | 2022-2026 | 88 | 72 | -16 | stature | 0.40 | 0.93 | apps 2 (p0.43), goals 0 (p0.46), award 0.00, finish — · stature idx 0.500/w 1.00 |
| 89 | Sánchez (Mexico 1978) ★ | FW | 1974-82 | 88 | 72 | -16 | stature | 0.50 | 0.87 | apps 3 (p0.62), goals 0 (p0.35), award 0.00, finish — · stature idx 0.500/w 1.00 |
| 90 | Madjer (Algeria 1986) | FW | 1986-94 | 88 | 72 | -16 | stature | 0.46 | 0.88 | apps 3 (p0.60), goals 0 (p0.34), award 0.00, finish — · stature idx 0.462/w 1.00 |
| 91 | Fàbregas (Spain 2014) ★ | MF | 2010-2018 | 88 | 72 | -16 | stature | 0.34 | 0.91 | apps 2 (p0.38), goals 0 (p0.41), award 0.00, finish — · stature idx 0.504/w 1.00 |
| 92 | Faras (Morocco 1970) | FW | 1962-70 | 88 | 72 | -16 | stature | 0.44 | 0.88 | apps 2 (p0.46), goals 0 (p0.37), award 0.00, finish — · stature idx 0.504/w 1.00 |
| 93 | Ronaldinho (Brazil 2006) ★ | MF | 1998-2006 | 97 | 82 | -15 | stature | 0.82 | 0.99 | apps 5 (p0.90), goals 0 (p0.43), award 0.00, finish — · stature idx 0.870/w 1.00 |
| 94 | Xavi (Spain 2006) ★ | MF | 1998-2006 | 94 | 79 | -15 | stature | 0.72 | 0.98 | apps 4 (p0.79), goals 0 (p0.43), award 0.00, finish — · stature idx 0.815/w 1.00 |
| 95 | Kaká (Brazil 2002) ★ | MF | 1998-2006 | 94 | 79 | -15 | stature | 0.71 | 0.98 | apps 1 (p0.23), goals 0 (p0.43), award 0.00, finish 1.00 · stature idx 0.799/w 1.00 |
| 96 | Cannavaro (Italy 2002) ★ | DF | 1998-2006 | 93 | 78 | -15 | stature | 0.61 | 0.99 | apps 3 (p0.62), goals 0 (p0.46), award 0.00, finish — · stature idx 0.827/w 1.00 |
| 97 | Rivera (Italy 1974) ★ | MF | 1974-82 | 92 | 77 | -15 | stature | 0.62 | 0.97 | apps 2 (p0.38), goals 1 (p0.89), award 0.00, finish — · stature idx 0.729/w 1.00 |
| 98 | Santos (Brazil 1954) | DF | <=1958 | 92 | 77 | -15 | stature | 0.72 | 0.98 | apps 3 (p0.59), goals 0 (p0.48), award 0.00, finish — · stature idx 0.684/w 1.00 |
| 99 | Gerrard (England 2014) ★ | MF | 2010-2018 | 90 | 75 | -15 | stature | 0.63 | 0.98 | apps 3 (p0.62), goals 0 (p0.41), award 0.00, finish — · stature idx 0.643/w 1.00 |
| 100 | Gento (Spain 1962) | FW | 1962-70 | 88 | 73 | -15 | stature | 0.50 | 0.88 | apps 3 (p0.67), goals 0 (p0.36), award 0.00, finish — · stature idx 0.461/w 1.00 |

---

## E. T4 — Ceiling-victim census (12b expected-movers)

1,469 cards display exactly 88 (1,322 historical + 147 projected; 1,244 sit at
internal exactly 62.0 — the clamp, Audit-1 §B.4). Ranked below by uncapped raw merit:
the players who most plausibly belong ABOVE 88 once 12b lifts the ceiling.

### Annotations

- **Historical award-anchored victims (top of list):** Schumacher-1986,
  E. Martínez-2022, Vavá-1962, then Jairzinho-1970 (7 goals, champion, raw 94.8),
  Klose-2006 (Golden Boot, raw 94.4), Forlán-2010 (**Golden Ball** of his
  tournament, raw 94.0), Banks-1966 / Maier-1974 (88 despite weight 0.88 — their
  stature path lands ~66 internal, still inside the pile). A Golden-Ball winner
  displaying 88 (Forlán) is the historical-side counterpart of the Valverde problem.
- **2026 victims with elite face validity:** Haaland (49 caps / 55 goals, raw 94.6),
  Valverde (raw 95.7), B. Fernandes (98.9), Alaba (94.6), Hakimi (93.9), Rice (93.9),
  Robertson (94.5) — plus link-missed Rodri (90.1) and Casemiro/Alisson (§H.3).
- **Caveat (Audit-1 §B.2):** the 2026 ranking inside the pile is caps/goals
  accumulation — Souček (98.7) outranking Haaland (94.6) is the longevity-detector
  artifact, not a quality ordering. 12b's D1 (age-conditioned cohorts) is what makes
  this ranking meaningful.

## T4 Ceiling census — all cards displaying exactly 88 (n=1469), top 50 by uncapped raw merit
| # | card | pos | OVR | basis | internal | raw(uncap) | merit inputs |
|---|---|---|---|---|---|---|---|
| 1 | Schumacher (West Germany 1986) | GK | 88 | measured | 62.0 | 100.0 | apps 7 (p0.98), goals 0 (p0.50), award 0.70, finish 0.75 [Silver Ball] · stature idx 0.308/w 0.00 |
| 2 | Martínez (Argentina 2022) | GK | 88 | measured | 62.0 | 100.0 | apps 7 (p0.99), goals 0 (p0.50), award 0.85, finish 1.00 [Golden Glove] · stature idx 0.255/w 0.00 |
| 3 | Vavá (Brazil 1962) | FW | 88 | measured | 62.0 | 100.0 | apps 6 (p0.96), goals 4 (p0.98), award 0.90, finish 1.00 [Golden Boot] · stature idx 0.396/w 0.00 |
| 4 | Fernandes (Portugal 2026) | MF | 88 | measured | 62.0 | 98.9 | caps 87 (p0.94), goals 28 (p0.99), age 31 (af 0.97), lg 1.00 · stature idx 0.200/w 0.00 |
| 5 | Hwang (South Korea 2026) | MF | 88 | measured | 62.0 | 98.9 | caps 79 (p0.91), goals 17 (p0.97), age 30 (af 1.00), lg 1.00 · stature idx —/w 0.00 |
| 6 | Silva (Portugal 2026) | MF | 88 | measured | 62.0 | 98.8 | caps 107 (p0.97), goals 14 (p0.94), age 31 (af 0.97), lg 1.00 · stature idx 0.243/w 0.00 |
| 7 | Soucek (Czech Republic 2026) | MF | 88 | measured | 62.0 | 98.7 | caps 89 (p0.94), goals 17 (p0.97), age 31 (af 0.97), lg 1.00 · stature idx —/w 0.00 |
| 8 | Mcginn (Scotland 2026) | MF | 88 | measured | 62.0 | 98.5 | caps 85 (p0.93), goals 20 (p0.98), age 31 (af 0.97), lg 1.00 · stature idx —/w 0.00 |
| 9 | Tielemans (Belgium 2026) | MF | 88 | measured | 62.0 | 98.5 | caps 84 (p0.92), goals 13 (p0.93), age 29 (af 1.00), lg 1.00 · stature idx —/w 0.00 |
| 10 | Xhaka (Switzerland 2026) | MF | 88 | measured | 62.0 | 97.8 | caps 145 (p0.99), goals 17 (p0.97), age 33 (af 0.93), lg 1.00 · stature idx 0.105/w 0.00 |
| 11 | Giménez (Uruguay 2026) | DF | 88 | measured | 62.0 | 96.3 | caps 99 (p0.97), goals 8 (p0.97), age 31 (af 0.97), lg 1.00 · stature idx —/w 0.00 |
| 12 | Valverde (Uruguay 2026) | MF | 88 | measured | 62.0 | 95.7 | caps 73 (p0.88), goals 9 (p0.86), age 27 (af 1.00), lg 1.00 · stature idx —/w 0.00 |
| 13 | Rodríguez (Switzerland 2026) | DF | 88 | measured | 62.0 | 95.1 | caps 137 (p0.99), goals 9 (p0.97), age 33 (af 0.93), lg 1.00 · stature idx —/w 0.00 |
| 14 | Marcos (Brazil 2002) | GK | 88 | measured | 62.0 | 95.0 | apps 7 (p0.98), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 15 | Pumpido (Argentina 1986) | GK | 88 | measured | 62.0 | 95.0 | apps 7 (p0.98), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 16 | Illgner (West Germany 1990) | GK | 88 | measured | 62.0 | 95.0 | apps 7 (p0.98), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 17 | Gilmar (Brazil 1958) | GK | 88 | measured | 62.0 | 95.0 | apps 6 (p0.98), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 18 | Taffarel (Brazil 1994) | GK | 88 | measured | 62.0 | 95.0 | apps 7 (p0.98), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx 0.096/w 0.00 |
| 19 | Calhanoglu (Turkey 2026) | MF | 88 | measured | 62.0 | 94.9 | caps 104 (p0.96), goals 22 (p0.99), age 32 (af 0.95), lg 0.90 · stature idx —/w 0.00 |
| 20 | Morlock (West Germany 1954) | FW | 88 | measured | 63.0 | 94.8 | apps 5 (p0.94), goals 6 (p0.99), award 0.60, finish 1.00 [Silver Boot] · stature idx 0.360/w 0.17 |
| 21 | Jairzinho (Brazil 1970) | FW | 88 | measured | 62.0 | 94.8 | apps 6 (p0.95), goals 7 (p0.98), award 0.60, finish 1.00 [Silver Boot] · stature idx 0.309/w 0.00 |
| 22 | Dias (Portugal 2026) | DF | 88 | measured | 63.9 | 94.8 | caps 74 (p0.91), goals 3 (p0.84), age 29 (af 1.00), lg 1.00 · stature idx 0.386/w 0.38 |
| 23 | Sabitzer (Austria 2026) | MF | 88 | measured | 62.0 | 94.7 | caps 98 (p0.95), goals 26 (p0.99), age 32 (af 0.95), lg 0.90 · stature idx —/w 0.00 |
| 24 | Alaba (Austria 2026) | DF | 88 | measured | 62.0 | 94.6 | caps 113 (p0.98), goals 15 (p1.00), age 33 (af 0.93), lg 1.00 · stature idx —/w 0.00 |
| 25 | Haaland (Norway 2026) | FW | 88 | measured | 62.0 | 94.6 | caps 49 (p0.75), goals 55 (p0.96), age 25 (af 1.00), lg 1.00 · stature idx —/w 0.00 |
| 26 | Robertson (Scotland 2026) | DF | 88 | measured | 62.0 | 94.5 | caps 93 (p0.95), goals 4 (p0.90), age 32 (af 0.95), lg 1.00 · stature idx —/w 0.00 |
| 27 | Lloris (France 2018) | GK | 88 | measured | 62.0 | 94.5 | apps 6 (p0.97), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx 0.067/w 0.00 |
| 28 | Félix (Brazil 1970) | GK | 88 | measured | 62.0 | 94.5 | apps 6 (p0.97), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 29 | Olivieri (Italy 1938) | GK | 88 | measured | 62.0 | 94.5 | apps 4 (p0.97), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 30 | Fillol (Argentina 1978) | GK | 88 | measured | 62.0 | 94.5 | apps 7 (p0.97), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 31 | Klose (Germany 2006) | FW | 88 | measured | 62.0 | 94.4 | apps 7 (p0.98), goals 5 (p1.00), award 0.90, finish 0.55 [Golden Boot] · stature idx 0.395/w 0.00 |
| 32 | Combi (Italy 1934) | GK | 88 | measured | 62.0 | 94.4 | apps 5 (p0.97), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx —/w 0.00 |
| 33 | Schiavio (Italy 1934) | FW | 88 | measured | 63.0 | 94.3 | apps 4 (p0.90), goals 4 (p0.99), award 0.60, finish 1.00 [Silver Boot] · stature idx 0.360/w 0.17 |
| 34 | Fernández (Argentina 2022) | MF | 88 | measured | 62.0 | 94.2 | apps 7 (p0.98), goals 1 (p0.93), award 0.55, finish 1.00 [Best Young Player] · stature idx 0.165/w 0.00 |
| 35 | Christie (Scotland 2026) | MF | 88 | measured | 62.0 | 94.1 | caps 67 (p0.84), goals 10 (p0.88), age 31 (af 0.97), lg 1.00 · stature idx —/w 0.00 |
| 36 | Lindelöf (Sweden 2026) | DF | 88 | measured | 62.0 | 94.1 | caps 76 (p0.92), goals 3 (p0.84), age 31 (af 0.97), lg 1.00 · stature idx —/w 0.00 |
| 37 | Stones (England 2026) | DF | 88 | measured | 62.0 | 94.1 | caps 87 (p0.94), goals 3 (p0.84), age 32 (af 0.95), lg 1.00 · stature idx 0.200/w 0.00 |
| 38 | Kovačić (Croatia 2026) | MF | 88 | measured | 62.0 | 94.1 | caps 112 (p0.97), goals 5 (p0.74), age 32 (af 0.95), lg 1.00 · stature idx 0.050/w 0.00 |
| 39 | Ahmed (Qatar 2026) | DF | 88 | measured | 62.0 | 94.0 | caps 67 (p0.90), goals 3 (p0.84), age 26 (af 1.00), lg 1.00 · stature idx —/w 0.00 |
| 40 | Maier (West Germany 1974) | GK | 88 | stature | 66.3 | 94.0 | apps 7 (p0.96), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx 0.446/w 0.88 |
| 41 | Forlán (Uruguay 2010) | FW | 88 | measured | 62.0 | 94.0 | apps 7 (p0.98), goals 5 (p0.99), award 1.00, finish 0.40 [Golden Ball] · stature idx 0.376/w 0.00 |
| 42 | Hakimi (Morocco 2026) | DF | 88 | measured | 62.0 | 93.9 | caps 95 (p0.96), goals 11 (p0.98), age 27 (af 1.00), lg 0.90 · stature idx 0.320/w 0.00 |
| 43 | Rice (England 2026) | MF | 88 | measured | 62.0 | 93.9 | caps 72 (p0.87), goals 6 (p0.78), age 27 (af 1.00), lg 1.00 · stature idx —/w 0.00 |
| 44 | Sangare (Ivory Coast 2026) | MF | 88 | measured | 62.0 | 93.8 | caps 57 (p0.77), goals 12 (p0.92), age 28 (af 1.00), lg 1.00 · stature idx —/w 0.00 |
| 45 | Míguez (Uruguay 1950) | FW | 88 | measured | 63.0 | 93.7 | apps 4 (p0.84), goals 5 (p0.99), award 0.60, finish 1.00 [Silver Boot] · stature idx 0.360/w 0.17 |
| 46 | Mbemba (DR Congo 2026) | DF | 88 | measured | 62.0 | 93.6 | caps 108 (p0.98), goals 7 (p0.95), age 31 (af 0.97), lg 0.90 · stature idx —/w 0.00 |
| 47 | Banks (England 1966) | GK | 88 | stature | 66.3 | 93.6 | apps 6 (p0.95), goals 0 (p0.50), award 0.00, finish 1.00 · stature idx 0.446/w 0.88 |
| 48 | Sánchez (Chile 1962) | FW | 88 | measured | 62.0 | 93.4 | apps 6 (p0.96), goals 4 (p0.98), award 0.90, finish 0.55 [Golden Boot] · stature idx 0.396/w 0.00 |
| 49 | Pašalić (Croatia 2026) | MF | 88 | measured | 62.0 | 93.4 | caps 84 (p0.92), goals 11 (p0.90), age 31 (af 0.97), lg 0.90 · stature idx —/w 0.00 |
| 50 | Lee (South Korea 2026) | MF | 88 | measured | 62.0 | 93.3 | caps 105 (p0.97), goals 15 (p0.96), age 33 (af 0.93), lg 0.90 · stature idx —/w 0.00 |

---

## F. T5 — Famous-squad eyeball sheets

### Annotations (what jumps out, per squad)

- **Brazil 1970** — arguably the greatest squad ever renders as Pelé 97 + a flat
  **wall of ten 88s** (Gérson, Rivellino, Clodoaldo, Tostão, Jairzinho, Carlos
  Alberto 89…). Jairzinho (7 goals in 7 games, champion) = Piazza = Félix at 88. The
  ceiling erases the entire internal hierarchy of the squad. Also: 0-app reserve GKs
  Ado/Leão display 87 — one point below the starting XI (reserve-compression
  advisory, §H.6).
- **Netherlands 1974** — Cruyff 95 below Rummenigge-78/82 99 and Zico-78 98 (index
  defect §C). Van Hanegem (88, idx —) has no archive row at all.
- **Argentina 1986** — Maradona 99 + **sixteen 88s**. Valdano (4 goals incl. the
  final) = Pumpido = Garré. Passarella 88 `stature` with 0 apps sits identical to
  7-app starters (down-cap + ceiling interacting).
- **Italy 1982** — plausible at the top (Rossi 99, Zoff 89, Baresi 89-as-reserve) but
  Gentile/Scirea/Tardelli/Cabrini — the defensive spine of a champion — are
  indistinguishable 88s with near-empty archive rows (Scirea idx 0.360, Cabrini
  0.242, Gentile —). MV2-9's DF under-credit drawn in one table.
- **Brazil 1982** — the canonical "beautiful losers": Zico 98 / Falcão 93 /
  Sócrates **88** (idx 0.396 — fourth knife-edge case at the 0.40 gate, with Klose
  0.395, Godín 0.398, Maier 0.446 ramped). Cerezo 78.
- **France 1998** — Zidane 99 / Henry 98 / Barthez 91 / Thuram 90 plausible.
  **Deschamps (captain of champions) idx 0.209 → 88** and Desailly idx 0.160 → 88:
  archive holes for non-podium leaders (§TL;DR-5).
- **Spain 2010** — the most face-valid sheet of the ten (Iniesta 98, Xavi 97,
  Casillas 92, Villa 90, Ramos/Puyol 91) EXCEPT **Busquets idx 0.066 and Xabi Alonso
  idx 0.052** → both 88 measured. Two of the most decorated midfielders ever carry
  near-zero stature indexes.
- **Germany 2014** — Neuer 92/Lahm 91/Kroos 90/Müller 90 fine; **Klose 88**
  (idx 0.395, gate 0.40) — the World Cup's all-time top scorer one fact short of
  material; Schweinsteiger idx 0.250 → 88.
- **Argentina 2022** — champion squad = **nineteen 88s** including Golden-Glove
  Martínez and Enzo Fernández (Best Young Player). Di María 89. The reveal the owner
  originally flagged came from exactly this compression.
- **France 2022** — Mbappé 98/Benzema 92/Griezmann 92 fine; **Lloris (147 caps,
  champion-captain 2018) idx 0.067 → 88**; Varane idx 0.225 → 88; Kanté absent
  (injured, correctly no card).


## T5 Brazil 1970 (n=22)
| player | pos | OVR | basis | apps/gls | award | finish | idx | w |
|---|---|---|---|---|---|---|---|---|
| Félix | GK | 88 | measured | 6/0 | 0.00 | 1.00 | — | 0.00 |
| Ado | GK | 87 | measured | 0/0 | 0.00 | 1.00 | — | 0.00 |
| Leão | GK | 87 | measured | 0/0 | 0.00 | 1.00 | — | 0.00 |
| Alberto | DF | 89 | stature | 6/1 | 0.00 | 1.00 | 0.492 | 1.00 |
| Antônio | DF | 88 | measured | 2/0 | 0.00 | 1.00 | — | 0.00 |
| Brito | DF | 88 | measured | 6/0 | 0.00 | 1.00 | — | 0.00 |
| Everaldo | DF | 88 | measured | 5/0 | 0.00 | 1.00 | — | 0.00 |
| Fontana | DF | 83 | measured | 1/0 | 0.00 | 1.00 | — | 0.00 |
| Baldocchi | DF | 77 | measured | 0/0 | 0.00 | 1.00 | — | 0.00 |
| Joel | DF | 77 | measured | 0/0 | 0.00 | 1.00 | — | 0.00 |
| Zé Maria | DF | 77 | measured | 0/0 | 0.00 | 1.00 | — | 0.00 |
| Caju | MF | 88 | measured | 4/0 | 0.00 | 1.00 | — | 0.00 |
| Clodoaldo | MF | 88 | measured | 6/1 | 0.00 | 1.00 | — | 0.00 |
| Gérson | MF | 88 | measured | 4/1 | 0.00 | 1.00 | — | 0.00 |
| Piazza | MF | 88 | measured | 6/0 | 0.00 | 1.00 | — | 0.00 |
| Rivellino | MF | 88 | measured | 5/3 | 0.00 | 1.00 | 0.275 | 0.00 |
| Pelé ★ | FW | 97 | stature | 6/4 | 0.00 | 1.00 | 0.807 | 1.00 |
| Jairzinho | FW | 88 | measured | 6/7 | 0.60 | 1.00 | 0.309 | 0.00 |
| Tostão | FW | 88 | measured | 6/2 | 0.00 | 1.00 | 0.187 | 0.00 |
| Roberto | FW | 82 | measured | 2/0 | 0.00 | 1.00 | — | 0.00 |
| Edu | FW | 80 | measured | 1/0 | 0.00 | 1.00 | — | 0.00 |
| Dario | FW | 79 | measured | 0/0 | 0.00 | 1.00 | — | 0.00 |

## T5 Netherlands 1974 (n=22)
| player | pos | OVR | basis | apps/gls | award | finish | idx | w |
|---|---|---|---|---|---|---|---|---|
| Jongbloed | GK | 88 | measured | 7/0 | 0.00 | 0.75 | — | 0.00 |
| Schrijvers | GK | 83 | measured | 0/0 | 0.00 | 0.75 | — | 0.00 |
| Treijtel | GK | 83 | measured | 0/0 | 0.00 | 0.75 | — | 0.00 |
| Krol | DF | 89 | stature | 7/1 | 0.00 | 0.75 | 0.461 | 1.00 |
| Israël | DF | 88 | measured | 3/0 | 0.00 | 0.75 | — | 0.00 |
| Jansen | DF | 88 | measured | 7/0 | 0.00 | 0.75 | — | 0.00 |
| Rijsbergen | DF | 88 | measured | 7/0 | 0.00 | 0.75 | — | 0.00 |
| Suurbier | DF | 88 | measured | 7/0 | 0.00 | 0.75 | — | 0.00 |
| Strik | DF | 74 | measured | 0/0 | 0.00 | 0.75 | — | 0.00 |
| Vos | DF | 74 | measured | 0/0 | 0.00 | 0.75 | — | 0.00 |
| van Ierssel | DF | 74 | measured | 0/0 | 0.00 | 0.75 | — | 0.00 |
| Cruyff ★ | MF | 95 | stature | 7/3 | 0.00 | 0.75 | 0.755 | 1.00 |
| Neeskens ★ | MF | 91 | stature | 7/5 | 0.60 | 0.75 | 0.597 | 1.00 |
| Haan | MF | 88 | measured | 7/0 | 0.00 | 0.75 | — | 0.00 |
| de Jong | MF | 88 | measured | 4/1 | 0.00 | 0.75 | — | 0.00 |
| van Hanegem | MF | 88 | measured | 7/0 | 0.00 | 0.75 | — | 0.00 |
| van de Kerkhof | MF | 76 | measured | 1/0 | 0.00 | 0.75 | 0.275 | 0.00 |
| Geels | MF | 73 | measured | 0/0 | 0.00 | 0.75 | — | 0.00 |
| van de Kerkhof | MF | 73 | measured | 0/0 | 0.00 | 0.75 | 0.275 | 0.00 |
| Rensenbrink ★ | FW | 94 | stature | 6/1 | 0.00 | 0.75 | 0.705 | 1.00 |
| Rep | FW | 88 | measured | 7/4 | 0.00 | 0.75 | — | 0.00 |
| Keizer | FW | 76 | measured | 1/0 | 0.00 | 0.75 | — | 0.00 |

## T5 Argentina 1986 (n=22)
| player | pos | OVR | basis | apps/gls | award | finish | idx | w |
|---|---|---|---|---|---|---|---|---|
| Pumpido | GK | 88 | measured | 7/0 | 0.00 | 1.00 | — | 0.00 |
| Islas | GK | 87 | measured | 0/0 | 0.00 | 1.00 | — | 0.00 |
| Zelada | GK | 87 | measured | 0/0 | 0.00 | 1.00 | — | 0.00 |
| Brown | DF | 88 | measured | 7/1 | 0.00 | 1.00 | — | 0.00 |
| Cuciuffo | DF | 88 | measured | 6/0 | 0.00 | 1.00 | — | 0.00 |
| Garré | DF | 88 | measured | 4/0 | 0.00 | 1.00 | — | 0.00 |
| Olarticoechea | DF | 88 | measured | 7/0 | 0.00 | 1.00 | — | 0.00 |
| Passarella ★ | DF | 88 | stature | 0/0 | 0.00 | 1.00 | 0.529 | 1.00 |
| Ruggeri | DF | 88 | measured | 7/1 | 0.00 | 1.00 | 0.140 | 0.00 |
| Clausen | DF | 83 | measured | 1/0 | 0.00 | 1.00 | — | 0.00 |
| Maradona ★ | MF | 99 | stature | 7/5 | 1.00 | 1.00 | 0.952 | 1.00 |
| Batista | MF | 88 | measured | 7/0 | 0.00 | 1.00 | — | 0.00 |
| Enrique | MF | 88 | measured | 5/0 | 0.00 | 1.00 | — | 0.00 |
| Giusti | MF | 88 | measured | 7/0 | 0.00 | 1.00 | — | 0.00 |
| Borghi | MF | 81 | measured | 2/0 | 0.00 | 1.00 | — | 0.00 |
| Tapia | MF | 81 | measured | 2/0 | 0.00 | 1.00 | — | 0.00 |
| Bochini | MF | 79 | measured | 1/0 | 0.00 | 1.00 | — | 0.00 |
| Trobbiani | MF | 79 | measured | 1/0 | 0.00 | 1.00 | — | 0.00 |
| Burruchaga | FW | 88 | measured | 7/2 | 0.00 | 1.00 | — | 0.00 |
| Pasculli | FW | 88 | measured | 2/1 | 0.00 | 1.00 | — | 0.00 |
| Valdano | FW | 88 | measured | 7/4 | 0.00 | 1.00 | — | 0.00 |
| Almirón | FW | 78 | measured | 0/0 | 0.00 | 1.00 | — | 0.00 |

## T5 Italy 1982 (n=22)
| player | pos | OVR | basis | apps/gls | award | finish | idx | w |
|---|---|---|---|---|---|---|---|---|
| Zoff | GK | 89 | stature | 7/0 | 0.00 | 1.00 | 0.523 | 1.00 |
| Bordon | GK | 88 | measured | 0/0 | 0.00 | 1.00 | — | 0.00 |
| Galli | GK | 88 | measured | 0/0 | 0.00 | 1.00 | — | 0.00 |
| Baresi ★ | DF | 89 | stature | 0/0 | 0.00 | 1.00 | 0.632 | 1.00 |
| Bergomi | DF | 88 | measured | 3/0 | 0.00 | 1.00 | 0.275 | 0.00 |
| Cabrini | DF | 88 | measured | 7/1 | 0.00 | 1.00 | 0.242 | 0.00 |
| Collovati | DF | 88 | measured | 7/0 | 0.00 | 1.00 | — | 0.00 |
| Gentile | DF | 88 | measured | 6/0 | 0.00 | 1.00 | — | 0.00 |
| Scirea | DF | 88 | measured | 7/0 | 0.00 | 1.00 | 0.360 | 0.17 |
| Vierchowod | DF | 77 | measured | 0/0 | 0.00 | 1.00 | — | 0.00 |
| Antognoni | MF | 88 | measured | 6/0 | 0.00 | 1.00 | — | 0.00 |
| Conti | MF | 88 | measured | 7/1 | 0.00 | 1.00 | — | 0.00 |
| Marini | MF | 88 | measured | 5/0 | 0.00 | 1.00 | — | 0.00 |
| Oriali | MF | 88 | measured | 5/0 | 0.00 | 1.00 | — | 0.00 |
| Tardelli | MF | 88 | measured | 7/2 | 0.00 | 1.00 | — | 0.00 |
| Causio | MF | 83 | measured | 2/0 | 0.00 | 1.00 | — | 0.00 |
| Dossena | MF | 76 | measured | 0/0 | 0.00 | 1.00 | — | 0.00 |
| Rossi ★ | FW | 99 | stature | 7/6 | 1.00 | 1.00 | 0.879 | 1.00 |
| Altobelli | FW | 88 | measured | 3/1 | 0.00 | 1.00 | — | 0.00 |
| Graziani | FW | 88 | measured | 7/1 | 0.00 | 1.00 | — | 0.00 |
| Massaro | FW | 77 | measured | 0/0 | 0.00 | 1.00 | — | 0.00 |
| Selvaggi | FW | 77 | measured | 0/0 | 0.00 | 1.00 | — | 0.00 |

## T5 Brazil 1982 (n=22)
| player | pos | OVR | basis | apps/gls | award | finish | idx | w |
|---|---|---|---|---|---|---|---|---|
| Peres | GK | 88 | measured | 5/0 | 0.00 | — | — | 0.00 |
| Carlos | GK | 71 | measured | 0/0 | 0.00 | — | — | 0.00 |
| Sérgio | GK | 71 | measured | 0/0 | 0.00 | — | — | 0.00 |
| Júnior | DF | 87 | measured | 5/1 | 0.00 | — | — | 0.00 |
| Leandro | DF | 87 | measured | 5/0 | 0.00 | — | — | 0.00 |
| Luizinho | DF | 87 | measured | 5/0 | 0.00 | — | — | 0.00 |
| Oscar | DF | 87 | measured | 5/1 | 0.00 | — | — | 0.00 |
| Edevaldo | DF | 71 | measured | 1/0 | 0.00 | — | — | 0.00 |
| Edinho | DF | 71 | measured | 1/0 | 0.00 | — | — | 0.00 |
| Juninho | DF | 68 | measured | 0/0 | 0.00 | — | — | 0.00 |
| Pedrinho | DF | 68 | measured | 0/0 | 0.00 | — | — | 0.00 |
| Zico ★ | MF | 98 | stature | 5/4 | 0.45 | — | 0.859 | 1.00 |
| Falcão | MF | 93 | stature | 5/3 | 0.70 | — | 0.686 | 1.00 |
| Sócrates | MF | 88 | measured | 5/2 | 0.00 | — | 0.396 | 0.46 |
| Cerezo | MF | 78 | measured | 4/0 | 0.00 | — | — | 0.00 |
| Isidoro | MF | 78 | measured | 4/0 | 0.00 | — | — | 0.00 |
| Batista | MF | 72 | measured | 1/0 | 0.00 | — | — | 0.00 |
| Dirceu | MF | 72 | measured | 1/0 | 0.00 | — | 0.220 | 0.00 |
| Renato | MF | 70 | measured | 0/0 | 0.00 | — | — | 0.00 |
| Serginho | FW | 88 | measured | 5/2 | 0.00 | — | — | 0.00 |
| Éder | FW | 88 | measured | 5/2 | 0.00 | — | — | 0.00 |
| Dinamite | FW | 71 | measured | 0/0 | 0.00 | — | — | 0.00 |

## T5 France 1998 (n=22)
| player | pos | OVR | basis | apps/gls | award | finish | idx | w |
|---|---|---|---|---|---|---|---|---|
| Barthez | GK | 91 | stature | 7/0 | 0.85 | 1.00 | 0.650 | 1.00 |
| Charbonnier | GK | 88 | measured | 0/0 | 0.00 | 1.00 | — | 0.00 |
| Lama | GK | 88 | measured | 0/0 | 0.00 | 1.00 | — | 0.00 |
| Thuram ★ | DF | 90 | stature | 6/2 | 0.50 | 1.00 | 0.560 | 1.00 |
| Blanc | DF | 88 | measured | 5/1 | 0.00 | 1.00 | 0.392 | 0.43 |
| Desailly | DF | 88 | measured | 7/0 | 0.00 | 1.00 | 0.160 | 0.00 |
| Leboeuf | DF | 88 | measured | 3/0 | 0.00 | 1.00 | — | 0.00 |
| Lizarazu | DF | 88 | measured | 6/1 | 0.00 | 1.00 | 0.335 | 0.00 |
| Candela | DF | 83 | measured | 1/0 | 0.00 | 1.00 | — | 0.00 |
| Zidane ★ | MF | 99 | stature | 5/2 | 0.00 | 1.00 | 0.928 | 1.00 |
| Boghossian | MF | 88 | measured | 5/0 | 0.00 | 1.00 | — | 0.00 |
| Deschamps | MF | 88 | measured | 6/0 | 0.00 | 1.00 | 0.209 | 0.00 |
| Djorkaeff | MF | 88 | measured | 7/1 | 0.00 | 1.00 | — | 0.00 |
| Karembeu | MF | 88 | measured | 4/0 | 0.00 | 1.00 | 0.144 | 0.00 |
| Petit | MF | 88 | measured | 6/2 | 0.00 | 1.00 | — | 0.00 |
| Diomède | MF | 86 | measured | 3/0 | 0.00 | 1.00 | — | 0.00 |
| Pires | MF | 86 | measured | 3/0 | 0.00 | 1.00 | 0.253 | 0.00 |
| Vieira | MF | 82 | measured | 2/0 | 0.00 | 1.00 | 0.363 | 0.19 |
| Henry ★ | FW | 98 | stature | 6/3 | 0.00 | 1.00 | 0.857 | 1.00 |
| Dugarry | FW | 88 | measured | 3/1 | 0.00 | 1.00 | — | 0.00 |
| Trezeguet | FW | 88 | measured | 6/1 | 0.00 | 1.00 | 0.367 | 0.23 |
| Guivarc'h | FW | 86 | measured | 6/0 | 0.00 | 1.00 | — | 0.00 |

## T5 Spain 2010 (n=23)
| player | pos | OVR | basis | apps/gls | award | finish | idx | w |
|---|---|---|---|---|---|---|---|---|
| Casillas ★ | GK | 92 | stature | 7/0 | 0.85 | 1.00 | 0.710 | 1.00 |
| Reina | GK | 88 | measured | 0/0 | 0.00 | 1.00 | — | 0.00 |
| Valdés | GK | 88 | measured | 0/0 | 0.00 | 1.00 | 0.200 | 0.00 |
| Puyol ★ | DF | 91 | stature | 7/1 | 0.00 | 1.00 | 0.599 | 1.00 |
| Ramos ★ | DF | 91 | stature | 7/0 | 0.00 | 1.00 | 0.618 | 1.00 |
| Piqué ★ | DF | 90 | stature | 7/0 | 0.00 | 1.00 | 0.526 | 1.00 |
| Arbeloa | DF | 88 | measured | 2/0 | 0.00 | 1.00 | — | 0.00 |
| Capdevila | DF | 88 | measured | 7/0 | 0.00 | 1.00 | — | 0.00 |
| Marchena | DF | 88 | measured | 3/0 | 0.00 | 1.00 | — | 0.00 |
| Albiol | DF | 77 | measured | 0/0 | 0.00 | 1.00 | — | 0.00 |
| Iniesta ★ | MF | 98 | stature | 6/2 | 0.00 | 1.00 | 0.839 | 1.00 |
| Xavi ★ | MF | 97 | stature | 7/0 | 0.00 | 1.00 | 0.815 | 1.00 |
| Fàbregas ★ | MF | 89 | stature | 4/0 | 0.00 | 1.00 | 0.504 | 1.00 |
| Alonso | MF | 88 | measured | 7/0 | 0.00 | 1.00 | 0.052 | 0.00 |
| Busquets | MF | 88 | measured | 7/0 | 0.00 | 1.00 | 0.066 | 0.00 |
| Navas | MF | 88 | measured | 3/0 | 0.00 | 1.00 | — | 0.00 |
| Silva | MF | 82 | measured | 2/0 | 0.00 | 1.00 | 0.283 | 0.00 |
| Martínez | MF | 78 | measured | 1/0 | 0.00 | 1.00 | — | 0.00 |
| Mata | MF | 78 | measured | 1/0 | 0.00 | 1.00 | — | 0.00 |
| Villa | FW | 90 | stature | 7/5 | 0.80 | 1.00 | 0.504 | 1.00 |
| Torres | FW | 88 | stature | 7/0 | 0.00 | 1.00 | 0.410 | 0.58 |
| Pedro | FW | 85 | measured | 4/0 | 0.00 | 1.00 | — | 0.00 |
| Llorente | FW | 79 | measured | 1/0 | 0.00 | 1.00 | — | 0.00 |

## T5 Germany 2014 (n=23)
| player | pos | OVR | basis | apps/gls | award | finish | idx | w |
|---|---|---|---|---|---|---|---|---|
| Neuer ★ | GK | 92 | stature | 7/0 | 0.85 | 1.00 | 0.733 | 1.00 |
| Weidenfeller | GK | 87 | measured | 0/0 | 0.00 | 1.00 | — | 0.00 |
| Zieler | GK | 87 | measured | 0/0 | 0.00 | 1.00 | — | 0.00 |
| Lahm ★ | DF | 91 | stature | 7/0 | 0.00 | 1.00 | 0.625 | 1.00 |
| Boateng | DF | 88 | measured | 7/0 | 0.00 | 1.00 | 0.225 | 0.00 |
| Hummels | DF | 88 | measured | 6/2 | 0.00 | 1.00 | 0.320 | 0.00 |
| Höwedes | DF | 88 | measured | 7/0 | 0.00 | 1.00 | — | 0.00 |
| Mertesacker | DF | 88 | measured | 6/0 | 0.00 | 1.00 | 0.047 | 0.00 |
| Mustafi | DF | 88 | measured | 3/0 | 0.00 | 1.00 | — | 0.00 |
| Durm | DF | 77 | measured | 0/0 | 0.00 | 1.00 | — | 0.00 |
| Ginter | DF | 77 | measured | 0/0 | 0.00 | 1.00 | — | 0.00 |
| Großkreutz | DF | 77 | measured | 0/0 | 0.00 | 1.00 | — | 0.00 |
| Kroos ★ | MF | 90 | stature | 7/2 | 0.00 | 1.00 | 0.525 | 1.00 |
| Götze | MF | 88 | measured | 6/2 | 0.00 | 1.00 | — | 0.00 |
| Khedira | MF | 88 | measured | 5/1 | 0.00 | 1.00 | — | 0.00 |
| Kramer | MF | 88 | measured | 3/0 | 0.00 | 1.00 | — | 0.00 |
| Schweinsteiger | MF | 88 | measured | 6/0 | 0.00 | 1.00 | 0.250 | 0.00 |
| Özil | MF | 88 | measured | 7/1 | 0.00 | 1.00 | 0.349 | 0.07 |
| Draxler | MF | 78 | measured | 1/0 | 0.00 | 1.00 | — | 0.00 |
| Müller | FW | 90 | stature | 7/5 | 0.88 | 1.00 | 0.535 | 1.00 |
| Klose | FW | 88 | measured | 5/2 | 0.00 | 1.00 | 0.395 | 0.00 |
| Schürrle | FW | 88 | measured | 6/3 | 0.00 | 1.00 | — | 0.00 |
| Podolski | FW | 79 | measured | 2/0 | 0.00 | 1.00 | 0.262 | 0.00 |

## T5 Argentina 2022 (n=26)
| player | pos | OVR | basis | apps/gls | award | finish | idx | w |
|---|---|---|---|---|---|---|---|---|
| Armani | GK | 88 | measured | 0/0 | 0.00 | 1.00 | 0.052 | 0.00 |
| Martínez | GK | 88 | measured | 7/0 | 0.85 | 1.00 | 0.255 | 0.00 |
| Rulli | GK | 88 | measured | 0/0 | 0.00 | 1.00 | — | 0.00 |
| Martínez | DF | 88 | measured | 5/0 | 0.00 | 1.00 | — | 0.00 |
| Molina | DF | 88 | measured | 7/1 | 0.00 | 1.00 | — | 0.00 |
| Montiel | DF | 88 | measured | 4/0 | 0.00 | 1.00 | — | 0.00 |
| Otamendi | DF | 88 | measured | 7/0 | 0.00 | 1.00 | 0.253 | 0.00 |
| Pezzella | DF | 88 | measured | 3/0 | 0.00 | 1.00 | — | 0.00 |
| Romero | DF | 88 | measured | 7/0 | 0.00 | 1.00 | — | 0.00 |
| Tagliafico | DF | 88 | measured | 6/0 | 0.00 | 1.00 | — | 0.00 |
| Foyth | DF | 83 | measured | 1/0 | 0.00 | 1.00 | — | 0.00 |
| Acuña | MF | 88 | measured | 6/0 | 0.00 | 1.00 | — | 0.00 |
| De Paul | MF | 88 | measured | 7/0 | 0.00 | 1.00 | — | 0.00 |
| Fernández | MF | 88 | measured | 7/1 | 0.55 | 1.00 | 0.165 | 0.00 |
| Mac Allister | MF | 88 | measured | 6/1 | 0.00 | 1.00 | — | 0.00 |
| Palacios | MF | 88 | measured | 3/0 | 0.00 | 1.00 | — | 0.00 |
| Paredes | MF | 88 | measured | 5/0 | 0.00 | 1.00 | — | 0.00 |
| Gómez | MF | 84 | measured | 2/0 | 0.00 | 1.00 | — | 0.00 |
| Almada | MF | 79 | measured | 1/0 | 0.00 | 1.00 | — | 0.00 |
| Rodríguez | MF | 79 | measured | 1/0 | 0.00 | 1.00 | — | 0.00 |
| Messi ★ | FW | 99 | stature | 7/7 | 1.00 | 1.00 | 0.938 | 1.00 |
| Di María | FW | 89 | stature | 5/1 | 0.00 | 1.00 | 0.478 | 1.00 |
| Álvarez | FW | 88 | measured | 7/4 | 0.00 | 1.00 | 0.156 | 0.00 |
| Martínez | FW | 86 | measured | 6/0 | 0.00 | 1.00 | 0.250 | 0.00 |
| Dybala | FW | 79 | measured | 2/0 | 0.00 | 1.00 | 0.200 | 0.00 |
| Correa | FW | 78 | measured | 1/0 | 0.00 | 1.00 | — | 0.00 |

## T5 France 2022 (n=26)
| player | pos | OVR | basis | apps/gls | award | finish | idx | w |
|---|---|---|---|---|---|---|---|---|
| Lloris | GK | 88 | measured | 6/0 | 0.00 | 0.75 | 0.067 | 0.00 |
| Mandanda | GK | 88 | measured | 1/0 | 0.00 | 0.75 | — | 0.00 |
| Areola | GK | 82 | measured | 0/0 | 0.00 | 0.75 | — | 0.00 |
| Disasi | DF | 88 | measured | 3/0 | 0.00 | 0.75 | — | 0.00 |
| Hernandez | DF | 88 | measured | 6/1 | 0.00 | 0.75 | 0.200 | 0.00 |
| Konaté | DF | 88 | measured | 5/0 | 0.00 | 0.75 | — | 0.00 |
| Koundé | DF | 88 | measured | 6/0 | 0.00 | 0.75 | — | 0.00 |
| Upamecano | DF | 88 | measured | 5/0 | 0.00 | 0.75 | 0.200 | 0.00 |
| Varane | DF | 88 | measured | 6/0 | 0.00 | 0.75 | 0.225 | 0.00 |
| Hernandez | DF | 79 | measured | 1/0 | 0.00 | 0.75 | — | 0.00 |
| Pavard | DF | 79 | measured | 1/0 | 0.00 | 0.75 | — | 0.00 |
| Saliba | DF | 79 | measured | 1/0 | 0.00 | 0.75 | — | 0.00 |
| Fofana | MF | 88 | measured | 6/0 | 0.00 | 0.75 | — | 0.00 |
| Rabiot | MF | 88 | measured | 6/1 | 0.00 | 0.75 | — | 0.00 |
| Tchouaméni | MF | 88 | measured | 7/1 | 0.00 | 0.75 | — | 0.00 |
| Camavinga | MF | 81 | measured | 2/0 | 0.00 | 0.75 | — | 0.00 |
| Guendouzi | MF | 76 | measured | 1/0 | 0.00 | 0.75 | — | 0.00 |
| Veretout | MF | 76 | measured | 1/0 | 0.00 | 0.75 | — | 0.00 |
| Mbappé ★ | FW | 98 | stature | 7/8 | 0.97 | 0.75 | 0.858 | 1.00 |
| Benzema ★ | FW | 92 | stature | 0/0 | 0.00 | 0.75 | 0.728 | 1.00 |
| Griezmann | FW | 92 | stature | 7/0 | 0.00 | 0.75 | 0.634 | 1.00 |
| Dembélé ★ | FW | 89 | stature | 7/0 | 0.00 | 0.75 | 0.507 | 1.00 |
| Giroud | FW | 88 | measured | 6/4 | 0.45 | 0.75 | 0.241 | 0.00 |
| Kolo Muani | FW | 88 | measured | 3/1 | 0.00 | 0.75 | — | 0.00 |
| Coman | FW | 82 | measured | 6/0 | 0.00 | 0.75 | — | 0.00 |
| Thuram | FW | 82 | measured | 5/0 | 0.00 | 0.75 | — | 0.00 |

---

## G. T6 — Named probe: Valverde-2022 counterfactual

**Setup (read-only, no shipped change):** re-ran the production historical path
(`rating.build_internal_view`) with a synthetic career-stature row injected for
Valverde (P-05174) at swept index values (coverage 1.0, tier from the production
thresholds), display held on the **production curve** (anchors unchanged). Base card:
WC-2022, MF, raw 0.4697 (= the (WC-2022, MF) cohort reference → modulation 0), no
archive row → 76.

| injected index | weight | stature target (MF) | internal | **display OVR** | basis |
|---|---|---|---|---|---|
| (none — shipped) | 0.000 | — | 46.97 | **76** | measured |
| 0.300 | 0.000 | — | 46.97 | **76** | measured |
| 0.350 | 0.083 | 0.600 | 48.05 | **77** | measured |
| 0.398 (= Godín) | 0.483 | 0.600 | 53.27 | **81** | measured |
| **0.420** | 0.667 | 0.613 | 56.54 | **84** | career_stature_estimate |
| 0.460 | 1.000 | 0.640 | 64.00 | **88** | career_stature_estimate |
| 0.500 | 1.000 | 0.667 | 66.67 | **88** | career_stature_estimate |
| 0.550 | 1.000 | 0.700 | 70.00 | **89** | career_stature_estimate |
| 0.600 | 1.000 | 0.733 | 73.33 | **89** | career_stature_estimate |

**Reading:** the owner's instinct (83–84) corresponds to index ≈ **0.42**. Where would
a curated career-to-2026 record land him? The in-archive peer band for his profile
(national-team captain, serial club honors, no global award podium) is exactly there:
Godín 0.398 · Carlos Alberto 0.492 · Zoff 0.523 · Passarella 0.529 (vs Cafu 0.656 and
Cannavaro 0.827 for podium-class defenders). **Conclusion: Audit-1's D2
(active-career recognition intake) fixes Valverde-2022 organically at a defensible
index — he lands 81–88 across the whole plausible band, centered on the owner's
number. He is hereby proposed as a named 12b acceptance probe** (§H.2). No further
mechanism is needed for him; the per-tournament measured treatment of his group-exit
2022 (raw 0.4697 → 76) is fair *within* the measured world.

**Two design caveats for 12b from this sweep:**
1. **Band compression above the pile:** internal 64 → 88 but internal 73.3 → still 89
   (the p95 anchor sits ON the 1,244-card pile). Newly material actives will bunch at
   88–89 until the 12b regen dissolves the pile and the refit curve decompresses the
   84–91 band. Counterfactual numbers above are indicative under the FROZEN curve;
   the shipped 12b numbers will shift with the refit (expected: slightly up).
2. The counterfactual basis flips to `career_stature_estimate` at 0.42+ — 12b's
   acceptance gate should assert basis transitions, not just OVR deltas.

### T6-b — Similar high-profile group/early-exit cases (mini-list)

Players whose 2026 career inputs are elite (projected raw ≥ 88, weight 0) but whose
recent historical cards sit ≤ 80 — i.e., the "Valverde-2022 class" of cards a D2
stature row would lift in the SAME pass (the historical path reads the same archive):
Lukaku-2022 71, Goretzka-2018 71 / -2022 76, B. Fernandes-2018 72, Partey-2022 76,
Kovačić-2014 75, Bentancur-2022 76, Tielemans-2022 76, Witsel-2022 76, Gueye-2018 74.
Full 57-pair join:

## T6-b Group/early-exit candidates: elite 2026 career inputs (proj raw >= 88, no stature row) with weak 2014+ historical cards (hist OVR <= 80) — 57 pairs
| hist card | pos | hist OVR | hist inputs | 2026 OVR | 2026 career inputs |
|---|---|---|---|---|---|
| Elvedi (Switzerland 2018) | DF | 68 | apps 0 (p0.09), goals 0 (p0.45), award 0.00, finish — · stature idx —/w 0.00 | 88 | caps 66, goals 3, raw 90.6 |
| Endo (Japan 2018) | DF | 68 | apps 0 (p0.09), goals 0 (p0.45), award 0.00, finish — · stature idx 0.040/w 0.00 | 88 | caps 73, goals 4, raw 89.6 |
| Lo Celso (Argentina 2018) | MF | 70 | apps 0 (p0.06), goals 0 (p0.42), award 0.00, finish — · stature idx —/w 0.00 | 88 | caps 65, goals 4, raw 90.9 |
| Freuler (Switzerland 2018) | MF | 70 | apps 0 (p0.06), goals 0 (p0.42), award 0.00, finish — · stature idx —/w 0.00 | 88 | caps 87, goals 11, raw 90.5 |
| Jiménez (Mexico 2014) | FW | 71 | apps 1 (p0.13), goals 0 (p0.30), award 0.00, finish — · stature idx 0.100/w 0.00 | 88 | caps 123, goals 44, raw 90.7 |
| Digne (France 2014) | DF | 71 | apps 1 (p0.27), goals 0 (p0.47), award 0.00, finish — · stature idx —/w 0.00 | 88 | caps 56, goals 0, raw 88.9 |
| Lukaku (Belgium 2022) | FW | 71 | apps 2 (p0.29), goals 0 (p0.33), award 0.00, finish — · stature idx 0.251/w 0.00 | 88 | caps 125, goals 90, raw 91.7 |
| Goretzka (Germany 2018) | MF | 71 | apps 1 (p0.18), goals 0 (p0.42), award 0.00, finish — · stature idx —/w 0.00 | 88 | caps 69, goals 15, raw 92.5 |
| Larin (Canada 2022) | FW | 72 | apps 3 (p0.54), goals 0 (p0.33), award 0.00, finish — · stature idx 0.048/w 0.00 | 88 | caps 89, goals 30, raw 93.0 |
| Elvedi (Switzerland 2022) | DF | 72 | apps 2 (p0.43), goals 0 (p0.46), award 0.00, finish — · stature idx —/w 0.00 | 88 | caps 66, goals 3, raw 90.6 |
| Ayew (Ghana 2014) | FW | 72 | apps 3 (p0.54), goals 0 (p0.30), award 0.00, finish — · stature idx —/w 0.00 | 88 | caps 120, goals 34, raw 90.7 |
| Ayew (Ghana 2022) | FW | 72 | apps 3 (p0.54), goals 0 (p0.33), award 0.00, finish — · stature idx —/w 0.00 | 88 | caps 120, goals 34, raw 90.7 |
| Sarr (Senegal 2018) | FW | 72 | apps 3 (p0.59), goals 0 (p0.35), award 0.00, finish — · stature idx —/w 0.00 | 88 | caps 82, goals 19, raw 91.8 |
| Fernandes (Portugal 2018) | MF | 72 | apps 2 (p0.33), goals 0 (p0.42), award 0.00, finish — · stature idx 0.200/w 0.00 | 88 | caps 87, goals 28, raw 98.9 |
| Kubo (Japan 2022) | MF | 72 | apps 2 (p0.43), goals 0 (p0.44), award 0.00, finish — · stature idx —/w 0.00 | 88 | caps 49, goals 7, raw 90.3 |
| David (Canada 2022) | FW | 72 | apps 3 (p0.54), goals 0 (p0.33), award 0.00, finish — · stature idx 0.158/w 0.00 | 88 | caps 76, goals 39, raw 91.9 |
| Jiménez (Mexico 2018) | FW | 72 | apps 2 (p0.33), goals 0 (p0.35), award 0.00, finish — · stature idx 0.100/w 0.00 | 88 | caps 123, goals 44, raw 90.7 |
| Jiménez (Mexico 2022) | FW | 72 | apps 3 (p0.54), goals 0 (p0.33), award 0.00, finish — · stature idx 0.100/w 0.00 | 88 | caps 123, goals 44, raw 90.7 |
| Hwang (South Korea 2018) | FW | 72 | apps 3 (p0.59), goals 0 (p0.35), award 0.00, finish — · stature idx —/w 0.00 | 88 | caps 79, goals 17, raw 98.9 |
| Embolo (Switzerland 2018) | FW | 73 | apps 4 (p0.81), goals 0 (p0.35), award 0.00, finish — · stature idx —/w 0.00 | 88 | caps 86, goals 24, raw 90.0 |
| Silva (Portugal 2022) | FW | 73 | apps 5 (p0.89), goals 0 (p0.33), award 0.00, finish — · stature idx 0.243/w 0.00 | 88 | caps 107, goals 14, raw 98.8 |
| Kolašinac (Bosnia and Herzegovina 2014) | DF | 73 | apps 2 (p0.43), goals 0 (p0.47), award 0.00, finish — · stature idx —/w 0.00 | 88 | caps 64, goals 0, raw 88.1 |
| Irvine (Australia 2018) | MF | 74 | apps 3 (p0.56), goals 0 (p0.42), award 0.00, finish — · stature idx —/w 0.00 | 88 | caps 81, goals 14, raw 91.6 |
| Gueye (Senegal 2018) | MF | 74 | apps 3 (p0.56), goals 0 (p0.42), award 0.00, finish — · stature idx 0.060/w 0.00 | 88 | caps 130, goals 7, raw 91.4 |
| Skhiri (Tunisia 2018) | MF | 74 | apps 3 (p0.56), goals 0 (p0.42), award 0.00, finish — · stature idx —/w 0.00 | 88 | caps 82, goals 4, raw 89.2 |
| Lee (South Korea 2018) | MF | 74 | apps 3 (p0.56), goals 0 (p0.42), award 0.00, finish — · stature idx —/w 0.00 | 88 | caps 105, goals 15, raw 93.3 |
| Kovačić (Croatia 2014) | MF | 75 | apps 3 (p0.62), goals 0 (p0.41), award 0.00, finish — · stature idx 0.050/w 0.00 | 88 | caps 112, goals 5, raw 94.1 |
| Valverde (Uruguay 2022) | MF | 76 | apps 3 (p0.64), goals 0 (p0.44), award 0.00, finish — · stature idx —/w 0.00 | 88 | caps 73, goals 9, raw 95.7 |
| Partey (Ghana 2022) | MF | 76 | apps 3 (p0.64), goals 0 (p0.44), award 0.00, finish — · stature idx —/w 0.00 | 88 | caps 57, goals 15, raw 92.5 |
| Diatta (Senegal 2022) | MF | 76 | apps 3 (p0.64), goals 0 (p0.44), award 0.00, finish — · stature idx —/w 0.00 | 88 | caps 60, goals 2, raw 89.1 |
| Gueye (Senegal 2022) | MF | 76 | apps 3 (p0.64), goals 0 (p0.44), award 0.00, finish — · stature idx 0.060/w 0.00 | 88 | caps 130, goals 7, raw 91.4 |
| Skhiri (Tunisia 2022) | MF | 76 | apps 3 (p0.64), goals 0 (p0.44), award 0.00, finish — · stature idx —/w 0.00 | 88 | caps 82, goals 4, raw 89.2 |
| Tielemans (Belgium 2022) | MF | 76 | apps 3 (p0.64), goals 0 (p0.44), award 0.00, finish — · stature idx —/w 0.00 | 88 | caps 84, goals 13, raw 98.5 |
| Witsel (Belgium 2022) | MF | 76 | apps 3 (p0.64), goals 0 (p0.44), award 0.00, finish — · stature idx 0.062/w 0.00 | 88 | caps 137, goals 12, raw 92.0 |
| Castagne (Belgium 2022) | MF | 76 | apps 3 (p0.64), goals 0 (p0.44), award 0.00, finish — · stature idx —/w 0.00 | 88 | caps 62, goals 2, raw 92.8 |
| Bentancur (Uruguay 2022) | MF | 76 | apps 3 (p0.64), goals 0 (p0.44), award 0.00, finish — · stature idx —/w 0.00 | 88 | caps 74, goals 3, raw 91.2 |
| Goretzka (Germany 2022) | MF | 76 | apps 3 (p0.64), goals 0 (p0.44), award 0.00, finish — · stature idx —/w 0.00 | 88 | caps 69, goals 15, raw 92.5 |
| Lee (South Korea 2022) | MF | 76 | apps 3 (p0.64), goals 0 (p0.44), award 0.00, finish — · stature idx —/w 0.00 | 88 | caps 105, goals 15, raw 93.3 |
| Mandi (Algeria 2014) | DF | 78 | apps 3 (p0.62), goals 0 (p0.47), award 0.00, finish — · stature idx 0.053/w 0.00 | 88 | caps 117, goals 7, raw 90.5 |
| Giménez (Uruguay 2014) | DF | 78 | apps 3 (p0.62), goals 0 (p0.47), award 0.00, finish — · stature idx —/w 0.00 | 88 | caps 99, goals 8, raw 96.3 |

---

## H. T7 — Synthesis for MV2-12b

### H.1 Consolidated candidate-misratings table (deduped across T1–T6, severity-ranked)

Severity: **S1** = live distortion a user can see today, mechanism confirmed ·
**S2** = systematic class with named victims, fix = 12b scope · **S3** = advisory /
design-ratification.

| # | sev | card(s) / cohort | now | class | evidence | expected fix path |
|---|---|---|---|---|---|---|
| 1 | S1 | **Neymar 2026** | 88, no legend | identity link miss (mononym) | §H.3; hist 93/93/93, idx 0.682, legend | link-seam fix unit (pre-12b) |
| 2 | S1 | **Rodri 2026** | 88, no legend | identity link miss (`"not applicable"` name pollution) | §H.3; hist 89, idx 0.527, legend; reigning Ballon d'Or | link-seam fix unit |
| 3 | S1 | 15 further minted link misses (Casemiro, Alisson, Ederson, Marquinhos, Fabinho, Raphinha, Weverton, Bremer, Danilo, Pacho, Trézéguet, Vitinha, Pedri, Gavi, C. Devlin) | various | identity link miss | §H.3 | link-seam fix unit |
| 4 | S2 | **Pelé** (idx 0.807, silver, rank 45; best card 97) | 97 | archive era/eligibility bias | §C; no global_annual_recognition (Ballon d'Or Europeans-only <1995) | 12b index re-normalization |
| 5 | S2 | **Cruyff** 0.755 / **Garrincha** 0.723 / Di Stéfano 0.774 / Yashin 0.738 / Charlton 0.748 | 95/94/92/92/95 | archive era/eligibility bias | §C | 12b index re-normalization |
| 6 | S2 | **Kocsis idx 0.992 = #1 all-time**; Piola 0.911, Albert 0.872, Owen 0.789 > Cruyff; 2–3-fact entries at 0.78–0.86 (Boniperti, Ocwirk, Andrade, Hanappi, Scarone) | 94–99 | sparse-fact index inflation | §C | 12b index re-normalization (fact-count/coverage shrinkage) |
| 7 | S2 | **E. Martínez 2022** (Golden Glove, champion, raw 100) | 88 | measured ceiling vs award-anchored perf | §E | 12b ceiling treatment / D2 row |
| 8 | S2 | Schumacher 1986 (raw 100) · Vavá 1962 (raw 100) · Jairzinho 1970 (94.8) · **Forlán 2010 (Golden Ball)** · Klose 2006 (Golden Boot) | 88 | measured ceiling | §E | 12b ceiling treatment |
| 9 | S2 | **Haaland 2026** (49c/55g) · Valverde 2026 (95.7) · Pedri 88 · Wirtz 88 · B. Fernandes 98.9 | 88 | C1+C3 (Audit-1), more names | §E | D1+D2 |
| 10 | S2 | **Yamal 2026** | 79 | youth double penalty (Audit-1 C3) | Audit-1 §B.2 | D1+D2 |
| 11 | S2 | **Vinícius Júnior 2026** | 87, idx 0.200 | frozen archive (C1) on a LINKED player | §B | D2 re-curation |
| 12 | S2 | **Klose** idx 0.395 (gate 0.40) → best 88 · Sócrates 0.396 → 88 · Godín 0.398 → 88(2014)/81 | 88 | material-gate knife edge | §F | 12b: ramp already smooths; needs fact re-curation, not gate move |
| 13 | S2 | **Busquets 0.066 · X. Alonso 0.052 · Lloris 0.067 · Deschamps 0.209 · Desailly 0.160** | 88 | archive holes: unsung-role greats (extends MV2-9 beyond DF/GK) | §F | D2 family for non-podium leadership |
| 14 | S2 | Champion-GK class (Marcos, Pumpido, Illgner, Gilmar, Taffarel, Félix, Fillol, Banks, Maier) | 88 | MV2-9 GK under-credit, drawn per-card | §D | MV2-3.5-style GK families |
| 15 | S2 | Valverde 2022 | 76 | frozen archive (C1) | §G counterfactual: idx 0.42 → 84 | D2 (named probe) |
| 16 | S2 | T6-b class (Lukaku-2022 71, B. Fernandes-2018 72, Goretzka, Partey, Bentancur, Kovačić…) | 71–76 | frozen archive on historical cards of actives | §G | D2 (same pass) |
| 17 | S2 | Legend-flag vs display disagreement: Piola/Albert/Walter/Bozsik/Cea/Ocwirk/Andrade/Hanappi/Boniperti/Santos = 94–99 NOT-LEGEND | 94–99 | flag/band inconsistency | §C | 12b legend re-derivation |
| 18 | S3 | Stature down-cap insensitivity: Rossi-1986 94 (0 apps) · Zidane-2002 95 (1 app) · Messi-2010 98 (0 goals) · Kahn-1994 89 · Eto'o-2014 89 · Keegan-1982 92 · Matthews-1950 93 | 89–98 | design: TOURNAMENT_DOWN_CAP 0.05–0.12 | §D | owner ratifies or 12b widens down-cap |
| 19 | S3 | Champion-reserve compression: 0-app reserves at 87–88 (Brazil-1970 GKs, Argentina-2022 GKs, Bordon/Galli-1982) | 87–88 | finish-anchor weight on 0-app cards | §F | owner call (display-only feel) |
| 20 | S3 | 88-wall squad monotony (Argentina-2022: 19×88; Argentina-1986: 16×88; Brazil-1970: 10×88) | 88 | display artifact of the pile (Audit-1 §B.4) | §F | dissolves with 12b internal fix + curve refit; do NOT patch curve alone |
| 21 | S3 | GK display ceiling 93 (Buffon) vs 10 outfield 99s | ≤93 | recognition-bias residue | §B | monitor after #14 |

### H.2 Proposed 12b acceptance-probe set (named cards, gate assertions)

Expected-movers (direction asserted, magnitude indicative under the frozen curve):

| probe | now | expect after 12b (D1+D2) | asserts |
|---|---|---|---|
| Yamal 2026 | 79 | ≥ 85 | C3 youth fix |
| Haaland 2026 | 88 | > 88 | ceiling escape, minted+D2 |
| Valverde 2026 | 88 | 89–91 | D2 captaincy/club-honors family |
| **Valverde 2022** | 76 | 81–88 (center ~84) | D2 reaches historical cards of actives |
| Rodri 2026 (after link fix) | 88 | ≥ 89 **+ legend badge** | link fix + archive consult |
| Neymar 2026 (after link fix) | 88 | ~92–93 **+ legend badge** | link fix alone (no model change needed) |
| Vinícius Júnior 2026 | 87 | ≥ 90 | D2 re-curation of linked actives |
| E. Martínez 2022 | 88 | > 88 | D2 active-career GK row (or explicit owner waiver) |
| Lukaku 2022 | 71 | ≥ ~80 | T6-b class |
| B. Fernandes 2018 | 72 | ↑ | T6-b class |
| Aït-Nouri 2026 | 83 | mid-80s | D1 (Audit-1 §D1) |
| Gavi 2026 | 84 | ↑ modest | D1 U22 cohort |
| Klose 2014 | 88 | > 88 | gate knife-edge resolved by fact curation |
| Pelé 1970 | 97 | ≥ Maradona/Messi tier **iff** index re-normalization is in 12b scope | archive bias (declare scope explicitly) |
| Cruyff 1974 | 95 | ↑ iff index re-normalization in scope | archive bias |

Should-NOT-move controls (zero or ≤1 rounding-grain movement):

| control | now | guards against |
|---|---|---|
| Perlaza 2026 | 68 | fringe inflation (no facts → no lift) |
| Khalil Ayari 2026 | 71 | youth-cohort overcorrection |
| Dempsey 2010 | 88 | historical measured path untouched |
| Boufal 2022 | 88 | historical measured path untouched |
| Messi 2010 | 98 | stature path stability |
| Kocsis 1954 | 99 | D1/D2 must NOT silently move the archive top (index work is a separate, explicit decision) |
| Cesare Maldini 1962 | 71 | Audit-1 ruling stands (UX fix only) |
| Q. Timber 2026 | 72 | link fix must not merge the twins (§H.3) |

### H.3 New defect #1 — 2026 identity-seam link misses (NOT explained by Audit-1)

**Probe:** exact `birth_date` join between minted 2026 players and the historical
`players.json`, surname-containment filtered, then per-pair human verification of
the 22 raw hits → **17 true misses, 5 true negatives** (same-name different people:
E. Martínez (URU 1999) ≠ Dibu (correctly linked separately), L. Suárez (COL 1997),
Mokoena (b.1997 vs 1974), Fathy (Qatar b.1993), A. González (MEX b.2003)) and the
**Timber twins** (identical birth date, correctly separate people — a trap for any
naive birth-date join).

| player | minted 2026 (OVR) | historical cards | archive idx | live impact |
|---|---|---|---|---|
| Neymar | 88 | 2014:93 · 2018:93 · 2022:93 | 0.682, legend | **−5 OVR + lost legend badge TODAY** |
| Rodri | 88 | 2022:89 | 0.527, legend | ~−1 OVR + lost legend badge |
| Casemiro | 88 | 2018:79 · 2022:88 | — | provenance only (no row → same 88) |
| Alisson | 88 | 2018:88 · 2022:88 | — | provenance only |
| Marquinhos | 88 | 2018:71 · 2022:88 | 0.046 | provenance only |
| Ederson | 75 | 2018:71 · 2022:78 | — | provenance only |
| Raphinha | 88 | 2022:73 | — | provenance only |
| Pedri | 88 | 2022:80 | — | provenance only |
| Gavi | 84 | 2022:88 | — | provenance only |
| Danilo | 85 | 2018:71 · 2022:79 | — | provenance only |
| Weverton | 72 | 2022:78 | — | provenance only |
| Fabinho | 71 | 2022:71 | — | provenance only |
| Bremer | 71 | 2022:72 | — | provenance only |
| Vitinha | 76 | 2022:76 | — | provenance only |
| Pacho | 83 | 2022:68 | — | provenance only |
| Trézéguet (EGY) | 79 | 2018:74 | — | provenance only |
| C. Devlin | 70 | 2022:70 | — | provenance only |

**Mechanisms (both name-form):** (a) mononyms/nicknames — the 2026 squad wikitext
carries "Casemiro"/"Rodri"/"Pedri" while the historical `full_name` is either the
long legal name or polluted; (b) **474 historical players have
`given_name = "not applicable"`**, which corrupts `full_name`
(`"not applicable Rodri"`) and defeats any full-name match. "Provenance only" rows
still matter: under D2 every one of these players would be barred from a future
archive row exactly like Yamal (Audit-1 C1's link gate), so the miss count becomes a
rating distortion the moment 12b ships. **Recommendation: a small Red-tier
identity-seam fix unit (birth_date + nation + surname disambiguation, twins-safe)
BEFORE 12b integration; it changes ratings for Neymar/Rodri immediately
(compact regen + canary chain applies).**

### H.4 New defect #2 — within-archive index normalization bias (12b design input)

Audit-1 established the archive is *frozen in time* (C1). This audit adds that it is
also **skewed across its own eras and fact-density classes**: (a) pre-1995
non-European(-club) players cannot have `global_annual_recognition` facts (Ballon
d'Or eligibility), depressing Pelé/Garrincha/Di Stéfano-class indexes; (b) sparse
2–3-fact profiles built on `retrospective_selection` reach 0.78–0.99
(Kocsis #1 overall), out-ranking 15–69-fact modern profiles; (c) unsung-role greats
(holding MF, non-podium captains, winning GKs) have near-zero indexes (0.05–0.25).
If 12b re-normalizes the index (career-stage normalization is already in D2's
spec), it should ALSO decide explicitly whether era/eligibility re-weighting and
fact-count shrinkage are in scope — otherwise D2 will mint accurate rows for actives
onto a reference scale whose top (Kocsis 0.992) and middle (Pelé 0.807) are
themselves misordered. **This changes 12b's design: the index scale is not a fixed
truth to map onto.**

### H.5 / H.6 Advisory design questions (owner ratification, not bugs)

- **Down-cap (H.1 #18):** `TOURNAMENT_DOWN_CAP` (0.05–0.12) keeps a gold-tier
  legend's 0-app tournament within ~6 internal points of their target → Rossi-1986
  shows 94. If cards are meant to read as "this player AT this tournament", the cap
  is too tight; if they read as "this player, tournament-flavored", it is working as
  designed. One knob, global blast radius — needs an explicit owner stance before
  12b re-locks goldens.
- **Reserve compression (H.1 #19):** `team_finish` (weight 0.16–0.2) is the only
  signal a 0-app card has, so champion reserves land 87–88, one point under
  champions who played every minute. Bounded, honest-input behavior — but it reads
  as a misrating on every famous-squad sheet (T5).

### H.7 Out-of-scope confirmations

- No fixes, no rating changes, no ETL modifications shipped. The counterfactual ran
  in-memory against committed inputs.
- No external rating-system data consulted anywhere (IP hard line); plausibility
  judgments are world knowledge + in-repo numbers only.

---

### Appendix: reproduction

```bash
cd etl && python3 - << 'PY'
import sys; sys.path.insert(0, 'src')
from pathlib import Path
from wcdraft_etl import rating, rating_2026, display_curve
out = Path('output')
internal_hist, _ = rating.build_internal_view(
    players=rating._load(out, "players"),
    cards=rating._load(out, "player_tournaments"),
    tournaments=rating._load(out, "tournaments"),
    manager_tournaments=rating._load(out, "manager_tournaments"),
    career_stature_by_player=rating._load_career_stature(out))
curve = display_curve.fit_unified_curve(out)  # 20.0 / 43.2551552 / 62.0 / 100.0
cards26 = rating._load(out, "player_tournaments_2026")
internal_proj = rating_2026._build_internal_rows(
    cards26, rating_2026._load_career_stature(out),
    rating_2026._historical_raw_only_internal(out))
# verification: _display_score(row, curve, estimate=basis=='baseline_anchor_estimate')
# matches committed `overall` 12,219/12,219.
PY
```

Inputs: committed `etl/output/*.json` at `b4f8651`. Counterfactual injection:
synthetic career-stature row {index, coverage 1.0, tier per production thresholds}
for P-05174 through `build_internal_view`, display on the frozen production curve.
