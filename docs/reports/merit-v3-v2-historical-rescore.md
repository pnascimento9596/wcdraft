# merit-v3 V2 Historical Re-Score Report

- Branch: `merit-v3-v2-historical-rescore`
- Base: `origin/merit-v3` (`a42260b`)
- Spec: `docs/plans/merit-v3-design-2026-06-11.md` §4, §5, §7 V2 entry
- Full per-card delta CSV: `docs/reports/merit-v3-v2-historical-rescore-delta.csv`
- Historical rating version: `wc-perf-5.0.0`; projected rating version unchanged: `proj-career-3.0.0`

## Scope Boundary

V2 changes only historical rating integration. `ratings_2026.json`, compact bundles, canaries, lambda/realism goldens, and `career_stature.json` are intentionally not regenerated. The display curve remains frozen to the pre-V2 `unified_pooled_piecewise_power_v1` anchors; `refit=True` is diagnostic only for V4. Top-level `ratings.json` remains Career-compatible while additive `basis_ratings.career/current` materializes the dual-basis payload for V6 runtime work. `etl/output/merit/merit_divergence_review.json` is re-locked because full ETL pytest asserts the review-only divergence artifact against the active historical rating loader; it remains non-runtime review output.

## Mechanism Delta Summary

| Mechanism | Cohort n | min | p25 | median | p75 | max |
|---|---:|---:|---:|---:|---:|---:|
| award_headroom | 119 | -3 | -1 | 0 | 0 | 4 |
| finish_participation | 1731 | -13 | -2 | 0 | 0 | 3 |
| stature_down_modulation | 240 | -15 | -2 | -1 | 0 | 15 |
| v1_index_consumption | 1540 | -17 | -1 | 0 | 0 | 15 |
| dual_basis_emission | 10973 | -17 | 0 | 0 | 0 | 15 |

## No-Award Headroom Guard

The award-headroom change was checked on every no-award historical internal row:
10,853 rows had `award_score == 0.0`, including 1,180 rows whose raw tournament
score was above the raw-only ceiling. All 10,853 matched the old formula exactly:
`raw_only_score == min(raw_tournament_score, raw_only_ceiling)`, `award_headroom == 0.0`,
max absolute mismatch `0.0`. This isolates the §4.1 invariant; no-award rows may
still move through the separate V2 participation-scaled finish/down-cap mechanisms.

## Probe Table

| Probe | Owner | Result | Notes |
|---|---|---|---|
| Yamal 2026 | V3-owned | unchanged | ratings_2026 byte-stability verified separately |
| Haaland 2026 | V3-owned | unchanged | ratings_2026 byte-stability verified separately |
| Valverde 2026 | V3-owned | unchanged | ratings_2026 byte-stability verified separately |
| Valverde 2022 | V2-owned | 76->80 (current 76) | raw 0.47; raw_only 0.47; idx 0.4; mod -0.021 |
| Rodri 2026 | V3-owned | unchanged | ratings_2026 byte-stability verified separately |
| Neymar 2026 | V3-owned watch | unchanged | ratings_2026 byte-stability verified separately |
| Vinicius Junior 2026 | V3-owned | unchanged | ratings_2026 byte-stability verified separately |
| E. Martinez 2022 | V2-owned | 88->90 (current 90) | raw 1; raw_only 0.761; idx 0.289; mod 0 |
| Schumacher 1986 | V2-owned | 88->89 (current 89) | raw 1; raw_only 0.723; idx 0.28; mod 0 |
| Forlan 2010 | V2-owned | 88->89 (current 91) | raw 0.939; raw_only 0.8; idx 0.423; mod 0.08 |
| Vava 1962 | V2-owned | 88->89 (current 90) | raw 1; raw_only 0.774; idx 0.462; mod 0.08 |
| Jairzinho 1970 | V2-owned | 88->89 (current 89) | raw 0.94; raw_only 0.697; idx 0.357; mod 0.08 |
| Klose 2006 | V2-owned | 88->89 (current 90) | raw 0.942; raw_only 0.774; idx 0.444; mod 0.08 |
| Klose 2014 | V2-owned index; V4 final gate | 88->89 (current 88) | raw 0.772; raw_only 0.62; idx 0.444; mod 0.08 |
| Ait-Nouri 2026 / Gavi 2026 | V3-owned | unchanged / not in pinned pool | Ait-Nouri P-W26-0015 remains 83; no Gavi row exists in the current `players_2026.json`; ratings_2026 byte-stability verified separately |
| Pele 1970 | V2-owned index consumption; V4 final gate | 97->99 (current 88) | raw 0.81; raw_only 0.62; idx 0.878; mod 0.08 |
| Kocsis 1954 | V2-owned index consumption; V4 final shrink gate | 99->99 (current 90) | raw 0.965; raw_only 0.774; idx 0.876; mod 0.08 |
| Cruyff 1974 vs Owen 1998 | V2-owned ordering | 95->94 vs 96->93 | idx 0.72 vs 0.677 |
| Rossi 1986 | V2-owned | 94->91 (current 71) | raw 0.332; raw_only 0.332; idx 0.851; mod -0.085 |
| Zidane 2002 | V2-owned | 95->91 (current 71) | raw 0.351; raw_only 0.351; idx 0.853; mod -0.091 |
| Messi 2010 | V2-owned | 98->95 (current 73) | raw 0.438; raw_only 0.438; idx 0.867; mod 0.011 |
| Rulli 2022 | V2-owned | 88->78 (current 78) | raw 0.495; raw_only 0.495; idx null; mod 0 |
| Armani 2022 | V2-owned | 88->78 (current 78) | raw 0.495; raw_only 0.495; idx 0.036; mod 0 |
| Ado 1970 | V2-owned | 87->77 (current 77) | raw 0.479; raw_only 0.479; idx null; mod 0 |
| Leao 1970 | V2-owned | 87->77 (current 77) | raw 0.479; raw_only 0.479; idx null; mod 0 |
| Lukaku 2022 | V4-owned facts/display gate | 71->71 (current 71) | P-72637:WC-2022; no V2-owned citable-fact intake, miss reported honestly |
| B. Fernandes 2018 | V4-owned facts/display gate | 72->72 (current 72) | P-39584:WC-2018; no V2-owned citable-fact intake, miss reported honestly |
| Dempsey 2010 | control | 88->88 (current 88) | P-18672:WC-2010; no award headroom, raw_only 0.614 |
| Boufal 2022 | control | 88->88 (current 88) | P-59033:WC-2022; no award headroom, clamped at 0.62 |
| Messi 2022 | control | 99->99 (current 91) | raw 1; raw_only 0.8; idx 0.867; mod 0.08 |
| Cesare Maldini 1962 | control | 71->71 (current 71) | P-34023:WC-1962; Audit-1 ruling unchanged |
| Khalil Ayari 2026 | V3-owned control | unchanged | P-W26-0713:WC-2026 remains 71; ratings_2026 byte-stability verified separately |
| Q. Timber 2026 | V3-owned control | unchanged | P-W26-0429:WC-2026 remains 72; ratings_2026 byte-stability verified separately |

## Mechanism Exemplars

### award_headroom

| Card | Player | Old -> New | Current | Arithmetic |
|---|---|---:|---:|---|
| `P-13162:WC-2022` | Martínez WC-2022 | 88 -> 90 (+2) | 90 | min(1,0.62)+gate 0.786*headroom -> raw_only 0.761; current OVR 90 |
| `P-07171:WC-1986` | Schumacher WC-1986 | 88 -> 89 (+1) | 89 | min(1,0.62)+gate 0.571*headroom -> raw_only 0.723; current OVR 89 |
| `P-86087:WC-2010` | Forlán WC-2010 | 88 -> 89 (+1) | 91 | min(0.939,0.62)+gate 1*headroom -> raw_only 0.8; current OVR 91 |
| `P-45310:WC-1962` | Vavá WC-1962 | 88 -> 89 (+1) | 90 | min(1,0.62)+gate 0.857*headroom -> raw_only 0.774; current OVR 90 |
| `P-77430:WC-1970` | Jairzinho WC-1970 | 88 -> 89 (+1) | 89 | min(0.94,0.62)+gate 0.429*headroom -> raw_only 0.697; current OVR 89 |
| `P-27787:WC-2006` | Klose WC-2006 | 88 -> 89 (+1) | 90 | min(0.942,0.62)+gate 0.857*headroom -> raw_only 0.774; current OVR 90 |
| `P-07028:WC-1954` | Kocsis WC-1954 | 99 -> 99 (+0) | 90 | min(0.965,0.62)+gate 0.857*headroom -> raw_only 0.774; current OVR 90 |
| `P-80404:WC-1986` | Maradona WC-1986 | 99 -> 99 (+0) | 91 | min(1,0.62)+gate 1*headroom -> raw_only 0.8; current OVR 91 |
| `P-58080:WC-1990` | Milla WC-1990 | 93 -> 97 (+4) | 88 | min(0.749,0.62)+gate 0.214*headroom -> raw_only 0.648; current OVR 88 |
| `P-46080:WC-1962` | Garrincha WC-1962 | 94 -> 97 (+3) | 90 | min(1,0.62)+gate 0.857*headroom -> raw_only 0.774; current OVR 90 |

### finish_participation

| Card | Player | Old -> New | Current | Arithmetic |
|---|---|---:|---:|---|
| `P-36188:WC-2022` | Rulli WC-2022 | 88 -> 78 (-10) | 78 | finish 1*factor 0.55=effective 0.55; raw 0.621->0.495 |
| `P-39788:WC-2022` | Armani WC-2022 | 88 -> 78 (-10) | 78 | finish 1*factor 0.55=effective 0.55; raw 0.621->0.495 |
| `P-47010:WC-1970` | Ado WC-1970 | 87 -> 77 (-10) | 77 | finish 1*factor 0.55=effective 0.55; raw 0.605->0.479 |
| `P-06015:WC-1970` | Leão WC-1970 | 87 -> 77 (-10) | 77 | finish 1*factor 0.55=effective 0.55; raw 0.605->0.479 |
| `P-05318:WC-2018` | Alexander-Arnold WC-2018 | 85 -> 72 (-13) | 72 | finish 0.4*factor 0.55=effective 0.22; raw 0.427->0.384 |
| `P-02858:WC-1994` | Zetti WC-1994 | 87 -> 76 (-11) | 76 | finish 1*factor 0.55=effective 0.55; raw 0.602->0.476 |
| `P-12835:WC-1994` | Rinaldi WC-1994 | 87 -> 76 (-11) | 76 | finish 1*factor 0.55=effective 0.55; raw 0.602->0.476 |
| `P-07141:WC-1974` | Nigbur WC-1974 | 88 -> 78 (-10) | 78 | finish 1*factor 0.55=effective 0.55; raw 0.625->0.499 |
| `P-44327:WC-1974` | Kleff WC-1974 | 88 -> 78 (-10) | 78 | finish 1*factor 0.55=effective 0.55; raw 0.625->0.499 |
| `P-56533:WC-1982` | Galli WC-1982 | 88 -> 78 (-10) | 78 | finish 1*factor 0.55=effective 0.55; raw 0.62->0.494 |

### stature_down_modulation

| Card | Player | Old -> New | Current | Arithmetic |
|---|---|---:|---:|---|
| `P-91717:WC-1986` | Rossi WC-1986 | 94 -> 91 (-3) | 71 | target 0.901+mod -0.025->-0.085; score 0.816 |
| `P-56430:WC-2002` | Zidane WC-2002 | 95 -> 91 (-4) | 71 | target 0.902+mod -0.045->-0.091; score 0.811 |
| `P-14758:WC-2010` | Messi WC-2010 | 98 -> 95 (-3) | 73 | target 0.911+mod 0.016->0.011; score 0.922 |
| `P-13141:WC-1986` | Cha WC-1986 | 73 -> 88 (+15) | 72 | target 0.641+mod 0->-0.024; score 0.617 |
| `P-38027:WC-1982` | Rufer WC-1982 | 73 -> 88 (+15) | 72 | target 0.641+mod -0.004->-0.025; score 0.616 |
| `P-51349:WC-1990` | Choi WC-1990 | 73 -> 88 (+15) | 72 | target 0.641+mod 0->-0.023; score 0.618 |
| `P-75144:WC-1958` | del Muro WC-1958 | 73 -> 88 (+15) | 72 | target 0.639+mod 0.002->-0.021; score 0.618 |
| `P-77989:WC-1998` | Omam-Biyik WC-1998 | 73 -> 88 (+15) | 72 | target 0.641+mod 0->-0.022; score 0.619 |
| `P-92848:WC-1958` | Reyes WC-1958 | 73 -> 88 (+15) | 72 | target 0.641+mod 0->-0.026; score 0.615 |
| `P-92848:WC-1966` | Reyes WC-1966 | 73 -> 88 (+15) | 72 | target 0.641+mod 0->-0.022; score 0.619 |

### v1_index_consumption

| Card | Player | Old -> New | Current | Arithmetic |
|---|---|---:|---:|---|
| `P-38906:WC-1970` | Pelé WC-1970 | 97 -> 99 (+2) | 88 | idx 0.807->0.878; target 0.871->0.919 |
| `P-38906:WC-1958` | Pelé WC-1958 | 97 -> 99 (+2) | 90 | idx 0.807->0.878; target 0.871->0.919 |
| `P-07028:WC-1954` | Kocsis WC-1954 | 99 -> 99 (+0) | 90 | idx 0.992->0.876; target 0.995->0.917 |
| `P-50564:WC-1974` | Cruyff WC-1974 | 95 -> 94 (-1) | 88 | idx 0.755->0.72; target 0.837->0.814 |
| `P-51130:WC-1998` | Owen WC-1998 | 96 -> 93 (-3) | 88 | idx 0.789->0.677; target 0.859->0.784 |
| `P-03367:WC-2018` | ter Stegen WC-2018 | 88 -> 71 (-17) | 71 | idx 0.464->0.334; target 0.621->null |
| `P-03367:WC-2022` | ter Stegen WC-2022 | 88 -> 71 (-17) | 71 | idx 0.464->0.334; target 0.621->null |
| `P-09441:WC-2022` | Alves WC-2022 | 88 -> 72 (-16) | 72 | idx 0.5->0.36; target 0.663->null |
| `P-65534:WC-2014` | Lampard WC-2014 | 88 -> 72 (-16) | 71 | idx 0.496->0.375; target 0.664->0.6 |
| `P-13141:WC-1986` | Cha WC-1986 | 73 -> 88 (+15) | 72 | idx 0.36->0.462; target 0.6->0.641 |

### dual_basis_emission

| Card | Player | Old -> New | Current | Arithmetic |
|---|---|---:|---:|---|
| `P-14758:WC-2010` | Messi WC-2010 | 98 -> 95 (-3) | 73 | career 95 vs current 73 |
| `P-12676:WC-1962` | Puskás WC-1962 | 95 -> 94 (-1) | 73 | career 94 vs current 73 |
| `P-51382:WC-1954` | Matthews WC-1954 | 94 -> 93 (-1) | 72 | career 93 vs current 72 |
| `P-61251:WC-1990` | Romário WC-1990 | 94 -> 92 (-2) | 71 | career 92 vs current 71 |
| `P-08601:WC-1958` | Charlton WC-1958 | 91 -> 91 (+0) | 71 | career 91 vs current 71 |
| `P-35082:WC-1974` | Kempes WC-1974 | 94 -> 93 (-1) | 73 | career 93 vs current 73 |
| `P-35082:WC-1982` | Kempes WC-1982 | 94 -> 93 (-1) | 73 | career 93 vs current 73 |
| `P-37483:WC-1986` | Zico WC-1986 | 95 -> 93 (-2) | 73 | career 93 vs current 73 |
| `P-37808:WC-1954` | Jonquet WC-1954 | 89 -> 88 (-1) | 68 | career 88 vs current 68 |
| `P-51382:WC-1950` | Matthews WC-1950 | 93 -> 91 (-2) | 71 | career 91 vs current 71 |

## Boundary Checks Recorded

- `ratings_2026.json`: fresh `rating_2026.build_all()` byte-equal to committed output after V2 changes.
- `career_stature.json`: consumed but not edited by V2.
- Compact/generated runtime data: intentionally untouched; the compact-data golden red remains the declared mid-season skew for V6.
- Neymar-2026 watch: V2 does not rebuild projected cards, so the V1-reported counterfactual below-band picture is unchanged by this unit.

## Validation Recorded

- `etl/.venv/bin/python -m ruff check src tests`: clean.
- `etl/.venv/bin/python -m pytest -q tests/test_rating.py tests/test_unified_display.py tests/test_ingest_2026.py --tb=short --durations=10`: 91 passed.
- `etl/.venv/bin/python -m pytest -q --tb=short --durations=10`: 241 passed.
- Mutate-and-fail proofs:
  - `RAW_AWARD_HEADROOM = 0.0` made `test_award_gated_headroom_moves_major_award_measured_cards` fail (`P-13162:WC-2022` current overall 88, expected >=89).
  - `FINISH_PARTICIPATION_FLOOR = 1.0` made `test_participation_scaled_finish_anchor_drops_zero_app_champion_reserves` fail (`P-36188:WC-2022` overall 88, expected <=83).
  - `rating_2026._load_career_stature(... use_rating_compat=False)` made `test_matches_committed_golden` fail on `etl/output/ratings_2026.json`.
- Two-run determinism hashes after rerunning `wcdraft_etl.rating` and `wcdraft_etl.merit_divergence` twice:
  - `output/ratings.json`: `14b9dbccfb6e1880d1e9cddfd4e95c33f7a9fd1faf39a8e84f10130bc3529494`
  - `output/merit/MERIT_V2_SAMPLE.md`: `1232e3bf6898b2d35409ca1f418f761e9fd756edbfee6a826a0c7cfab835b952`
  - `output/merit/merit_divergence_review.json`: `2e5a9316c6491ab3ec149b56460bc441f7652b77be0e6d343e7651954804ffda`
