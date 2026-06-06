# WS-B Sim + Scoring — Calibration

> **Phase 1 rating recalibration landed (wc-perf-2.0.0 / proj-career-2.0.0):**
> the rating display curve compresses sim channels onto the display band
> `[66, 99]`, and the λ constants below were retuned to keep WC-like
> scoreline distributions believable on that compressed scale. The **recoupled
> path landed** — the display curve drives both `overall` AND the four sim
> channels; display-only decoupling was NOT used. All OTHER constants
> (chance budget, incidents, injuries, shootout band, scoring, synergy,
> manager modifier) remain at the pre-Phase-1 first-cut values and are a
> flagged follow-on. Every value lives in
> [`src/engine/calibration.ts`](src/engine/calibration.ts) and is locked by
> golden fixtures — changing any of them moves a golden `RunResult` byte and
> therefore **requires an `engine_version` bump**. Phase 1 bumped
> `engine-2026.06.04` → `engine-2026.06.06`.

## Determinism

The engine is pure + seeded (cyrb128 + sfc32 via `createRng` / `deriveSubseed`).
No `Date` / `Math.random` / `crypto` / `performance`. **No transcendental math**
(`exp` / `log` / fractional `pow`): λ is a clamped LINEAR map and goal counts
are drawn as a **binomial over a fixed chance budget** (rational arithmetic
only), never a Knuth-Poisson sampler (which would need `exp(-λ)`). Substreams
(`match_sim` / `event_gen` / `opponent_selection` / `narrative`) are all
derived from the run seed via `deriveSubseed`. Sampling pools are canonically
sorted before any draw.

## Expected goals (λ) — Phase 1 retune

`λ_for = clamp(BASE + SPREAD · (attackFor − defenseAgainst)/100, MIN, MAX)`

| Constant | Old (pre-Phase 1) | **Phase 1 (current)** |
|---|---|---|
| `LAMBDA.BASE` | 1.3 | **1.25** |
| `LAMBDA.SPREAD` | 1.7 | **4.0** |
| `LAMBDA.MIN` | 0.25 | **0.30** |
| `LAMBDA.MAX` | 3.6 | **3.40** |
| `LAMBDA.ET_FRACTION` | 30/90 | 30/90 (unchanged) |

### Why these values

After Phase 1 the channel range compresses from `[0, 100]` (effective) onto
`[66, 99]` — the max channel delta `(attackFor − defenseAgainst)` is bounded
by `~33` rather than `~100`. The old `SPREAD = 1.7` produced a maximum λ
swing of `±1.7` across the full historical scale; that same coefficient on
the compressed scale would only swing `±0.56`, collapsing favourite/underdog
separation into draws.

- `BASE = 1.25` keeps an evenly-matched expected total near 2.5 goals per
  match (the WC historical mean).
- `SPREAD = 4.0` restores favourite/underdog separation on the compressed
  scale: the per-channel-point lambda response is lifted in proportion to the
  range compression.
- `MIN = 0.30` keeps even outmatched attacks alive (a meaningful underdog
  upset rate).
- `MAX = 3.40` bounds blowouts and keeps the per-chance probability
  `λ / chances` comfortably below `CHANCES.MAX_GOAL_PROB`.

Goals ~ `Binomial(chances, λ/chances)` → mean = λ. Chance budget:
`CHANCES.REGULATION = 14`, `CHANCES.EXTRA_TIME = 5`, per-chance goal prob
capped at `0.6`. Non-goal chances split into saved shot / off-target / foul /
offside / open play (`CHANCE_OUTCOME` shares), sourcing the full box score.

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

## Synergy + team-strength fold (unchanged, but on the new channel scale)

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
compressed display band. This is intentional — Synergy was always tuned as
percentages-of-team-channels, not absolute amounts, so the bounded
multipliers behave consistently on either scale.

## Scoring config (`DEFAULT_SCORING_CONFIG`) — unchanged

Integer weights keep `points = raw × weight` exact so `score = Σ points`
holds byte-for-byte. See table in `calibration.ts`.

## Golden lock

`test/fixtures/sim-golden.json` pins the `RunResult` for five characteristic
scenarios — **blowout / upset / draw-into-pens / injury-cascade /
group-elimination** — found by `scripts/generate-sim-golden.ts`. Regenerate
via `pnpm --filter @wcdraft/core run gen:sim-golden`. Identical
`(squad, scenario, seed, version anchors)` → byte-identical `RunResult`
(incl. score, `PlayerRunStats`, event-derived top scorer, narrative seed).

The Phase 1 landing regenerated this golden together with
`packages/data/test/fixtures/e2e-real-run-golden.json`.

## Public signatures — sim + Synergy (unchanged)

- `runTournament(draft, scenario, seed, world)` → REQUIRED `world: SimWorld`
  (user ratings + `Team2026` opponents + optional manager rating / per-card
  nation / scoring config / `Bracket2026`). `runTournamentFull(...)` is the
  event-bearing entry returning `{ run, matches }`. `SimWorld` lives in
  `src/types/sim.ts` and is exported from the top-level barrel.
- `computeSynergy(squad, formation, manager, nationByCardId?)` → optional
  4th `nationByCardId` (a `SquadSlot` carries no nation). Absent ⇒ no
  clusters / no links (honest-state: an unknown nation cannot manufacture
  Synergy).
