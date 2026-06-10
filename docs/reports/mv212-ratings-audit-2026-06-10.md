# MV2-12 Pre-Work — Cross-Era Ratings Audit (DIAGNOSTIC ONLY)

- **Date:** 2026-06-10 · **Branch:** `ws-etl/mv212-ratings-audit` off main `48d87c0`
- **Scope:** report + queue update only. ZERO changes to engine, data bundles, ratings,
  or app code.
- **Method:** every number below was computed by executing the production rating code
  (`rating.build_internal_view`, `rating_2026._build_internal_rows`,
  `display_curve.fit_unified_curve`) against the committed canonical tables in
  `etl/output/`. **Determinism proof:** the rebuilt internal scores, passed through the
  rebuilt unified curve, reproduce the committed `overall` for **12,219 / 12,219 cards
  (0 mismatches)** — the analysis pipeline IS the production pipeline.
- **Versions audited:** historical `wc-perf-4.2.1` · projected `proj-career-3.0.0` ·
  curve `unified_pooled_piecewise_power_v1` · engine `engine-2026.06.09` (not consulted
  for `overall`; display is ETL-side).

## TL;DR

1. **"Maldini 71" is Cesare Maldini (WC-1962), not Paolo.** Paolo's four cards display
   93–94. No Daniel Maldini card exists. The rating is defensible; the defect is
   surname-only display ambiguity (UX follow-up, §E).
2. **"Valverde 76" was his WC-2022 historical card** (3 apps, 0 goals, group exit —
   per-tournament measured). His 2026 projected card displays **88 — the maximum any
   non-stature card can reach** (see 3).
3. **The owner's working hypothesis is confirmed, with a sharper mechanism than
   "under-credits in-progress careers":** the ONLY path above internal 62 (display 88)
   is the career-stature blend (`rating.py:698` caps the raw path at
   `RAW_ONLY_GLOBAL_CEILING = 0.62` in BOTH eras), and the career-stature archive
   contains **zero in-progress careers** — 791 players, `career_peak_year` max **2022**,
   0 entries ≥ 2023; 2026 minted players are structurally barred from it by the link
   gate; only 69/335 linked 2026 players have a row. So Yamal's ceiling is 88 *no matter
   what his merit inputs say*, while 466 historical stature-lifted cards sit above 88.
4. The defect is **internal-score-level**, as the invariant predicts (§B.4). The display
   curve is order-preserving; it adds one artifact (a 12% pile-up at display 88) but
   introduces no inversion.
5. **Go: promote q-002 to an MV2-12 dispatch** with option **D2 (active-career
   recognition intake) + D1 (career-stage normalization of the projected raw path)**
   as the recommended scope (§F).

---

## A. Named-card forensics

### A.1 The three flagged cards — exact identity and arithmetic

Display curve (fit on the pooled 12,219 internal scores): internal 20.0 → 66 ·
43.255 (pool median) → 73 · **62.0 (pool p95) → 88** · 100 → 99. Mid segment is linear;
high segment is `88 + 11·t^1.85`. Note the p95 anchor lands **exactly on the 0.62
raw-only ceiling** because 1,244 cards pile up at internal 62.0 (the p95 quantile falls
inside the pile).

| Card | Identity | Internal | OVR | Basis | Decomposition |
|---|---|---:|---:|---|---|
| `P-34023:WC-1962` | **Cesare** Maldini, ITA DF, age 30 at WC-1962 | 35.89 | **71** | measured | 2 apps (pct 0.331, w=1.0), 0 awards, `team_finish` null (group exit), no career-stature row → raw 0.3589. Low segment: 66 + 7·0.683^0.65 = 71.5 → 71 |
| `P-W26-0680:WC-2026` | Lamine Yamal, ESP FW, age 18, **minted** (no historical WC → link gate bars career stature) | 50.51 | **79** | measured | caps 25 → pct **0.502**, goals 6 → pct **0.595** (all-age FW cohort); blend 0.5715 × **age_factor 0.8286** → base 0.4273; + league 0.31 → projected_raw 0.7373; quantile-mapped onto historical raw-only internals → 0.5051. Mid segment: 73 + 15·0.387 = 78.8 → 79 |
| `P-05174:WC-2022` | Federico Valverde, URU MF (the card the reveal slotted) | 46.97 | **76** | measured | 3 apps (pct 0.642), 0 goals (pct 0.442), no award, finish null, **no career-stature row** (active player, archive ends at peak-year 2022) → raw = internal 0.4697 → 76 |

Every Maldini in the pool: Cesare `WC-1962` = 71 (above); Paolo `P-43222` 1990 **94**,
1994 **94**, 1998 **93**, 2002 **93** (all `career_stature_estimate`, legend=true,
index 0.750, weight 1.0 — e.g. 1990: target 0.822 + mod 0.07 → internal 89.19 → 94).
No Daniel Maldini card exists in either pool. Both players carry `common_name`
**"Maldini"** in `players.json` — the reveal cannot distinguish them.

Every Yamal: exactly one card (above). Every Valverde (P-05174): WC-2022 = 76,
WC-2026 = **88** at internal **exactly 62.000** — he is linked but has **no career-stature
row**, so weight 0 → his projected raw 0.957 (caps 73 pct 0.877, goals 9 pct 0.858,
age 27 → af 1.0, league 1.0) quantile-maps above the ceiling and **clamps to 0.62**.
88 is the highest OVR he can possibly display under proj-career-3.0.0.

### A.2 The comparators — where the inversion comes from

| Card | Internal | OVR | Basis | What drives it |
|---|---:|---:|---|---|
| Dempsey `WC-2010` / `WC-2014` | 61.42 / 61.45 | **88** / **88** | measured | 2010: 1 goal / 4 apps → goals pct **0.911** in the 2010 MF cohort → raw 0.614, just under the ceiling. Stature row exists (index 0.115) but weight ramps to 0 → pure raw. Mid segment t = 0.969 → 87.5 → 88 |
| Kahn `WC-2002` | 84.21 | **92** | career_stature_estimate | award_score **1.0** (Golden Ball 2002) inside raw; but the score is stature-driven: index 0.719 → weight 1.0, target 0.58 + 0.38·0.532 = 0.782, +mod 0.06 → 0.842 → 92 |
| Godín `WC-2010` | 64.40 | **88** | measured | index 0.398 → weight **0.481** (just under dominance): final = 0.481·(0.60+0.07) + 0.519·**min(0.736, 0.62)** = 0.644. The retired-player stature row lifts him over the ceiling Valverde-2022 cannot cross |
| Boufal `WC-2022` | 62.00 | **88** | measured | raw 0.631 (7 apps, pct 0.978 + Morocco semifinal finish 0.4) **clamped to the 0.62 ceiling** |

**The exact component creating the inversion:** the career-stature blend weight.
Historical cards of *retired* players get `weight > 0` from the archive (Godín 0.48,
Kahn 1.0, Paolo Maldini 1.0); cards of *active* players (Valverde, Boufal) and all
minted 2026 players get `weight = 0` — not because their careers lack merit, but because
the archive has no row for anyone whose career was still running when the source set was
curated (peak-year max 2022, 0 entries ≥ 2023). Within the measured-only world the model
is cross-era fair (§B.3); the unfairness enters entirely through who is *allowed* a
stature row.

## B. Cohort-level quantification

### B.1 Display OVR distribution by provenance class (n = 12,219)

| Cohort | n | p10 | p50 | p90 | mean | max |
|---|---:|---:|---:|---:|---:|---:|
| Historical (all) | 10,973 | 70 | 73 | 88 | 76.8 | 99 |
| — measured_performance | 10,101 | 71 | 73 | 88 | 76.4 | **88** |
| — career_stature_estimate | 486 | 88 | 91 | 98 | 91.7 | 99 |
| — baseline_anchor_estimate | 386 | 66 | 66 | 72 | 67.4 | 73 |
| Projected 2026 (all) | 1,246 | 70 | 73 | 88 | 76.3 | 99 |
| — measured (incl. all minted) | 1,230 | 70 | 73 | 88 | 76.1 | **88** |
| — career_stature_estimate | 16 | 89 | 91 | 98 | 92.6 | 99 |
| — minted subset | 911 | 69 | 72 | 83 | 74.0 | **88** |
| — linked subset | 335 | 73 | 84 | 88 | 82.5 | 99 |

The eras' aggregate distributions match (that was MV2-5/MV2-6's goal and it holds). The
split by basis exposes the structure: **measured caps at 88 in both eras; everything
above 88 is stature-path**, and the 2026 pool gets exactly 16 stature cards (the
Messi/Modrić/Mbappé linked-material tier) vs 486 historical.

### B.2 Modern-elite probe (own merit data only — no external rating systems)

Top minted-2026 cards by internal score are **all caps-accumulating veterans at the
62.0 cap → 88**: Bensebaini (81 caps), Amoura, N. González, **Alaba (113 caps)**,
Sabitzer (98), Gregoritsch, Posch, Laimer, **Casemiro (85)**, **Alisson (77)**,
Marquinhos (104), Muñoz, L. Díaz, Coufal, Souček. The career-totals percentile is a
longevity detector, not a quality detector.

Consensus-elite young actives land mid-pack: **Yamal is rank 175 of 911 minted
(rank 412 of 1,246 projected) at OVR 79** — inside the historical *measured mid-tier*,
below 1,469 cards displaying 88, below Dempsey/Godín/Boufal, and below ~45-cap
journeyman veterans in his own cohort. The age signal that would distinguish him is in
our data but unused: against the **U21 FW 2026 cohort (n=31)** his caps percentile is
**0.919** and goals percentile **0.935** (vs 0.502/0.595 all-age) — the cohort's median
caps is 8; Yamal has 25 at age 18.

### B.3 Inversion rate

Operationalization (own-data only): for every (historical, projected) pair of
**measured-basis** cards, the projected card's merit inputs "dominate" when its
percentile within its own pool's raw-merit composite exceeds the historical card's
percentile within the historical raw composite (this is exactly the quantity MV2-5's
quantile map equates cross-era). Result: of **6,111,118** projected-dominant pairs,
the historical card displays strictly higher OVR in **16,278 = 0.27%** (rounding-grain
noise). **Measured-vs-measured is cross-era fair.**

The inversion mass lives entirely in the stature channel: **466 historical
`career_stature_estimate` cards sit above internal 62** and therefore outrank **all
1,230 non-stature 2026 cards regardless of merit inputs** — 573,180 pairs of
structurally guaranteed historical dominance, of which the Yamal-vs-Dempsey-tier cases
are the visible subset. (A further 45 historical measured cards sit above 62 via partial
stature weight, e.g. Godín.)

### B.4 Display curve: compress or amplify?

The unified curve is one monotone function applied to both eras, so it **cannot create
or remove a single ordering inversion** — the defect is fully present at internal-score
level, as the invariant requires us to expect, and is proven by the structural cap:
`min(raw, 0.62)` is applied to the internal score (`rating.py:698`,
`rating_2026.py:475-478`) *before* any display mapping. The curve does add one
**display artifact**: 1,244 cards sit at internal exactly 62.0 and the p95 anchor sits
exactly there, so **12.0% of all cards display exactly 88** (1,322 historical + 147
projected) — which is why the owner's single reveal contained three unrelated 88s
(Dempsey, Godín, Boufal). The 84–90 band is effectively "at or near the ceiling."

## C. Mechanism isolation

| # | Mechanism | Verdict | Evidence |
|---|---|---|---|
| C1 | **Stature accrual truncation** | **CONFIRMED — primary, and stronger than hypothesized: not truncated accrual but total absence** | Archive = 791 players, peak-year median 2002, max **2022**, 0 ≥ 2023. Minted 2026 players barred by the link gate (`rating_2026.py:424` — only `link_status == "linked"` may consult career stature); only 69/335 linked actives have rows; 0 merit `source_facts` exist for Yamal. Affects historical cards of active players too (Valverde-2022 gets no lift; retired Godín does). |
| C2 | **proj-career-3.0.0 input staleness** | **NOT the defect** | Pinned squads revision oldid 1357762108 retrieved **2026-06-04** (6 days before audit; tournament starts 06-11). Yamal `caps=25\|goals=6` matches the committed wikitext byte-for-byte (`sources/wikipedia_2026/…squads.wikitext:1071`) — the parse is faithful. Whether the upstream squad table itself lags cannot be verified offline; flagged unverified, low priority. The real input gap is *signal poverty*: career totals + league strength are the only quality signals; `award_score` is null/weight-0 for every 2026 card by design (tournament awards unearned pre-tournament), and career recognition (Kopa/Ballon d'Or-class facts) is only reachable via the archive C1 closes. |
| C3 | **Age/experience prior** | **CONFIRMED — secondary, doubly penalizing but not binding** | Explicit: `age_factor` floor 0.80, prime 24–30; Yamal (18) gets **0.8286**. Counterfactual at af=1.0: internal 50.5 → 55.2, OVR **79 → 83**. Implicit double penalty: all-age career-total percentiles already punish youth (C1/B.2). Even af=1.0 **plus** p99 caps/goals percentiles pins at the 62 cap → **88 max**. Cohort signature: minted age<24 mean OVR 71.7 vs 24–30 74.3 vs >30 76.0 — monotone in age, the opposite of how scouting value runs. |
| C4 | **Display curve pooling** | **NOT a cause** | §B.4 — monotone, order-preserving; defect pre-exists at internal level. One artifact: 12% of cards display 88. |
| C5 | **Legend passthrough interaction** | **NOT a cause** | `legend` is a flag join (302 runtime entries; 290 of the 511 >62 historical internals), never an input to score or curve. Curve anchors are pool quantiles; the p95 anchor is set by the 1,244-card *ceiling pile-up* (cards ≥ 62 = 14.4% of pool, so p95 falls inside the pile) — removing legends from the fit would not move it materially. |

## D. MV2-12 design options (proposal only)

All three land at the **internal score** (required by the irreversibility invariant);
none is a display-curve patch. Full compliance chain for any of them:
rating-version bump (`proj-career-4.0.0` and/or `career-stature-3.0.0` / `wc-perf-4.3.0`)
→ strategic-pick canary regen (`WCDRAFT_CANARY_REGEN=1`) + pick-equality proof in the
same PR → compact regen if channels move → λ re-fit BEFORE re-locking realism bands →
fresh-session RED review → human approval, `--match-head-commit` merge.

### D1 — Career-stage normalization of the projected raw path
Score caps/goals percentiles within **age-conditioned cohorts** (or equivalently,
percentile of accrual-rate-at-age) instead of all-age cohorts; retire or soften
`age_factor` to avoid double-counting career stage.
- **Movement:** Yamal's evidence basis becomes p92/p94 (U21 FW) instead of p50/p59 →
  projected raw ≈ 0.94+ → at/near the cap → **79 → ~88**. Aït-Nouri ≈ 83 → mid-80s.
  Veterans-at-the-cap (Alaba tier) are diluted slightly but stay high. Dempsey/Kahn band:
  **untouched** (historical path unchanged). Perlaza 68 / Khalil Ayari 71: unchanged —
  Ayari's 3 caps at 21 is ~p06 even age-conditioned (no fringe inflation).
- **Limit:** cannot place anyone above 88 — the 0.62 ceiling still binds, so "top-3 in
  the world" remains inexpressible. Risk: thin age-cohorts (U21 FW n=31) make
  percentiles grainy; precocious-journeyman overcredit is bounded by the cap.
- **Blast radius:** `rating_2026.py` only → 2026 channels move → compact regen + λ check.

### D2 — Active-career recognition intake (extend the merit source set to in-progress careers)
Curate citable public recognition facts for current players (the same fact families the
archive already uses: global/regional annual recognition, position-balanced selections,
captaincy, international record) with a curation cutoff date, and let 2026 cards consult
career stature through a **player-identity** (not historical-card-link) seam, so minted
players with real recognition records become material. Career-stage-normalize the
*index* (an 18-year-old is scored against accrual-to-date expectations, not
completed-career totals) so in-progress careers aren't structurally sub-material.
- **Movement:** Yamal acquires a real stature row (his recognition record is citable) →
  weight > 0 → can cross 88 into the low 90s if his index lands ≥0.4 — the only option
  that can express the owner's "arguably top 3." Valverde-2026 similarly (captaincy +
  club honors families) → 88 → ~89–91. Valverde-2022 historical card also lifts (same
  archive feeds `rating.py`). Dempsey/Kahn/Godín: unchanged unless their rows gain facts.
  Perlaza/Ayari: no recognition facts → no movement (strong anti-overcorrection property:
  fringe players cannot be inflated by a channel they have no facts in).
- **Risks:** recency/recognition bias (the known DF/GK under-credit, MV2-9); curation
  burden + anti-fabrication discipline (every fact SHA-pinned, Yashin-captaincy
  precedent); active careers drift — needs a re-pin policy (e.g., recuration each
  dataset_version). Largest blast radius: `career_stature` table + both rating stages →
  both eras' channels can move → full canary + λ + realism chain.

### D3 — Trajectory credit (merit-density blend)
Blend per-appearance merit density (goals/cap, caps/year-at-age) with cumulative totals
for in-progress careers.
- **Movement:** helps high-rate scorers (Amoura 19/45 = 0.42 g/cap) more than Yamal
  (6/25 = 0.24) — poorly targeted at the actual defect; a DF/GK gets nothing from rate
  signals (re-opens the position bias MV2-3.5 narrowed). High overcorrection risk for
  small-sample high-rate fringe players — exactly the Perlaza/Ayari band we must not
  inflate. **Not recommended** as primary.

### D4 (named for completeness) — Projected-cohort per-tournament calibration anchor
Re-anchoring the projected distribution to historical *per-tournament* distributions is
already substantively what MV2-5's quantile map does (B.3 shows it works). Re-doing it
cannot lift the ceiling and is **not the defect**.

## E. Maldini disambiguation ruling

**The 71 card is Cesare Maldini (P-34023, WC-1962) — neither Paolo (93–94 across four
cards) nor Daniel (no card exists).** The rating is defensible per-tournament
(2 appearances, group exit, no award, no stature row — and Cesare's own managerial-era
fame is out of scope for a 1962 player card). **Not a P0 rating defect.**

**UI follow-up (filed here, NOT implemented — UX wave runs in parallel):** both players
render `common_name = "Maldini"`. Any surname-colliding card pool (Maldini ×2 is not
unique) needs a disambiguator on card surfaces — given-name initial when `common_name`
collides within the pool, plus the tournament year already shown on some surfaces.
Memory-mode reveal is the worst case (rating hidden until reveal, so the user anchors on
the famous surname). Suggested owner: the running UX wave; the data layer already
carries `given_name`/`full_name`.

## F. Go / no-go recommendation

**GO — promote q-002 to an active MV2-12 implementation dispatch.**

Recommended option: **D2 + D1 combined** (active-career recognition intake with
career-stage-normalized index, plus age-conditioned cohorts in the projected raw path).
D1 alone is cheap but caps the fix at 88 and cannot express elite active players;
D2 alone fixes the elite tier but leaves the all-age percentile distortion under it.
Together they close both confirmed mechanisms (C1 primary, C3 secondary) at the internal
level, have a natural anti-overcorrection property (no facts → no lift; Perlaza/Ayari
stay put), and leave the measured historical path — which B.3 shows is already
cross-era fair — untouched except where new facts legitimately land.

Sequencing note for the Lead Architect: D2's source-set curation (SHA-pinned, citable,
anti-fab) is the long pole and is severable as an MV2-12a intake unit (byte-identical
ratings, facts only — the E-4.1/MV2-1 precedent) ahead of an MV2-12b rating-integration
unit carrying the full Red chain (canary regen + pick equality, compact regen, λ re-fit
before any realism re-lock, fresh-session RED review). A third, display-only artifact —
12% of all cards rendering exactly 88 (§B.4) — is real but cosmetic; it should NOT be
patched at the curve while the internal fix is pending (invariant: no display patches
for internal defects).

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
PY
```

Inputs: committed `etl/output/*.json` at `48d87c0` (ratings.json n=10,973 wc-perf-4.2.1;
ratings_2026.json n=1,246 proj-career-3.0.0; career_stature.json n=791
career-stature-2.1.0 source set). No external rating source consulted anywhere in this
audit (IP firewall respected).
