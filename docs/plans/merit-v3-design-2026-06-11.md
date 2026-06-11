# merit-v3 Season Design — D2 Activation · D1 Age Cohorts · Index Bias · Ceiling

- **Date:** 2026-06-11 · **Branch:** `merit-v3-udesign` off `merit-v3` (= main `b41b8e0`)
- **Tier:** RED PLANNING, DOCS-ONLY. No implementation, no schema/rating/runtime change in
  this PR. Every implementation unit below is DISPATCH-ONLY and carries the full Red chain.
- **Evidence base (executed analysis — this design does NOT re-derive it):**
  [`mv212-ratings-audit-2026-06-10.md`](../reports/mv212-ratings-audit-2026-06-10.md)
  (Audit-1: 0.62 raw cap, frozen archive, youth double penalty, 88 pile-up),
  [`mv212-face-validity-2026-06-10.md`](../reports/mv212-face-validity-2026-06-10.md)
  (Audit-2: index bias §C/§H.4, ceiling census §E, probe set §H.2, Valverde counterfactual
  §G), `etl/output/merit/ACTIVE_CAREERS.md` + the staged 12a channel
  (`active-career-source-set-1.0.0`: 47 facts / 23 players, cutoff 2026-06-01),
  [`club-backfill-manifest-2026-06-10.md`](../reports/club-backfill-manifest-2026-06-10.md),
  [`draft-config-2026-06-10.md`](draft-config-2026-06-10.md) §D (dual-basis contract),
  [`merit-v2-stature-dominant-2026-06-08.md`](merit-v2-stature-dominant-2026-06-08.md)
  (rating-architecture v4: blend formula, tiers, versioning conventions).

## 0. Owner-ratified scope (binding inputs)

1. **Audit-2 advisories are IN-SCOPE TO FIX, not ratify-as-known:** stature down-cap
   insensitivity (Rossi-1986 94 with 0 apps) and champion-reserve compression at 87–88
   (0-app reserves one point under starters). Both get mechanism fixes in §4.
2. **Dual-basis internals materialize NOW.** The Career/Current toggle ships later in the
   `engine-draft-config` season, but merit-v3 must emit both internal score paths per card
   so the toggle can consume them without another rating skew (§5).
3. **One skew event.** Club backfill + census-lock flips + compact regen + all anchor bumps
   ride this season's single merge to main. No intermediate production skew.
4. **Naming is pinned** (draft-config plan, owner-approved): `Career` = career-best /
   full-career stature; `Current` = at-that-World-Cup-year strength. Never "Prime".

Out of scope, ledgered with size estimates: full archive re-research (§3.4), ranked
leaderboard policy for config axes (draft-config §F, HUMAN), surname disambiguation UX
(`q-005`).

---

## 1. D2 activation — active-career stature for in-progress careers

### 1.1 Identity seam: person-identity, not historical-card link

Today's gates are the defect (Audit-1 C1): `rating.py` consults the archive by historical
player id only for players the curated archive covers (peak-year max 2022, zero
in-progress careers), and `rating_2026.py:424` only lets `link_status == "linked"` cards
consult it at all — minted players are structurally barred.

**Decision:** both rating stages consult career stature through a single **person-identity
resolver** built in `stature.py` and emitted on `career_stature.json`:

- A person key unifies `P-*` historical ids, `P-W26-*` minted ids, and the 12a identity
  bridges (4 staged: Neymar, Alisson, Marquinhos, Rodri). After U0 (identity-link fix unit,
  in flight on this integration branch) converts the 17 Audit-2 §H.3 link misses into real
  links, the bridge list shrinks to whatever U0 leaves minted-only; the resolver consumes
  U0's links first and bridges second. The Timber-twins trap stays test-pinned: resolution
  is `birth_date + nation + surname`, ambiguity withheld, never assigned.
- **One person = at most one stature row** (build-enforced). The 12a double-credit guard
  (`test_double_credit_guard_fails_the_build_on_an_archived_target`) survives activation in
  merged form: a staged active fact may extend a person's row, but two rows for one person
  fail the build.

### 1.2 How active facts map into the index: stage-normalized scoring

The T6 counterfactual validated the peer-band target (Valverde at injected index 0.42
displays 84, inside the Godín 0.398 · C. Alberto 0.492 · Zoff 0.523 · Passarella 0.529
band). The mechanism that gets an in-progress career there:

- Active facts are scored with the **same family scoring** as the archive
  (career-stature-3.0.0 table, §3), then the index is **career-stage normalized**: each
  family contribution is measured against expected accrual-to-date for the player's career
  stage (age/years-active), not against completed-career totals. Stage-expectation curves
  are fit deterministically from the archive's own fact timing (monotone in stage, locked
  by tests); where a family has no datable timing, the conservative fallback is the
  completed-career denominator (no inflation by default).
- Stage normalization **cannot exceed** the completed-career scale: an in-progress index is
  capped at what the same facts would score on a completed career. Anti-overcorrection
  stands structurally: **no facts → no row → no lift** (Perlaza/Ayari controls, §7).
- The 12a channel activates as-is: 47 facts / 23 players, cutoff 2026-06-01. V1 (§8) adds
  one bounded curation increment (`active-career-source-set-2.0.0`) scoped to the named
  probe set and the Audit-2 S2 classes (Vinícius re-curation, Rodri post-2022 facts,
  E. Martínez GK facts) — same SHA-pinned anti-fab discipline; refuted/absent facts stay
  absent (the Valverde-captaincy refutation and Hajsafi gap are recorded precedents).

### 1.3 The Valverde gap: one new fact family, bounded

12a curation proved the probe's risk: Valverde carries **zero staged facts** (his Uruguay
captaincy was REFUTED — Giménez holds the citable 2026 captaincy), and no existing family
captures "serial major club honors" — the very profile the T6 peer band describes.

**Decision:** career-stature-3.0.0 adds one family, `club_season_honors`, restricted to
top-tier continental titles (Champions League / Libertadores class) with documented final
participation, conservatively weighted and position-neutral. This is the citable lever for
Valverde (2× CL with final participation), Vinícius (2× CL), and partially the
Busquets/X. Alonso/unsung-role class (§3.3). Guardrails: titles only (no subjective
"importance" scoring), participation documented in the pinned source, weight fit in-unit
against the pre-registered probe bands (§7) — if the weight needed to land Valverde at
0.40–0.46 distorts any control, the family weight loses and the probe band is reported as
missed, not forced.

### 1.4 Refresh / cutoff policy for future intake

- Every active source set is **dated** (`curation_cutoff`) and immutable once pinned.
- Re-curation cadence: **once per dataset-anchor skew event** (the only time live tokens
  invalidate anyway). Between skews, active indexes are honestly stale as-of-cutoff; basis
  metadata carries the cutoff so the UI can state it if ever needed.
- Facts never decay or get hand-edited; a future cutoff supersedes by adding facts under a
  new source-set version.

### 1.5 The explicit activation diff

Activation = flipping the two 12a inertness guards, nothing implicit:

1. `test_scoring_code_never_references_the_active_artifacts`
   (`etl/tests/test_merit_active.py:103`) flips to its inverse: stature scoring MUST
   consume `source_facts_active.json` / `career_stature_active_staging.json`.
2. `test_double_credit_guard_fails_the_build_on_an_archived_target`
   (`etl/tests/test_merit_active.py:216`) flips from "staged fact may not target an
   archived identity" to "staged facts merge into the person's single row; two rows per
   person fail the build".

### 1.6 Expected probe movement (full bands pre-registered in §7)

Valverde-2022 76 → 81–86 (basis flips to `career_stature_estimate`); Valverde-2026
88 → 89–91; Yamal-2026 crosses the 88 wall (5 staged facts incl.
`global_annual_recognition`); Haaland-2026 88 → 89–93 (11 facts); historical cards of
actives lift in the same pass (T6-b class: Lukaku-2022, B. Fernandes-2018, …) because the
historical path reads the same archive. Perlaza/Ayari/Dempsey/Boufal do not move.

---

## 2. D1 — age-conditioned scoring of the projected raw path

### 2.1 Mechanism: expected-accrual curves, not thin age-band cohorts

Audit-1 C3 confirmed the double penalty: all-age career-total percentiles punish youth
(Yamal caps p0.502 all-age vs p0.919 in the U21 FW cohort) AND `age_factor` (floor 0.80)
punishes it again. Audit-1 also flagged the trap in the obvious fix: hard age-band cohorts
are grainy (U21 FW n=31).

**Decision:** replace all-age percentiles with **age-conditional quantile curves**:

- For each position × signal (caps, goals), fit monotone-in-age conditional quantile
  curves over the full 2026 pool (n=1,246) — pooled smoothing, no hard band edges. A
  player's evidence percentile = their signal's quantile **at their age**.
- **Retire `age_factor`** (the career-stage job moves entirely into the conditioning;
  keeping both re-creates the double penalty). The monotone-in-age cohort signature
  (minted age<24 mean 71.7 vs >30 mean 76.0) must flatten — locked as a distribution test.
- The MV2-5 cross-era quantile map is **re-derived** on the new projected raw distribution
  (same mechanism, new inputs), preserving the measured-vs-measured cross-era fairness
  Audit-1 §B.3 proved (inversion rate ≤0.5% re-asserted in §7).

### 2.2 Predicted movement and overcorrection guards

- **Yamal-2026:** caps-at-18 / goals-at-18 quantiles land ~p0.92/p0.94 (the audit's U21
  measurement) → projected raw ≈ 0.94 → at/near the measured ceiling. D1 alone takes him
  79 → ~88; with his D2 row he exits the wall (combined band §7: 85–91, center ≥88).
- **Aït-Nouri-2026:** 83 → 84–87. **Gavi:** modest up.
- **Fringe-youth controls (must NOT move):** Khalil Ayari (3 caps at 21 is ~p0.06 even
  age-conditioned) stays 71 ±1; Perlaza stays 68 ±1. Small-sample high-rate inflation is
  bounded because accrual _totals_ (not per-game rates) remain the signal — D3 (rate
  blending) stays rejected per Audit-1.
- Veterans-at-the-cap (Alaba tier) dilute slightly on evidence percentile but their D2
  facts (Alaba: 6 staged facts) keep legitimately decorated careers high; pure
  longevity-accumulators without facts settle below the award/fact carriers — which is the
  intended dissolution of the "longevity detector" artifact (Audit-1 §B.2).

Blast radius: `rating_2026.py` only, but ordering inside the 2026 pool changes broadly →
full compact regen + canary + λ chain (§6, §8).

---

## 3. Index-bias mitigation — what ships now vs ledgered

Audit-2 §H.4 established the archive index is biased within itself: (a) pre-1995 Ballon
d'Or eligibility (Europeans only) structurally zeroes `global_annual_recognition` for
Pelé/Garrincha/Di Stéfano-class careers; (b) sparse 2–3-fact retrospective-only profiles
reach 0.78–0.99 (Kocsis 0.992 = #1 all-time, above Maradona/Messi/Pelé); (c) unsung-role
greats sit near zero (Busquets 0.066, X. Alonso 0.052, Lloris 0.067, Deschamps 0.209,
Klose 0.395 one fact short of the 0.40 gate). Pelé at rank 45 is not acceptable in a
season that re-locks goldens — D2 must not mint accurate active rows onto a misordered
reference scale.

### 3.1 Ships: eligibility-aware family normalization

For each (player, family), an **eligibility predicate** derived from documented award
rules (citable, deterministic): e.g. `global_annual_recognition` is ineligible for a
player whose career predates 1995 and whose career was outside the award's documented
eligibility (pre-1995 Ballon d'Or: European players at European clubs). Ineligible
families are **removed from that player's denominator** (weights re-normalize over
eligible families); they are never scored 0. Coverage becomes "evidence over eligible
families". Effect: Pelé's index rises on the strength of the families he could earn
(international_record, regional, retrospective, wc_legacy) instead of being diluted by a
family he was barred from; Kocsis-class profiles do NOT rise (they were never diluted —
their families are all eligible).

### 3.2 Ships: sparse-fact / single-family saturation control

The Kocsis defect is concentration: extreme per-family scores from 2–3 retrospective
facts. Two mechanisms, constants fit in-unit against the pre-registered §T2 ordering gate
(§7), not hand-set per player:

- **Per-family contribution saturation:** no single family can carry an index past the
  gold floor; the top decile of the index requires breadth (≥3 materially-scored
  families). Kocsis (3 families, retrospective-heavy) saturates below the
  Maradona/Messi/Pelé tier.
- **Fact-count confidence shrinkage above the gold floor:** index mass above ~0.85 is
  scaled by a fact-count confidence term, so 2-fact profiles (Boniperti, Ocwirk, Hanappi,
  Scarone) cannot occupy 0.78–0.86 while 15–69-fact profiles sit beside them. Below the
  gold floor the index is untouched (pre-war greats whose ONLY signal is retrospective
  remain material — the fix targets the misordered top, not the honest middle).

### 3.3 Ships: legend/band coherence + knife-edge re-curation

- The `legend` derivation re-runs on the re-normalized index; the Audit-2 NOT-LEGEND
  inconsistency (Piola/Albert/Bozsik/Ocwirk/… at 94–99 without the badge) must close in
  whichever direction the new index sends each entry — the gate is "no 94+ display without
  either legend or a measured award path", asserted as a census test.
- Knife-edge cases at the 0.40 material gate (Klose 0.395, Sócrates 0.396, Godín 0.398):
  resolved by fact re-curation (V1 probe-set increment; Klose's WC-record facts are
  citable) — the gate itself does not move (the ramp already smooths it; moving the gate
  to chase named players is a per-player override by another name).
- `club_season_honors` (§1.3) partially lifts the unsung-role class (Busquets, X. Alonso,
  Lloris are serial continental winners).

### 3.4 Ledgered: full archive re-research (OUT this season)

Closing the unsung-role holes properly (Deschamps/Desailly-class leadership, champion-GK
families per Audit-2 H.1 #14, captaincy expansion deferred since MV2-1 #18, Yashin
captaincy still withheld for lack of a citable source) is a research wave, not a
normalization: estimated **150–250 new facts over 60–100 players, 2–3 curation sessions**
(MV2-1 + MV2-3.5 throughput as the basis). Ledgered as the first post-season queue item
(`q-002` successor) with the §T2/T5 sheets as its work list. This season's gate (§7) only
requires the ordering fixes of §3.1–3.3.

### 3.5 Expected probe movement

Pelé index 0.807/rank 45 → top-10, ≥ Kocsis; Kocsis 0.992 → no longer #1 (expected
≤0.90); Cruyff > Owen restored; Pelé-1970 card 97 → 98–99; Kocsis-1954 card 99 → 94–97
(his measured inputs remain monstrous — Golden Boot, 11 goals — so he stays elite, just
not GOAT-tier); 2-fact 0.78–0.86 profiles drop below the 15+-fact tier they currently
outrank.

---

## 4. Ceiling + display curve

### 4.1 Raw-cap redesign: award-gated headroom

Today `RAW_ONLY_GLOBAL_CEILING = 0.62` hard-clamps the raw path in BOTH eras
(`rating.py:698`, `rating_2026.py:475-478`); Audit-2 §E shows the cap's worst victims are
championship-award measured performances the cap was never meant to suppress: Schumacher
1986 (Silver Ball, raw 100), Dibu Martínez 2022 (Golden Glove, champion, raw 100), Vavá
1962 (Golden Boot, champion, raw 100), Forlán 2010 (**Golden Ball**, raw 94.0) — all
displaying 88.

**Decision:** the clamp becomes **award-gated soft headroom**:

```text
capped  = min(raw_path, RAW_ONLY_GLOBAL_CEILING)
headroom = award_gate(award_anchor) * min(max(raw_path - CEILING, 0), RAW_AWARD_HEADROOM)
raw_only_score' = capped + headroom
```

- `award_gate` is 0 below a major-individual-award threshold (Golden/Silver/Bronze
  Ball/Boot/Glove class — the existing `award_anchor` already encodes this) and ramps to 1
  at Golden-Ball class. No award → exactly today's clamp (Dempsey, Boufal, and the entire
  no-award measured cohort are byte-stable on the internal scale).
- `RAW_AWARD_HEADROOM` is fit so the maximum measured display lands **strictly below the
  legend band's interior** — measured award performances can clear 88 into ~89–92, but the
  high-90s remain reserved for material stature (the v4 invariant survives, loosened only
  for documented award evidence).
- The 2026 measured path gets the identical structure post-quantile-map. 2026 cards have
  `award_score` null by design (pre-tournament) → no 2026 card uses headroom; their exit
  above 88 is D2 facts, which is the honest channel.

### 4.2 Pile-up dissolution target

Today 12.0% of all cards display exactly 88 (1,469 cards; 1,244 at internal exactly 62.0),
and the p95 curve anchor sits ON the pile. Targets, asserted as census tests in V4:

- **No single display value holds >4% of the pool** (the wall dissolves; the clamp pile
  spreads over 84–92 by true raw ordering once headroom + D1/D2 move its members).
- The famous-squad sheets stop being walls: Brazil-1970 (ten 88s) and Argentina-2022
  (nineteen 88s) become internally ordered — Jairzinho > Piazza/Félix is the named check.
- Anti-inflation stays locked: pooled median 73 ±1; share of 90+ ≤5% (currently 2.7%; the
  ceiling escapes and re-curated legends justify a bounded rise, not a band migration).

### 4.3 Advisory fixes (owner-ratified IN SCOPE)

**(a) Stature down-cap insensitivity** — participation-scaled down-modulation: the
`TOURNAMENT_DOWN_CAP[pos, tier]` allowance widens as participation evidence vanishes
(scaled by apps percentile, bounded; constants fit in-unit). A gold-tier legend's no-show
tournament reads one tier lower instead of indistinguishable: Rossi-1986 94 → 89–92,
Zidane-2002 95 → 90–93, Messi-2010 98 → 95–97. The Career basis keeps reading "this
player, tournament-flavored" — but a 0-app tournament now visibly flavors it. (The Current
basis, §5, renders these cards honestly low by construction; the down-cap fix is what
keeps the _Career_ display defensible meanwhile.)

**(b) Champion-reserve compression** — participation-scaled finish anchor: `team_finish`
credit on the measured path scales with the card's own participation (0-app reserves
retain a bounded fraction, not full champion credit). Expected: 0-app champion reserves
(Brazil-1970 Ado/Leão 87, Argentina-2022 backup GKs 88) land **76–83**, restoring squad
hierarchy without zeroing honest squad membership.

### 4.4 Curve re-fit + the mandatory chain

The unified display curve is re-fit (same low-DOF monotone family, new kind identifier
`unified_pooled_piecewise_power_v2`) over the pooled post-merit-v3 internals of **both
bases' Career pool** (see §5 for why the curve is shared). The p95 anchor will no longer
sit inside a clamp pile.

Because internal scores feed the sim channels, channels move in both eras → **λ re-fit
BEFORE any realism re-lock** (MV2-11b precedent; engine anchor bumps; realism goldens are
EXPECTED-RED mid-season exactly as in MV2-10 and never re-locked to pass a red gate).

---

## 5. Dual-basis materialization (Career / Current internals)

Per the draft-config plan §D (binding): merit-v3 materializes both score paths now; the
product toggle ships later.

- **`career`** = the full stature-dominant blend (today's semantics, post-§1–4 fixes).
  This remains the shipped display/sim basis for this season — zero product-visible basis
  change at merge.
- **`current`** = the at-that-tournament measured path: `raw_only_score'` (with award
  headroom) for historical cards; the D1 age-conditioned projected raw (quantile-mapped)
  for 2026. No career-stature blend, no legend gold (per draft-config: Current suppresses
  career badges; tournament awards remain, they belong to the card-year).
- ETL emits **both internal scores and both full channel sets**
  (`{overall, attack, midfield, defense, goalkeeping, coverage, components,
basis_metadata}` per basis) on `ratings.json` / `ratings_2026.json`. One shared display
  curve fitted over the union of both bases' internal pools maps both (draft-config §D
  decision: same internal score must render identically across bases).
- Compact bundles carry both bases (`runtime-data-2.0.0`): basis-aware lookup
  `ratingByCardIdByBasis.career` / `.current`, with the existing `ratingByCardId`
  remaining as a compatibility alias for `career` so every shipped surface and test is
  untouched until `engine-draft-config` flips a consumer. Honest-state rule (draft-config
  §D): missing-basis channels are never silently backfilled from the other basis.
- Bundle-size check is a V6 gate (two channel sets × 12,219 cards; brotli measured, budget
  recorded — if the delta is unacceptable, the fallback is ETL-materialized but
  compact-deferred, which the owner must explicitly accept since it re-opens a skew for
  draft-config; default is carry-both).
- Sim consumption stays Career-only this season. The Current heavy-realism validation and
  basis canaries belong to `engine-draft-config` (DC-6/DC-7), not merit-v3 — but V7's λ
  re-fit records the Current-pool channel distributions as a baseline artifact so DC-7
  starts from measured ground.

---

## 6. Version matrix + the single skew event

Every anchor moves once, in the season merge (§8 V8). Enumerated:

| Anchor                    | From                              | To                                                                                                             | Driver                                                                                    |
| ------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Career-stature table      | career-stature-2.1.0              | **career-stature-3.0.0**                                                                                       | index re-norm (§3), stage-normalized active index (§1), `club_season_honors` family       |
| Active source set         | active-career-source-set-1.0.0    | **active-career-source-set-2.0.0**                                                                             | bounded probe-set curation increment (§1.2)                                               |
| Historical rating         | wc-perf-4.2.1                     | **wc-perf-5.0.0**                                                                                              | award-gated ceiling, participation-scaled down-cap/finish, new index, dual-basis emission |
| Projected rating          | proj-career-3.0.0                 | **proj-career-4.0.0**                                                                                          | D1 age conditioning, person-identity seam, quantile-map re-derivation, dual-basis         |
| Display curve kind        | unified_pooled_piecewise_power_v1 | **…\_v2**                                                                                                      | re-fit on post-v3 pooled internals (§4.4)                                                 |
| Dataset                   | 2026-06-04                        | **measured at pin time**                                                                                       | club backfill source pins (21 tournaments) + squad-data refresh if re-pinned              |
| Runtime data schema       | runtime-data-1.1.0                | **runtime-data-2.0.0**                                                                                         | dual-basis rating shape (§5)                                                              |
| Legend census (runtime)   | 302                               | **re-measured** (moves: bridges/U0 restore Neymar/Rodri badges; §3.3 re-derivation moves membership both ways) | census re-lock in V6                                                                      |
| Engine                    | engine-2026.06.09                 | **engine-2026.06.XX**                                                                                          | λ re-fit (V7)                                                                             |
| Club-coverage census lock | 1,246 / 12,219 (2026-only)        | **measured from pinned revisions**                                                                             | backfill manifest item 4 — the test MUST flip                                             |

**Canary protocol (clarified for the reviewer):** the strategic-pick canary embeds
`rating_version` and is regenerated (`WCDRAFT_CANARY_REGEN=1`) at every rating bump. The
**zero-pick-flip proof applies to stamp-only bumps** (the #62/#64 precedent). merit-v3 is
the first _semantic_ rating change since the canary shipped: pick flips are the intended
output. The gate becomes (a) determinism — regen twice, byte-identical; (b) the full
pick-flip diff is enumerated in the V6 report and reviewed against the §7 probe directions
(flips must be explainable by the probe movements, e.g. award-ceiling escapees entering
strategic picks); (c) post-merge the zero-flip property re-arms for future stamp-only
bumps.

**New committed PREV skew cases:** before V8, capture current-production fixtures —
a valid pre-v3 `t1.` token, a pre-v3 saved-run record, and a pre-v3 leaderboard-replay
payload — and commit them asserting `WRONG_SEASON`/skew-notice (never replay, never crash)
against the post-v3 anchors. This extends the existing skew suite with real cross-season
artifacts rather than synthetic flips only.

---

## 7. Acceptance gate — pre-registered probe set

Defined BEFORE implementation; V4 commits this table as named-anchor tests; the season
review re-executes it. Bands are display values on the **re-fit curve** (wider than the
frozen-curve counterfactuals by design). Direction is binding; a missed band is a gate
failure that needs either a fix or an explicit owner waiver recorded in the gate report.

### 7.1 Movers (15 from Audit-2 §H.2, plus the ratified advisory/index probes)

| #   | Probe                                                              | Now            | Expected                                                          | Asserts                                                                                                   |
| --- | ------------------------------------------------------------------ | -------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | Yamal 2026                                                         | 79             | **85–91** (≥85 hard)                                              | D1+D2 youth fix                                                                                           |
| 2   | Haaland 2026                                                       | 88             | **89–93**                                                         | ceiling exit via D2 facts (11 staged)                                                                     |
| 3   | Valverde 2026                                                      | 88             | **89–91**                                                         | D2 via `club_season_honors` (§1.3)                                                                        |
| 4   | Valverde 2022                                                      | 76             | **81–86** (center ~84) + basis flips to `career_stature_estimate` | D2 reaches historical cards of actives; T6 band                                                           |
| 5   | Rodri 2026 (post-U0)                                               | 88             | **89–92 + legend badge**                                          | link fix + archive consult + re-curation                                                                  |
| 6   | Neymar 2026 (post-U0)                                              | 88             | **92–94 + legend badge**                                          | link fix alone (idx 0.682)                                                                                |
| 7   | Vinícius Júnior 2026                                               | 87             | **≥90**                                                           | D2 re-curation of a linked active (idx 0.200 stale)                                                       |
| 8   | E. Martínez 2022                                                   | 88             | **89–92**                                                         | award-gated headroom (Golden Glove, champion)                                                             |
| 9   | Schumacher 1986                                                    | 88             | **89–92**                                                         | headroom (Silver Ball, raw 100)                                                                           |
| 10  | Forlán 2010                                                        | 88             | **89–92**                                                         | headroom (Golden Ball)                                                                                    |
| 11  | Vavá 1962 · Jairzinho 1970 · Klose 2006                            | 88             | **>88 each**; Jairzinho > Piazza/Félix                            | headroom + squad-hierarchy restoration                                                                    |
| 12  | Klose 2014 (idx 0.395)                                             | 88             | **>88**                                                           | knife-edge resolved by re-curation, NOT by moving the 0.40 gate                                           |
| 13  | Lukaku 2022                                                        | 71             | **≥78**                                                           | T6-b class (conditional on citable facts; if none land, report the miss honestly)                         |
| 14  | B. Fernandes 2018                                                  | 72             | **↑ (direction)**                                                 | T6-b class                                                                                                |
| 15  | Aït-Nouri 2026                                                     | 83             | **84–87**; Gavi 2026 84 → modest ↑                                | D1                                                                                                        |
| 16  | Pelé (index)                                                       | 0.807, rank 45 | **top-10, ≥ Kocsis' new index**; Pelé-1970 card 97 → **98–99**    | §3 era/eligibility re-norm                                                                                |
| 17  | Kocsis (index)                                                     | 0.992, #1      | **≤0.90, not #1**; card 99 → **94–97**                            | §3 saturation/shrinkage (explicitly a mover now — the H.2 control is superseded by the ratified §3 scope) |
| 18  | Cruyff vs Owen                                                     | 0.755 < 0.789  | **Cruyff > Owen**; Cruyff-1974 95 → 96–98                         | §3 ordering gate                                                                                          |
| 19  | Rossi 1986                                                         | 94 (0 apps)    | **89–92**; Zidane-2002 95 → 90–93; Messi-2010 98 → 95–97          | participation-scaled down-cap (§4.3a)                                                                     |
| 20  | 0-app champion reserves (Ar-2022 backup GKs, Brazil-1970 Ado/Leão) | 87–88          | **76–83**                                                         | participation-scaled finish anchor (§4.3b)                                                                |

### 7.2 Controls (≤1 display point of rounding/curve-grain movement)

| Control                      | Now          | Guards against                                     |
| ---------------------------- | ------------ | -------------------------------------------------- |
| Perlaza 2026                 | 68           | fringe inflation (no facts → no lift)              |
| Khalil Ayari 2026            | 71           | D1 youth-cohort overcorrection                     |
| Dempsey 2010                 | 88           | no-award measured path untouched by headroom       |
| Boufal 2022                  | 88           | clamped-without-award stays clamped                |
| Messi 2022 / Messi 2010-band | 99 / per #19 | stature-path stability under index re-norm         |
| Cesare Maldini 1962          | 71           | Audit-1 ruling stands (UX-only follow-up, `q-005`) |
| Q. Timber 2026               | 72           | identity resolution must not merge the twins       |
| baseline_anchor cohort       | [66, 73]     | estimate band untouched                            |

### 7.3 Distribution + structural gates

- No single display value >4% of the pool (today: 12% at 88); pooled median 73 ±1; 90+
  share ≤5%.
- Measured-vs-measured cross-era inversion rate ≤0.5% re-proven on the re-derived
  quantile map (Audit-1 §B.3 methodology re-executed).
- No 94+ display without legend or a measured-award path (§3.3 coherence census).
- Basis-transition asserts (T6 caveat): probes that cross the material gate must flip
  `overall_basis`, not just OVR.
- Determinism: rebuilt internals + rebuilt curve reproduce committed `overall`
  12,219/12,219 (both audits' reproduction harness re-run as the final check).
- Dual-basis: every draftable card carries complete channel sets for both bases (or an
  explicit exclusion census), `ratingByCardId` ≡ `.career` alias proven byte-identical.

---

## 8. Unit decomposition + order

U0 (identity links) is already in flight on `merit-v3`. All units are RED unless noted,
PR into `merit-v3`, fresh-session re-executing review per the train protocol; the season
merge to main is the single skew/ship event.

| Unit               | Scope                                                                                                                                                                                                                                                          | Golden/lock touch                                                                                                   | Depends on               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **U0** (in flight) | 2026 identity-link fix (17 misses, twins-safe)                                                                                                                                                                                                                 | ratings_2026 diff for linked players; NO compact regen (deferred to V6)                                             | —                        |
| **V1**             | career-stature-3.0.0: index re-norm (§3.1–3.3), stage-normalized active scoring (§1.2), `club_season_honors`, source-set 2.0.0 curation increment, person-identity resolver, **inertness-guard flips (§1.5)**                                                  | ETL tests only; consumed rating outputs stay byte-identical via the 12a staging pattern until V2 flips the consumer | U0 (bridge handoff)      |
| **V2**             | wc-perf-5.0.0 historical integration: new index consumption, award-gated ceiling, participation-scaled down-cap + finish anchor, dual-basis emission                                                                                                           | ratings.json re-lock; named-anchor tests; §7 historical probes staged                                               | V1                       |
| **V3**             | proj-career-4.0.0: D1 age conditioning (age_factor retired), person-identity stature seam, quantile-map re-derivation, dual-basis                                                                                                                              | ratings_2026.json + teams_2026 re-lock; cross-era parity tests re-derived                                           | V1, V2                   |
| **V4**             | curve re-fit (v2 kind) + display invariants + **the §7 probe table committed as tests** + distribution censuses                                                                                                                                                | display goldens; probe gate goes green here or the season stops                                                     | V2, V3                   |
| **V5** (parallel)  | club backfill per the manifest: pin 21 squad-page revisions, parse club, join in ETL (`cards.py:114` null → parsed), per-tournament coverage measured + recorded                                                                                               | ETL determinism; census numbers recorded for V6's test flip                                                         | none (parallel to V1–V4) |
| **V6**             | compact regen: runtime-data-2.0.0 dual-basis shape, legend census re-lock, club census-lock flip, bundle-size budget check, canary regen + reviewed pick-flip diff (§6), data/draft/e2e golden re-locks, PREV skew fixtures committed                          | all `test:golden:*` suites; any NEW golden script registered in root `turbo.json`                                   | V4, V5                   |
| **V7**             | λ re-fit vs the new Career channels; engine bump; heavy realism re-lock (λ BEFORE bands — bands never re-locked to pass red); Current-pool channel baseline recorded for DC-7                                                                                  | realism goldens; faithfulness suite                                                                                 | V6                       |
| **V8**             | season merge: STATE.md (counts, versions, flags) in the same change; cumulative diff fresh-SESSION review that RE-EXECUTES the gates (suites + §7 probe table + live-token skew probes); owner approval SHA-pinned; `gh pr merge --squash --match-head-commit` | cumulative re-lock verification only — no new code                                                                  | V7                       |

Order: U0 → V1 → V2 → V3 → V4 → V6 → V7 → V8, with V5 parallel any time before V6.
Fix-forward → re-review loops on any unit are normal. Post-merge: live sanity on
production (replay byte-identity for a fresh token, probe spot-checks on live cards,
console clean), per the merge-=-ship rule.

### Season-merge checklist (V8, explicit)

1. Rebase `merit-v3` onto fresh main; full cumulative gate re-run (typecheck/lint/test/
   build, all goldens, ETL ruff+pytest, heavy realism, byte-determinism).
2. §7 probe table green on the final SHA; distribution censuses recorded with real counts.
3. Canary pick-flip diff reviewed against §7; determinism regen proven.
4. PREV skew fixtures green; live `t1.` invalidation behavior verified on a preview
   deploy before main.
5. Fresh-session independent review of the cumulative diff (re-executes, not diff-reads).
6. Owner approval pinned to the final SHA; squash with `--match-head-commit`.
7. STATE.md + `docs/queue/q-002` successor updated in the same merge.

---

## Open questions for the owner

None. The four pre-ratified inputs (§0) close the questions this design would otherwise
carry. Two decisions are pre-registered as in-unit outcomes rather than questions: the
`club_season_honors` weight (lands Valverde 0.40–0.46 or the probe is reported missed,
§1.3) and the compact dual-basis size budget (carry-both unless the measured delta forces
the explicitly-flagged fallback, §5).
