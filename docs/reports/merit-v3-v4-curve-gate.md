# merit-v3 V4 Report — Display-Curve Re-fit + the §7 Pre-Registered Gate

- Branch: `merit-v3-v3v4-projected-and-curve` (chained on V3, same PR)
- Base: `origin/merit-v3` (`bc4f671`)
- Spec: `docs/plans/merit-v3-design-2026-06-11.md` §4.4, §5, §7; gate committed as
  tests in `etl/tests/test_merit_v3_gate.py`
- Delta CSV: `docs/reports/merit-v3-v4-curve-refit-delta.csv` (12,219 rows, both eras,
  career + current displays)
- Versions: rating versions UNCHANGED (`wc-perf-5.0.0` / `proj-career-4.0.0` per the §6
  matrix); display curve kind `unified_pooled_piecewise_power_v1` → **`…_v2`**

## Curve re-fit

Fit population (design §5: "the union of both bases' internal pools", both eras):
historical career + historical current + 2026 career + 2026 current, n = **24,438**.
Anchors (internal 0–100): floor `20.0` · median `42.325568` · p95 `62.0` · max `100.0`
(v1 median was `43.2551648`). Frozen as `FROZEN_UNIFIED_CURVE_V2_ANCHORS`;
`test_default_curve_is_frozen_v2_and_freeze_tracks_live_refit` pins frozen == live
refit so the freeze cannot silently go stale. Curve form + the three exponents
unchanged (low-DOF contract test still green).

Note on §4.4's expectation: the design predicted "the p95 anchor will no longer sit
inside a clamp pile". Empirically FALSE — 1,150 historical no-award cards still sit at
internal exactly 62.0 (V2's own §4.1 no-award byte-stability invariant pins them), so
the union p95 lands exactly on 62.0. Recorded as part of the pile-up miss mechanism.

Effect: every moved display moves EXACTLY +1 (2,374 historical + 279 of 2026 career
displays; current displays similar). Channels: **byte-identical across BOTH bases, 0
diffs over 12,219 cards** (decoupling invariant). Mutation proof re-executed: routing
channels through the curve makes `test_channels_are_decoupled_from_the_curve` FAIL;
reverted, green.

## §7.1 Mover scoreboard (FINAL — v2 curve; misses pinned as `*_MISSED_*` tests)

| # | Probe | Band | Measured | Verdict |
|---|---|---|---|---|
| 1 | Yamal 2026 | 85–91 (≥85 hard) | **92**, legend ✓ | **MISSED (+1)** — hard floor holds; V1 row (idx 0.641) overshoots the D1+D2-only prediction |
| 2 | Haaland 2026 | 89–93 | **98**, legend ✓ | **MISSED (+5)** — idx 0.843 maps near-peak; wall exit itself proven |
| 3 | Valverde 2026 | 89–91 | **88** | **MISSED (−1)** — idx lands exactly 0.40 → weight exactly 0.5; §1.3's own no-force rule |
| 4 | Valverde 2022 | 81–86 + basis flip | **81**, career_stature_estimate ✓ | **IN-BAND** |
| 5 | Rodri 2026 | 89–92 + legend | **91**, legend ✓ | **IN-BAND** |
| 6 | Neymar 2026 | 92–94 + legend | **91**, legend ✓ | **MISSED (−1)** — the DECLARED watch-item (idx 0.600, age-34 down-modulation) |
| 7 | Vinícius Jr 2026 | ≥90 | **90** | **IN-BAND** |
| 8 | E. Martínez 2022 | 89–92 | **90** | **IN-BAND** |
| 9 | Schumacher 1986 | 89–92 | **89** | **IN-BAND** |
| 10 | Forlán 2010 | 89–92 | **89** | **IN-BAND** |
| 11 | Vavá 62 · Jairzinho 70 · Klose 06 | >88 each; Jairzinho > Piazza/Félix | **89/89/89**; 89 > 88/88 | **IN-BAND** |
| 12 | Klose 2014 | >88 (gate unmoved) | **89**; gate pinned 0.40 | **IN-BAND** |
| 13 | Lukaku 2022 | ≥78 conditional on facts | **71** (no facts staged) | **MISSED (honest-miss branch of its own registration)** |
| 14 | B. Fernandes 2018 | ↑ direction (conditional) | **72** (unchanged) | **MISSED (same mechanism as #13)** |
| 15 | Aït-Nouri · Gavi | 84–87 · modest ↑ | **85** · 84→**88** | **IN-BAND** |
| 16 | Pelé index + card | top-10, ≥ Kocsis; card 98–99 | rank **2** (0.8783 ≥ 0.8762); card **99** | **IN-BAND** |
| 17 | Kocsis index + card | ≤0.90, not #1; card 94–97 | idx **0.876**, rank 3 ✓; card **99** | **index IN-BAND · card MISSED (+2)** — 0.876 sits 0.002 under Pelé; both map near-ceiling |
| 18 | Cruyff vs Owen | Cruyff > Owen; card 96–98 | idx 0.720 > 0.677 ✓; cards 94 > 93 ✓; card **94** | **ordering IN-BAND · card MISSED (−2)** |
| 19 | Rossi 86 · Zidane 02 · Messi 10 | 89–92 · 90–93 · 95–97 | **91 · 91 · 95** | **IN-BAND** |
| 20 | 0-app champion reserves | 76–83 | Rulli/Armani **78**, Ado/Leão **77** | **IN-BAND** |

**Movers: 14 fully in-band · 6 with ≥1 missed element** (#1, #2, #3, #6, #13, #14
fully missed bands; #17/#18 split — index/ordering halves pass, card bands miss).
No parameter was tuned to convert any miss (no pre-registered protocol applies);
each `*_MISSED_*` test pins the measured value so drift is loud.

## §7.2 Controls (±1)

| Control | Expected | Measured | Verdict |
|---|---:|---:|---|
| Perlaza 2026 | 68 | NOT in pinned pool | non-evaluable (pinned absent; precedent: V2's Gavi) |
| Khalil Ayari 2026 | 71 | **71** | PASS |
| Dempsey 2010 | 88 | **88** | PASS |
| Boufal 2022 | 88 | **88** | PASS |
| Messi 2022 | 99 | **99** | PASS |
| Cesare Maldini 1962 | 71 | **72** | PASS (±1) |
| Q. Timber 2026 | 72 | **73** | PASS (±1) |
| baseline_anchor cohort | [66, 73] | 386 cards, min 66 / max 73 | PASS |

## §7.3 Distribution + structural gates

| Gate | Target | Measured | Verdict |
|---|---|---|---|
| Pooled median | 73 ±1 | **73** | PASS |
| 90+ share | ≤5% | **2.31%** | PASS |
| Pile-up | no value >4% | **71: 17.8% · 72: 15.3% · 88: 11.3%** | **MISSED — structural** (see below) |
| Cross-era inversion (B.3 re-executed) | ≤0.5% | **0.588%** (36,476 / 6,200,282 pairs) | **MISSED — marginal** (award asymmetry) |
| Coherence: no 94+ w/o legend or award | 0 | **9 violations, pinned exactly** | **MISSED** (V1 legend-derivation gap) |
| Basis-transition assert | crossers flip basis | Valverde-2022 flipped ✓ | PASS |
| Determinism | 12,219/12,219 | **12,219/12,219** reproduced | PASS |
| Dual-basis completeness | every card, both bases | 12,219 × 2 full channel sets | PASS |

### Miss mechanisms (recorded for the owner at V8)

1. **Pile-up (structural):** the 88 wall is a point mass — 1,150 no-award historical
   cards at internal exactly 62.0, byte-stable under V2's own §4.1 invariant; only 119
   award cards could escape. No monotone curve spreads a point mass. The 71/72 piles
   are pigeonhole arithmetic: floor→median (66..73, 8 integers) must hold ~half the
   pool while the median gate (73 ±1) is itself §7.3 — jointly unsatisfiable with
   ≤4%-per-value. Improvement IS locked: 88-share must stay < the pre-season 12.0%.
2. **Inversion 0.588% vs 0.27% baseline:** §4.1 headroom lifts ~119 historical
   measured cards into 89–92 while 2026 measured cards are structurally award-null
   pre-tournament — the designed award asymmetry, counted as inversions by the
   raw-percentile operationalization. Pinned ≤0.65%.
3. **Coherence census:** exactly 9 pre-1967 `career_stature_estimate` cards at 94+
   without badge or award (Hidegkuti-54, F. Walter-54/58, Albert-66, N. Santos-62,
   Ocwirk-54, Andrade-30, Bozsik-54, Hanappi-54) — V1's legend reason-codes did not
   close them in either direction. Set pinned exactly; growth is red.

## Validation (real counts)

- ETL: ruff clean; **288 passed** (`pytest -q`) including the 19 committed gate tests
  and the V3 property suite.
- Determinism: rating → ingest → rating (both orders) leaves all re-locked artifacts
  byte-identical; frozen-curve == live-refit test green.
- Re-locked in V4: `ratings.json` (display-only), `ratings_2026.json` (display-only),
  `MERIT_V2_SAMPLE.md`, `merit_divergence_review.json` (review-only artifact asserted
  against the live loader — V2 precedent). `teams_2026.json` NOT moved by V4 (best-XI
  reads internal scores — decoupling corroborated).
- Root turbo validation at the chained head: see PR (compact family declared-red
  excepted).
