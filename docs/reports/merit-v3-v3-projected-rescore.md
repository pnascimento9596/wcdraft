# merit-v3 V3 Projected Re-Score Report (proj-career-4.0.0)

- Branch: `merit-v3-v3v4-projected-and-curve`
- Base: `origin/merit-v3` (`bc4f671`)
- Spec: `docs/plans/merit-v3-design-2026-06-11.md` §2, §5, §7-V3, §8 V3 entry
- Full per-card delta CSV: `docs/reports/merit-v3-v3-projected-rescore-delta.csv` (1,246 rows — every 2026 card)
- Projected rating version: `proj-career-3.0.0` → **`proj-career-4.0.0`**; historical `wc-perf-5.0.0` untouched

## Scope boundary

V3 changes the PROJECTED (2026) stage only. Re-locked artifacts: `ratings_2026.json`,
`teams_2026.json` (aggregates + best XI ride the internal scores), `manifest_2026.json`
(version stamp line only), `etl/output/merit/MERIT_V2_SAMPLE.md` (2026 + display
sections re-render). **Historical `ratings.json` and `career_stature.json` are
byte-identical to base** (`git diff` empty — V2's artifacts). Compact bundles, canaries,
λ/realism goldens untouched (V6/V7). The display curve stays FROZEN to the pre-V2
`unified_pooled_piecewise_power_v1` anchors — every display number below is provisional;
the §7 bands are judged at V4 on the re-fit curve.

## Mechanisms (all §8-V3-assigned)

1. **D1 age-conditional quantile curves** (§2.1): per position × signal (caps, intl
   goals), a pooled monotone-in-age conditional quantile surface over the full 2026 pool
   (n=1,246) replaces the all-age percentile maps. Triangular-kernel pooled smoothing
   (no hard band edges); monotone-in-age enforced STRUCTURALLY (running max along age);
   evidence percentile = the signal's quantile at the player's age. **`age_factor` is
   retired** (function + constants deleted; component no longer emitted).
2. **Person-identity stature seam** (§1.1/§2): minted cards consult the
   career-stature-3.0.0 person rows by minted player_id (the V1 resolver emits them);
   the structural bar (`link_status == "linked"` only) is removed. Ambiguity stays
   withheld upstream (no row → no consult); the rating-compat pin is retired (full v3
   rows consumed).
3. **Quantile-map re-derivation** (§2.1): the MV2-5 cross-era map now targets V2's live
   wc-perf-5.0.0 raw-only internal distribution (weight==0 rows' `raw_only_score`,
   award headroom included) instead of the rating-compat reconstruction.
4. **Dual-basis emission** (§5): every 2026 row carries `basis_ratings.career/current`
   (same shape as V2's historical emission). `current` = the D1 age-conditioned
   projected raw, quantile-mapped + ceiling-capped, no career blend; top-level row
   remains the Career compatibility surface.

## Calibration disclosure (in-unit, pre-registered lock)

`AGE_QUANTILE_BANDWIDTH` was fit in-unit against the §2.1 pre-registered distribution
lock (the minted raw-path age signature must FLATTEN). Measured old-above-young gap on
the fixed cohort definition (minted, weight==0, age<24 vs >30, display points):
pre-V3 **+4.16**; h=4.0 **−2.31** (inversion = overcorrection); h=5 −1.73; h=6 −1.06;
h=8 **+0.09**; h=10 +1.04. Locked **h=8.0**; the lock test asserts |gap| ≤ 1.0.
Controls were held during the sweep (Khalil Ayari 71→71/72, Aït-Nouri 84–86,
Q. Timber 73 at every h). No §7 probe band was used to pick h.

## Mechanism delta summary (display deltas on the FROZEN curve)

| Cohort                                    |     n | min | p25 | median | p75 | max |
| ----------------------------------------- | ----: | --: | --: | -----: | --: | --: |
| age_conditioning (raw path, wt==0)        | 1,222 | -16 |  -1 |      0 |   1 |  10 |
| person_identity_seam (minted with rows)   |    20 |  -4 |  -1 |      0 |   0 |  17 |
| index_reconsumption (linked, index moved) |    72 | -16 |  -2 |      0 |   0 |   6 |
| all cards                                 | 1,246 | -16 |  -1 |      0 |   1 |  17 |

753/1,246 cards moved; 12 `overall_basis` flips; 4 legend flips (minted persons gaining
their factual badge: Haaland, Yamal, Alaba + 1).

## §7 probe positions (PROVISIONAL — frozen v1 curve; the binding gate is V4's)

| Probe                  | Old | New (frozen curve) | Current basis | Notes                                                                     |
| ---------------------- | --: | -----------------: | ------------: | ------------------------------------------------------------------------- |
| Yamal 2026 (#1)        |  79 |             **92** |            88 | minted person row consulted, idx 0.641, legend ✓                          |
| Haaland 2026 (#2)      |  88 |             **98** |            88 | idx 0.843, legend ✓ — above the 89–93 band on the frozen curve; V4 judges |
| Valverde 2026 (#3)     |  88 |             **88** |            88 | idx 0.400 exactly at the material gate, wt 0.50 — V4 watch                |
| Rodri 2026 (#5)        |  90 |             **91** |            88 | legend ✓ (band 89–92)                                                     |
| Neymar 2026 (#6)       |  93 |             **91** |            88 | legend ✓ — below the 92–94 band; KNOWN WATCH-ITEM                         |
| Vinícius Jr 2026 (#7)  |  87 |             **90** |            88 | idx 0.511 (V1 re-curation), material now                                  |
| Aït-Nouri 2026 (#15)   |  83 |             **85** |            85 | in 84–87                                                                  |
| Gavi 2026 (#15)        |  84 |             **88** |            88 | row exists post-U0 pool (V2 had none); "modest ↑"                         |
| Khalil Ayari (control) |  71 |             **71** |            71 | no facts → no row → no lift                                               |
| Q. Timber (control)    |  72 |             **73** |            73 | twins unmerged, ±1                                                        |
| Perlaza (control)      |   — |                  — |             — | NOT in the pinned 2026 pool (no row exists; honest absence)               |
| Messi 2026 (stability) |  99 |                 98 |            85 | stature path stable                                                       |

Emergent finding (ledgered for V8): **Dembélé 2026** 89→81 with legend=True — his
career-stature row (global_annual_multi_winner, 2 facts) sits at coverage 0.20, below
the 0.25 material gate, so the badge joins but the score stays raw-path. A V1-curation
coverage gap, not a V3 mechanism defect; pinned by test as the single non-material
legend.

## Validation (real counts)

- ETL suite: **256 passed** (`pytest -q`), ruff clean. +12 new tests
  (`tests/test_projected_age_conditioning.py`): synthetic curve-math exactness,
  production-pool monotonicity-in-age (structural property, every pos × signal),
  monotonicity-in-value, unknown-age fallback, age-grid clamping, age_factor
  retirement, cohort-flattening lock, quantile-map target pin, dual-basis shape +
  career alias + current-channel derivation.
- Run-twice determinism: `ratings_2026.json`, `teams_2026.json`, `MERIT_V2_SAMPLE.md`
  byte-identical across two clean `python -m wcdraft_etl.ingest_2026` runs.
- Historical hard boundary: `ratings.json` + `career_stature.json` `git diff` EMPTY.
- Test-semantics updates (flagged for the reviewer, not silent weakening):
  `test_minted_never_consume_career_stature` → split into no-row-never-consults +
  minted-person-rows-consulted (the §1.1 flip); `test_linked_below_material_stays_on_raw_path`
  exemplar Vinícius→Upamecano (Vinícius graduated to material — the §7 probe);
  legend-join test now permits the single pinned non-material legend (Dembélé) and
  minted badges; version pins 3.0.0→4.0.0; current-channel test allows the ±1
  six-decimal rounding boundary.
