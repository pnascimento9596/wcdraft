# WS-B Sim + Scoring — Calibration

> **E-3a (engine-v2) landed** — the λ map is now a four-channel form
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
> **ENGINE_VERSION POLICY (E-3a)**: changes to `LAMBDA` / `CHANCES` /
> `CHANCE_OUTCOME` normally require an `engine_version` bump. E-3a
> **defers** that bump to the season merge — the constants change and the
> impacted goldens (`sim-golden.json`, `e2e-real-run-golden.json`) are
> re-locked on the `engine-v2-e3a-lambda-calibration` branch, but
> `engine_version` stays `engine-2026.06.04` (pinned by
> `packages/data/test/compact-data.integrity.test.ts`). This is the only
> sanctioned exception; it is locked to the engine-v2 chain.

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

| Constant | Pre-E3a | **E-3a (current)** | Why |
|---|---|---|---|
| `LAMBDA.BASE` | 1.25 | **0.85** | n=50 → much less per-match noise → lower BASE keeps mean goals/match near 2.54 |
| `LAMBDA.SPREAD` | 4.0 | 4.0 | unchanged |
| `LAMBDA.MIN` | 0.30 | **0.75** | raised — keeps underdogs credible after BASE drop |
| `LAMBDA.MAX` | 3.40 | 3.40 | unchanged |
| `LAMBDA.W_DEF` | — | **0.65** | new — DEFENSE share of `defResist` |
| `LAMBDA.W_GK` | — | **0.35** | new — GOALKEEPING share of `defResist` (W_DEF + W_GK ≡ 1) |
| `LAMBDA.GAMMA_MID` | — | **0.45** | new — midfield `control_for` sensitivity |
| `LAMBDA.CONTROL_BAND_LO/HI` | — | 0.85 / 1.15 | bounded multiplier — midfield amplifies, never replaces |
| `LAMBDA.ET_FRACTION` | 30/90 | 30/90 | unchanged |
| `CHANCES.REGULATION` | 14 | **50** | raised so Binomial→Poisson; MAX_GOAL_PROB cap stops binding |
| `CHANCES.EXTRA_TIME` | 5 | **17** | scaled by ET_FRACTION |
| `CHANCE_OUTCOME.SAVED_SHARE` | 0.26 | **0.10** | re-normalized for n=50 |
| `CHANCE_OUTCOME.OFF_TARGET_SHARE` | 0.22 | **0.14** | re-normalized for n=50 |
| `CHANCE_OUTCOME.FOUL_SHARE` | 0.16 | **0.22** | re-normalized for n=50 |
| `CHANCE_OUTCOME.OFFSIDE_SHARE` | 0.08 | **0.04** | re-normalized for n=50 |

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
the existing `realism-modern-norms.golden.test.ts` measures). 2 passes ×
~30 evaluations × ~3,006 matches per evaluation = ~3 min wall-clock; the
schedule + grids are pinned, so the winner is reproducible.

| Norm | Target | Pre-fit (E-3a seed) | **Fit landing** | Pre-E2 baseline (origin/engine-v2) |
|---|---|---|---|---|
| goals / game | 2.54 | 3.05 | **2.40** (Δ −0.13) | 2.44 (Δ −0.10) |
| group draw % | 24.7 | 24.40 | **26.4** (Δ +1.7pp) | 28.7 (Δ +4.0pp) |
| margin ≥ 4 % | 4.9 | 5.66 | **2.93** (Δ −2.0pp) | 2.30 (Δ −2.6pp) |
| KO → ET % | 33 | 11.04 | **29.6** (Δ −3.4pp) | 28.5 (Δ −4.5pp) |
| shootout % | 21.4 | 11.03 | **15.7** (Δ −5.7pp) | 14.3 (Δ −7.1pp) |

Every fitted norm lands STRICTLY INSIDE the existing bands committed to
`realism-modern-norms.golden.test.ts` AND inside each test's `|delta|<X`
sanity cap. So the symmetric realism gate continues to pass with the new
constants — only the per-test `it()` titles were updated to reflect the
new Δ landings.

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
   that catch any engine regression. Updated `it()` titles for E-3a
   landings; all 5 norms pass.

2. **Asymmetric (new, REPORT-ONLY)** —
   `packages/data/test/realism/realism.gate.test.ts`. N=200 auto-drafted
   user XIs (via `autoDraft` over the era-weighted draft-reachable
   `DRAFT_POOL_BUNDLE`, which folds in the E-1 era weighting +
   with-replacement + rare exposure sampling) vs the real projected-2026
   `Team2026[]` opponents. Logs `[REALISM] obs / tgt / band` lines, never
   fails by default. Hard-pass with `WCDRAFT_REALISM_GATE=pass`.

   Latest landing (N=200, fitted tuple):

   ```
   [REALISM] N_runs=200 qualifying=11/200 matches=613 groups=600 KO=13
   [REALISM] ✗ goals/game     obs=3.075 tgt=2.540
   [REALISM] ✗ draw% (group)  obs=14.83% tgt=24.70%
   [REALISM] ✗ margin≥4%      obs=16.64% tgt=4.90%
   [REALISM] ✗ KO→ET%         obs=0.00% tgt=33.00%
   [REALISM] ✓ shootout%      obs=0.00% tgt=21.40%
   ```

   The structural gap (only 11/200 auto-drafts qualify, blowouts at
   17%) reflects an HONEST property of the auto-drafted population:
   era-weighted random draws are systematically weaker than the
   projected-elite 2026 opponents. Calibration cannot close this gap
   without distorting the symmetric (true-WC-norms) gate. The harness
   exists as TELEMETRY for player-experience tuning (e.g. the upstream
   draft helper, manager modifier, Synergy bonus), not as a tournament
   realism check. Flip to PASS gate only after the draft / Synergy /
   manager amplification work explicitly targets this distribution.

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

## Golden lock — E-3a re-locked artifacts

| Fixture | Why it moved | Regenerator |
|---|---|---|
| `packages/core/test/fixtures/sim-golden.json` | every scoreline/event/score is downstream of λ + n | `pnpm --filter @wcdraft/core run gen:sim-golden` |
| `packages/data/test/fixtures/e2e-real-run-golden.json` | real-data run is downstream of the same | `pnpm --filter @wcdraft/data run gen:e2e-golden` |
| `packages/data/test/realism-modern-norms.golden.test.ts` (Δ labels) | landings shift; bands still cover | hand-edit `it()` titles |

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
