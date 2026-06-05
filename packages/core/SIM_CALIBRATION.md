# WS-B Sim + Scoring — Calibration

> **CALIBRATION: tune vs historical scorelines.** Every constant below is a
> plausible FIRST CUT, not yet fitted to a historical World-Cup scoreline
> distribution. Fitting λ / weights / probabilities against real WC data is a
> **flagged follow-on lane**, not this PR. All values live in
> [`src/engine/calibration.ts`](src/engine/calibration.ts) and are **locked by
> golden fixtures** — changing any of them moves a golden `RunResult` byte and
> therefore **requires an `engine_version` bump**.

## Determinism

The engine is pure + seeded (cyrb128 + sfc32 via `createRng` / `deriveSubseed`).
No `Date` / `Math.random` / `crypto` / `performance`. **No transcendental math**
(`exp` / `log` / fractional `pow`): λ is a clamped LINEAR map and goal counts are
drawn as a **binomial over a fixed chance budget** (rational arithmetic only),
never a Knuth-Poisson sampler (which would need `exp(-λ)`). Substreams
(`match_sim` / `event_gen` / `opponent_selection` / `narrative`) are all derived
from the run seed via `deriveSubseed`. Sampling pools (scorer pool, shootout
taker order, opponent pool) are canonically sorted before any draw.

## Expected goals (λ)

`λ_for = clamp(BASE + SPREAD · (attackFor − defenseAgainst)/100, MIN, MAX)`

| Constant | Value |
|---|---|
| `LAMBDA.BASE` | 1.3 |
| `LAMBDA.SPREAD` | 1.7 |
| `LAMBDA.MIN` / `MAX` | 0.25 / 3.6 |
| `LAMBDA.ET_FRACTION` | 30/90 |

Goals ~ `Binomial(chances, λ/chances)` → mean = λ. Chance budget:
`CHANCES.REGULATION = 14`, `CHANCES.EXTRA_TIME = 5`, per-chance goal prob capped
at `0.6`. Non-goal chances split into saved shot / off-target / foul / offside /
open play (`CHANCE_OUTCOME` shares), sourcing the full box score.

## Knockout tie resolution

ET when a knockout is level after 90; penalties when still level after ET.
Shootout: best-of-five + sudden death, conversion `BASE_CONVERT_PROB = 0.75`
confined to a **variance floor band** `±CONVERT_BAND (0.10)` regardless of how
lopsided the teams are — **the "favourites can still lose" guarantee**.

## Injuries / substitutions / forfeit

0–2 injury events per match (`PRIMARY_INJURY_PROB 0.5`, `SECOND_INJURY_PROB 0.2`);
each is tournament-ending with `TOURNAMENT_ENDING_PROB 0.34` and then **persists
out of every later match lineup** for the run. Position-aware bench subs from the
5-bench (reset each match). Below `FIELDABLE_FLOOR = 7` available players → forfeit
(0–3 walkover) — a safety valve.

## Synergy + team-strength fold (bounded)

`team_channel = clamp_int( mean_11(rating[ch] × position_compatibility) ×
synergy.multiplier × manager_modifier )`

- **position compatibility** — MAX-of-eligibles fold over
  `POSITION_COMPATIBILITY_FACTORS` (same line 1.0, one-off ≈0.75, two-off ≈0.45,
  GK↔outfield ≈0.15).
- **Synergy** components: nation clusters (starters only), linked pairs (per
  formation adjacency edge), manager link. Weights `0.45 / 0.40 / 0.15`.
- **Bounded multipliers**: `synergy.multiplier ∈ [1, 1 + 0.12]`; manager modifier
  `∈ [1 − 0.10, 1 + 0.10]` (null manager → exactly 1.0). The bound is the
  **"Synergy amplifies, never replaces talent"** guarantee: a high-Synergy weak
  XI can never out-aggregate a low-Synergy superstar XI.

## Scoring config (`DEFAULT_SCORING_CONFIG`)

Integer weights keep `points = raw × weight` exact so `score = Σ points` holds
byte-for-byte.

| Component | Weight |
|---|---|
| `goal_points` | 3 |
| `goal_difference_weight` | 1 |
| `clean_sheet_bonus` | 4 |
| `undefeated_bonus` | 10 |
| round progression `G1..G3 / R32 / R16 / QF / SF / F` | 1·3 / 2 / 3 / 5 / 8 / 13 |
| `conceded_penalty` | −1 |
| `yellow_penalty` / `red_penalty` | −1 / −4 |
| `foul_penalty` / `offside_penalty` | 0 / 0 |
| `missed_pen_penalty` | −2 |

## Golden lock

`test/fixtures/sim-golden.json` pins the `RunResult` for four characteristic
scenarios — **blowout / upset / draw-into-pens / injury-cascade** — found by
`scripts/generate-sim-golden.ts` (regenerate via
`pnpm --filter @wcdraft/core run gen:sim-golden`). Identical `(squad, scenario,
seed, version anchors)` → byte-identical `RunResult` (incl. score,
`PlayerRunStats`, event-derived top scorer, narrative seed).

## Public signatures — sim + Synergy

The public 4-arg `RunTournamentFn` and 4-arg `ComputeSynergyFn` thread the
resolved inputs the (draft, scenario, seed) / (squad, formation, manager) cores
do not carry on their own:

- `runTournament(draft, scenario, seed, world)` → REQUIRED `world: SimWorld`
  (user ratings + `Team2026` opponents + optional manager rating / per-card
  nation / scoring config / `Bracket2026`). `runTournamentFull(...)` is the
  event-bearing entry returning `{ run, matches }`. `SimWorld` lives in
  `src/types/sim.ts` and is exported from the top-level barrel.
- `computeSynergy(squad, formation, manager, nationByCardId?)` → optional 4th
  `nationByCardId` (a `SquadSlot` carries no nation). Absent ⇒ no clusters / no
  links (honest-state: an unknown nation cannot manufacture Synergy).
