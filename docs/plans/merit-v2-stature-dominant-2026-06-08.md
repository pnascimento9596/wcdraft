# Merit-v2: Stature-Dominant Ratings — Plan

> **SUPERSEDED 2026-06-12:** This draft plan is historical. The shipped
> replacement is merit-v3: `runtime-data-2.0.0`, `wc-perf-5.0.0`,
> `proj-career-4.0.0`, `career-stature-3.0.0`, and `engine-2026.06.12`.
> Sections below retain the original design/evidence trail and include stale
> point-in-time anchors such as `engine-2026.06.08`.

## Goal

Replace the current `raw_tournament + capped_lift` composite (where `career_stature` is a small modulating lift on top of the per-tournament measured score) with a **stature-dominant** composite: for any player with material career merit, **career stature drives both `overall` and the four channels**, and tournament context modulates ±. A recognized great's worst World Cup still reads elite; a journeyman's best tournament does not. Broaden factual sourcing so deep coverage exists for each team's top ~5 players; calibrate the global display scale so recognized greats land 88–99 (Messi ~91+, Pelé/Maradona/Messi/Cristiano in the high 90s); reconcile 2026 onto the same calibrated scale so a 2026 star and a historical great are directly comparable; surface a factual `Legend` badge driven by recognition thresholds (Ballon d'Or, all-time XI inclusion) rather than the current OVR ≥ 96 heuristic; and re-fit the sim cascade (λ, realism, faithfulness, goldens, engine_version) honestly under the broader channel movement.

## Background

### The exact current state (HEAD = `21ca5e9`, season-merge finalized)

The merged E-4.2 lift code shipped in `wc-perf-3.0.0`. Verified per-card outcomes from the committed `etl/output/ratings.json`:

| Card                        | `overall` | `attack` | `mid` | `def` | `gk` | `career_stature_score` | `career_stature_lift` |
| --------------------------- | --------: | -------: | ----: | ----: | ---: | ---------------------: | --------------------: |
| Pelé `WC-1966` (`P-38906`)  |        84 |       66 |    48 |    34 |   20 |                  0.590 |                 0.119 |
| Messi `WC-2010` (`P-14758`) |        84 |       66 |    48 |    34 |   20 |                  0.657 |                 0.225 |

The lift is working as designed but the _design_ underweights stature. Per Probe A's count over the committed JSON:

| Outcome                                                 |         Cards |
| ------------------------------------------------------- | ------------: |
| Total historical rating cards                           |        10,973 |
| No `career_stature` row at all                          | 9,612 (87.6%) |
| Has row but `coverage < 0.25` (gate)                    |           872 |
| Has row & coverage but `target ≤ raw` (no positive gap) |           346 |
| **Positive `career_stature_lift`**                      |       **143** |

`etl/output/merit/CAREER_STATURE.md` reports the score distribution on the 644 scored players: max `career_stature_score = 0.658` (Maradona); legends Cruyff 0.083, Cafu 0.406, Maldini 0.162 — clear source-coverage gaps for non-attacker / non-BdO legends. The 0–1 score scale itself tops out near 0.66 even for the all-time peak.

### Why this is "backwards"

`etl/src/wcdraft_etl/rating.py:402-415` defines `_career_lift`:

```python
elite  = career_score ** CAREER_ELITE_EXPONENT          # 0.85
target = REPLACEMENT_BASE + CAREER_TARGET_SPAN[pos] * elite   # 0.20 + 0.74-0.80 · elite
lift   = min(CAREER_MAX_LIFT[pos],                       # 0.20-0.26
             CAREER_BLEND_HISTORICAL * max(0, target - raw))  # 0.70 · gap
```

Three structural reasons stature underdrives the result even when ingested:

1. **`raw_tournament_score` IS the base.** Lift only adds to it. A weak tournament cannot be replaced with the stature-implied target; lift only closes a fraction of the gap toward it.
2. **Lift is fractional and capped.** `0.70 · (target − raw)` is at most 70% of the gap, then min'd against a 0.20–0.26 cap. Even when `career_stature_score = 0.65` (Maradona ceiling) and `raw = 0.20`, the formula caps lift at ~0.26.
3. **Coverage gate is binary and high.** `coverage < 0.25 → lift = 0`. Cruyff (coverage 0.15) gets zero lift; Maldini (coverage 0.25) sits at the threshold; many legitimate legends with thin recognition-list coverage are zeroed entirely.

### The 2026 distribution problem

`rating_2026.py` does **not** consume `career_stature.json` at all (Probe E: no import, no lookup, separate `build_all`). The projected composite is purely:

```text
base   = REPLACEMENT_BASE + (BASE_CEILING - REPLACEMENT_BASE) · (caps_pct × W_caps + goals_pct × W_goals) · age_factor
anchor = LEAGUE_WEIGHT · league_strength
score  = clamp01(base + anchor)
```

Read from the committed `etl/output/ratings_2026.json` (1,246 rows, OVR `66/73/99`), the top-10 is:

| Rank |   OVR | Player                                                        |
| ---: | ----: | ------------------------------------------------------------- |
|  1–4 |    99 | Bernardo Silva, Bruno Fernandes, Hee-chan Hwang, Tomáš Souček |
|  5–6 |    98 | Youri Tielemans, John McGinn                                  |
|    7 |    96 | Granit Xhaka                                                  |
|    8 |    95 | **Kylian Mbappé**                                             |
| 9–10 | 93–92 | José Giménez, Federico Valverde                               |

For reference: **Messi-2026 sits at OVR 79**; **Vinícius Jr at 84**. The cohort-percentile formula plus age decay produces this distribution. Career stature is not in the math.

Display curves are fit **separately** for historical and 2026 (`rating.py:655` vs `rating_2026.py:257`), so the two OVR scales are not directly comparable — that's the reconciliation seam.

### Engine cascade state on HEAD (Probe B)

| Surface                     | State                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine_version`            | `engine-2026.06.08` — `packages/data/scripts/build-compact-data.mjs:49`                                                                                                                                                                                                                                                                                                                             |
| Historical `rating_version` | `wc-perf-3.0.0`                                                                                                                                                                                                                                                                                                                                                                                     |
| Projected `rating_version`  | `proj-career-2.0.0` (no career lift on 2026)                                                                                                                                                                                                                                                                                                                                                        |
| λ math                      | **Four-channel live** — `lambdaForFour` in `packages/core/src/engine/calibration.ts:462-470`, called from `match.ts:404-405`; uses attack, `defensiveResistance(def,gk)`, `midfieldControl(mid,mid)`.                                                                                                                                                                                               |
| λ constants                 | `BASE=0.85`, `SPREAD=6.5`, `MIN=0.40`, `MAX=3.4`, `W_DEF=0.70`, `W_GK=0.30`, `GAMMA_MID=0.50`, `CONTROL_BAND=[0.85, 1.15]`, `CHANCES.REGULATION=50`, `LAMBDA_DISP.OUTER_PROB=0.20`/`A=0.75` (`calibration.ts:76-260`)                                                                                                                                                                               |
| Symmetric realism gate      | `packages/data/test/realism-modern-norms.golden.test.ts` — bands `mean_goals [2.478, 2.594]`, `group_draw [0.2288, 0.2652]`, `margin_ge_4 [0.0412, 0.0570]`, `ko_et [0.2961, 0.3648]`, `ko_shootout [0.1843, 0.2443]`. Narrow — current state lands centrally.                                                                                                                                      |
| Asymmetric realism gate     | `packages/data/test/realism/realism.gate.test.ts` — heavy-gated by `WCDRAFT_REALISM_HEAVY=1`, separate CI job; shape bands plus goals-per-game lower floor `2.4`. Golden anchors `engine-2026.06.04`.                                                                                                                                                                                               |
| Faithfulness suite          | **`packages/core/src/faithfulness.test.ts` exists on HEAD** (memory said it was deferred — stale). 11 `it()` cases: determinism, 4-channel monotonicity, elite ceiling (99/99/99/99 vs 50/50/50/50: KO win ≥ 0.85, < 1.0; group max goals ≥ 6), dominance-not-certainty (85 vs 60: win ∈ [0.65, 0.95]), legibility (attack/GK directional), no-inversion. Stature-dominant should _help_ this gate. |
| Skew test                   | `apps/web/lib/game/__tests__/run-token.test.ts:251-292` — pre-bump tokens (`engine-2026.06.04 + wc-perf-2.0.0`) trip skew cleanly; merit-v2 stamp bump (e.g. `engine-2026.06.10 + wc-perf-4.0.0`) will trip persisted runs the same way. By design — no silent re-sim.                                                                                                                              |
| Heavy CI split              | `WCDRAFT_REALISM_HEAVY=1` env-gates asymmetric realism off the default test path; `.github/workflows/ci.yml:83-114` runs a separate `realism` job.                                                                                                                                                                                                                                                  |

### Card UI / Legend badge seam (Probe C)

A `Legend` badge **already renders today**, but it's derived from `overall >= 96` in `apps/web/lib/game/view-models.ts:277-282`:

```ts
if (r.overall !== null && r.overall >= 96) return "legend";
```

Render hops: `provenanceBadgeKind(r)` → `ratingView(r).badge_kind` (`adapters.ts:60-78`) → row class `s.prov_legend` (`candidate-card.tsx:80-84`), provenance dot (`:124-128`), and expanded badge pill `"Legend"` (`:156-160`). CSS already exists: `game.module.css:2276-2279` (`prov_legend` border/glow), `:2326-2330` (`provBadge_legend`).

A factual Legend badge (Ballon d'Or / all-time XI / etc.) requires:

- A typed boolean on `Rating` — `packages/core/src/types/rating.ts:46-91` and `packages/core/src/schemas/rating.ts:30-45` (Zod object, no passthrough/catchall — boolean must be added explicitly).
- Pass-through in compact builder — `packages/data/scripts/build-compact-data.mjs:306-322` (historical) and `:405-419` (projected).
- `RuntimeRating` propagation — `packages/data/src/types.ts:116-153`.
- Read in `provenanceBadgeKind(...)` — switch from OVR threshold to the boolean.
- `components[]` is NOT a passthrough: `RatingComponentSchema` is `z.object({signal, value, weight})` with no `.passthrough()`. A boolean ride on `components[]` would not validate cleanly across the runtime boundary — better as a first-class field.

### Career-stature data layer (E-4.1, already merged on HEAD)

`etl/src/wcdraft_etl/merit/` shipped via PR #43 (commit `4d96ac9`). Has the deterministic source-intake architecture (`fetch.py --verify`, parser, `link.py` with review withholding, `stature.py` composite, `etl/output/merit/source_facts.json`, `link_review.json`, `CAREER_STATURE.md`, `MERIT_SOURCES.md`). 644 players scored from existing sources (Ballon d'Or, FIFA POY, IFFHS Best/Century, FIFA 100, RSSSF SAM-POY, RSSSF UEFA POY, RSSSF Century caps, WC awards/goals). The pattern works; the gap is **source breadth**, not architecture. Merit-v2 reuses the data layer wholesale and adds source families on top.

### External recognition sources to broaden coverage (Probe D)

Current sourcing is **winner-only / striker-biased**. The principled correction is **position-balanced XI selections, continental player awards, and all-time dream teams** — these add factual recognition for defenders / GKs / midfielders / non-European legends without proprietary rating IP.

Tier-A additions (highest leverage, mostly RSSSF/Wikipedia, deterministic parseable):

1. **RSSSF African Player of the Year** — https://www.rsssf.org/miscellaneous/afr-poy.html — 1970+, Africa legends invisible to BdO.
2. **RSSSF Asian Player of the Year** — https://www.rsssf.org/miscellaneous/as-poy.html — 1980+, Asian legends.
3. **RSSSF South American Player of the Year** (Rey de América) — https://www.rsssf.org/miscellaneous/sam-poy.html — already ingested winners; placements add depth.
4. **Concacaf Awards** — https://en.wikipedia.org/wiki/CONCACAF_Awards — 2013+, modern NAm/Caribbean stars.
5. **UEFA Club positional awards** (GK / DF / MF / FW) — https://en.wikipedia.org/wiki/UEFA_Club_Football_Awards — 1997–2010, **fixes defender/GK blind spot directly**.
6. **UEFA Men's Player of the Year** + top-three — https://en.wikipedia.org/wiki/UEFA_Men%27s_Player_of_the_Year_Award — 2010+.
7. **UEFA Team of the Year** (annual XI) — https://en.wikipedia.org/wiki/UEFA_Team_of_the_Year — 2001–2020, annual position-normalized recognition.
8. **FIFPro World 11** — https://en.wikipedia.org/wiki/FIFPro_World11 — 2005+, player-voted XI.
9. **ESM Team of the Season** — https://en.wikipedia.org/wiki/ESM_Team_of_the_Season — 1994/95+.
10. **World Soccer Awards** via RSSSF — https://www.rsssf.org/miscellaneous/wsoc-awards.html — 1982+, independent global recognition.
11. **Onze d'Or / d'Argent / de Bronze** via RSSSF — https://www.rsssf.org/miscellaneous/onze-awards.html — 1976+.
12. **IFFHS All-Time / National Dream Teams** — https://www.iffhs.com/posts/1110 — retrospective all eras, **closes pre-1956 + defender/GK + non-European gaps simultaneously**.
13. **Ballon d'Or Dream Team** (2020) — https://en.wikipedia.org/wiki/Ballon_d%27Or_Dream_Team — position-specific 1st/2nd/3rd all-time XIs.

Tier-B (regional, selective):

14. **Placar Bola de Ouro / Bola de Prata** — https://www.rsssfbrasil.com/miscellaneous/bouro.htm — Brazilian league.
15. **Don Balón Award (Spain)** — https://en.wikipedia.org/wiki/Don_Bal%C3%B3n_Award — 1976–2010.
16. **Guerin d'Oro (Italy)** — https://en.wikipedia.org/wiki/Guerin_d%27Oro — Serie A defensive era.
17. **Germany Footballer of the Year** — https://en.wikipedia.org/wiki/Footballer_of_the_Year_(Germany) — 1960+.

Captaincy (secondary modifier, parser-thin):

18. **EU-Football.info captains-by-captain-caps** — https://eu-football.info/_players.php?data=10 — best practical source.

Recommended "first wave" (12 sources): #1–11 + #18 — highest coverage lift, lowest parser pain.

### Independent non-IP cross-check sources (review-only, not ingested)

- FourFourTwo 100 Greatest Footballers Ever — https://www.fourfourtwo.com/features/ranked-the-100-best-football-players-of-all-time
- World Soccer Greatest XI — https://www.worldsoccer.com/world-soccer-latest/the-greatest-xi-how-the-panel-voted-341427
- Ballon d'Or Dream Team (also Tier-A above, doubles as cross-check)

Paulo's existing GPT-produced non-IP merit report (per prior plan; not stored in this repo) continues to play this role — review input only, never source.

### Prior plan and critique on disk

`docs/plans/merit-rating-model-2026-06-07.md` (E-4 lift-over-tournament composite) and `docs/reviews/merit-rating-model-plan-critique-2026-06-07.md` (editorial critique) — read; surfaced the under-specified `REPLACEMENT_BASE`, `saturating_combine`, 2026 canonical-id lookup, and ordering bugs. Merit-v2 **reframes** the composite shape (stature-dominant base, not lift); the data-layer architecture (`etl/src/wcdraft_etl/merit/`), source-pin pattern, IP firewall, and divergence-review queue carry over.

### IP firewall (unchanged)

No proprietary rating IP: Sofifa, Futbin, EA Sports, PES, eFootball, Konami. Public recognition lists, awards, captaincy data, and editorial all-time rankings are FACTS and OK. The audit regex at `etl/tests/test_rating.py:648-680` extends to any new raw directories under `etl/merit/raw/`.

---

## Approach

Merit-v2 is a **stature-dominant rating rebase** that explicitly supersedes the current `wc-perf-3.0.0` capped-lift design. The current code already has the right data spine — deterministic merit source intake, conservative linking, `career_stature.json`, rating components, compact propagation, and sim gates — but the rating formula is structurally backwards: `raw_tournament_score` remains the base and `career_stature` can only add a positive, capped fraction of the gap. Merit-v2 is a **targeted ETL/rating refactor**, not a gameplay rewrite: reuse `etl/src/wcdraft_etl/merit/`; replace `_career_lift(...)` with a stature target + bounded signed tournament modulation; extend the 2026 path for linked canonical players; fit **one unified display curve**; add a first-class factual `legend: boolean` to `Rating`; treat broad channel movement as expected and route it through the existing faithfulness + realism + golden re-lock cascade. Do not introduce a runtime career-stature entity; career aggregates remain ETL-only.

### Source breadth and career-stature v2

The existing `career-stature-1.0.0` table proves the architecture works, but the source set is too narrow and striker/Ballon-d'Or biased. Merit-v2 bumps to:

```text
merit-source-set-2.0.0
career-stature-2.0.0
```

Extend the existing pinned-byte source architecture rather than replacing it:

```text
fetch.py --pin / --verify
  → committed raw bytes under etl/merit/raw/
  → pure parsers
  → conservative link.py
  → source_facts.json + link_review.json
  → stature.py
  → career_stature.json + CAREER_STATURE.md
```

The required v2 source wave includes Tier-A sources #1–13 plus #18 from the Background — broader than a narrower "first wave" because the factual Legend badge and defender/GK repair both depend on all-time/dream-team routes (IFFHS, Ballon d'Or Dream Team) on day one. Without #12/#13, the position-aware Legend route for defenders/GKs is under-sourced and a second source-set migration is predictable.

Add a deterministic **research backstop** for coverage gaps under `etl/merit/raw/research/`, scoped mechanically:

- top ~5 players per 2026 team by current projected internal score, only where the 2026 card is linked to a canonical historical `player_id`;
- a curated historical gap list from `CAREER_STATURE.md` / `MERIT_SOURCES.md` (Cruyff, Baresi, Maldini, Yashin, non-European/defender/GK gaps).

Research notes contain only citation-backed factual claims that would also be valid parser output (award inclusion, all-time/dream-team inclusion, captaincy record, caps/goals record). No rating numbers, no invented rankings, no LLM-generated facts, no per-player overrides. Research rows enter the same `source_facts.json` path as parser rows; ambiguous research rows are withheld to review identically.

### Career-stature table shape (v2)

`career_stature.json` remains ETL-only and keyed by `player_id`. v2 rows carry:

```text
player_id
stature_version              # "career-stature-2.0.0"
source_set_version           # "merit-source-set-2.0.0"
career_stature_score         # raw saturating evidence in [0,1]
career_stature_index         # calibrated monotonic scale in [0,1], consumed by rating
coverage                     # weighted source-family coverage in [0,1]
era_bucket
career_peak_year
family_scores
family_weights
legend                       # factual badge eligibility, boolean
legend_reason_codes          # closed-set strings, ETL/report-only
review_flags
source_refs
```

The distinction between `career_stature_score` and `career_stature_index` is load-bearing:

- `career_stature_score` remains the transparent saturating factual composite (per-family `1 − Π(1 − fact_strength_i)`; cross-family `1 − Π(1 − family_weight[f] · family_score[f])`).
- `career_stature_index` is a calibrated, **monotonic, global** transform that corrects the v1 compression where all-time peaks topped out near 0.66. The transform uses a small number of documented global parameters; no per-player overrides.

v2 family set (position-balanced):

```text
wc_legacy
global_annual_recognition
regional_annual_recognition
position_balanced_selection
international_record
retrospective_selection
captaincy
club_honors                 # registered, weight 0 unless approved later
```

### Stature-dominant rating formula

For historical cards, keep the current raw tournament calculation as a context signal:

```text
raw_tournament_score = clamp01(tournament_base + award_anchor + finish_anchor)
```

Then replace `_career_lift(...)` with a **blended composite** that ramps continuously from the raw-only path to the stature-dominant path across a small band around the material-stature threshold, eliminating the cliff that would otherwise land two near-identical players far apart:

```text
stature_model_weight = ramp01(
    career_stature_index,
    MATERIAL_STATURE_MIN_INDEX - STATURE_RAMP_HALF_WIDTH,
    MATERIAL_STATURE_MIN_INDEX + STATURE_RAMP_HALF_WIDTH,
)  if (career row exists AND coverage >= MATERIAL_STATURE_MIN_COVERAGE)
   else 0.0

stature_target  = target_for_position(pos, career_stature_index)
tournament_ref  = median raw_tournament_score for (tournament_id, pos)
raw_delta       = raw_tournament_score - tournament_ref
modulation      = clamp(
    TOURNAMENT_MOD_GAIN[pos] * raw_delta,
    -TOURNAMENT_DOWN_CAP[pos, stature_tier],
    +TOURNAMENT_UP_CAP[pos, stature_tier],
)
stature_path    = clamp01(stature_target + modulation)
raw_path        = raw_only_score(raw_tournament_score, tournament evidence)

final_score     = clamp01(
    stature_model_weight       * stature_path
  + (1 - stature_model_weight) * raw_path
)
```

The asymptotic endpoints are unchanged: a card well below the material-stature band (`stature_model_weight = 0`) is purely tournament-derived; a card well above (`stature_model_weight = 1`) is purely stature-dominant with bounded tournament modulation. Between them, the ramp interpolates so the boundary is continuous. `STATURE_RAMP_HALF_WIDTH` is locked alongside the other v2 constants in MV2-8 and tested by a threshold-straddle assertion (cards within ε of the threshold differ by < N display points).

**Stature tier shape (structural; numeric edges locked by tests in MV2-8):** `stature_tier ∈ {bronze, silver, gold}` partitioned by quantiles of `career_stature_index` within the material-stature cohort (lowest tier = qualifying material stature; highest = approximately top-quintile of material-stature index). Tier is used only by the per-pos `TOURNAMENT_DOWN_CAP[pos, stature_tier]` table (tighter cap at higher tier). Tiering is computed in stature.py and emitted on `career_stature.json`; rating consumes it. The Legend boolean is independent of stature tier (legend has its own factual gate).

**Cohort fallback for tournament reference (structural):** `tournament_ref` for `(tournament_id, pos)` uses the cohort median when `n >= COHORT_MIN_N`; falls back to `(pos)`-only cross-tournament median when sparser; falls back to `raw_tournament_score` (→ `raw_delta = 0`, no modulation) when even that is empty. Identical pattern on the 2026 side for `projected_ref` with the 2026 position cohort. `COHORT_MIN_N` is a small global constant fit alongside other v2 constants in MV2-8.

Initial fitting ranges (locked by tests in MV2-8, not normative in code):

```text
MATERIAL_STATURE_MIN_COVERAGE: 0.25–0.35
MATERIAL_STATURE_MIN_INDEX:    0.35–0.45
STATURE_RAMP_HALF_WIDTH:       ≈ 0.04–0.08 (band around MATERIAL_STATURE_MIN_INDEX
                                              over which stature_model_weight ramps 0→1)
STATURE_TARGET_FLOOR[pos]:     ≈ 0.58–0.66
STATURE_TARGET_SPAN[pos]:      index ≈ 1.0 maps near display high-90s
TOURNAMENT_MOD_GAIN[pos]:      ≈ 0.25–0.45
TOURNAMENT_DOWN_CAP:           ≈ 0.05–0.12; tighter at highest stature tier
TOURNAMENT_UP_CAP:             ≈ 0.05–0.10
COHORT_MIN_N:                  small positive integer (≈ 6–10)
```

Normative behavior (more important than the indicative numerics):

- A recognized great's weak tournament remains elite (bounded down-modulation).
- A recognized great's apex tournament can still rise above the career target via positive modulation.
- A non-material-stature player remains primarily tournament-derived; cannot enter the high-90s/Legend band on raw curve alone.
- No positive-gap requirement; tournament context can move stature cards up OR down.
- No `CAREER_MAX_LIFT` cap remains because there is no additive "lift" concept.
- No per-player override table.

The old component fields are renamed so the emitted rating no longer claims lift semantics. Stop emitting `career_stature_lift` and old `career_stature_target`; emit `raw_tournament_score`, `tournament_reference_score`, `tournament_modulation`, `career_stature_score`, `career_stature_index`, `career_stature_coverage`, `stature_target_score`, `stature_model_weight`. Because `RatingComponentSchema` is numeric-only, `legend` and `legend_reason_codes` are NOT placed in `components[]` — they need first-class schema fields.

### Raw-only cards

Raw-only cards remain honest and playable; they are not silently zeroed. The high-90s/Legend display band is reserved for material-stature cards via a **global raw-only elite ceiling** derived deterministically: cap `raw_only_score` at the lower of (a) the median final internal score of material-stature cards in the cohort `(tournament_id, pos)` and (b) a fixed global ceiling that maps under the unified curve to a display value strictly below the lowest factual-Legend display. The ceiling is computed once per build from the final stature-path score distribution; it is not a per-player override and not hand-set. Cards without material career stature never receive `legend = true`.

### 2026 reconciliation (in scope, not deferred)

Use the existing identity seam — `link_status == "linked"` on `player_tournaments_2026.json` (`ingest_2026.py:80-88, 146`; `identity_2026.py:137-210`). For linked players with material stature:

```text
projected_final_score = stature_target + bounded projected_context_modulation

projected_raw_score = current caps/goals/age/league formula
projected_ref       = median projected_raw_score for 2026 position cohort
projected_delta     = projected_raw_score - projected_ref
projected_mod       = bounded(PROJECTED_MOD_GAIN * projected_delta)
```

Minted/unlinked/ambiguous 2026 players never query `career_stature.json` and remain on `projected_raw_score`. Linked aging legends can receive downward projected modulation but not a full collapse below recognized stature. `teams_2026.json` regenerates because linked-player channel movement changes Team2026 aggregates. Projected rating bumps to `proj-career-3.0.0`.

### Unified display scale

Fit **one** low-DOF monotonic curve over the combined historical + projected final internal-score distribution. Both `ratings.json` and `ratings_2026.json` materialize `overall` through the same fitted curve. No per-player overrides, no per-era override table. The display cap path is explicit: `baseline_anchor_estimate` keeps the `[66, 73]` cap; any material `career_stature_estimate` exits via the normal unified curve.

Display invariants (test-locked):

- Historical and projected `overall` both in `[66, 99]`; no `overall == 100`.
- Recognized greats land broadly `88–99`.
- Messi `>= 91` on relevant high-stature cards, including linked 2026 unless an approved projected-context cap visibly lowers him.
- Pelé / Maradona / Messi / Cristiano can reach high-90s on appropriate cards.
- Defender/GK legends are not suppressed relative to attackers.
- Defender/GK/midfielder legends read elite on their **position channel**, not uniformly elite across all four channels (Maldini DEF ≫ ATT; Yashin GK ≫ outfield; a defender or goalkeeper legend must NOT become a top-tier attacker). This is the inverse of the not-suppressed invariant: position channel must rise, off-position channels must remain plausibly bounded.
- Raw-only non-material cards do not occupy the same high-90s semantic band as global legends.

### Factual Legend badge

Replace the UI's `overall >= 96` heuristic (`view-models.ts:277-282`) with a factual boolean `Rating.legend`. Threshold (Paulo approved 2026-06-08, recognizability-first):

```text
legend = true if any of:

1. global_annual_win_count >= 2
   (Ballon d'Or, FIFA World Player/The Best, IFFHS World's Best,
    World Soccer Player of the Year, equivalents)
   OR (global_annual_win_count >= 1
       AND at least one corroborating major fact:
         approved all-time selection
         / position-balanced world-XI selection
         / regional POY top-3
         / 100-cap-class record)

2. approved_all_time_selection_count >= 1
   (Ballon d'Or Dream Team 1st/2nd/3rd XI, IFFHS all-time/world/national
    dream team, IFFHS century world/continental top tier, equivalents)

3. position_balanced_world_xi_count >= 3
   AND career_stature_index >= LEGEND_INDEX_FLOOR
   (FIFPro World 11 / UEFA Team of the Year / ESM Team of the Season /
    UEFA positional awards — the defender/GK/midfielder route)

4. broad_retrospective_inclusion (FIFA 100 or equivalent)
   AND at least one additional major annual, all-time, regional-POY,
   or position-balanced fact
```

Rationale: dropping the pure single-distant-award case (one annual win, decades ago, no corroboration) so the badge reads as a "known legend" rather than a single-win artifact. Route 1's multi-winner OR winner-with-corroboration branch covers modern recognized greats; Routes 2-4 still capture pre-BdO, non-attacker, and non-European greats via approved all-time selections, repeated position-balanced world XIs, and FIFA-100-equivalent retrospective inclusion paired with a corroborating major fact. The threshold is tunable via the `LEGEND_INDEX_FLOOR` constant and MV2-8 named anchors without a re-plan.

Reason codes (closed strings): `global_annual_multi_winner`, `global_annual_winner_with_corroboration`, `approved_all_time_selection`, `position_balanced_world_xi_3plus`, `retrospective_plus_major_fact`. The v1 single-award-alone code (`global_annual_winner`) is dropped.

Runtime: `provenanceBadgeKind(...)` checks `legend === true` first, then estimate/projected/historical. Existing CSS (`prov_legend`, `provBadge_legend`) is reused as-is.

### Versioning

```text
Historical rating:      wc-perf-3.0.0       → wc-perf-4.0.0
Projected rating:       proj-career-2.0.0   → proj-career-3.0.0
Career stature table:   career-stature-1.0.0 → career-stature-2.0.0
Merit source set:       (current)           → merit-source-set-2.0.0
Runtime data schema:    runtime-data-1.0.0  → runtime-data-1.1.0  (legend required on RuntimeRating)
Engine version:         bump only if λ/constants/math change
```

If sim calibration constants move, bump `engine_version` and re-lock persisted-run skew expectations. If only ratings/channels move and engine constants remain byte-identical, do not bump `engine_version`; rating-version anchors already invalidate persisted runs via the existing skew test.

### Sim cascade posture

Merit-v2 moves far more than the current 143 lifted cards. Treat downstream sim failures as expected signal, not noise:

1. Regenerate historical/projected ratings and compact bundles.
2. Run faithfulness suite (`packages/core/src/faithfulness.test.ts`).
3. Run symmetric realism gate (`realism-modern-norms.golden.test.ts`).
4. Run heavy asymmetric realism gate (`WCDRAFT_REALISM_HEAVY=1`).
5. If gates fail because channels moved, re-fit λ constants in `calibration.ts:76-260` without weakening realism bands inside the rating PR.
6. Bump `engine_version` only when engine constants/math change.
7. Re-lock golden fixtures only after reviewing plausible movement in team/channel distributions, high-stature historical cards, 2026 TeamStrength aggregates, top-scorer/match/group-stage/e2e outcomes.

---

## Work Items

### MV2-1 — Merit source-set v2 expansion

**Goal:** Extend the existing deterministic merit intake with the source breadth needed for stature-dominant ratings, position-balanced defender/GK coverage, 2026 top-player coverage, and factual Legend eligibility. Reuses the current `merit/` package; does not change rating outputs.

**Done when:**

- `etl/src/wcdraft_etl/merit/` registers source-set version `merit-source-set-2.0.0`, separate from the career-stature table version.
- The v2 source registry includes v1 sources plus Tier-A additions: RSSSF African POY; RSSSF Asian POY; SAM POY placements (not only winners); CONCACAF Awards; UEFA Club positional awards; UEFA Men's Player of the Year top-three; UEFA Team of the Year; FIFPro World 11; ESM Team of the Season; World Soccer Awards; Onze d'Or/d'Argent/d'Bronze; IFFHS All-Time / National Dream Teams; Ballon d'Or Dream Team; EU-Football.info captaincy-by-captain-caps.
- Source-family mapping is explicit and stable: `global_annual_recognition`, `regional_annual_recognition`, `position_balanced_selection`, `retrospective_selection`, `international_record`, `captaincy`, existing `wc_legacy`, reserved `club_honors` (weight 0).
- Raw snapshots committed under `etl/merit/raw/`; listed in `etl/merit/fetch_manifest.json`.
- `python -m wcdraft_etl.merit.fetch --verify` recomputes SHA256 for every committed file and fails on byte drift.
- New parsers are pure functions over committed bytes; no network, clock, randomness, fuzzy online lookup, or LLM calls.
- `merit/build.py` emits sorted deterministic `source_facts.json`, `link_review.json`, `MERIT_SOURCES.md` without changing `ratings.json`, `ratings_2026.json`, compact bundles, or sim artifacts.
- `merit/link.py` keeps the conservative rule: unique high-confidence links only; multi-candidate, nation-divergent, weak-match, transliteration, and missing-candidate rows withheld to review.
- New position-balanced sources produce facts for defenders/GKs/midfielders as first-class signals.
- `MERIT_SOURCES.md` includes a defender/GK coverage section explicitly covering Baresi, Maldini, Yashin, Buffon, Cafu, Beckenbauer.
- Proprietary-rating audit scans the expanded `etl/merit/raw/` tree and new parser/linker files; rejects proprietary rating tokens; allows legitimate public awards, all-time teams, tournament names, tri-codes, and `FIFA 100` as a public factual source.

**Key files:**

- `etl/src/wcdraft_etl/merit/__init__.py:1-120` — source registry, version constants, family taxonomy.
- `etl/src/wcdraft_etl/merit/fetch.py:1-75` — SHA-pinned fetch/verify.
- `etl/src/wcdraft_etl/merit/build.py:1-80` — parser collection and deterministic artifact emission.
- `etl/src/wcdraft_etl/merit/link.py:1-214` — conservative linker.
- `etl/src/wcdraft_etl/merit/report.py:1-160` — `MERIT_SOURCES.md`.
- `etl/merit/raw/**` — committed v2 raw snapshots.
- `etl/merit/fetch_manifest.json` — pinned byte manifest.
- `etl/tests/test_merit.py:1-220` — parser/linker/determinism test precedent.
- `etl/tests/test_rating.py:648-680` — proprietary rating IP audit seam.

**Dependencies:** none.

**Size:** XL.

---

### MV2-2 — Deterministic factual research backstop

**Goal:** Add a narrow, citation-backed deterministic research source path for high-impact coverage gaps that parser-only public lists still miss (2026 top players + historical defender/GK/non-European greats). **In scope for Merit-v2; not optional** (Paulo approved 2026-06-08; cannot be de-scoped for schedule). This is a **bounded coverage-gap mechanism**, not an editorial rating channel: scope is mechanically defined (top-5-per-2026-linked-team + curated v1-report gap list), every row carries a public-source citation, and the linker treats research rows identically to parser rows. There is no path for an implementer to add subjective rankings or invented numbers — the source-fact contract and the proprietary-IP audit jointly enforce this.

**Done when:**

- New committed research area `etl/merit/raw/research/` with a manifest listing each note, cited public source URL, pin metadata, and intended source-family mapping.
- Research scope is mechanically bounded: top ~5 players per 2026 team by current projected internal score, only where the 2026 card is linked to a canonical historical `player_id`; plus a curated historical gap list from `CAREER_STATURE.md` and `MERIT_SOURCES.md`.
- Research notes contain only factual claims that would also be valid parser output (award/dream-team inclusion, captaincy record, caps/goals record, public recognition placement).
- Research notes do NOT contain: rating numbers; subjective invented rankings; LLM-generated facts; proprietary rating references; OVR/channel recommendations; per-player boost/override instructions.
- Research facts enter `source_facts.json` with stable `source_id`, `family`, `raw_name`, `year`, `detail`, and citation reference.
- Linker treats research rows identically to parsed rows: unique high-confidence assignment only; ambiguous to review; uncited fails the build.
- `MERIT_SOURCES.md` separates parser-derived and research-derived fact counts.
- Known v1 gaps explicitly evaluated: Cruyff, Baresi, Maldini, Yashin, non-European legends.
- Tests prove that modifying a citation changes the pinned manifest and that ambiguous research rows do not leak into `career_stature.json`.

**Key files:**

- `etl/merit/raw/research/**` — committed research notes and manifest.
- `etl/src/wcdraft_etl/merit/build.py:1-80` — research parser in `collect_records`.
- `etl/src/wcdraft_etl/merit/link.py:1-214` — identical link/review rules for research rows.
- `etl/src/wcdraft_etl/merit/report.py:1-160` — parser-vs-research contribution split.
- `etl/output/merit/CAREER_STATURE.md:1-45` — thin-coverage evidence.
- `etl/output/merit/MERIT_SOURCES.md:1-80` — coverage report.
- `etl/src/wcdraft_etl/rating_2026.py:170-286` — projected distribution used only to select bounded 2026 review set.
- `etl/tests/test_merit.py:150-260` — withholding/determinism precedent.

**Dependencies:** MV2-1.

**Size:** M.

---

### MV2-3 — `career-stature-2.0.0` table, index, and factual Legend eligibility

**Goal:** Replace the v1 capped-lift-oriented `career_stature.json` semantics with a v2 ETL-only stature table that exposes both transparent source evidence and a calibrated `career_stature_index` consumed by ratings. Add factual `legend` eligibility at the source/stature layer, not from OVR.

**Done when:**

- `etl/output/career_stature.json` emits `version = "career-stature-2.0.0"`; every row carries the v2 field set (see Approach § "Career-stature table shape").
- `career_stature_score` continues the saturating factual composite; `career_stature_index` is a global, documented, monotonic transform that corrects the v1 compression near 0.66.
- Transform contains no per-player IDs, names, or direct override map.
- Family weights are era-aware and position-balanced; attacker-heavy annual awards cannot be the only route to high stature.
- `coverage` represented as weighted family coverage; missing coverage is lower coverage, not a fabricated zero.
- `club_honors` registered with weight 0 unless separately approved.
- `legend` is source-derived; does NOT inspect `overall`, channels, or rating artifacts.
- `legend_reason_codes` are closed strings: `global_annual_winner`, `approved_all_time_selection`, `position_balanced_world_xi_3plus`, `retrospective_plus_major_fact`.
- Defender/GK/midfielder Legend routes work via all-time XI / dream-team / positional-award / repeated world-XI selections.
- `CAREER_STATURE.md` reports score/index distributions by era and position; canonical-greats checklist; defender/GK checklist; Legend count and reason-code breakdown; rows withheld from rating due to thin coverage.
- `pipeline.py` ordering updated so merit facts and `career_stature.json` are produced after canonical historical tables/supplement overlays and before ratings consume them.
- Fresh build is byte-identical across two consecutive runs.
- Tests fail on duplicate `player_id`, non-finite values, out-of-range scores/indexes/coverage, conflicting duplicate facts, and missing/non-boolean `legend`.

**Key files:**

- `etl/src/wcdraft_etl/merit/stature.py:1-230` — v1 composite to extend.
- `etl/src/wcdraft_etl/merit/__init__.py:1-120` — version constants, family registry.
- `etl/src/wcdraft_etl/pipeline.py:28-66, 80-132` — pipeline ordering.
- `etl/output/career_stature.json` — v2 artifact.
- `etl/output/merit/CAREER_STATURE.md:1-45` — v1 report to expand.
- `etl/output/merit/career_stature_review.json` — review artifact.
- `etl/tests/test_merit.py:1-260` — deterministic merit fixture pattern.
- `etl/tests/test_career_stature.py` — stature-table schema/index/Legend assertions.

**Dependencies:** MV2-1, MV2-2.

**Size:** L.

---

### MV2-4 — Historical rating refactor: remove capped lift, add stature target + bounded modulation

**Goal:** Refactor historical ratings from `raw_tournament + capped_lift` to a stature-dominant internal score. Career stature becomes the primary base for material-stature players; tournament context becomes bounded signed modulation. Raw-only cards remain honest and playable.

**Done when:**

- `etl/src/wcdraft_etl/rating.py` bumps `RATING_VERSION` from `wc-perf-3.0.0` to `wc-perf-4.0.0`.
- `_career_lift(...)` at `rating.py:402-415` is removed or made unreachable; no active formula uses `CAREER_MAX_LIFT`, positive-gap-only `max(0, target - raw)`, or `raw_tournament_score + career_lift`.
- Historical internal scoring follows the Approach formula: a blended composite `stature_model_weight * stature_path + (1 - stature_model_weight) * raw_path`, where `stature_path` is `clamp01(stature_target + bounded signed modulation)` and `raw_path` is `raw_only_score(raw_tournament_score, tournament evidence)`. The hard `has_material_stature` if/else from earlier drafts is replaced by this continuous blend so the threshold is not a cliff.
- `stature_model_weight` is a monotonic ramp `0 → 1` over `[MATERIAL_STATURE_MIN_INDEX - STATURE_RAMP_HALF_WIDTH, MATERIAL_STATURE_MIN_INDEX + STATURE_RAMP_HALF_WIDTH]`, gated to `0.0` when no career row exists or `coverage < MATERIAL_STATURE_MIN_COVERAGE`. Asymptotic endpoints (`0` = raw-only, `1` = stature-dominant) are preserved; near-identical cards straddling `MATERIAL_STATURE_MIN_INDEX` do not land far apart.
- Channel-shape invariant for non-attacker legends: a DF/GK/MF legend reads elite on its **position channel**, not uniformly elite (Maldini DEF ≫ ATT; Yashin GK ≫ outfield; a defender or goalkeeper legend must NOT become a top-tier attacker). Channel derivation enforces position-shape, not flat stature transfer.
- Tournament context = existing raw composite (goals/appearances percentiles + award anchor + finish anchor); cohort-relative reference is median `raw_tournament_score` for `(tournament_id, pos)`.
- Modulation is signed: weak tournament can lower stature target within capped range; apex tournament can raise it within capped range. No positive-gap requirement.
- Downward caps tighter at highest stature tiers (legend's weakest WC still reads elite).
- Raw-only cards never receive fabricated career rows; never silently zeroed; bounded below the high-90s/Legend semantic band by a global evidence-based ceiling.
- No per-player override table, name exception list, or player-id constant.
- `components[]` stops emitting `career_stature_lift` and old `career_stature_target`; emits new numeric components per Approach.
- Non-numeric diagnostics (path labels, Legend reason codes) do NOT enter `components[]` (`RatingComponentSchema` remains numeric-only).
- Channel derivation continues from final post-stature internal score through `_channel(...)`; all four sim channels move coherently.
- Every emitted rating row joins `career_stature.json.legend` for the card's `player_id` and emits `legend: boolean` directly on the row (missing-row → `false`). This is the rating-layer join that MV2-7's compact builder reads.
- Tests assert internal-score behavior BEFORE display calibration: Pelé-1966 and Messi-2010 are stature-path cards; Pelé-1958 and Maradona-1986 can exceed stature target via positive modulation; Cruyff/Baresi/Maldini/Yashin no longer zeroed once v2 sources are present; raw-only controls do not become factual legends or high-90s peers; defender/GK named anchors (Maldini, Yashin, Buffon, Cafu, Baresi) show position-channel-dominant shape, not uniform elite across all four channels.
- **Accuracy-eyeball SAMPLE artifact** emitted at `etl/output/merit/MERIT_V2_SAMPLE.md`: a human-readable shape sample covering ~40-50 cards (top by `career_stature_index`, a mid sample of solid-but-not-legendary internationals, and a position-balanced slice including DF/GK/MF anchors), each row showing internal scores (final, stature_path, raw_path, stature_model_weight, four channels). This is the first sanity read of the curve **before MV2-5 / MV2-6 commit further effort**; if the shape is visibly wrong, MV2-4 iterates before downstream stages bake in the bad curve.

**Key files:**

- `etl/src/wcdraft_etl/rating.py:129-148` — career-lift constants to replace.
- `etl/src/wcdraft_etl/rating.py:250-308` — display helpers (final display use moves to MV2-6).
- `etl/src/wcdraft_etl/rating.py:318-335` — career-stature loader.
- `etl/src/wcdraft_etl/rating.py:402-415` — `_career_lift` removal point.
- `etl/src/wcdraft_etl/rating.py:536-552` — current lift insertion point; replace with stature target + modulation.
- `etl/src/wcdraft_etl/rating.py:655, 674-682` — `build_internal_view` / `build_ratings` signatures.
- `etl/tests/test_rating.py:1-190` — setup, determinism, schema/distribution tests.
- `etl/tests/test_rating.py:331-470` — monotonicity, basis, anchor tests to revise.
- `etl/tests/test_rating.py:648-680` — current E-4 lift acceptance tests to replace with stature-dominant assertions.

**Dependencies:** MV2-3.

**Size:** L.

---

### MV2-5 — 2026 linked-player stature reconciliation

**Goal:** Bring projected 2026 ratings onto the same stature scale for linked canonical players while keeping minted/unlinked/ambiguous players on the honest projected raw path.

**Done when:**

- `etl/src/wcdraft_etl/rating_2026.py` bumps `RATING_VERSION` from `proj-career-2.0.0` to `proj-career-3.0.0`.
- `rating_2026.py` consumes `career_stature.json` only for cards whose 2026 row has `link_status == "linked"`.
- Lookup key is canonical `player_id` already emitted on linked 2026 cards (`ingest_2026.py:80-88, 146`; `identity_2026.py:137-210`).
- Missing `link_status` fails loudly; never defaulted.
- All non-linked statuses (`minted`, `unlinked`, `ambiguous`, any future status not exactly `"linked"`) treated as non-stature.
- Linked + material-stature: `projected_final_score = stature_target + bounded projected_context_modulation`.
- Projected context source remains the factual projected formula at `rating_2026.py:193-263` (caps pct, intl_goals pct, age factor, league-strength anchor); cohort-relative modulation with tighter downward cap for highest-stature aging legends.
- Minted/unlinked/ambiguous: never query `career_stature.json`; remain on `projected_raw_score`; cannot receive factual Legend status.
- New numeric components for 2026: `projected_raw_score`, `projected_reference_score`, `projected_modulation`, `career_stature_score`, `career_stature_index`, `career_stature_coverage`, `stature_target_score`, `stature_model_weight`.
- Linked 2026 high-stature players (Messi, Cristiano) evaluated through same `career_stature_index` scale as historical cards.
- Every emitted projected rating row joins `career_stature.json.legend` for linked players (`legend = career_stature[player_id].legend`); minted/unlinked/ambiguous get `legend = false`.
- `ratings_2026.json` not final until MV2-6 applies unified display curve.
- `teams_2026.json` regenerates after final 2026 ratings (Team2026 aggregates depend on best-XI selection by projected `overall`).
- Tests assert on **internal scores (pre-display)**: no minted player consumes `career_stature.json`; linked Messi-2026 internal score is no longer dominated by age-only projected math; top-10 2026 distribution no longer dominated by projected raw artifacts without global-stature support. Display-band assertions (Messi-2026 ≥ 91 OVR, etc.) belong to MV2-6 after the unified curve lands.

**Key files:**

- `etl/src/wcdraft_etl/rating_2026.py:170-286` — projected rating build path.
- `etl/src/wcdraft_etl/rating_2026.py:193-263` — current projected raw formula.
- `etl/src/wcdraft_etl/rating_2026.py:257, 262` — separate curve/OVR materialization to remove in MV2-6.
- `etl/src/wcdraft_etl/ingest_2026.py:80-88, 146, 170-222` — `link_status` and ratings-to-Team2026 aggregate flow.
- `etl/src/wcdraft_etl/identity_2026.py:137-210` — linked vs minted identity resolver.
- `etl/tests/test_ingest_2026.py` — artifact/link-status tests.
- `etl/tests/test_rating.py:1-190` — version/distribution patterns to mirror for projected tests.

**Dependencies:** MV2-4.

**Size:** L.

---

### MV2-6 — Unified historical + projected display curve

**Goal:** Fit one low-DOF display scale over final historical and projected internal scores so historical cards and 2026 cards are directly comparable. Removes the separate-curve seam at `rating.py:655` and `rating_2026.py:257`.

**Done when:**

- Historical and projected internal row builders both expose final internal scores (post-MV2-4 / MV2-5) before display.
- A shared ETL-only display-scale module/coordinator fits a single curve over `[historical final internal scores] + [projected 2026 final internal scores]`.
- Neither `rating.py:655` nor `rating_2026.py:257` fits a partition-only curve.
- Both `ratings.json` and `ratings_2026.json` materialize `overall` through the same fitted curve.
- Curve remains global, monotonic, low-DOF, auditable: no per-player, per-era, or hand-set overrides.
- Historical and projected `overall` both in `[66, 99]`; no `overall == 100`.
- Display cap path is explicit: `baseline_anchor_estimate` keeps the `[66, 73]` cap; material `career_stature_estimate` exits via the normal unified curve.
- Scale invariants locked by tests: recognized greats broadly `88–99`; Messi `>= 91` on relevant high-stature cards (including linked 2026 unless an approved projected-context cap visibly lowers him); Pelé/Maradona/Messi/Cristiano can reach high-90s on appropriate cards; defender/GK legends not suppressed; raw-only non-material cards don't dominate high-90s.
- `ratings.json`, `ratings_2026.json`, and `teams_2026.json` regenerated together.
- Emitted rating versions: `wc-perf-4.0.0`, `proj-career-3.0.0`.
- Empty/non-finite/degenerate distributions fail loudly.

**Key files:**

- `etl/src/wcdraft_etl/rating.py:250-308` — display curve implementation to share.
- `etl/src/wcdraft_etl/rating.py:655, 674-682` — historical internal view and materialization.
- `etl/src/wcdraft_etl/rating_2026.py:257, 262` — projected-only curve to remove.
- `etl/src/wcdraft_etl/ingest_2026.py:170-222` — Team2026 aggregate rebuild after final projected ratings.
- `etl/tests/test_rating.py:86-180, 331-470` — distribution / monotonicity / anchor tests.
- `etl/RATING_METHODOLOGY.md` — historical methodology.
- `etl/RATING_METHODOLOGY_2026.md` — projected methodology.

**Dependencies:** MV2-4, MV2-5.

**Size:** L.

---

### MV2-7 — Runtime factual Legend boolean and badge switch

**Goal:** Propagate `legend: boolean` from ETL ratings through the core schema, compact builder, runtime data types, and web badge classifier. Stop deriving `Legend` from `overall >= 96`.

**Done when:**

- Historical and projected rating rows both include required `legend: boolean`, source-derived from `career_stature.json.legend`.
- `packages/core/src/types/rating.ts:46-91` adds `legend: boolean` to `Rating`.
- `packages/core/src/schemas/rating.ts:30-45` adds explicit required `z.boolean()` field.
- `RatingComponentSchema` remains numeric-only; `legend`/`legend_reason_codes` NOT hidden in `components[]`.
- `packages/data/scripts/build-compact-data.mjs:306-322` (historical) and `:405-419` (projected) copy `legend`; fail if source row is missing a boolean.
- `packages/data/src/types.ts:116-153` exposes `legend` on `RuntimeRating`.
- Runtime schema bumps `runtime-data-1.0.0 → runtime-data-1.1.0`.
- `apps/web/lib/game/view-models.ts:277-282` `provenanceBadgeKind(...)` checks `legend === true` before estimate/projected/historical.
- `apps/web/lib/game/adapters.ts:60-78` passes `r.legend` into the classifier.
- `apps/web/components/game/candidate-card.tsx:80-84, 124-128, 156-160` continues rendering the existing `legend` badge kind.
- Existing Legend CSS is reused as-is.
- Tests assert: `overall >= 96` but `legend === false` is NOT classified as legend; factual legend with `overall < 96` still gets the badge; estimate/projected badges still work when `legend === false`; every runtime rating has a boolean `legend`; compact data without `legend` fails schema validation rather than defaulting.
- No DB migration; compact regen + runtime schema/version anchors handle persisted-run/cache invalidation.

_(Specific file:line attach points are listed under Background § "Card UI / Legend badge seam" and Key files below — they orient the implementer but are not Done-when assertions; adjacent line numbers will shift.)_

**Key files:**

- `packages/core/src/types/rating.ts:46-91`, `packages/core/src/schemas/rating.ts:30-45`.
- `packages/data/scripts/build-compact-data.mjs:306-322, 405-419`.
- `packages/data/src/types.ts:116-153`.
- `apps/web/lib/game/view-models.ts:23, 277-282, 285-290`.
- `apps/web/lib/game/adapters.ts:60-78`.
- `apps/web/components/game/candidate-card.tsx:80-84, 124-128, 156-160`.
- `apps/web/components/game/game.module.css:2276-2279, 2326-2330`.
- `packages/data/test/compact-data.integrity.test.ts:76-124`.

**Dependencies:** MV2-3, MV2-6.

**Size:** M.

---

### MV2-8 — Named-anchor calibration tests + methodology docs

**Goal:** Lock the Merit-v2 calibration promises as explicit named-anchor acceptance tests, and refresh methodology docs to match. Routine methodology updates may also land in the last commit of MV2-4/MV2-5/MV2-7; this item owns the named-anchor test suite and the divergence threshold lock.

**Done when:**

- Named-anchor tests in `etl/tests/test_rating.py` (and projected counterpart) lock stature-dominant behavior at the **top**: Pelé-1966 remains elite; Messi-2010 rises from the current underweighted result; Pelé-1958 / Maradona-1986 / Messi-2022 / Cristiano high-stature cards can reach high-90s on appropriate cards; Cruyff/Baresi/Maldini/Yashin/Buffon/Cafu visible after v2 sources; cards with no material stature do not receive `legend = true`.
- Named-anchor tests lock the **mid band** (the E-4-repeat guard — the prior plan pinned only top + a floor, which is how the v1 curve compressed):
  - A solid international regular with modest recognition lands display **~76-84**, **NOT** 88+.
  - A marginal / thin-material-stature card (just over `MATERIAL_STATURE_MIN_INDEX`) lands display clearly **below** the recognized-greats band.
  - A strong-tournament raw-only journeyman does not enter the **high-80s / Legend band** on the raw curve alone.
- **Anti-inflation invariant** asserted on the material-stature display distribution: the cohort is NOT compressed into the high-80s/90s. Assert a believable spread — e.g. median material-stature display lands in a mid band, not clustered at the top; quantile gap between, say, P50 and P90 exceeds a minimum spread locked alongside the other v2 constants.
- Named-anchor **channel-shape** tests for non-attacker legends (inverse of "defenders/GKs not suppressed"): Maldini reads DEF ≫ ATT; Yashin reads GK ≫ outfield; defender / GK named anchors do not become top-tier attackers in their channel vector.
- **Threshold-straddle test** for MV2-4's continuity ramp: two cards with `career_stature_index` within ε of `MATERIAL_STATURE_MIN_INDEX` differ by < N display points (N locked alongside the other v2 constants); ensures `stature_model_weight` is smooth across the band.
- Top-end great-vs-great ordering is **NOT** hard-pinned by named-anchor tests; top-end inversions are routed through the MV2-9 divergence-review queue, not into the deterministic test surface, so a single non-IP review-input update never re-shapes acceptance tests.
- Display invariants asserted: recognized greats broadly in `88-99` (not pinned identical); Messi `>= 91` on relevant high-stature cards including linked 2026; no `overall == 100`; `legend` factual (can diverge from `overall >= 96`); modern journeyman / raw-only controls bounded below the Legend semantic band; old slugs implying capped lift absent.
- Final v2 constants locked: `MATERIAL_STATURE_MIN_*`, `STATURE_RAMP_HALF_WIDTH`, threshold-straddle `N` display points, mid-band anti-inflation spread thresholds, `STATURE_TARGET_*`, `TOURNAMENT_*_CAP`, `COHORT_MIN_N`, MV2-9 divergence thresholds (overall, primary channel, Legend disagreement integers).
- **Final display-accuracy SAMPLE artifact** emitted (refresh of `etl/output/merit/MERIT_V2_SAMPLE.md` or a sibling `MERIT_V2_DISPLAY_SAMPLE.md` covering the same cohort post-unified curve): each row shows final display `overall`, four display channels, `legend` flag, and stature path indicators. **Paulo reviews this sample and signs off on accuracy BEFORE MV2-11 commits the sim cascade / λ refit.** This is a human checkpoint, not an automated gate — the goal is to catch a miscalibrated curve before it propagates through the engine cascade and golden re-lock, where it would be far more expensive to correct.
- `etl/RATING_METHODOLOGY.md` and `RATING_METHODOLOGY_2026.md` updated to describe v2; `MERIT_SOURCES.md` + `CAREER_STATURE.md` regenerated for v2 source families and score/index/coverage/Legend distributions. (Methodology updates may have landed incrementally with MV2-4/5/7; this item ensures consistency.)
- Methodology docs state that rating constants are global; future tuning updates tests/reports, never adds player-specific exceptions.

**Key files:**

- `etl/tests/test_rating.py:86-180, 331-470, 648-680`.
- `etl/tests/test_merit.py:1-260`.
- `etl/RATING_METHODOLOGY.md`, `etl/RATING_METHODOLOGY_2026.md`.
- `etl/output/merit/MERIT_SOURCES.md:1-80`, `CAREER_STATURE.md:1-45`.

**Dependencies:** MV2-6, MV2-7.

**Size:** M.

---

### MV2-9 — Cross-stage determinism, IP firewall, and divergence review

**Goal:** Add the cross-stage validation that MV2-1 through MV2-8 individually cannot own: full-pipeline determinism, proprietary-IP firewall over the expanded source surface, and the review-only divergence queue. Per-stage acceptance tests live in their owning work items.

**Done when:**

- Cross-stage deterministic rebuild test compares committed JSON to fresh builds end-to-end (`source_facts.json`, `career_stature.json`, `ratings.json`, `ratings_2026.json`, `teams_2026.json`); byte-identical.
- Proprietary-source audit scans `etl/sources/`, `etl/supplement/raw/`, `etl/merit/raw/`, `etl/src/wcdraft_etl/merit/`, and new research files; rejects Sofifa/Futbin/EA Sports FC/EA ratings/PES/eFootball/Konami and variants; does NOT reject legitimate public football facts, public award names, all-time lists, tournament names, FIFA tri-codes, `FIFA 100` as a public factual source, or existing not-affiliated/disclaimer text.
- Schema-drift / missing-required-field / ambiguous-identity failures are loud (no silent defaults).
- Divergence-review artifact emitted at `etl/output/merit/merit_divergence_review.json` when an approved non-IP review input is provided; never loaded into scoring; never an override; surfaces a flat queue keyed by `player_id` with the divergence type (overall, primary channel, or legend) recorded per row.
- Indicative default divergence thresholds — `abs(Δoverall) ≥ 8`, `abs(Δprimary_channel) ≥ 10`, factual Legend disagreement on a canonical-great checklist player — locked by MV2-8 alongside the other v2 constants; this work item ships the queue mechanism, not the integer pin.

_(Per-stage tests — parser determinism, link withholding, `career_stature.json` schema, `wc-perf-4.0.0` rating shape, `proj-career-3.0.0` projected shape — live in MV2-1 / MV2-2 / MV2-3 / MV2-4 / MV2-5 respectively.)_

**Key files:**

- `etl/tests/test_merit.py:1-260`, `test_determinism.py:1-40`.
- `etl/tests/test_rating.py:1-190, 331-470, 648-680`.
- `etl/src/wcdraft_etl/pipeline.py:28-66, 80-132`.
- `etl/src/wcdraft_etl/merit/build.py:1-80`, `stature.py:1-230`.
- `etl/src/wcdraft_etl/merit_divergence.py` — divergence review path.
- `etl/output/merit/merit_divergence_review.json` — review-only artifact.

**Dependencies:** MV2-3, MV2-4, MV2-5, MV2-6, MV2-7. (Per-stage tests already own their dependencies; this item only adds the cross-stage gate.)

**Size:** M.

---

### MV2-10 — Compact rebuild, runtime counts, generated artifacts, and data goldens

**Goal:** Regenerate compact runtime data after final ETL outputs and runtime schema changes are complete. Update manifest counts and goldens only AFTER the compact builder has produced the actual values (avoids the prior plan's ordering bug).

**Done when:**

- `packages/data/scripts/build-compact-data.mjs` uses `SCHEMA_VERSION = "runtime-data-1.1.0"` after MV2-7 adds required `legend`.
- Compact builder copies `legend` for historical and projected ratings; fails on missing/non-boolean.
- Builder infers `rating_version_historical = "wc-perf-4.0.0"`, `rating_version_projected = "proj-career-3.0.0"`.
- `ENGINE_VERSION` at `build-compact-data.mjs:49` is unchanged unless MV2-11 changes engine constants.
- `draft-pool.compact.json`, `scenario-2026.compact.json`, generated `manifest.json`, `packages/data/reports/compact-size.json` regenerated AFTER `ratings.json`, `ratings_2026.json`, `teams_2026.json`, and runtime schema changes.
- Runtime count assertions updated ONLY AFTER compact rebuild — `baseline_anchor_estimate`, new `career_stature_estimate`, optional `legend` count. The old fixed `EXPECTED_BASELINE_ANCHOR_ESTIMATE = 388` is replaced with the actual post-MV2 count from the builder run.
- `packages/data/test/compact-data.integrity.test.ts:47, 76-124` asserts: all runtime ratings have `legend: boolean`; schema version `runtime-data-1.1.0`; rating versions match manifest; all overalls in `[66, 99]`; no `overall == 100`; channels in `[20, 100]`; Team2026 squad card IDs resolve; manifest counts match bundle contents.
- `compact-data.golden.test.ts` re-locked only after reviewing artifact diffs.
- `compact-size.json` and size-budget expectations updated only if bundle sizes changed.
- `scenario-2026.compact.json` diffs reviewed for Team2026 aggregate movement caused by linked-player reconciliation.
- No runtime career-stature table introduced; only per-card `RuntimeRating.legend` and numeric components cross the runtime boundary.

**Key files:**

- `packages/data/scripts/build-compact-data.mjs:49, 306-322, 405-419, 607-612`.
- `packages/data/src/types.ts:52-60, 116-153`.
- `packages/data/test/compact-data.integrity.test.ts:47, 76-124`.
- `packages/data/test/compact-data.golden.test.ts`.
- `packages/data/reports/compact-size.json`.
- `packages/data/src/generated/manifest.json`, `draft-pool.compact.json`, `scenario-2026.compact.json`.

**Dependencies:** MV2-6, MV2-7, MV2-9.

**Size:** M.

---

### MV2-11a — Sim cascade validation (gates merit-v2 merge)

**Goal:** Run the existing sim gates against final MV2-10 compact bundles and confirm whether merit-v2 ships with engine constants byte-identical or requires a λ refit. This work item is the merge gate; refit work is MV2-11b.

**Done when:**

- Faithfulness suite (`packages/core/src/faithfulness.test.ts`) run against final compact bundles: passes or produces a documented failure with a channel-distribution diagnosis.
- Symmetric realism gate (`realism-modern-norms.golden.test.ts`) run: bands at `:69-75` remain the acceptance target. Pass → proceed; fail → record measured landings and route to MV2-11b.
- Heavy asymmetric realism gate (`realism.gate.test.ts` with `WCDRAFT_REALISM_HEAVY=1`) run in CI: same disposition.
- Persisted-run skew verified end-to-end: existing stale runs with old `rating_version` / runtime schema version trip mismatch handling cleanly; no silent re-sim; no DB migration.
- A measurement report at `docs/investigations/merit-v2-sim-cascade-YYYY-MM-DD.md` records: gate pass/fail per suite, observed band landings vs targets, channel-distribution diffs (top-strength quantiles before/after), and the merge decision (ships clean / requires MV2-11b).
- If all gates pass: `engine_version` unchanged; only rating/runtime schema anchors invalidate persisted runs; merit-v2 ships clean.
- If any gate fails: merge does NOT proceed on merit-v2 alone; the failure report is the input to MV2-11b.

**Key files:**

- `packages/core/src/faithfulness.test.ts`
- `packages/data/test/realism-modern-norms.golden.test.ts:69-75, 196-230`
- `packages/data/test/realism/realism.gate.test.ts`
- `packages/data/test/compact-data.integrity.test.ts:103-124`
- `apps/web/lib/game/__tests__/run-token.test.ts:242-292`
- `packages/core/src/engine/calibration.ts:76-260, 462-470` (read-only at this stage)

**Dependencies:** MV2-10.

**Size:** M.

---

### MV2-11b — λ refit, engine-version bump, and golden re-lock (expected follow-on)

**Goal:** Refit λ at the existing locus, bump `engine_version` if constants/math change, and re-lock the downstream golden suite. **Expected, not contingent**: broad channel movement across most cards makes a λ refit the likely path because the narrow symmetric-realism bands at `realism-modern-norms.golden.test.ts:69-75` were tuned to the current distribution, so MV2-11b is planned and budgeted alongside MV2-11a. The merit-v2 merge gate stays honest — merge blocked until realism passes via MV2-11a-clean OR MV2-11a + this refit. Ships as a separate PR so merit-v2's rating/schema scope stays bounded.

**Done when:**

- Refit performed at `calibration.ts:76-260` using existing fit tooling (`packages/data/scripts/fit-calibration.mjs`); faithfulness invariants preserved; no realism band weakened inside the rating PR scope.
- `packages/core/SIM_CALIBRATION.md` updated with the refit rationale and measured landings.
- Symmetric and asymmetric golden bands updated only after reviewing measured landings.
- `engine_version` bumped at `build-compact-data.mjs:49` ONLY if λ / chance / dispersion constants or engine math changed. If bumped: regenerate compact manifest/artifacts; update engine-version assertions in `compact-data.integrity.test.ts`; re-lock stamp-carrying run/golden artifacts; update `run-token.test.ts:242-292` expected anchors.
- Core/data goldens regenerated only after diff review: `sim.golden.test.ts`, `simulate-match.golden.test.ts`, `group-stage.golden.test.ts`, `top-scorer.golden.test.ts`, `e2e-real-run.golden.test.ts`, compact-data goldens.
- Diff review explicitly checks: plausible Team2026 aggregate movement, user XI strength movement, no impossible channel bounds, no attacker-only Legend/elite bias, top-scorer attribution still follows channel semantics.

**Key files:** same surface as MV2-11a plus `packages/data/scripts/fit-calibration.mjs`, `packages/core/src/sim.golden.test.ts`, `packages/data/test/e2e-real-run.golden.test.ts`, `packages/core/SIM_CALIBRATION.md`, `packages/data/scripts/build-compact-data.mjs:49, 607-612`.

**Dependencies:** MV2-11a (expected follow-on; required whenever any realism gate reports broken bands. Merit-v2 merge blocked until realism passes via MV2-11a-clean OR MV2-11a + MV2-11b-refit).

**Size:** L; XL if engine math (not just constants) changes.

---

## Open Questions

The Approach resolves five of the six original Open Questions. One remains for Paulo (Legend threshold content). The others are recorded with their recommended resolutions.

1. **Stature-dominant blend mechanic.** RESOLVED in Approach as **stature target + bounded signed tournament modulation**, not the prior positive-gap-only capped lift. Directly fixes the failure mode: a recognized great's weak tournament remains elite while apex tournaments can still rise above the stature target. _Paulo approval not required beyond accepting this plan._
2. **Top-of-squad deep-research backstop.** RESOLVED: **IN SCOPE** as MV2-2 (Paulo approved 2026-06-08). Bounded mechanically (top ~5 linked-2026 + curated historical gap list), citation-backed facts only, no LLM intake, no rating numbers. Not optional; not subject to schedule de-scope. _Paulo approval not required beyond accepting this plan._
3. **Unified display curve.** RESOLVED as **one curve over combined historical + projected internal scores**. Direct fix for Messi-2026=79 / Souček-2026=99 vs Pelé-1966-att=66 cross-scale incoherence. _Paulo approval not required._
4. **Legend badge threshold.** RESOLVED (Paulo approved 2026-06-08, recognizability-first). Route 1 tightened: `global_annual_win_count >= 2`, OR `(global_annual_win_count >= 1 AND >= 1 corroborating major fact — approved all-time selection / position-balanced world-XI selection / regional POY top-3 / 100-cap-class record)`. Routes 2-4 unchanged. Drops the pure single-distant-award case so the badge reads as a "known legend"; Routes 2-4 still capture pre-BdO, non-attacker, and non-European greats. Tunable via the `LEGEND_INDEX_FLOOR` constant + MV2-8 named anchors without a re-plan. The single-award-alone reason code (`global_annual_winner`) is dropped from the closed-set strings. _Paulo approval not required beyond accepting this plan._
5. **Engine cascade scope.** RESOLVED as a **two-PR split**: MV2-11a is validate-only and gates the merit-v2 merge (faithfulness + symmetric + heavy asymmetric + skew + measurement report). MV2-11b runs the λ refit + golden re-lock as a separate PR and is **EXPECTED, not contingent** — broad channel movement across most cards makes a refit the likely path because the narrow symmetric-realism bands at `realism-modern-norms.golden.test.ts:69-75` were tuned to the current distribution. The merge gate stays honest: blocked until realism passes via MV2-11a-clean OR MV2-11a + MV2-11b-refit. MV2-11b is planned and budgeted, not framed as a rare contingency. This keeps merit-v2's rating/schema scope bounded and avoids open-ended sim risk in the same PR. `engine_version` bumps only if MV2-11b runs and changes constants/math. _Paulo reviews the MV2-11a measurement report before merge; otherwise no Paulo approval required._
6. **Versioning and rollout.** RESOLVED: `wc-perf-3.0.0 → 4.0.0`, `proj-career-2.0.0 → 3.0.0`, `career-stature-1.0.0 → 2.0.0`, new `merit-source-set-2.0.0`, `runtime-data-1.0.0 → runtime-data-1.1.0`, `engine_version` only if λ/math change. 2026 reconciliation is **in scope** for Merit-v2, not a follow-up. _Paulo approval not required unless de-scoping 2026._

## References

### Code seams (HEAD = `21ca5e9`)

- Lift math: `etl/src/wcdraft_etl/rating.py:402-415` (`_career_lift`), `:536-552` (insertion), `:129-148` (constants).
- Historical internal score & curve fit: `rating.py:655` (`build_internal_view`), `:674-682` (`build_ratings`).
- Historical curve loader: `rating.py:250-308` (`_fit_display_curve`, `_display_value`, `_display_score`).
- Career-stature loader: `rating.py:318-335` (`_load_career_stature`), called at `:725`.
- 2026 composite: `etl/src/wcdraft_etl/rating_2026.py:170-286` (especially `:193-263`); curve at `:257`; OVR at `:262`.
- 2026 identity: `etl/src/wcdraft_etl/ingest_2026.py:80-88` (sets `link_status`), `:146` (emits on cards); `identity_2026.py:137-210` (linker, keyed by `(nation_id, birth_date)` + normalized name).
- Merit data layer (E-4.1 merged): `etl/src/wcdraft_etl/merit/` — `fetch.py`, parsers, `link.py`, `stature.py`.
- IP-audit regex: `etl/tests/test_rating.py:648-680`.

### Sim cascade seams

- λ math: `packages/core/src/engine/calibration.ts:76-260` (constants), `:462-470` (`lambdaForFour`); `match.ts:390-405` (call site).
- Symmetric realism: `packages/data/test/realism-modern-norms.golden.test.ts:69-75` (bands), `:196-230` (assertions).
- Asymmetric realism: `packages/data/test/realism/realism.gate.test.ts` (heavy-gated); golden `asym-realism-golden.json:23-29` (centers), `:128-145` (bands).
- Faithfulness: `packages/core/src/faithfulness.test.ts` (11 cases).
- Skew test: `apps/web/lib/game/__tests__/run-token.test.ts:242-292`.
- Engine_version stamp chain: `build-compact-data.mjs:49,607-612` → `manifest.json:80-82` → `data.ts:122-130` (`composeVersions`) → `run-record.ts:305-323` → `draft.ts:146,767,824-829` → `tournament.ts:372-378`.

### Prior planning artifacts

- `docs/plans/merit-rating-model-2026-06-07.md` — prior E-4 plan (lift-over-tournament shape, superseded by merit-v2).
- `docs/reviews/merit-rating-model-plan-critique-2026-06-07.md` — editorial critique of prior plan.
- `etl/RATING_METHODOLOGY.md`, `etl/RATING_METHODOLOGY_2026.md` — current methodology docs to update.
- `etl/output/merit/CAREER_STATURE.md`, `MERIT_SOURCES.md` — current source/coverage state.
- `docs/investigations/engine-v2-asymmetric-realism-2026-06-07.md` — E-3a/E-3b cascade context.

### External signal sources (Tier A, to ingest)

See Background § "External recognition sources" above; full URL list there. Pattern follows the existing RSSSF supplement architecture: pin SHA256 → commit raw bytes → deterministic parse → conservative link with review withholding → factual scoring only.
