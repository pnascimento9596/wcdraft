# WS-B Sim + Scoring — Calibration

> **merit-v4 (`engine-2026.06.13-merit-v4`) — λ refit against
> national-strength + objective-club merit channels.** merit-v4 changed the
> rating/channel distribution and tripped the strategic-pick canary, so the
> deterministic fitter was re-run after the final source expansion. The
> accepted tuple remains:
> **`LAMBDA.BASE = 1.10`, `LAMBDA.SPREAD = 6.0`, `LAMBDA.MIN = 0.30`,
> `LAMBDA.GAMMA_MID = 0.80`, `LAMBDA.KO_LAMBDA_FACTOR = 0.82`**; `MAX`,
> `W_DEF/W_GK`, `CHANCES`, and `LAMBDA_DISP` remain unchanged from merit-v3 V8.
> Fitter: `175` evaluations; winner landing `goals=2.544`, `draw=24.87%`,
> `margin>=4=4.86%`, `KO->ET=34.13%`, `SO=21.33%`. Symmetric realism remains
> 5/5 in band; heavy asymmetric realism remains 7/7 after re-locking
> Wilson/floor shape bands. Runtime stamp: `engine-2026.06.13-merit-v4`.

> **merit-v3 V8 (`engine-2026.06.12`) — λ refit against the post-V6
> Career channels.** The merit-v3 rating/display changes moved the Career
> channels that feed the sim, so the MV2-11b tuple no longer landed inside
> the D5-tight symmetric realism bands. The deterministic fitter was re-run
> with the required upward `GAMMA_MID` grid extension, then extended again
> when the first result touched grid edges. Final accepted tuple:
> **`LAMBDA.BASE = 1.05`, `LAMBDA.SPREAD = 6.5`, `LAMBDA.MIN = 0.70`,
> `LAMBDA.GAMMA_MID = 0.80`, `LAMBDA.KO_LAMBDA_FACTOR = 0.82`**; `MAX`,
> `W_DEF/W_GK`, `CHANCES`, and `LAMBDA_DISP` remain unchanged from MV2-11b.
> Fitter: `175` evaluations; seed landing `goals=2.168`, `draw=29.17%`,
> `margin>=4=3.49%`, `KO->ET=38.27%`, `SO=24.40%`; winner landing
> `goals=2.534`, `draw=25.18%`, `margin>=4=4.96%`, `KO->ET=33.47%`,
> `SO=21.33%`. Faithfulness remains 11/11; heavy asymmetric realism remains
> 7/7 after re-locking Wilson/floor shape bands. V8 lands the season's single
> engine stamp: `engine-2026.06.12`.
> Evidence: `docs/reports/merit-v3-v7-lambda-refit.md`.

> **MV2-11b (engine-2026.06.09) — λ refit against merit-v2 stature-dominant
> channels.** The merit-v2 rating model (`wc-perf-4.2.0` / `proj-career-3.0.0`)
> moved every channel, so the E-3a REFIT λ tuple no longer landed inside the
> D5-tight bands. The deterministic coordinate descent (`fit-calibration.mjs`)
> was re-run against the new channel distribution and produced the current
> shipped tuple: **`LAMBDA.BASE = 1.0`, `LAMBDA.SPREAD = 7.0`,
> `LAMBDA.GAMMA_MID = 0.60`, `LAMBDA.KO_LAMBDA_FACTOR = 0.82`** (the rest of
> `LAMBDA` / `CHANCES` / `CHANCE_OUTCOME` / `LAMBDA_DISP` unchanged from
> E-3a REFIT). All 5 symmetric realism norms land mid-band; the faithfulness
> suite remains 11/11; the heavy asymmetric realism gate remains 7/7 (with
> shape bands re-derived to the 1.5pp floor). At the same time the season
> merge landed the deferred `engine_version` bump → `engine-2026.06.09`.
> `sim-golden.json`, `e2e-real-run-golden.json`, the symmetric realism
> golden, and the asymmetric realism golden were re-locked atomically.
>
> **E-3a (engine-v2) landed** — the λ map is a four-channel form
> (`attack` × bounded `midfield` modulator − weighted `defense`+`goalkeeping`
> resistance), the chance budget is raised so `Binomial(n, λ/n)` is
> genuinely Poisson-like at WC scale, the fitted tuple was found by a
> deterministic seeded coordinate search (D6), the faithfulness suite (D4)
> asserts monotonicity / elite-ceiling / dominance-not-certainty /
> legibility / no-inversion, and the realism harnesses report
> (symmetric: golden-locked / asymmetric draft-reachable: report-only).
> Every constant lives in
> [`src/engine/calibration.ts`](src/engine/calibration.ts) and is locked by
> golden fixtures.
>
> **ENGINE_VERSION POLICY (E-3a → resolved at season merge)**: changes to
> `LAMBDA` / `CHANCES` / `CHANCE_OUTCOME` normally require an
> `engine_version` bump. E-3a + E-4 + MV2-11b each moved the constants and
> re-locked the impacted goldens within their integration branches while
> `engine_version` deferred (E-3a / E-4 stayed `engine-2026.06.04`). The
> season merge landed the cumulative bump in one atomic step:
> `engine-2026.06.04 → engine-2026.06.09` (pinned by
> `packages/data/test/compact-data.integrity.test.ts`).

## Decoupling guards (ws-core/decoupling-guards)

Two display-channel ↔ sim coupling risks were surfaced by the season-merge
gate-2 adversarial review and disarmed on the `ws-core/decoupling-guards`
branch. Both are tripwires — they preserve current behaviour but make a
future regression turn red loudly.

1. **Manager modifier no longer reads `ManagerRating.overall`.** The
   `managerModifier()` fold in `engine/team-strength.ts` is now EXPLICITLY
   identity (returns 1.0 for every input). `ManagerRating.overall` is
   display-only — the type contract says "the sim MUST NOT read this
   field." When a sim-legal manager field is defined, wire that field
   here; do NOT re-introduce the display-overall read. Locked by
   `src/manager-modifier-decoupling.guard.test.ts` (static scan + functional
   identity assertion).

2. **Strategic-draft tie ordering invalidates the realism lock.** The
   `pickBest` helper in `packages/data/test/realism/draft-policies.ts`
   breaks `strategicAutoDraft` ties by `overall` DESC then `card_id` ASC.
   `overall` is the display-only Rating composite (`core/src/types/rating.ts`:
   "the sim engine MUST NOT read this field"). The harness sits UNDER the
   λ-calibration chain — any future change to the display `overall` curve
   (rescaling, post-fit normalisation, stature-driven pooled curve, etc.)
   can flip a tie ordering, re-order the strategic pick sequence, shift the
   realism landings, and silently invalidate the λ fit basis (the
   `realism.gate.test.ts` Wilson bands re-base WITH the landings on re-lock,
   so they do not catch the flip). The tiebreak is INTENTIONALLY left
   unchanged: any pick-flip drifts the locked realism landings and
   invalidates the λ basis. Instead,
   `packages/data/test/realism/strategic-pick-canary.golden.test.ts` locks
   the exact strategic-draft pick sequence for the first 5 seeds of the
   realism harness. **A display-curve change that flips even one tie
   ordering trips this canary and REQUIRES atomic re-lock against a fresh
   realism re-fit.**

## Determinism

The engine is pure + seeded (cyrb128 + sfc32 via `createRng` / `deriveSubseed`).
No `Date` / `Math.random` / `crypto` / `performance`. **No transcendental math**
(`exp` / `log` / fractional `pow`): λ is a clamped LINEAR map and goal counts
are drawn as a **binomial over a fixed chance budget** (rational arithmetic
only), never a Knuth-Poisson sampler (which would need `exp(-λ)`). Substreams
(`match_sim` / `event_gen` / `opponent_selection` / `narrative`) are all
derived from the run seed via `deriveSubseed`. Sampling pools are canonically
sorted before any draw.

## Expected goals (λ) — E-3a four-channel form

```
defResist_against = clamp_int( W_DEF·defenseAgainst + W_GK·goalkeepingAgainst )
control_for       = clamp( 1 + GAMMA_MID·(midfieldFor − midfieldAgainst)/100,
                           CONTROL_BAND_LO, CONTROL_BAND_HI )
λ_for             = clamp( BASE + SPREAD·(attackFor − defResist_against)/100,
                           MIN, MAX )  ·  control_for
```

| Constant | Pre-E3a | E-3a (initial) | E-3a REFIT | MV2-11b | **merit-v4 (`engine-2026.06.13-merit-v4`)** | Why (merit-v4) |
|---|---|---|---|---|---|---|
| `LAMBDA.BASE` | 1.25 | 0.85 | 0.85 | 1.0 | **1.10** | raised from V8 1.05 to restore mean goals under the merit-v4 channel distribution |
| `LAMBDA.SPREAD` | 4.0 | 4.0 | 6.5 | 7.0 | **6.0** | lowered from V8 6.5; margin>=4 stays in band with the higher BASE |
| `LAMBDA.MIN` | 0.30 | 0.75 | 0.40 | 0.40 | **0.30** | returned to the pre-E3a floor after BASE/SPREAD refit; symmetric and asymmetric gates stay green |
| `LAMBDA.MAX` | 3.40 | 3.40 | 3.40 | 3.40 | 3.40 | unchanged |
| `LAMBDA.W_DEF` | — | 0.65 | 0.70 | 0.70 | 0.70 | unchanged |
| `LAMBDA.W_GK` | — | 0.35 | 0.30 | 0.30 | 0.30 | unchanged (W_GK + W_DEF ≡ 1) |
| `LAMBDA.GAMMA_MID` | — | 0.45 | 0.50 | 0.60 | **0.80** | unchanged from V8 |
| `LAMBDA.CONTROL_BAND_LO/HI` | — | 0.85 / 1.15 | 0.85 / 1.15 | 0.85 / 1.15 | 0.85 / 1.15 | unchanged — bounded multiplier still amplifies, never replaces |
| `LAMBDA.ET_FRACTION` | 30/90 | 30/90 | 30/90 | 30/90 | 30/90 | unchanged |
| `LAMBDA.KO_LAMBDA_FACTOR` | — | — | 0.85 | 0.82 | 0.82 | unchanged from MV2-11b |
| `CHANCES.REGULATION` | 14 | 50 | 50 | 50 | 50 | unchanged |
| `CHANCES.EXTRA_TIME` | 5 | 17 | 17 | 17 | 17 | unchanged |
| `CHANCE_OUTCOME.SAVED_SHARE` | 0.26 | 0.10 | 0.10 | 0.10 | 0.10 | unchanged |
| `CHANCE_OUTCOME.OFF_TARGET_SHARE` | 0.22 | 0.14 | 0.14 | 0.14 | 0.14 | unchanged |
| `CHANCE_OUTCOME.FOUL_SHARE` | 0.16 | 0.22 | 0.22 | 0.22 | 0.22 | unchanged |
| `CHANCE_OUTCOME.OFFSIDE_SHARE` | 0.08 | 0.04 | 0.04 | 0.04 | 0.04 | unchanged |
| `LAMBDA_DISP.OUTER_PROB` | — | — | 0.20 | 0.20 | 0.20 | unchanged |
| `LAMBDA_DISP.A` | — | — | 0.75 | 0.75 | 0.75 | unchanged |
| `LAMBDA_DISP.GROUP_OUTER_PROB` | — | — | 0.10 | 0.10 | 0.10 | unchanged |
| `LAMBDA_DISP.GROUP_A` | — | — | 0.50 | 0.50 | 0.50 | unchanged |

## E-3a REFIT (current) — match-level λ dispersion (D1 path)

E-3a INITIAL pure-Poisson scoring was Pareto-limited against the D5-tight
bands:
- at λ_per_side ≈ 1.27 (the mean-goals norm), the maximum tie rate is ≈ 24.6%
  while the modern-era KO → ET norm is 33% and shootout 21.4% — no four-channel
  λ + chance-budget grid can clear `mean_goals ≈ 2.54` AND `KO → ET ≈ 33%`
  simultaneously;
- `group_draw` and `KO → ET` measure the SAME statistic (matches tied after 90′)
  on the SAME team population in the symmetric coherent-XI sweep, so the
  modern-era norms (24.7% group, 33% KO) cannot BOTH be hit without a
  PHASE-DEPENDENT driver.

The E-3a REFIT resolves both walls with two new mechanisms (both
transcendental-free; cross-platform determinism preserved):

1. **`LAMBDA.KO_LAMBDA_FACTOR`** (= 0.85) — multiplicative λ reduction applied
   to BOTH sides in KO regulation. Models the well-documented modern-WC fact
   that knockout matches run ~10–15% below group-stage scoring rates (more
   tactical, more cagey). Faithfulness preserved because the favourite/underdog
   ordering is scaled by the SAME factor.
2. **`LAMBDA_DISP` — phase-specific 3-point dispersion** — each match draws
   ONE seeded ε ∈ {1−A, 1, 1+A} (a discrete distribution, mean exactly 1,
   integer/rational arithmetic only). The (`OUTER_PROB`, `A`) pair is
   PHASE-DEPENDENT: KO uses a strong dispersion (0.20, 0.75) → lifts KO →
   ET and shootout rates; group uses a sparse, wider dispersion (0.10, 0.50)
   → lifts `margin ≥ 4` into band without pushing `group_draw` past its
   tight upper edge. Mean(ε) = 1 by construction so mean goals/match is
   preserved within each phase.

D5-tight bands now committed in `realism-modern-norms.golden.test.ts`
(replacing the pre-refit loose bands). The refit lands all 5 metrics
STRICTLY INSIDE these tight bands; the gate is no longer toothless.

**Why the four-channel form**: the E-2-era map keyed only on `attackFor`
vs `defenseAgainst`. After Phase 1 the channels compress onto `[66, 99]`,
so a single (att − def) edge collapses favourite/underdog separation when
either side has a weak GK or midfield. The four-channel form makes ALL
FOUR channels (and Synergy, via the bounded multiplier already folded into
`TeamStrength` upstream) legible drivers of λ.

**D3 — GK stays emergent**: a weak GK channel lowers `defResist` and the
attacker's λ rises automatically through the same surface as the defense
channel. There is NO opaque "missing GK" penalty in the engine. The
`position_compatibility` fold + `fieldable_floor` (and soft no-GK warning
upstream) are unchanged.

## D6 fit (deterministic coord descent)

`packages/data/scripts/fit-calibration.mjs` runs a seeded coordinate
descent on the symmetric Team2026-vs-Team2026 sweep (the same population
the existing `realism-modern-norms.golden.test.ts` measures). V7 used
3 passes, 175 evaluations, and 3,006 matches per evaluation after extending
the grids away from edge landings; the schedule + grids are pinned, so the
winner is reproducible.

| Norm | Modern-WC target | D5-tight band | E-3a initial landing | E-3a REFIT landing | **merit-v3 V7 landing** |
|---|---|---|---|---|---|
| goals / game           | 2.54  | [2.478, 2.594]  | 2.40 (Δ −0.13, FAIL ↓)        | 2.534 (Δ −0.006, ✓ near centre) | **2.534 (Δ −0.001, ✓)** |
| group draw %           | 24.7  | [22.88%, 26.52%] | 26.4 (Δ +1.7pp, ✓ narrow)     | 25.84% (Δ +1.14pp, ✓)           | **25.18% (Δ +0.48pp, ✓)** |
| margin ≥ 4 %           | 4.9   | [4.12%, 5.70%]   | 2.93 (Δ −2.0pp, FAIL ↓)       | 4.72% (Δ −0.18pp, ✓)            | **4.96% (Δ +0.05pp, ✓)** |
| KO → ET %              | 33.0  | [29.61%, 36.48%] | 29.6 (Δ −3.4pp, FAIL ↓)       | 33.60% (Δ +0.60pp, ✓)           | **33.47% (Δ +0.43pp, ✓)** |
| shootout %             | 21.4  | [18.43%, 24.43%] | 15.7 (Δ −5.7pp, FAIL ↓)       | 22.93% (Δ +1.53pp, ✓)           | **21.33% (Δ −0.10pp, ✓)** |

All 5 symmetric realism norms land STRICTLY INSIDE the D5-tight bands —
the realism gate is no longer toothless. Faithfulness (`packages/core/src/faithfulness.test.ts`,
11 ensembles) still passes 11/11 — bounded ε ∈ [1−A, 1+A] and KO_LAMBDA_FACTOR
applied to BOTH sides preserve monotonicity, elite-ceiling, and dominance-
not-certainty. Determinism preserved: `lambdaDispersionMultiplier` consumes
EXACTLY ONE `structRng.next()` call per match (always; the value is gated
by phase, the draw is not), and the discrete 3-point distribution is encoded
with rational thresholds — no transcendental math anywhere.

## Faithfulness suite (D4)

`packages/core/src/faithfulness.test.ts` — 11 deterministic seeded
ensembles asserting:
- **Determinism**: same (strengths, K, seedLabel) → same summary.
- **Monotonicity**: bumping `attack` / `midfield` / `defense` /
  `goalkeeping` by 15 weakly raises win-rate (each channel asserted
  separately).
- **Elite ceiling**: 99/99/99/99 vs 50/50/50/50 in knockouts wins ≥85%
  but < 100% (variance preserved). In groups, maxGoalsFor ≥ 6 and
  margin-≥4 wins occur at > 10% — the elite ceiling is legible in the
  box score, not just W/L.
- **Dominance-not-certainty**: 85/85/85/85 vs 60/60/60/60 in groups
  wins ≥ 65% but < 95%.
- **Legibility (att/def split)**: a 95-attack/50-defense XI both scores
  AND concedes more than a balanced one.
- **Legibility (GK — D3 emergent path)**: dropping GK from 80 to 50
  raises mean goals-against by > 0.05 (meaningful, not noise).
- **No-inversion**: 60/60/60/60 vs 85/85/85/85 wins ≤ 25% (variance
  floor — never 0).

## Realism gates (D5)

Two harnesses, complementary:

1. **Symmetric (existing, hard gate)** —
   `packages/data/test/realism-modern-norms.golden.test.ts`. A 3,006-match
   Team2026-vs-Team2026 sweep against modern-era WC norms. Locked bands
   that catch any engine regression. Updated `it()` titles for V7
   landings; all 5 norms pass.

2. **Asymmetric (E-3b — PASS GATE on a COMPETENT user population)** —
   `packages/data/test/realism/realism.gate.test.ts`. N=2000 drafted user
   XIs vs the projected-2026 `Team2026[]` opponents, MEASURED OVER the
   `strategicAutoDraft` slot-fit best-available policy in
   `packages/data/test/realism/draft-policies.ts` (test-only — the
   production `autoDraft` is UNCHANGED). Landings are locked in
   `packages/data/test/realism/asym-realism-golden.json`.

   ```
   [REALISM] ── policy=strategicAutoDraft       qualifying=1611/2000 matches=9965 groups=6000 KO=3965
   [REALISM]    ✓ goals/game     obs=   2.586  (lower floor 2.52)
   [REALISM]    ✓ draw% (group)  obs=  25.28%  band 25.28% ± 1.50%
   [REALISM]    ✓ margin≥4%      obs=   4.64%  band  4.64% ± 1.50%
   [REALISM]    ✓ KO→ET%         obs=  32.41%  band 32.41% ± 1.50%
   [REALISM]    ✓ shootout%      obs=  19.87%  band 19.87% ± 1.50%
   ```

   **Gate mechanism (durable infrastructure).**
   - **Population.** `strategicAutoDraft` — for each spin, scan
     `rolled_card_ids` and pick max of
     `positionCompatibility(eligible, slot_position) × rating[channel_for_slot]`
     (tiebreak: `overall` DESC, `card_id` ASC). Manager-first / first-vacant
     slot order is unchanged from canonical `autoDraft`. This is the
     realistic proxy for a COMPETENT human draft; canonical `autoDraft`
     stays a determinism fixture, NOT a user-behavior proxy.
   - **Shape bands (TIGHT).** The 4 shape norms (draw% / margin≥4% / KO→ET%
     / shootout%) are gated as Wilson-style half-widths AROUND the
     strategic landings. Half-widths include a variance floor (≥ 1.5pp for
     match-denominator metrics; ≥ 4–5pp for KO-only metrics) so the gate
     isn't brittle to engine output noise but red-flags any meaningful
     drift.
   - **One-sided lower floor on goals/game.** Total goal volume
     legitimately tracks the underdog gap (strategic XI is ~10–13 channel
     points below the 2026 coherent-elite opponent mean) and there is no
     real-world ceiling, so the gate only enforces a LOWER floor (2.40)
     and lets goals/game drift up without false alarms.
   - **`greedyOverallAutoDraft` CI guard.** A position-blind max-overall
     drafter is the NEGATIVE CONTROL: the gate ASSERTS it lands OUTSIDE
     every shape band, so nobody can "fix" realism by maxing OVR. Competent
     must mean slot-fit-aware.
   - **Telemetry.** The harness logs per-policy XI channel means + Synergy
     multiplier + manager modifier for every run — so a future regression's
     direction (population gap moved? Synergy folded differently?) is
     visible in the CI log without re-running the measurement.
   - **N sizing.** N=2000 targets a 95% Wilson half-width ≤ ~4pp on the
     KO-derived metrics (KO→ET, shootout); observed half-widths land at
     3.89pp / 3.38pp. Overriding `WCDRAFT_REALISM_N` below the locked
     value will widen the KO bands above the gate tolerance and (correctly)
     red the gate — the small-N problem surfaces instead of silently
     widening tolerance.

   **E-3b investigation provenance.** The pre-E-3b landing (11/200
   qualifying, 16.64% margin≥4, 0% KO→ET) was a harness population
   artifact — canonical `autoDraft` is canonical-first, so the population
   was coherent-elite vs random-history. `docs/investigations/engine-v2-asymmetric-realism-2026-06-07.md`
   quantifies the artifact end-to-end (Angle 1 strategic vs canonical;
   Angle 2 rating distribution parity; Angle 3 SPREAD amplification).

   **E-4 re-lock policy.** When E-4 (rating-stature) lands, λ and the
   strategic landings shift. Re-run the measurement at the same
   `(N, seed_prefix, formation_id)`, copy the new landings + Wilson
   half-widths into `asym-realism-golden.json`, and commit the band update
   ATOMICALLY with the engine-output change. The gate MECHANISM
   (strategicAutoDraft + raised N + greedyOverall guard + shape bands +
   lower-floor goals + per-policy telemetry) is the DURABLE infrastructure
   E-4's realism re-fit measures against; only the NUMBERS move.

## Knockout tie resolution (unchanged)

ET when a knockout is level after 90; penalties when still level after ET.
Shootout: best-of-five + sudden death, conversion `BASE_CONVERT_PROB = 0.75`
confined to a **variance floor band** `±CONVERT_BAND (0.10)` regardless of
how lopsided the teams are — the "favourites can still lose" guarantee.

## Injuries / substitutions / forfeit (unchanged)

0–2 injury events per match (`PRIMARY_INJURY_PROB 0.5`, `SECOND_INJURY_PROB
0.2`); each is tournament-ending with `TOURNAMENT_ENDING_PROB 0.34` and then
persists out of every later match lineup for the run. Position-aware bench
subs from the 5-bench (reset each match). Below `FIELDABLE_FLOOR = 7`
available players → forfeit (0–3 walkover) — a safety valve.

## Synergy + team-strength fold (unchanged formula)

`team_channel = clamp_int( mean_11(rating[ch] × position_compatibility) ×
synergy.multiplier × manager_modifier )`

- **position compatibility** — MAX-of-eligibles fold over
  `POSITION_COMPATIBILITY_FACTORS` (same line 1.0, one-off ≈0.75, two-off
  ≈0.45, GK↔outfield ≈0.15).
- **Synergy** components: nation clusters (starters only), linked pairs (per
  formation adjacency edge), manager link. Weights `0.45 / 0.40 / 0.15`.
- **Bounded multipliers**: `synergy.multiplier ∈ [1, 1 + 0.12]`; manager
  modifier `∈ [1 − 0.10, 1 + 0.10]` (null manager → exactly 1.0). The bound
  is the "Synergy amplifies, never replaces talent" guarantee.

The aggregator is unchanged; only the channel inputs are now on the
compressed display band. The four-channel λ form makes the Synergy
amplification visible in all four channels rather than only `attack` and
`defense`.

## Scoring config (`DEFAULT_SCORING_CONFIG`) — unchanged

Integer weights keep `points = raw × weight` exact so `score = Σ points`
holds byte-for-byte. See table in `calibration.ts`.

## Golden lock — sim/realism artifacts

| Fixture | Why it moved | Regenerator |
|---|---|---|
| `packages/core/test/fixtures/sim-golden.json` | every scoreline/event/score is downstream of λ + n | `pnpm --filter @wcdraft/core run gen:sim-golden` |
| `packages/data/test/fixtures/e2e-real-run-golden.json` | real-data run is downstream of the same | `pnpm --filter @wcdraft/data run gen:e2e-golden` |
| `packages/data/test/realism-modern-norms.golden.test.ts` (Δ labels) | landings shift; bands still cover | hand-edit `it()` titles |

For merit-v3 V7, `sim-golden.json`, `realism-modern-norms.golden.test.ts`, and
`asym-realism-golden.json` re-lock. `e2e-real-run-golden.json` stayed green
against the new tuple and was not regenerated. Runtime manifest, leaderboard
season key, and stamp-carrying compact anchors remain V8 work.

Unaffected (no regen): `synergy.golden`, `scenario.golden`, `narrative.golden`,
`opponent-selection.golden`, `top-scorer.golden`, `draft.golden`,
`group-stage.golden`, `compact-data.golden`, `compact-data.integrity` (still
pins `engine-2026.06.04`).

## Public signatures — sim + Synergy (unchanged)

- `runTournament(draft, scenario, seed, world)` → REQUIRED `world: SimWorld`.
- `computeSynergy(squad, formation, manager, nationByCardId?)` → optional
  4th `nationByCardId`.
- `simulateMatchCore`, `membersFromTeam2026` — public sim primitives for
  realism harnesses (`@wcdraft/data` test/realism-modern-norms.golden.test.ts).
- **E-3a additions** (offline tooling only — DO NOT call from production):
  `__UNSAFE_setCalibrationOverride` / `__UNSAFE_clearCalibrationOverride` —
  thread-local swap of `LAMBDA` + `CHANCES` for the D6 fit script. Default
  state is byte-identical to the frozen exports; goldens lock the
  no-override path.

## Engine-v2 series — deferred `engine_version` bump ledger

The `engine-v2` integration branch follows a **deferred-bump policy**: sub-unit
PRs change deterministic engine output (draft, synergy, sim, calibration)
without bumping `engine_version`. The single bump + cumulative golden re-lock
+ client/DB version-skew handling happen **atomically at the
`engine-v2` → `main` season merge**, not per sub-unit. This matches the
pre-existing policy already in force above for the Phase 1 decoupled rating
recalibration (which also stayed at `engine-2026.06.04`).

Why it's safe in dev: `engine-v2` does not deploy. No live client carries any
intermediate anchor between the current `main` and the eventual
`engine-v2` → `main` merge, so the `versionsAgree` / `purgeStale` /
leaderboard-season gates have nothing to enforce *within* the series. At the
season-merge moment the bump invalidates every outstanding `main`-anchored
token / RunRecord / leaderboard season in one stroke.

Within-branch fixture consistency is preserved: every sub-unit re-locks its
own draft / sim / e2e goldens against the branch state of the moment, so the
test suite remains byte-deterministic at every commit in the series.

| Sub-unit | Engine output change | Goldens re-locked here | `engine_version` |
|---|---|---|---|
| **E-2 — nation-only synergy + rare UI** (squashed `74bb90c`) | Synergy moved from manager-driven to nation-only; rare-spin UI surfaced | synergy + draft (selectively) | not bumped |
| **E-3a — λ calibration** (queued on `engine-v2-e3a-lambda-calibration`) | `LAMBDA.{BASE,SPREAD,MIN,MAX}` shifted toward realism-control bands | sim + e2e | not bumped |
| **E-1b — pre-1998 era mass 15% → 10%** (this PR #37) | `RARE_ERA_MASS 0.15 → 0.10`, modern (T,N) per-pair probs × 1.0588 | draft + e2e | not bumped |
| **E-3b — asymmetric realism gate (test-harness only)** | NONE (no engine bytes change — `sim-golden.json` byte-identical, `engine_version` unchanged) | asym-realism golden landings + shape bands (new fixture) | not bumped |

Codex review of PR #37 correctly reproduced the cross-engine-state replay
failure (`pickPlayer: card P-04469:2010 is not a candidate on spin 2` when an
old `:23`-anchored pick log is replayed under the new engine constants) and
flagged the missing bump as a structural blocker. That blocker is real **in
absolute terms** and is the exact failure mode the season-merge bump is
designed to invalidate atomically. It is **unreachable in production** during
the engine-v2 dev phase because no `engine-v2`-anchored token exists outside
this branch.

If any sub-unit ever needs to ship to production before the season merge
(e.g. a hotfix backport to `main`), it MUST bump `engine_version` and
re-lock the public-data manifests, ignoring the deferred-bump policy.
