# Merit-Anchored Rating Model: Plan

> Status: **DRAFT — awaiting Paulo review**. Plan only; no code yet. Implementation will follow as engine-v2 sub-unit **E-4**.

## Goal

Replace the per-tournament-only measured rating with a **career-stature merit base** (computed per `player_id`, consistent across that player's cards) that is lightly modulated by tournament context, so historical legends carry their stature into off-tournament cards (e.g. Pelé-1966 attack channel rises off the current 54 floor) without breaking engine-v2 realism gates or contradicting the no-proprietary-ratings firewall. Career signals come exclusively from **public factual sources** (recognition counts, international record facts, WC honors, club honors) — never proprietary rating IP.

## Background

### The exact failure mode (corrects user's framing)

Per-card factual check on the current `etl/output/ratings.json` artifact:

| Card                     | `overall` | `attack` | `overall_basis`      |
| ------------------------ | --------: | -------: | -------------------- |
| `P-38906:WC-1958` (Pelé) |        97 |       97 | measured_performance |
| `P-38906:WC-1962`        |        86 |       70 | measured_performance |
| `P-38906:WC-1966`        |    **78** |   **54** | measured_performance |
| `P-38906:WC-1970`        |        89 |       82 | measured_performance |

**The 54 is the channel, not the OVR.** Displayed `overall` is already lifted by the global display curve to 78. The user-perceived "Pelé-1966 = 54" is the `attack` channel reaching the engine — which is what drives λ, scorer weighting, and shootout edge. So the problem is **decoupled channels**, not OVR.

### Why channels go raw

`etl/src/wcdraft_etl/rating.py:331-335` — `_channel()`:

```python
val = score_0_100 * spread + FLOOR_CHANNEL * (1.0 - spread)  # FLOOR_CHANNEL = 20
```

Channels are a convex blend between the **raw internal `score_0_100`** and a hard floor of **20**. They do **not** consume the display-calibrated `overall`. Methodology is explicit on this: "Channels operate on the composite, not the curve's display output" (`etl/RATING_METHODOLOGY.md:231-233`). So the display floor (66) and curve fit do nothing for channels.

For Pelé-1966 (FW, attack spread = 1.00 at `rating.py:127`):

- `g_pct = 0.806`, `a_pct = 0.419`, `base = 0.20 + 0.48 * (0.75*0.806 + 0.25*0.419) = 0.5405`
- `award_score = 0` (no '66 award), `finish_pts = 0` (no semifinal)
- `score_0_100 = 54.05` → `attack = 54`

A career-stature term added to `score_0_100` would lift channels and OVR simultaneously.

### Surgical locus for a career base

`_build_internal_rows()` at `rating.py:443-450`:

```python
anchor = AWARD_WEIGHT[pos] * award_score + FINISH_WEIGHT[pos] * (finish_pts or 0.0)
score = _clamp01(base + anchor)
score_0_100 = 100.0 * score
```

This is the precise insertion point. The plan adds a **career-stature term** to the same `base + anchor + career_term` composite. The data seam is also clear: `build_ratings()` (`rating.py:513-518`) and `build_all()` (`rating.py:568-578`) currently load only `players, player_tournaments, tournaments, manager_tournaments`. A new `career_stature` input table — keyed by `player_id` — would be loaded here.

### The 2026 path already proves the pattern

`rating_2026.py` already uses career signals (caps, intl*goals, age/DOB, club_nation, captaincy, league_strength). It imports `_channel`, `BASE_WEIGHTS`, `CHANNEL_SPREAD`, `_clamp01`, `_fit_display_curve`, `_display_score` from `rating.py` (`rating_2026.py:42-56`). The historical model can mirror this: career signals already power the 2026 anchor; we extend the historical model with a \_career stature* anchor independently.

### What's already ingested vs missing

**Captured historically** (`etl/output/`):

- WC tournament-card factual data: `player_tournaments.json` (13,843 rows), `goals.json` (3,637, full 1930+), `awards.json` (200: Golden Ball/Boot/Glove/Silver/Bronze/BYP — already per-tournament, trivially career-aggregable), `manager_tournaments.json` (637, with `final_placement` only for semifinalists), `appearances.json` (27,432, native 1970+, RSSSF overlay for pre-1970 via `appearances_source = "rsssf_starting_xi"`).
- Per-player identity in `players.json` (10,401 rows): DOB, names, gender, `primary_position`, `eligible_positions`.

**Captured in 2026 only** (`etl/output/*_2026.json`):

- Career snapshot fields: `caps`, `intl_goals`, `captain`, `birth_date`, `club`, `club_nation_code`.

**NOT captured (the merit-composite gap)**:

- Ballon d'Or wins / top-N finishes (1956+, RSSSF + Wikipedia structured tables, public)
- FIFA World Player of the Year / The Best (1991–2009, 2016+; FIFA Ballon d'Or merger 2010–2015)
- IFFHS World's Best Player (annual: 1988–1990, 2020+; era-thin)
- UEFA Player of the Year (2011+); CONMEBOL/El Mundo/El País (1971+)
- All-time XI / FIFA 100 / IFFHS Century — editorial selections, fact = inclusion
- Career international caps + goals career-aggregated (RSSSF country pages + Wikipedia infoboxes)
- Captaincy career spans (globally source-thin, especially pre-modern)
- Club honors

**Era-thin reality**: Pre-1956 (pre-Ballon d'Or), legitimate public substitutes are: cumulative WC honors (already in `awards.json`), cumulative WC goals (in `goals.json`), team finishes (in `manager_tournaments.json`), IFFHS retrospective century elections, RSSSF country caps/goals records, FIFA 100 (living-players-only-2004 — structurally excludes deceased pre-modern players).

### Existing source-ingest architecture (the template to reuse)

- **Pinned, deterministic, no-LLM, no-fabrication invariants** — encoded in `etl/src/wcdraft_etl/source.py` (Fjelstul v1.2.0 @ commit `f41e9437…`), `source_2026.py` (Wikipedia 2026 snapshots committed under `etl/sources/wikipedia_2026/`).
- **RSSSF supplement pattern** (`etl/src/wcdraft_etl/supplement/`):
  - `fetch.py` — networked maintenance script, SHA256-pinned, `--verify` recomputes hash to detect drift. NOT on deterministic build path.
  - `rsssf.py` — pure deterministic parser over committed bytes.
  - `link.py` — withholds ambiguous matches into `link_review.json`; refuses to overwrite native Fjelstul values.
  - Report counts in `etl/output/supplement/SUPPLEMENT.md`: 1,578 sourced cards, 222 review items.

Any new public-source ingestion (e.g. Ballon d'Or) must follow this pattern: commit raw bytes, SHA-pin the fetch, parse deterministically, withhold ambiguous links into a `_review.json`.

### IP firewall — what "no FIFA" actually means

The firewall is **no proprietary rating IP** (Sofifa/Futbin/EA/PES/eFootball/Konami). Existing legitimate `FIFA World Cup` tournament naming, FIFA tri-codes (`wiki2026.py:9-200`), and "not affiliated with FIFA" disclaimers stay. The audit regex at `etl/tests/test_rating.py:648-680` extends to new raw directories added by E-4.

### Engine-v2 state & the cascade

**Current `main` checkout** (verified):

| Constant                                 |                          Value | File                                                 |
| ---------------------------------------- | -----------------------------: | ---------------------------------------------------- |
| `engine_version`                         |            `engine-2026.06.04` | `packages/data/scripts/build-compact-data.mjs:48-51` |
| `LAMBDA.BASE` / `SPREAD` / `MIN` / `MAX` | `1.3` / `1.7` / `0.25` / `3.6` | `packages/core/src/engine/calibration.ts:39-47`      |
| `CHANCES.REGULATION` / ET                |                     `14` / `5` | `calibration.ts:59-66`                               |

**Documented engine-v2 E-3a state** (branch `engine-v2-e3a-lambda-calibration`, commit `5c54b8a`, base `2075e3d`, per `docs/investigations/engine-v2-asymmetric-realism-2026-06-07.md:32-35`) — fitted but not yet on `main`:

- Four-channel λ: `defResist = clamp_int(0.65·def + 0.35·gk)`; `λ_for = clamp(BASE + SPREAD·(attack − defResist)/100, MIN, MAX) · control_for`
- `BASE=0.85`, `SPREAD=4.0`, `MIN=0.75`, `MAX=3.4`, `GAMMA_MID=0.45`, `CONTROL_BAND=[0.85,1.15]`, `CHANCES.REGULATION=50`
- `LAMBDA_DISP` (match-level λ dispersion) is WIP in dirty worktree, **not in clean E-3a measurements**

**Channel→sim path (current code):**

1. `aggregateUserXiStrength()` (`packages/core/src/engine/team-strength.ts:36-66`) folds per-card channels into `TeamStrength` (4 channels mean-of-11 × synergy × manager).
2. `lambdaFor(attackFor, defenseAgainst)` (`packages/core/src/engine/match.ts:67-73`) — current λ reads **only** attack and defense; E-3a's `defResist` adds gk; E-3a's `control_for` adds midfield.
3. Per-player event weights `attackWeight = attack + 1`, `creativeWeight = midfield + 1` (`tournament.ts:75-93`) drive scorer/assist attribution.
4. Shootout edge: `shootoutConvertProb()` at `match.ts:635-643` uses `attack − defense`.

**Hard realism gate that any channel re-base must clear**: `packages/data/test/realism-modern-norms.golden.test.ts` — 3,006-match symmetric coherent-XI sweep, asserts:

- Mean regulation goals/match ∈ [2.20, 2.90]
- Group draw rate ∈ [20%, 30%]
- Margin ≥ 4 ∈ [1.5%, 6.0%]
- KO → ET ∈ [22%, 36%]
- KO → shootout ∈ [10%, 27%]

**Cascade if every card's channels shift**:

1. ETL: `etl/output/ratings.json`, `ratings_2026.json` regenerate.
2. `packages/data/scripts/build-compact-data.mjs` rebuilds compact bundles.
3. Compact integrity gate (`packages/data/test/compact-data.integrity.test.ts:76-91, 103-107`) — channel band [20,100] and engine_version pin.
4. Symmetric realism gate must re-pass; if not, λ/SPREAD/dispersion re-fit at the same locus E-3a fit them.
5. Golden re-locks: `sim.golden.test.ts` + `test/fixtures/sim-golden.json`, `simulate-match.golden.test.ts`, `group-stage.golden.test.ts`, `top-scorer.golden.test.ts`, `e2e-real-run.golden.test.ts` + fixture, `compact-data.golden.test.ts`.
6. Faithfulness gate: documented in the E-3a investigation as `packages/core/src/faithfulness.test.ts` (monotonicity, elite ceiling, dominance-not-certainty, legibility, no-inversion) — **file not found in current `main` checkout**; status to resolve in E-4 sub-step.
7. **Engine_version bump at season merge**: stamp chain is `build-compact-data.mjs:48-51` → `packages/data/src/generated/manifest.json:80-82` → `apps/web/lib/game/data.ts:121-129` → `apps/web/lib/game/run-record.ts:305-313` → `packages/core/src/draft.ts:469-471` → `packages/core/src/engine/tournament.ts:375-377` → `RunResult`.

### Prior plans & versioning conventions

- `etl/RATING_METHODOLOGY.md:1-20, 62-74` — Phase 2 follow-ons explicitly include Ballon d'Or, all-time list ranks. The current plan **is** that follow-on.
- `etl/RATING_METHODOLOGY_2026.md:17-25` — same Phase 2 plan for 2026 projected.
- Version conventions: historical = `wc-perf-X.Y.Z` (current `2.0.0`); projected = `proj-career-X.Y.Z` (current `2.0.0`). A merit re-base bumps both minor or major.
- Runtime contract from `prompt-exports/2026-06-07-plan-e3-red-calibration-engine-v2.md:3439-3451`: per-card `Rating` schema is the runtime entity; career aggregates live offline in ETL, never as runtime entities.

### Independent merit cross-check (validation, not source)

The user explicitly notes a non-IP merit report produced by GPT/ChatGPT (in a separate session) is available for **divergence-flagging only** — never as a source. This compares our merit output against an independent assembly of the same public facts. Divergences ≥ N OVR points become review items, not auto-overrides.

## Approach

### Recommendation

Implement E-4 as a **career-stature floor/lift over the existing tournament composite**:

- Build an ETL-only `career_stature.json` keyed by `player_id`.
- Add the career term in `rating.py` before `score_0_100` is materialized, so both `overall` and the four channels move coherently.
- Keep runtime `Rating` schema unchanged; career aggregates live offline and appear in runtime only as numeric summary entries in the existing open-ended `components[]`.
- Do **not** create a runtime `CareerStature`, `PlayerMerit`, or manager-rating entity.
- Do **not** add a channel-only career multiplier (rejected — see below).

E-4 is a **rating/data-model change first**, not a sim retune. But because channels move, the plan explicitly reserves a downstream sim re-lock phase rather than pretending the change is display-only.

### Rejected alternative: channel-only lift

Do not implement `channels = current_channels × career_multiplier`. It preserves the same semantic bug — channels would remain a hidden strength layer disagreeing with displayed OVR. E-4 should intentionally move sim behavior and then validate/re-lock the cascade.

### Source tiers

| Tier                                      | Status                                                                      | Examples                                                                                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tier 0 — already ingested**             | Scoreable immediately                                                       | WC awards (`awards.json`, 200 rows), WC goals (`goals.json`, 3,637), team finishes (`manager_tournaments.json`), participation (`player_tournaments.json`) |
| **Tier 1 — public recognition / records** | Scoreable after pinned-byte fetch + deterministic parse + conservative link | RSSSF Ballon d'Or master, RSSSF Sud-American POY, RSSSF IFFHS century elections, RSSSF 100+ caps, Wikipedia snapshots (FIFA 100, public-award pages)       |
| **Tier 2 — club honors**                  | **Deferred to E-4b**                                                        | Weight `0` in E-4a; reserved family, report-only                                                                                                           |

Tier-2 deferral is intentional pushback on scope: global player-level club-honor extraction has high identity and source-shape risk and would force half-ingested infobox paths that violate no-fabrication discipline. A later E-4b can revisit once an approved deterministic source plan exists.

### Career composite

Era-bucketed family weights:

| Era bucket  | `wc_legacy` | `annual_recognition` | `international_record` | `retrospective_selection` | `club_honors` |
| ----------- | ----------: | -------------------: | ---------------------: | ------------------------: | ------------: |
| `pre_1956`  |        0.45 |                 0.00 |                   0.20 |                      0.35 |          0.00 |
| `1956_1990` |        0.30 |                 0.45 |                   0.10 |                      0.15 |          0.00 |
| `1991_plus` |        0.25 |                 0.45 |                   0.20 |                      0.10 |          0.00 |

Family scoring (each family folds its inputs via the saturating-product form already used in `rating.py:310-322` — `score = 1 − Π(1 − w_i · s_i)` — so positive evidence accumulates toward 1.0 without ever exceeding it):

```text
wc_legacy             = saturate(career WC award score,
                                 career WC team-finish score,
                                 career WC goals/appearance trust score)
annual_recognition    = saturate(Ballon d'Or / equivalent placements,
                                 global player-of-year placements,
                                 regional player-of-year placements)
international_record  = threshold/list-inclusion score from public caps/goals record lists
retrospective_selection = saturate(FIFA-100 inclusion,
                                   IFFHS century / all-time selections,
                                   other approved public list-inclusion facts)
```

Rules:

- `career_peak_year` is derived deterministically: median tournament year for multi-card players; single tournament year for one-card players. Do not infer unobserved club-career peak years.
- Source families structurally unavailable for a player's era are excluded from the denominator by era bucket (e.g. `annual_recognition` weight 0 pre-1956).
- Positive linked facts add score; absence from a complete top-N/list source is a factual zero for that source family; ambiguous source rows are withheld to review and never assigned; missing coverage is represented in `coverage`, not silently treated as evidence against the player.

### Rating integration formula

Keep the current tournament composite, but apply a career-aware lift toward a career target. Planning-level:

```text
raw_tournament_score = clamp01(tournament_base + tournament_anchor)

if coverage < MIN_CAREER_COVERAGE_FOR_LIFT or career_stature_score is None:
    career_lift = 0
else:
    career_elite  = career_stature_score ^ CAREER_ELITE_EXPONENT
    career_target = REPLACEMENT_BASE + CAREER_TARGET_SPAN[pos] * career_elite
    career_lift   = min(
        CAREER_MAX_LIFT[pos],
        CAREER_BLEND_HISTORICAL * max(0, career_target - raw_tournament_score)
    )

score        = clamp01(raw_tournament_score + career_lift)
score_0_100  = 100 * score
```

`REPLACEMENT_BASE = 0.20` reuses the existing internal floor at `etl/src/wcdraft_etl/rating.py:110` — the same `score = 0.20` baseline that anchors the current `_build_internal_rows()` blend. This keeps a single floor concept across both branches.

Indicative starting constants (E-4.5 fits these against the named-anchor set; **not** normative yet):

```text
CAREER_ELITE_EXPONENT        = 1.35
CAREER_TARGET_SPAN           = { FW: 0.72, MF: 0.72, DF: 0.70, GK: 0.70 }
CAREER_BLEND_HISTORICAL      = 0.65
CAREER_MAX_LIFT              = { FW: 0.24, MF: 0.22, DF: 0.22, GK: 0.20 }
MIN_CAREER_COVERAGE_FOR_LIFT = 0.25

CAREER_BLEND_PROJECTED       = 0.35
CAREER_MAX_LIFT_PROJECTED    = 0.10
```

Rationale: career stature is a **floor/lift, not an override**. A great tournament can still exceed the career target. A poor/off-tournament card for a true legend is lifted materially but not pinned to 99. Mid-tier or weakly sourced players receive little or no lift. No per-player override table.

### `overall_basis` semantics (split estimate)

| Basis                      | Meaning                                                                                                                      | Display cap                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `measured_performance`     | Card has at least one positively weighted tournament signal; career lift may apply.                                          | Normal display curve                           |
| `career_stature_estimate`  | Card lacks tournament individual signal but has usable career stature (`coverage ≥ 0.50` and `career_stature_score ≥ 0.55`). | Normal display curve, **not** old estimate cap |
| `baseline_anchor_estimate` | Card lacks tournament individual signal **and** lacks usable career stature.                                                 | Existing `[66, 73]` estimate cap               |

ETL/data-test semantic only — the core `RatingSchema` does not validate `overall_basis`; `components[]` remains open.

### Projected 2026 handling

`rating_2026.py` may consume `career_stature.json` for rows whose 2026 card has `link_status: "linked"` (the field already emitted by `etl/src/wcdraft_etl/ingest_2026.py` at the seam around `:117-137`, set by the linker in `identity_2026.py`). Minted 2026 players (`link_status != "linked"`) remain on the current projected formula. This breaks the dependency cycle where `career_stature` would otherwise depend on `players_2026.json`. Implementation may key by `player_id` directly when `link_status == "linked"`; specifying the lookup helper is an E-4.4 detail.

### Versioning

```text
Historical:    wc-perf-2.0.0      → wc-perf-3.0.0
Projected:     proj-career-2.0.0  → proj-career-3.0.0  (only if linked 2026 rows consume career_stature)
Career table:  career-stature-1.0.0
Engine:        engine-2026.06.04  unchanged (bumps only if E-3a/E-3b lands atomically)
```

### Validation / cross-check

The independent non-IP merit report (e.g. produced by GPT) is **review input only**: stored under `docs/` outside the build path, never loaded by ETL scoring, never used as a source or override. Default divergence-review threshold: `abs(Δoverall) ≥ 8` OR `abs(Δprimary_channel) ≥ 10` writes a queue entry; humans triage.

### Managers

Managers remain rating-unavailable/null in E-4. `team-strength.ts` already treats missing manager rating as modifier 1.0. Manager-stature would require a separate methodology (coaching merit signals differ from player career signals) and is out of scope here.

---

## Work Items

### E-4.1 — Deterministic career-source intake & review artifacts (includes source registry)

**Design question:** data sourcing / feasibility.

**Goal:** Add an E-4 source-ingest package mirroring the RSSSF supplement architecture: fetch raw public bytes outside the build path, parse committed bytes deterministically, link to canonical `player_id`s conservatively, emit review artifacts for ambiguity. The committed snapshots + `MERIT_SOURCES.md` together serve as the source registry — no separate feasibility doc.

**Done when:**

- New package `etl/src/wcdraft_etl/merit/` with split responsibilities:
  - `__init__.py` — constants, source ids, version, source registry (proprietary-IP block list vs allowed public-fact list, club-honors deferred `weight_0`)
  - `fetch.py` — networked maintenance + `--verify`
  - `parse_*.py` — pure parsers per source shape
  - `link.py` — source-row → `player_id` + review queue
  - `stature.py` — career-stature builder, no network
- Raw snapshots committed under `etl/merit/raw/` + `etl/merit/fetch_manifest.json`.
- `fetch.py --verify` recomputes SHA256 against committed files and fails on drift.
- Linker uses normalized names, nation context, career-year proximity, DOB where available; only unique high-confidence links assigned; collisions/transliteration/missing candidates/multi-player matches go to review; no synthetic player facts.
- Deterministic sorted outputs: `etl/output/merit/source_facts.json`, `link_review.json`, `MERIT_SOURCES.md`.
- Proprietary-source audit scans `etl/merit/raw/` in addition to current source directories.
- No rating outputs change.

**Key files:**

- `etl/src/wcdraft_etl/source.py:1-57` (pinned-source pattern)
- `etl/src/wcdraft_etl/supplement/__init__.py:1-58`
- `etl/src/wcdraft_etl/supplement/fetch.py:1-75`
- `etl/src/wcdraft_etl/supplement/rsssf.py:1-77` (pure parser pattern)
- `etl/src/wcdraft_etl/supplement/link.py:1-65, 66-214`
- `etl/src/wcdraft_etl/pipeline.py:42-66, 80-132`
- `etl/output/supplement/SUPPLEMENT.md:1-45`
- `etl/tests/test_supplement.py` (mirror with new `test_merit.py`)
- `etl/tests/test_rating.py:648-680` (IP audit extension)

**Dependencies:** none.

**Size:** L.

---

### E-4.2 — ETL-only `career_stature.json` merit composite

**Design question:** merit composite.

**Goal:** Build the deterministic per-player career-stature table that `rating.py` will consume. This table is the only place where career aggregates live.

**Done when:**

- `merit/stature.py` emits `etl/output/career_stature.json`, `etl/output/merit/CAREER_STATURE.md`, `etl/output/merit/career_stature_review.json`.
- Rows keyed uniquely by `player_id`; every row carries `player_id`, `stature_version`, `career_stature_score`, `coverage`, `era_bucket`, `career_peak_year`, `family_scores`, `family_weights`, `review_flags`, `source_refs`.
- `career_stature_score` and `coverage` finite in `[0, 1]`.
- Family weights follow the era table above; `club_honors` remains `null` and weight `0`.
- `wc_legacy` uses already-ingested WC facts + approved linked source facts.
- Withheld source rows do not affect any player score.
- Duplicate source facts deduped by stable `source_fact_id` or fail loudly if conflicting.
- `pipeline.py` emits merit artifacts after canonical historical tables; `manifest.json` gains a `merit` block.
- Fresh rebuild is byte-identical.

**Key files:**

- `etl/src/wcdraft_etl/pipeline.py:28-66, 80-132`
- `etl/output/COVERAGE.md:1-67`
- `etl/output/supplement/SUPPLEMENT.md:1-45`
- `etl/src/wcdraft_etl/rating.py:281-311` (`_award_score()` to reuse for WC award career aggregation)
- `etl/src/wcdraft_etl/rating.py:88-120` (existing award/finish constants to reuse)
- `etl/tests/test_rating.py:25-74` (committed-output fixture pattern)

**Dependencies:** E-4.1.

**Size:** L.

---

### E-4.3 — Historical rating integration & projected linked-player seam

**Design question:** merit composite.

**Goal:** Consume `career_stature.json` in the rating stages and apply the career-aware lift to the same internal score that feeds display OVR and sim channels.

**Done when:**

- `rating.py` changes limited to: loading `career_stature.json`; passing `career_stature_by_player` into `build_internal_view()`, `_build_internal_rows()`, `build_ratings()`; computing target/lift after `raw_tournament_score`; appending career-stature summary components; bumping `RATING_VERSION` to `wc-perf-3.0.0`.
- Signature evolution:
  ```text
  Before:  build_internal_view(players, cards, tournaments, manager_tournaments)
  After:   build_internal_view(players, cards, tournaments, manager_tournaments, career_stature)
  ```
- `_build_internal_rows()` records both `raw_tournament_score_0_100` and post-career `score_0_100`.
- `components[]` gains `career_stature_score`, `career_stature_coverage`, `career_stature_target`, `career_stature_lift`.
- Missing/low-coverage career row → `career_stature_score = null`, `career_stature_lift = 0`, current behavior preserved.
- `overall_basis` semantics updated per the split above.
- `_display_score()` cap branch (`rating.py:239-267`) is keyed on `overall_basis`: `baseline_anchor_estimate` keeps the existing `[66, 73]` clamp; `career_stature_estimate` exits via the uncapped curve path; `measured_performance` unchanged.
- `rating_2026.py` optionally consumes the same lookup for linked canonical `player_id`s; bumps to `proj-career-3.0.0` only if any projected row changes.
- No runtime TypeScript `Rating` or Zod schema change required.

**Key files:**

- `etl/src/wcdraft_etl/rating.py:331-335` (`_channel()` continues to consume final `score_0_100`)
- `etl/src/wcdraft_etl/rating.py:443-450` (additive insertion point after `base + anchor`)
- `etl/src/wcdraft_etl/rating.py:513-518, 568-578`
- `etl/src/wcdraft_etl/rating_2026.py:42-56, 170-285`
- `etl/src/wcdraft_etl/ingest_2026.py:117-137, 142-166`
- `packages/core/src/types/rating.ts:1-31` (sim consumes channels only)
- `packages/core/src/schemas/rating.ts:21-39` (open `components[]`)

**Dependencies:** E-4.2.

**Size:** L.

---

### E-4.4 — Scale calibration & methodology update

**Design question:** scale calibration.

**Goal:** Re-fit the existing low-DOF display curve on the new internal score distribution, keep display bands stable, lock the new semantic scale with tests and methodology docs.

**Done when:**

- Historical `overall` stays in `[66, 99]`; projected `overall` stays in `[66, 99]` if 2026 changes; no `overall == 100`.
- Display curve remains global low-DOF: same curve kind; no per-player or per-era override tables.
- `etl/RATING_METHODOLOGY.md` documents career-lift constants: `CAREER_ELITE_EXPONENT`, `CAREER_TARGET_SPAN`, `CAREER_BLEND_HISTORICAL`, `CAREER_MAX_LIFT`, `MIN_CAREER_COVERAGE_FOR_LIFT`.
- `etl/RATING_METHODOLOGY_2026.md` documents linked-player-only integration and lower projected lift if applicable.
- Named-anchor tests updated in `etl/tests/test_rating.py`:
  - Pelé 1966 attack channel no longer sits at the old raw 54 channel failure.
  - Pelé's career-stature component is identical across all his historical cards.
  - Pelé 1958 / Maradona 1986 / Zidane 2006 / Messi 2022 remain elite.
  - Modern journeyman controls bounded.
  - Defender/GK still not rated on goals.
- `etl/output/ratings.json` is regenerated and committed; the ETL-side basis-count fields in the manifest emit both `baseline_anchor_estimate` and the new `career_stature_estimate` counts. (The runtime-side `RUNTIME_DATA_MANIFEST.counts.baseline_anchor_estimate = 388` pin in `compact-data.integrity.test.ts:47` is updated in E-4.7 after the compact rebuild — see ordering note there.)

**Key files:**

- `etl/src/wcdraft_etl/rating.py:129-196, 198-279` (display curve)
- `etl/RATING_METHODOLOGY.md:1-74, 173-235`
- `etl/RATING_METHODOLOGY_2026.md:17-25`
- `etl/tests/test_rating.py:86-180, 331-470`

**Dependencies:** E-4.3.

**Size:** M.

---

### E-4.5 — Channel derivation & runtime boundary lock

**Design question:** channel derivation.

**Goal:** Ensure the four sim channels are derived from the same post-career composite as display OVR, while preserving the runtime schema and explicit sim-consumption contract.

**Done when:**

- `rating.py` channel materialization stays:
  ```text
  channel = _channel(post_career_score_0_100, CHANNEL_SPREAD[pos][channel])
  ```
- No `career_channel_multiplier`, no channel-only boost table, no per-player override.
- `packages/core/src/types/rating.ts` and `schemas/rating.ts` add no career-stature entity or required fields.
- `build-compact-data.mjs` continues to pass through rating components without interpreting career-stature source details.
- Compact integrity tests assert: channel bounds `[20, 100]`; every runtime player card has exactly one rating; rating versions match manifest anchors.
- Manager behavior unchanged: no `manager_ratings.json`; no manager-stature score; missing manager rating stays neutral in `aggregateUserXiStrength()`.

**Key files:**

- `etl/src/wcdraft_etl/rating.py:331-335, 535-548`
- `packages/core/src/types/rating.ts:1-31`
- `packages/core/src/schemas/rating.ts:6-39`
- `packages/data/scripts/build-compact-data.mjs:48-51, 250-340`
- `packages/core/src/engine/team-strength.ts:24-35, 36-66`
- `packages/data/test/compact-data.integrity.test.ts:76-124`

**Dependencies:** E-4.3, E-4.4.

**Size:** M.

---

### E-4.6 — Validation, divergence review & IP firewall extension

**Design question:** validation.

**Goal:** Add the acceptance suite that proves E-4 is deterministic, source-clean, honest-state compliant, and materially fixes the historical-legends channel failure without hand-tuning individual players.

**Done when:**

- ETL tests cover: source fetch-manifest verification; parser determinism; source-row link determinism; ambiguous-row withholding; duplicate/conflicting source fact failure; `career_stature.json` schema; finite `[0,1]` scores; no ambiguous source assigned to a player; no per-player override table.
- Historical rating tests cover: deterministic rebuild equals committed `ratings.json`; `wc-perf-3.0.0` version; display distribution; career component presence and numeric/null values; same `player_id` has same `career_stature_score` on all historical cards; estimate semantics split correctly. (Named-anchor tests live in E-4.4.)
- Proprietary-source audit scans `etl/sources/`, `etl/supplement/raw/`, `etl/merit/raw/`, plus new merit parser/linker source files.
- Audit rejects: `sofifa`, `futbin`, `fifa ratings`, `EA Sports`, `PES`, `eFootball`, equivalent variants.
- Audit does **not** reject legitimate public football facts or existing legal/disclaimer usage.
- Independent non-IP merit report (if used) handled as review input only — stored outside build path, never loaded by ETL scoring, never used as source or override.
- Divergence-review default threshold: `abs(Δoverall) ≥ 8` OR `abs(Δprimary_channel) ≥ 10` → review-only queue at `etl/output/merit/merit_divergence_review.json`.

**Key files:**

- `etl/tests/test_rating.py:1-23, 86-180, 331-470, 648-680`
- `etl/tests/test_supplement.py` (parser/link/review test precedent)
- `packages/data/test/compact-data.integrity.test.ts:76-124`
- `docs/plans/merit-rating-model-2026-06-07.md` (mark Open Questions resolved post-implementation)

**Dependencies:** E-4.1, E-4.2, E-4.3, E-4.4, E-4.5.

**Size:** L.

---

### E-4.7 — Sim interaction, engine-v2 gate resolution & golden strategy

**Design question:** sim interaction + risk / golden strategy / phase ordering.

**Goal:** Treat E-4 as a rating/data-model change first, but explicitly validate and re-lock downstream sim artifacts because channels move.

**Done when:**

- Compact bundles regenerate after ETL/rating artifacts: `packages/data/src/generated/manifest.json`, `draft-pool.compact.json`, `scenario-2026.compact.json` (if projected rows or Team2026 aggregates change), `packages/data/reports/compact-size.json`.
- `build-compact-data.mjs` stamps `rating_version_historical = "wc-perf-3.0.0"`, `rating_version_projected = "proj-career-3.0.0"` (if projected rows change), `engine_version` unchanged unless engine constants change.
- `compact-data.integrity.test.ts:47` `RUNTIME_DATA_MANIFEST.counts.baseline_anchor_estimate = 388` is updated to the post-rebuild count (and a new `career_stature_estimate` count is added in the same pin). This is the runtime-side counter-update referenced in E-4.4's ordering note.
- `compact-data.golden.test.ts` passes after intentional artifact updates.
- `realism-modern-norms.golden.test.ts` is run and documented: if projected Team2026 aggregates unchanged, the symmetric gate stays byte-identical; if projected linked-player lifts move Team2026 aggregates, the symmetric gate must still pass committed bands.
- Core/data golden fixtures regenerate only after reviewing diffs: `sim-golden.json`, `e2e-real-run-golden.json`, compact-data generated artifacts.
- **If realism fails because channels changed, do not hide it** by weakening tests inside E-4. Instead: verify rating constants are within E-4 acceptance bands, then hand off to E-3a/E-3b calibration; only bump `engine_version` if engine math/constants change.
- E-3a branch context from the asymmetric-realism investigation resolved before season merge: current main has only the symmetric realism gate; the strategic asymmetric harness from the investigation is branch context, not assumed available on main; `packages/core/src/faithfulness.test.ts` is referenced by the investigation but absent from current main, so it must be restored/recreated before being cited as a hard merge gate.

**Key files:**

- `packages/data/scripts/build-compact-data.mjs:48-51, 320-430`
- `packages/data/test/compact-data.integrity.test.ts:103-107`
- `packages/data/test/compact-data.golden.test.ts:1-35`
- `packages/data/test/e2e-real-run.golden.test.ts:1-32`
- `packages/core/src/sim.golden.test.ts:1-23`
- `packages/data/test/realism-modern-norms.golden.test.ts:188-227`
- `packages/core/src/engine/calibration.ts:39-66` (unchanged unless engine retune is in scope)
- `packages/core/src/engine/match.ts:67-73`
- `docs/investigations/engine-v2-asymmetric-realism-2026-06-07.md:14-35` (branch state; context only until merged)

**Dependencies:** E-4.6.

**Size:** L.

---

## Risks & Migration

**Rating-version & replay compatibility.** Historical `rating_version` bumps to `wc-perf-3.0.0`; projected bumps to `proj-career-3.0.0` if projected rows consume career stature. Existing persisted runs are invalidated by the existing combined rating-version token path; no DB migration required.

**Runtime schema stability.** No runtime schema migration. `Rating` remains per-card. `components[]` already accepts open signal slugs with numeric/null values. Do **not** add a runtime career-stature table unless separately approved.

**Source rollback.** Raw snapshots and `fetch_manifest.json` are committed; rollback is a normal git revert: revert merit raw/source/parser artifacts → revert `career_stature.json` → revert `ratings.json` → revert compact/generated artifacts → revert version pins.

**Sim regression risk.** E-4 intentionally moves channels. That can change user XI strength, scorer/assist weights, shootout probabilities, run outcomes, and e2e fixtures. This is expected. It is **not** acceptable to hide failures by weakening realism bands without a separate calibration rationale (see E-4.7 hand-off rule).

**Source coverage risk.** Pre-1956 and non-European/regional-source eras remain inherently thinner. Mitigated by era-specific family weights, retrospective-selection facts, WC legacy facts, explicit `coverage`, review queues, no silent fallback to zero.

**Manager scope risk.** Manager ratings remain unavailable/null. Adding manager stature would require a separate methodology (coaching merit signals differ from player career signals) and runtime compact data has no manager-rating map.

---

## Implementation Order

1. **E-4.1 — merit source package + raw snapshot verification + source registry.** Parser/link tests; no rating changes.
2. **E-4.2 — emit `career_stature.json` and merit reports from `pipeline.py`.** New artifacts only; lock deterministic tests.
3. **E-4.3 — integrate career lift into `rating.py`.** First atomic rating change; includes `wc-perf-3.0.0`, methodology updates, and named-anchor tests in the same commit/PR.
4. **(Optional) Integrate linked-player career lift into `rating_2026.py`.** If included: bump `proj-career-3.0.0`, update `ingest_2026.py` / `RATING_METHODOLOGY_2026.md` atomically. If deferred: document projected stays at `proj-career-2.0.0`.
5. **E-4.4 — calibration + methodology update.** Fit indicative constants against named anchors; lock ETL-side basis counts.
6. **Run ETL validations.** Merit parser/link tests, historical rating tests, source IP audit, deterministic committed-output equality.
7. **E-4.5 — rebuild compact data + runtime-boundary lock.** Version pins, channel bounds, no manager-rating leakage.
8. **E-4.6 — validation, divergence review, IP firewall extension.** Acceptance suite + cross-check queue.
9. **E-4.7 — run sim & realism gates.** `realism-modern-norms`, core sim golden, e2e real-run golden, integrity-test count update (`compact-data.integrity.test.ts:47`). If realism fails due to projected/team channel movement, **do not adjust bands**; route to engine-v2 calibration.
10. **Regenerate goldens only after diff review.** Inspect for plausible user strength movement, no impossible channel bounds, no manager-rating leakage, no source-attribution loss.
11. **Resolve engine-v2 merge gates.** Before season merge, decide whether E-4 ships rating-only or atomically with E-3a/E-3b. Bump `engine_version` only if engine constants/math change. If relying on faithfulness tests from the E-3a investigation, restore/recreate them first.

---

## Open Questions

The Approach resolves the original four open questions. The five surviving items for Paulo are content/threshold approvals plus two that **materially reorder the work items**:

1. **Approve the rejection of channel-only lift.** Approach commits to adding the career term to `score_0_100` (lifts OVR + channels coherently). Confirms the canonical fix; locks in the E-3a/E-3b downstream re-lock obligation. _(Content only.)_
2. **Approve era-bucket weights and the family-scorer decomposition.** The era weights (`pre_1956 / 1956_1990 / 1991_plus`) and the four family-scoring lines are the load-bearing composite shape. The numeric calibration constants (`CAREER_BLEND_HISTORICAL`, `CAREER_MAX_LIFT`, etc.) are indicative; E-4.4 fits them against the named-anchor set. _(Content only.)_
3. **Approve divergence-review default threshold.** Recommended default: `abs(Δoverall) ≥ 8` OR `abs(Δprimary_channel) ≥ 10`. Aggregate distribution checks run alongside per-card review queue. _(Content only.)_
4. **Approve projected (2026) integration in E-4a vs deferral to E-4b.** _(Reorders work items.)_ "Include" forces E-4.3 to wire `link_status`-keyed lookup, E-4.4 to update `RATING_METHODOLOGY_2026.md` and re-fit the projected display distribution, and E-4.7 to regenerate `scenario-2026.compact.json` + verify `realism-modern-norms` under moved Team2026 aggregates. "Defer" keeps the projected path at `proj-career-2.0.0` and shrinks E-4.3/E-4.4/E-4.7 noticeably. Recommend resolving **before** sizing E-4.3 final.
5. **Approve engine-v2 sequencing.** _(Reorders work items.)_ E-4 can ship rating-only with `engine_version` unchanged, or atomically with E-3a/E-3b. "Atomic" silently adds a pre-step: restore/recreate `packages/core/src/faithfulness.test.ts` **before** E-4.3 ships, because a channel-moving lift must land against an operative faithfulness gate. Currently neither a work item nor a dep edge. Recommendation: rating-only first to keep blast radius bounded.

## References

- `etl/RATING_METHODOLOGY.md`, `etl/RATING_METHODOLOGY_2026.md` — current methodology + Phase 2 deferrals
- `etl/src/wcdraft_etl/rating.py:331-335, 443-450, 513-518, 568-578` — exact locus of career-base insertion
- `etl/src/wcdraft_etl/rating_2026.py:42-56, 170-285` — career-signal pattern to mirror
- `etl/src/wcdraft_etl/supplement/` — RSSSF supplement template for any new public ingest
- `etl/output/COVERAGE.md`, `manifest.json`, `supplement/SUPPLEMENT.md` — current data coverage state
- `etl/tests/test_rating.py:648-680` — IP-audit regex (sofifa/futbin/EA/PES) — inherit and extend
- `packages/core/src/engine/team-strength.ts:36-66`, `match.ts:67-73, 145-160, 182-198, 396-397, 635-657` — channel→λ→event→shootout path
- `packages/data/test/realism-modern-norms.golden.test.ts:188-227` — hard realism gate bands
- `packages/data/scripts/build-compact-data.mjs:48-51` — engine_version stamp source
- `docs/investigations/engine-v2-asymmetric-realism-2026-06-07.md:14-35, 79-84, 252-266` — E-3a calibration state and asymmetric findings
- `prompt-exports/2026-06-07-plan-e3-red-calibration-engine-v2.md` — earlier E-3 plan (read-only context)
- External signal sources (read-only references; ingest pattern follows RSSSF supplement architecture):
  - Ballon d'Or master: https://www.rsssf.org/miscellaneous/europa-poy.html
  - FIFA World Cup awards: https://en.wikipedia.org/wiki/FIFA_World_Cup_awards
  - IFFHS World's Best Player: https://en.wikipedia.org/wiki/IFFHS_World%27s_Best_Player
  - South American Footballer of the Year: https://www.rsssf.org/miscellaneous/sam-poy.html
  - IFFHS Century elections: https://www.rsssf.org/miscellaneous/iffhs-century.html
  - FIFA 100: https://en.wikipedia.org/wiki/FIFA_100
  - RSSSF 100+ caps/goals: https://www.rsssf.org/miscellaneous/century.html
