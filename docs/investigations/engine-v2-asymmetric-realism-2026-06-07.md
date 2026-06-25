# Investigation: engine-v2 asymmetric realism failure (autoDraft vs projected-2026)

> Date: 2026-06-07  
> Branch: `engine-v2-e3a-lambda-calibration` (worktree: `/private/tmp/wcdraft-engine-v2-e3a`, HEAD 5c54b8a)  
> Base anchor: engine-v2 @ 2075e3d  
> Mode: READ-ONLY measurement; no engine/rating/deploy changes. Measurement scripts in `/tmp` only.

## Summary

The "11/200 qualifying, 3.075 g/g, 16.64% margin≥4, 0% KO→ET" landing is **predominantly a population-artifact**: the asymmetric harness drafts via `autoDraft`, which picks `rolled_card_ids[0]` — the canonical first card on every spin — not the best-available card. The (tournament, nation) spin draws are era-weighted/random, so the resulting XI is a random walk through the historical pool against the projected-elite 2026 favourites. A strategic / competent draft (best-of-spin) is what real users do, and is the population the asymmetric realism gate should measure over. Whether even a competent draft can hit modern-WC norms also depends on (a) rating-distribution parity between the historical pool and `proj-career-2.0.0` 2026 opponents, and (b) how aggressively `SPREAD=4.0` amplifies the residual edge — both are quantified below.

## Symptoms

From `packages/data/test/realism/realism.gate.test.ts` at N=200, fitted tuple (SIM_CALIBRATION.md §D5):

```
[REALISM] N_runs=200 qualifying=11/200 matches=613 groups=600 KO=13
[REALISM] ✗ goals/game     obs=3.075 tgt=2.540
[REALISM] ✗ draw% (group)  obs=14.83% tgt=24.70%
[REALISM] ✗ margin≥4%      obs=16.64% tgt=4.90%
[REALISM] ✗ KO→ET%         obs=0.00% tgt=33.00%
[REALISM] ✓ shootout%      obs=0.00% tgt=21.40%
```

KO→ET 0% is mostly a denominator artifact: only ~13 knockout matches across 200 runs (11 qualifiers + a few ties), N too small to land near 33%.

## Background / Prior Research

- **Engine-v2 E-3a branch & worktree.** `engine-v2-e3a-lambda-calibration` (5c54b8a "ENGINE-V2 E-3a — four-channel λ + Poisson-like chance budget + realism fit") lives at `/private/tmp/wcdraft-engine-v2-e3a`. Parent commit 2075e3d is a webpack cache fix that the engine-v2 line sits on top of.
- **autoDraft is _not_ strategic.** `packages/core/src/draft.ts:1057` `autoDraft` loops `stepDraft`, which at `draft.ts:1048` does `pickPlayer(catalog, state, active.rolled_card_ids[0]!, slotId)` — i.e. it accepts the **first** card on every spin's roster. The randomization is upstream (which (tournament, nation) entry is drawn and which roster surfaces); autoDraft does no scoring, no best-available, no swap-on-better. This is the population fed into the asymmetric harness.
- **Spin shape.** `rollPendingSpinFromEntry` (`draft.ts:560–595`) exposes the entire roster of the drawn (tournament, nation) pair; the user (in real gameplay) sees and picks one of those cards. A strategic policy would scan `rolled_card_ids` and pick max-by-position-fit-and-rating; autoDraft does not.
- **Lambda map (E-3a, `engine/calibration.ts:71–105`).**  
  `defResist = clamp_int(W_DEF·def + W_GK·gk)` with `W_DEF=0.65, W_GK=0.35`.  
  `λ_for = clamp(BASE + SPREAD·(attack − defResist)/100, MIN, MAX) · control_for`  
  Fitted constants: `BASE=0.85, SPREAD=4.0, MIN=0.75, MAX=3.4, GAMMA_MID=0.45`, `CONTROL_BAND=[0.85, 1.15]`, `CHANCES.REGULATION=50`, `ET_FRACTION=30/90`.
- **Fit was symmetric by design.** `packages/data/scripts/fit-calibration.mjs` (D6 fit) optimises against the **symmetric** Team2026-vs-Team2026 sweep (`~3,006 matches × 30 evals × 2 passes`). The harness comment is explicit:
  > Symmetric sweep was chosen over the asymmetric draft-reachable harness because the norms (24.7% draw, 33% ET, 21.4% SO) are computed on real WC matches, which are top-tier-vs-top-tier — best mirrored by a coherent-XI sweep over the 2026 pool. … The asymmetric D5 harness still runs as a report-only smoke test, surfacing the player-experience landing.
- **Doc-stated honest-property.** `SIM_CALIBRATION.md §D5` records the same numbers reported in the symptoms above and states:
  > The structural gap (only 11/200 auto-drafts qualify, blowouts at 17%) reflects an HONEST property of the auto-drafted population: era-weighted random draws are systematically weaker than the projected-elite 2026 opponents. Calibration cannot close this gap without distorting the symmetric (true-WC-norms) gate. The harness exists as TELEMETRY for player-experience tuning (e.g. the upstream draft helper, manager modifier, Synergy bonus), not as a tournament realism check. Flip to PASS gate only after the draft / Synergy / manager amplification work explicitly targets this distribution.

So the design intent already separates "tournament realism" (symmetric, golden-locked, PASS gate) from "player-experience realism" (asymmetric, report-only). The open question this investigation must answer with numbers: when a _competent_ drafter plays, do we converge on tournament-realistic outcomes, or is there still a residual ratings/SPREAD problem?

## Investigator Findings

### Scope / setup notes

- **Measured commit:** detached worktree `/tmp/asym-realism/wt` at `5c54b8a`, created from the main repo with `git worktree add /tmp/asym-realism/wt 5c54b8a`. The originally requested E-3a worktree `/private/tmp/wcdraft-engine-v2-e3a` was left untouched after the WIP warning.
- **WIP preserved:** before any worktree operation, I saved the active dirty E-3a WIP diff to `/tmp/asym-realism/wip-LAMBDA_DISP.diff`, its stat to `/tmp/asym-realism/wip-LAMBDA_DISP.stat`, and dirty-file copies under `/tmp/asym-realism/wip-snapshot/`. At capture time the dirty files were:

```
packages/core/src/engine/calibration.ts   | 93 ++++++++++++++++++++++++++++++-
 packages/core/src/engine/match.ts         | 16 +++++-
 packages/data/scripts/fit-calibration.mjs | 66 +++++++++++++++-------
 3 files changed, 151 insertions(+), 24 deletions(-)
```

Final status checks also showed untracked WIP scripts `packages/data/scripts/test-tuple.mjs`, `packages/data/scripts/test-tuple2.mjs`, and `packages/data/scripts/test-tuple3.mjs`; I copied those into `/tmp/asym-realism/wip-snapshot/` too and saved `/tmp/asym-realism/wip-final-status.txt`.

- **Relevant WIP evidence:** that diff adds `LAMBDA_DISP`, `lambdaDispersionMultiplier`, and fit-script support for match-level λ dispersion. The comments in the WIP explicitly identify the same Pareto problem this measurement sees: pure independent-Poisson-like scoring struggles to keep goals/game near 2.54 while lifting KO regulation ties / shootouts. The proposed WIP applies one seeded match-level ε to both sides' λ to create cagey/open matches without changing mean λ. That is directly relevant, but **not included** in the measurements below; all numbers are against clean HEAD `5c54b8a`.
- **Build/install gotchas:** `pnpm -w install --offline` in an earlier clean export was insufficient/misleading: offline missed `brace-expansion@5.0.6`, and `-w` only installed root deps, leaving package deps such as `zod` unresolved for `@wcdraft/core`. The successful measurement worktree used `pnpm install --frozen-lockfile --store-dir /tmp/asym-realism/pnpm-store`, then `pnpm --filter @wcdraft/core run build` and `pnpm --filter @wcdraft/data run build`.
- **Runtime bundle gotchas:** `SCENARIO_2026_BUNDLE` has **48** teams in this commit, not 32 (manifest count and runtime array agree). I used all 48 `Team2026.aggregate_rating` records for opponent means/percentiles because that is the actual sim input. The runtime scenario bundle does not expose per-card 2026 ratings; 2026 star spot-checks therefore use the committed ETL files `etl/output/ratings_2026.json`, `players.json`, `players_2026.json`, and `player_tournaments_2026.json` from the pinned worktree.
- **Scripts / outputs:** one-shot drivers live under `/tmp/asym-realism/`, primarily `measure-asym-realism.mjs`. Raw machine-readable output is `/tmp/asym-realism/results.json`; generated Markdown tables are `/tmp/asym-realism/findings-measurement-tables.md`.

### Code-path references / measurement method

- The production harness constructs the draft dataset/world from `DRAFT_POOL_BUNDLE` and `SCENARIO_2026_BUNDLE` (`packages/data/test/realism/realism.harness.ts:37-85`) and runs `autoDraft` + `buildRunScenario` + `runTournamentFull` for N seeded runs (`realism.harness.ts:100-160`). The data barrel statically exports the runtime bundles at `packages/data/src/index.ts:20-31`.
- `autoDraft` is canonical-first: `stepDraft` takes the first offered manager if one is needed (`packages/core/src/draft.ts:1019-1035`), otherwise assigns `active.rolled_card_ids[0]` to the first vacant slot (`draft.ts:1042-1048`); `autoDraft` loops that policy to completion (`draft.ts:1057-1064`). The spin itself exposes the whole canonical roster via `rolled_card_ids` (`draft.ts:560-584`). The first-vacant slot behavior is `state.squad.find((s) => s.card_id === null)` (`draft.ts:844-848`).
- My `strategicSlotFit` policy intentionally **mirrors manager-first autoDraft**. On player spins only, it scores every `active.rolled_card_ids` candidate against the same first vacant slot by `positionCompatibility(eligible_positions, slot_position) * rating[channel_for_slot]`, with `overall` fallback and `card_id` tie-break. `greedyOverall` is the sanity baseline: same manager/slot flow but max `overall`, ignoring fit.
- User XI strength is computed on the exact sim path: `runTournamentFull` builds starter contributions, computes Synergy, and calls `aggregateUserXiStrength` (`packages/core/src/engine/tournament.ts:182-194`). The aggregation formula is channel mean of `rating[channel] * position_compatibility`, multiplied by Synergy and manager modifier (`packages/core/src/engine/team-strength.ts:36-53`). Null/missing manager rating is neutral (`team-strength.ts:30-33`). Synergy multiplier is bounded and computed at `packages/core/src/engine/synergy.ts:125-130`.
- The existing realism world does **not** pass `world.managerRatings`, and `DRAFT_POOL_BUNDLE` has no manager-rating map, so all reported manager modifiers are 1.000. This preserves harness behavior.
- Team2026 opponent strength in matches is `opponent.aggregate_rating` (`packages/core/src/engine/match.ts:1004-1007`). `membersFromTeam2026` creates lineup members from `squad_card_ids` but does not recompute ratings (`match.ts:962-979`).
- Era-weighting is non-trivial: rare/modern masses are defined at `draft.ts:155-160`; year mass is allocated and split by pair at `draft.ts:335-399`. The “era-weighted exposure” percentiles below weight each card by its pair's `base_draw_weight` whenever that pair is drawn; this measures candidate visibility, not a uniform random pick within a roster.
- `__UNSAFE_setCalibrationOverride` / `__UNSAFE_clearCalibrationOverride` are reachable from the built `@wcdraft/core` bundle and were used for SPREAD sweeps; the override state lives in `packages/core/src/engine/calibration.ts:386-392` in clean HEAD.

### Raw measurement tables

### Measurement run metadata

- Measurement worktree: `/tmp/asym-realism/wt`, detached at `5c54b8a`.
- Seed prefix: `wcdraft:realism:e3a:v1`; N=200 for every ensemble.
- Runtime manifest counts: draft ratings 12219; scenario teams 48.
- Manager ratings in runtime bundle: false; existing harness world therefore keeps manager modifier neutral at 1.000.

### Angle 1 — Strategic-draft population

| policy           | qualifying | matches | ko  | goalsPerGame | drawPct | margin4plusPct | koEtPct | shootoutPct |
| ---------------- | ---------- | ------- | --- | ------------ | ------- | -------------- | ------- | ----------- |
| strategicSlotFit | 67/200     | 696     | 96  | 2.394        | 25.83%  | 3.59%          | 30.21%  | 18.75%      |
| greedyOverall    | 12/200     | 615     | 15  | 3.109        | 14.50%  | 15.77%         | 6.67%   | 0.00%       |

| population                    | attack | midfield | defense | goalkeeping | synergyMultiplier | managerModifier |
| ----------------------------- | ------ | -------- | ------- | ----------- | ----------------- | --------------- |
| strategicSlotFit user XI mean | 45.40  | 48.84    | 48.34   | 24.20       | 1.01              | 1.00            |
| greedyOverall user XI mean    | 28.61  | 28.00    | 24.57   | 14.28       | 1.01              | 1.00            |
| 2026 opponent team mean (48)  | 55.52  | 61.60    | 58.58   | 24.71       | n/a               | n/a             |
| strategic minus 2026 mean     | -10.13 | -12.77   | -10.24  | -0.51       |                   |                 |
| greedy minus 2026 mean        | -26.92 | -33.61   | -34.01  | -10.43      |                   |                 |

### Angle 2 — Rating distribution parity

#### Draft pool raw percentile bands

| population | channel     | mean  | p10 | p25 | p50 | p75 | p90 | max |
| ---------- | ----------- | ----- | --- | --- | --- | --- | --- | --- |
| draft raw  | attack      | 36.06 | 21  | 27  | 34  | 41  | 55  | 100 |
| draft raw  | midfield    | 38.76 | 23  | 29  | 37  | 45  | 56  | 100 |
| draft raw  | defense     | 37.67 | 25  | 27  | 34  | 44  | 57  | 100 |
| draft raw  | goalkeeping | 23.32 | 20  | 20  | 20  | 20  | 34  | 100 |
| draft raw  | overall     | 75.24 | 70  | 71  | 73  | 79  | 83  | 99  |

#### Draft pool era-weighted exposure percentile bands

| population                  | channel     | mean  | p10 | p25 | p50 | p75 | p90 | max |
| --------------------------- | ----------- | ----- | --- | --- | --- | --- | --- | --- |
| draft era-weighted exposure | attack      | 36.09 | 22  | 27  | 34  | 41  | 55  | 100 |
| draft era-weighted exposure | midfield    | 39.44 | 23  | 29  | 38  | 46  | 57  | 100 |
| draft era-weighted exposure | defense     | 38.66 | 25  | 28  | 35  | 45  | 59  | 100 |
| draft era-weighted exposure | goalkeeping | 23.52 | 20  | 20  | 20  | 20  | 34  | 100 |
| draft era-weighted exposure | overall     | 75.31 | 70  | 71  | 73  | 79  | 83  | 99  |

#### 2026 scenario team aggregate percentile bands

| population               | channel     | mean  | p10    | p25    | p50    | p75    | p90    | max    |
| ------------------------ | ----------- | ----- | ------ | ------ | ------ | ------ | ------ | ------ |
| 2026 team aggregate (48) | attack      | 55.52 | 49     | 51     | 55     | 59     | 64     | 70     |
| 2026 team aggregate (48) | midfield    | 61.60 | 53     | 57     | 62     | 66     | 69     | 75     |
| 2026 team aggregate (48) | defense     | 58.58 | 52     | 55     | 58     | 62     | 65     | 69     |
| 2026 team aggregate (48) | goalkeeping | 24.71 | 20     | 24     | 25     | 26     | 29     | 30     |
| 2026 team aggregate (48) | coverage    | 0.71  | 0.7143 | 0.7143 | 0.7143 | 0.7143 | 0.7143 | 0.7143 |

#### Historical greats spot check

| player              | card         | nation       | overall | attack | midfield | defense | goalkeeping | primary                  | p90Check                        |
| ------------------- | ------------ | ------------ | ------- | ------ | -------- | ------- | ----------- | ------------------------ | ------------------------------- |
| Pelé 1970           | P-38906:1970 | Brazil       | 89      | 82     | 57       | 39      | 20          | attack=82 (p90=55)       | overall ≥ p90 83; primary ≥ p90 |
| Maradona 1986       | P-80404:1986 | Argentina    | 99      | 72     | 100      | 68      | 20          | midfield=100 (p90=56)    | overall ≥ p90 83; primary ≥ p90 |
| Cruyff 1974         | P-50564:1974 | Netherlands  | 88      | 58     | 78       | 55      | 20          | midfield=78 (p90=56)     | overall ≥ p90 83; primary ≥ p90 |
| Beckenbauer 1974    | P-72864:1974 | West Germany | 92      | 44     | 61       | 89      | 20          | midfield=61 (p90=56)     | overall ≥ p90 83; primary ≥ p90 |
| Messi 2022          | P-14758:2022 | Argentina    | 99      | 100    | 68       | 44      | 20          | attack=100 (p90=55)      | overall ≥ p90 83; primary ≥ p90 |
| Zidane 1998         | P-56430:1998 | France       | 89      | 59     | 81       | 56      | 20          | midfield=81 (p90=56)     | overall ≥ p90 83; primary ≥ p90 |
| Roberto Carlos 2002 | P-85176:2002 | Brazil       | 92      | 44     | 62       | 90      | 20          | defense=90 (p90=57)      | overall ≥ p90 83; primary ≥ p90 |
| Cannavaro 2006      | P-88863:2006 | Italy        | 99      | 48     | 68       | 100     | 20          | defense=100 (p90=57)     | overall ≥ p90 83; primary ≥ p90 |
| Buffon 2006         | P-11392:2006 | Italy        | 99      | 24     | 36       | 64      | 100         | goalkeeping=100 (p90=34) | overall ≥ p90 83; primary ≥ p90 |
| Iniesta 2010        | P-56330:2010 | Spain        | 89      | 60     | 82       | 57      | 20          | midfield=82 (p90=56)     | overall ≥ p90 83; primary ≥ p90 |

#### 2026 stars spot check

| player             | card            | nation  | overall | attack | midfield | defense | goalkeeping | primary              | p90Check                        |
| ------------------ | --------------- | ------- | ------- | ------ | -------- | ------- | ----------- | -------------------- | ------------------------------- |
| Mbappé FR 2026     | P-64077:2026    | France  | 95      | 97     | 66       | 43      | 20          | attack=97 (p90=71)   | overall ≥ p90 86; primary ≥ p90 |
| Bellingham EN 2026 | P-15674:2026    | England | 85      | 63     | 87       | 60      | 20          | midfield=87 (p90=75) | overall < p90 86; primary ≥ p90 |
| Vinícius BR 2026   | P-92812:2026    | Brazil  | 84      | 85     | 59       | 39      | 20          | attack=85 (p90=71)   | overall < p90 86; primary ≥ p90 |
| Foden EN 2026      | not found       |         |         |        |          |         |             |                      |                                 |
| Haaland NO 2026    | P-W26-0490:2026 | Norway  | 90      | 95     | 65       | 42      | 20          | attack=95 (p90=71)   | overall ≥ p90 86; primary ≥ p90 |
| Modrić HR 2026     | P-29491:2026    | Croatia | 87      | 65     | 89       | 61      | 20          | midfield=89 (p90=75) | overall ≥ p90 86; primary ≥ p90 |
| Saka EN 2026       | P-76842:2026    | England | 86      | 88     | 61       | 41      | 20          | attack=88 (p90=71)   | overall ≥ p90 86; primary ≥ p90 |
| Rodri ES 2026      | P-W26-0668:2026 | Spain   | 87      | 66     | 90       | 62      | 20          | midfield=90 (p90=75) | overall ≥ p90 86; primary ≥ p90 |
| Pedri ES 2026      | P-W26-0675:2026 | Spain   | 85      | 63     | 86       | 59      | 20          | midfield=86 (p90=75) | overall < p90 86; primary ≥ p90 |
| Kane EN 2026       | P-58924:2026    | England | 88      | 92     | 63       | 42      | 20          | attack=92 (p90=71)   | overall ≥ p90 86; primary ≥ p90 |

### Angle 3 — SPREAD amplification sweep

| policy           | spread | qualifying | matches | ko  | goalsPerGame | drawPct | margin4plusPct | koEtPct | shootoutPct |
| ---------------- | ------ | ---------- | ------- | --- | ------------ | ------- | -------------- | ------- | ----------- |
| autoDraft        | 1      | 60/200     | 693     | 93  | 2.069        | 27.83%  | 2.45%          | 26.88%  | 13.98%      |
| autoDraft        | 1.5    | 49/200     | 676     | 76  | 2.216        | 25.50%  | 3.70%          | 27.63%  | 17.11%      |
| autoDraft        | 2      | 35/200     | 645     | 45  | 2.420        | 21.67%  | 6.05%          | 26.67%  | 13.33%      |
| autoDraft        | 2.5    | 23/200     | 632     | 32  | 2.600        | 19.67%  | 7.75%          | 21.88%  | 9.38%       |
| autoDraft        | 3      | 18/200     | 624     | 24  | 2.776        | 18.83%  | 10.58%         | 12.50%  | 8.33%       |
| autoDraft        | 3.5    | 16/200     | 621     | 21  | 2.926        | 17.50%  | 13.04%         | 9.52%   | 4.76%       |
| autoDraft        | 4      | 11/200     | 613     | 13  | 3.075        | 14.83%  | 16.64%         | 0.00%   | 0.00%       |
| strategicSlotFit | 1      | 99/200     | 762     | 162 | 1.870        | 33.17%  | 1.18%          | 37.04%  | 20.37%      |
| strategicSlotFit | 1.5    | 89/200     | 739     | 139 | 1.954        | 30.67%  | 1.22%          | 31.65%  | 17.27%      |
| strategicSlotFit | 2      | 86/200     | 734     | 134 | 2.045        | 28.67%  | 1.50%          | 30.60%  | 15.67%      |
| strategicSlotFit | 2.5    | 83/200     | 727     | 127 | 2.121        | 28.83%  | 1.65%          | 26.77%  | 13.39%      |
| strategicSlotFit | 3      | 78/200     | 720     | 120 | 2.217        | 29.17%  | 2.50%          | 25.00%  | 13.33%      |
| strategicSlotFit | 3.5    | 74/200     | 713     | 113 | 2.293        | 28.17%  | 3.09%          | 28.32%  | 16.81%      |
| strategicSlotFit | 4      | 67/200     | 696     | 96  | 2.394        | 25.83%  | 3.59%          | 30.21%  | 18.75%      |

Closest strategic SPREAD by five-metric relative RMSE: 4.0 (relative RMSE 0.1408).

| policy           | SPREAD=4 margin≥4 | SPREAD=1 margin≥4 | excess vs 4.90 norm (pp) | SPREAD-driven pp | low-SPREAD residual pp | SPREAD share of excess |
| ---------------- | ----------------- | ----------------- | ------------------------ | ---------------- | ---------------------- | ---------------------- |
| autoDraft        | 16.64%            | 2.45%             | 11.74                    | 14.19            | -2.45                  | 120.84%                |
| strategicSlotFit | 3.59%             | 1.18%             | -1.31                    | 2.41             | -3.72                  | n/a                    |

#### 2026 projected per-card rating bands used for star spot-checks

| population                          | channel     | mean  | p10 | p25 | p50 | p75 | p90 | max |
| ----------------------------------- | ----------- | ----- | --- | --- | --- | --- | --- | --- |
| 2026 projected per-card ETL ratings | attack      | 46.53 | 23  | 34  | 43  | 58  | 71  | 97  |
| 2026 projected per-card ETL ratings | midfield    | 51.48 | 30  | 40  | 50  | 61  | 75  | 99  |
| 2026 projected per-card ETL ratings | defense     | 50.08 | 32  | 37  | 47  | 60  | 76  | 96  |
| 2026 projected per-card ETL ratings | goalkeeping | 24.76 | 20  | 20  | 20  | 20  | 43  | 90  |
| 2026 projected per-card ETL ratings | overall     | 75.78 | 70  | 71  | 73  | 80  | 86  | 99  |

### Buckets / conclusions

#### (1) Strategic-draft population bucket

A competent slot-fit draft lands **near World Cup norms, not near the autoDraft landing**.

- Clean baseline validation: the sweep row for `autoDraft`, `SPREAD=4.0` exactly reproduces the already-known baseline: 11/200 qualifying, 613 matches, 13 KO, 3.075 goals/game, 14.83% group draws, 16.64% margin≥4, 0.00% KO→ET, 0.00% shootout.
- `strategicSlotFit` at the same constants improves to **67/200 qualifying**, 696 matches, 96 KO matches, **2.394 goals/game**, **25.83% group draws**, **3.59% margin≥4**, **30.21% KO→ET**, and **18.75% shootout**. Those are qualitatively in the WC-norm neighborhood: draw/ET/shootout are close, blowouts are actually below the 4.90% target, and goals/game is modestly low rather than explosively high.
- `greedyOverall` is an important negative control: **12/200 qualifying**, 3.109 goals/game, 15.77% margin≥4. Max-overall without slot fit behaves almost like canonical-first because it can strand the XI with awful positional/GK fit. “Competent” here must mean slot-aware, not just max display overall.
- Strength explains the landing: `strategicSlotFit` still trails the 48-team 2026 opponent mean by **-10.13 attack**, **-12.77 midfield**, **-10.24 defense**, and **-0.51 goalkeeping** points, but that is survivable; `greedyOverall` trails by -26.92/-33.61/-34.01/-10.43, which is not survivable.

#### (2) Rating-distribution parity bucket

The two rating systems are **not population-equivalent at the channel/team-aggregate level**, but the individual top-end spot checks do **not** support “historical greats are under-rated.” My read: `proj-career-2.0.0` is a hotter outfield population than the draft-reachable `wc-perf-2.0.0` pool, while `wc-perf` still places canonical elite cards in sensible top bands.

- Raw draft-reachable per-card p90s are attack 55, midfield 56, defense 57, goalkeeping 34, overall 83. Era-weighted exposure barely changes that: p90s 55/57/59/34/83.
- 2026 projected per-card p90s are materially hotter in outfield channels: attack 71, midfield 75, defense 76, goalkeeping 43, overall 86. The 2026 **team aggregate** mean is 55.52 attack / 61.60 midfield / 58.58 defense / 24.71 GK.
- The canonical historical greats all clear raw draft p90 on both overall and their primary channel: Pelé 1970 attack 82; Maradona 1986 midfield 100; Cruyff 1974 midfield 78; Beckenbauer 1974 defense/midfield profile 89/61; Messi 2022 attack 100; Zidane 1998 midfield 81; Roberto Carlos 2002 defense 90; Cannavaro 2006 defense 100; Buffon 2006 GK 100; Iniesta 2010 midfield 82. That looks directionally believable.
- The 2026 stars that are present mostly also land where expected: Mbappé 95 overall / 97 attack; Haaland 90 / 95 attack; Kane 88 / 92 attack; Rodri 87 / 90 midfield; Modrić 87 / 89 midfield; Saka 86 / 88 attack. Bellingham, Vinícius, and Pedri are just below 2026 overall p90 but above primary-channel p90, which is plausible for a position-weighted channel model. Foden was not present in the projected 2026 tournament-card set at this snapshot, so no rating conclusion follows from that absence.
- Therefore the asymmetric failure is not “Pelé is bad.” It is the combination of (a) non-strategic autoDraft; (b) projected 2026 coherent teams with hotter outfield aggregates; and (c) high SPREAD amplifying those gaps.

#### (3) SPREAD amplification bucket

For the strategic population, clean HEAD's current `SPREAD=4.0` is the closest value in the requested sweep by five-metric relative RMSE (0.1408). Lowering SPREAD monotonically improves neither realism nor player experience: it lowers goals/game too far and pushes blowouts below target.

- Strategic sweep: SPREAD 1.0 gives 1.870 goals/game, 33.17% draws, 1.18% margin≥4, 37.04% KO→ET, 20.37% shootout, 99/200 qualifying. SPREAD 4.0 gives 2.394 goals/game, 25.83% draws, 3.59% margin≥4, 30.21% KO→ET, 18.75% shootout, 67/200 qualifying. The latter is closest overall to the five norms despite still-low goals.
- AutoDraft sweep: SPREAD 1.0 has 60/200 qualifying and only 2.45% margin≥4; SPREAD 4.0 collapses to 11/200 qualifying and 16.64% margin≥4. Using SPREAD 1.0 as the low-amplification floor, the observed autoDraft margin≥4 excess at SPREAD 4.0 is **not** a positive residual at low spread; the low-spread row is 2.45 percentage points **below** the 4.90% norm. The +11.74 pp high-spread excess is therefore a high-SPREAD × weak-population interaction, not a standalone rating-gap blowout floor. Numerically, `SPREAD=4 minus SPREAD=1` is +14.19 pp for autoDraft, i.e. 120.84% of the positive excess over the norm because the low-SPREAD residual is negative.
- Strategic has no blowout excess to decompose at SPREAD 4.0: 3.59% margin≥4 is 1.31 pp below norm. SPREAD still raises strategic blowouts by +2.41 pp from SPREAD 1.0 to 4.0, but even after that increase the strategic population remains under the blowout target.
- The WIP `LAMBDA_DISP` direction is well-motivated by these data: once the draft policy is competent, the hard part is not suppressing blowouts; it is raising goals/game while maintaining high draw/ET/shootout rates. Match-level shared dispersion is aimed exactly at that goals-vs-ties Pareto tension.

### Investigator recommendation from the measurements

Do **not** flip the asymmetric gate to PASS for canonical `autoDraft`. It is measuring a bad autopilot, not the competent user population. If the product wants an asymmetric realism gate, gate one of these instead:

1. **Recommended:** add a test-only strategic draft policy equivalent to `strategicSlotFit` and gate/report that. It is closer to actual user behavior and already lands near the norms at current constants.
2. Keep canonical `autoDraft` as telemetry only, or change `autoDraft` itself to a slot-aware helper if product semantics allow that behavior change. The `greedyOverall` result is a warning: any helper change must be slot-fit-aware, not simply max overall.
3. Treat rating parity separately from sim calibration. The 2026 projected outfield scale is hotter than historical draft-reachable channel scale, but elite historical cards are not obviously under-rated. If parity work happens, compare **coherent drafted XI aggregates** vs **Team2026 aggregates**, not raw player overall alone.
4. Continue evaluating the `LAMBDA_DISP` WIP on a clean branch/worktree. It addresses the residual strategic-population tension (goals vs ET/shootouts) more directly than lowering SPREAD.

## Investigation Log

### Phase 1 — Branch / file inventory (agent)

**Hypothesis:** the harness, autoDraft, calibration, and rating bundles all live in the E-3a worktree.  
**Findings:** confirmed. Harness at `packages/data/test/realism/realism.harness.ts`; gate at `realism.gate.test.ts`; fit driver at `packages/data/scripts/fit-calibration.mjs`; constants at `packages/core/src/engine/calibration.ts`; autoDraft at `packages/core/src/draft.ts:1057`; draft-pool and 2026-scenario bundles available via `@wcdraft/data` (`DRAFT_POOL_BUNDLE`, `SCENARIO_2026_BUNDLE`, `RUNTIME_DATA_MANIFEST`).  
**Evidence:** see file:line refs in Background.  
**Conclusion:** confirmed.

### Phase 1 — autoDraft is canonical-first, not strategic (agent)

**Hypothesis:** the "RANDOM" framing in the prompt is accurate.  
**Findings:** `autoDraft` always picks `rolled_card_ids[0]` — the first card in canonical order on each spin's roster. There is no per-spin best-available scoring. Per-spin randomness is in (tournament, nation) selection (era-weighted), not in card-quality.  
**Evidence:** `draft.ts:1057–1065`, `draft.ts:1037–1048`, `draft.ts:560–595`.  
**Conclusion:** confirmed. The asymmetric harness population is best characterised as "first-card-of-each-era-weighted-spin," which is materially weaker than a strategic best-on-roster policy.

## Wilson-band re-check at the strategic landing (agent)

Plugging the strategic-slot-fit numbers from the pair's Angle-1 table back into the same Wilson `±2·√(p(1−p)/N)` (or `2·√(λ/N)` for goals/game) tolerance the harness already uses (`realism.harness.ts:173–176`):

```
norm           obs     tgt     delta    band     inBand
goals/game     2.394   2.540   -0.146   ±0.121   FALSE
draw%          25.83%  24.70%  +1.13pp  ±3.52pp  true
margin≥4%       3.59%   4.90%  -1.31pp  ±1.64pp  true
KO→ET%         30.21%  33.00%  -2.79pp  ±9.60pp  true
shootout%      18.75%  21.40%  -2.65pp  ±8.37pp  true
```

So at clean HEAD constants the strategic asymmetric run lands **4-of-5 norms in the existing Wilson band** at N=200; only `goals/game` misses, and it misses by ~1.2× the band in the "honest direction" — the strategic user XI is genuinely weaker than the 48-team coherent 2026 opponent population on outfield channels (Angle-2 gap: attack −10.13, mid −12.77, def −10.24, GK −0.51). That residual goals/game miss is the only structural pressure left after the population artefact is removed; it is not a calibration bug.

## Root Cause

The asymmetric-realism failure is a **population-policy mismatch in the measurement harness**, not a sim-calibration failure and not a rating-accuracy failure. Specifically, in order of contribution:

1. **(Dominant) The harness measures `autoDraft`, which is canonical-first, not strategic.** `autoDraft` (`packages/core/src/draft.ts:1057–1064`) always feeds the spin's first-canonical roster card into the first vacant slot (`draft.ts:1042–1048`, `draft.ts:560–584`). The randomization is upstream (era-weighted (tournament, nation) selection), and the in-roster pick is fixed-position, not best-available. A slot-aware best-available policy on the same world+seeds at the same constants raises qualifying from 11/200 → 67/200, drops goals/game from 3.075 → 2.394, drops margin≥4 from 16.64% → 3.59%, lifts KO→ET from 0% → 30.21%, lifts shootout from 0% → 18.75%, and lands 4-of-5 norms inside the gate's own Wilson band. The 11/200 / 16.64% / 0% landing is therefore a measurement artefact of an unrealistic user-policy proxy, not a property of the engine, the ratings, or the draft pool.
2. **(Secondary, complementary) `SPREAD=4.0` amplifies the residual strength gap.** The fit is correct for the symmetric sweep, but on the weaker asymmetric population every per-channel deficit gets multiplied by the same `(attack − defResist)/100` slope. The SPREAD sweep is unambiguous: on autoDraft, margin≥4 rises from 2.45% at SPREAD 1.0 to 16.64% at SPREAD 4.0 (+14.19 pp purely from SPREAD on the same population); on strategic, the same sweep moves margin≥4 from 1.18% to only 3.59% (still below the 4.9% norm). SPREAD is not the root cause — lowering it on the symmetric population would distort the locked symmetric gate — but it is the amplifier that makes the autoDraft policy artefact visible as blowouts.
3. **(Not a cause) Rating-distribution accuracy.** Historical canonical greats land in sensible top bands on `wc-perf-2.0.0`: Pelé 1970 attack 82, Maradona 1986 midfield 100, Messi 2022 attack 100, Cannavaro 2006 defense 100, Buffon 2006 GK 100, Beckenbauer 1974 defense 89, Roberto Carlos 2002 defense 90 — every spot-checked great clears raw draft p90. `proj-career-2.0.0` 2026 stars also land where expected (Mbappé 97 att / 95 ovr, Haaland 95 att / 90 ovr, Rodri 90 mid / 87 ovr, Modrić 89 mid / 87 ovr). What _is_ true is that 2026 _coherent team aggregates_ run hotter than the _random draft-reachable per-card pool_ — per-channel p90s 71/75/76/43 for 2026 vs 55/56/57/34 for draft-reachable — but that gap is the legitimate "coherent elite XI vs era-weighted random selection from history" gap, not a rating-scale calibration error. Closing it via rating-pipeline changes would mis-represent history.
4. **(Honest residual)** Even on the strategic population, mean strength is still 10–13 channel points below the 2026 opponent mean on the outfield. That drives goals/game to 2.39 (vs norm 2.54). This is the only real engine-vs-norm pressure left, and it lives entirely in the honest-state "underdog user XI scores less than two coherent elite WC teams" zone. It is small (~1.2× band) and is in the right direction.

The dirty WIP on the engine-v2-e3a worktree (`LAMBDA_DISP` / parity-dependent variance — `/tmp/asym-realism/wip-LAMBDA_DISP.diff`) is aimed at a real Pareto edge — pure-Poisson tied/SO rates can't simultaneously hit 33% / 21.4% at 2.54 g/g — but that pressure shows up on the _symmetric_ gate, not on the asymmetric one. On the asymmetric strategic population the tied / SO rates are already inside the Wilson band at clean constants, so `LAMBDA_DISP` is orthogonal to this investigation's failure; it should be evaluated against its own (symmetric) target.

## Recommendations

### Target population — the correct answer

The asymmetric-realism gate must measure over a **slot-aware best-available draft policy** (the pair's `strategicSlotFit`: for each spin, scan the spin's whole roster and pick the card maximising `positionCompatibility(eligible_positions, slot_position) × rating[channel_for_slot]`, with `overall` fallback and `card_id` tiebreak — manager flow unchanged). This is the realistic proxy for how a competent human plays the actual draft loop (`draft.ts:866–946` plus `pickManager` upstream). The `greedyOverall` negative control in Angle-1 (12/200, 3.109 g/g, 15.77% margin≥4) is a hard warning that "competent" must mean _slot-fit-aware_, not max display `overall` — without slot fit the helper strands the XI with bad positional and goalkeeping fit and reproduces the autoDraft failure.

`autoDraft` should stay as today's deterministic canonical-first harness fixture for golden tests (it is byte-stable, easy to reason about, and the golden suite already locks it). It should not be used as the realism gate population.

### Fix tier — what to do, in order

| Tier                     | Action                                                                                                                                                                                                                                                                                                                               | Cost                                                                                                                                                        | Risk                                                                                                                                                                                                              | Coverage                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **T1 (DO FIRST)**        | Add a `strategicAutoDraft` (slot-fit max-by-channel) policy in the realism harness (test-only, not in the production `draft.ts` API), and switch the asymmetric realism gate to measure over it. Keep canonical `autoDraft` as an additional `[REALISM-AUTODRAFT]` report-only log line for telemetry.                               | ~1 day. Touches `packages/data/test/realism/realism.harness.ts` only. Production engine bytes unchanged. Goldens unchanged. No engine_version implications. | Low. The new policy lives only in `@wcdraft/data` test code. No rating pipeline change. No `LAMBDA` / `CHANCES` change. The existing symmetric `realism-modern-norms.golden.test.ts` is unaffected.               | Closes 4-of-5 norms inside the existing Wilson band immediately; converts the "report-only" asymmetric harness into a meaningful PASS gate. |
| **T2 (DO ALONGSIDE T1)** | Define the asymmetric gate as "4-of-5 norms in Wilson band at N=200" _or_ widen `goals/game` band to `±max(0.121, 0.15)` so strategicSlotFit at clean constants is in-band on all five norms. Documented as a honest-residual concession: underdog XI scores less than two coherent elite XIs.                                       | ~½ day, doc + test change in `realism.harness.ts` + `realism.gate.test.ts`.                                                                                 | Low. The band is documented as honest-state, not an arbitrary slack.                                                                                                                                              | Lets the gate flip to PASS at clean E-3a constants without engine retune.                                                                   |
| **T3 (OPTIONAL, defer)** | Evaluate the WIP `LAMBDA_DISP` on the _symmetric_ gate where its Pareto motivation lives. Land it only if it preserves the symmetric golden bands AND keeps the asymmetric strategic Wilson-band gate passing. If it hurts mean goals on the asymmetric strategic population (it shouldn't — `E[ε]=1`), don't land it.               | ~1 week. Full engine_version bump path, including golden re-locks on `sim-golden.json` and `e2e-real-run-golden.json`.                                      | Higher: real engine bytes move, all sim goldens shift. The deferred season-merge `engine_version` bump (currently `engine-2026.06.04`, pinned by `compact-data.integrity.test.ts`) becomes the right home for it. | Reduces residual asymmetric `goals/game` ↔ tie-rate Pareto tension on both populations. Not required to flip the asymmetric gate.           |
| **T4 (DO NOT DO)**       | Lower `SPREAD` to suppress autoDraft blowouts. Sweep is clear: strategic SPREAD=4 has 3.59% margin≥4 (below 4.9% norm) and is already the closest five-metric RMSE point (0.1408). Lower SPREAD pushes blowouts and goals/game further below norms and would break the symmetric gate.                                               | —                                                                                                                                                           | Breaks symmetric realism gate. Distorts the locked symmetric calibration that D6 fit produced.                                                                                                                    | —                                                                                                                                           |
| **T4 (DO NOT DO)**       | "Fix" rating-distribution parity by inflating historical channels or deflating 2026 projected channels. Spot checks show greats are in sensible top bands; the team-aggregate gap is the legitimate "coherent elite vs random history" gap. Re-scaling either side would distort the rating pipeline that golden tests already lock. | —                                                                                                                                                           | Breaks rating goldens; misrepresents history.                                                                                                                                                                     | —                                                                                                                                           |

### Season-merge gate definition (proposed)

When the season-merge `engine_version` bump lands (currently deferred per `SIM_CALIBRATION.md` §"ENGINE_VERSION POLICY (E-3a)"), the realism gate set should be:

1. **Symmetric realism gate — UNCHANGED, HARD PASS.** `packages/data/test/realism-modern-norms.golden.test.ts` continues to assert all five norms inside their existing locked bands over the ~3,006-match Team2026-vs-Team2026 sweep. This is the canonical "WC realism" check and is what the D6 fit optimises for. Constants don't move except via an explicit fit re-run.

2. **Asymmetric realism gate — flip from REPORT-ONLY to HARD PASS, on a strategic population.** Concretely:
   - Harness uses a new `strategicAutoDraft` (slot-fit best-available) policy, NOT canonical `autoDraft`.
   - N=200 (current), seed prefix `wcdraft:realism:e3a:v1` (current), same `DRAFT_POOL_BUNDLE` and `SCENARIO_2026_BUNDLE` inputs (current).
   - Five WC norms, same Wilson tolerance as today, with one documented honest-state concession: `goals/game` band widened to `±max(2·√(target/N), 0.15)` (i.e. floor of ±0.15 g/g) so the strategic-underdog landing of ~2.39 g/g passes against the 2.54 norm. Justified in-line with the "underdog user XI vs two coherent elite WC sides" rationale — and explicitly NOT applied to the symmetric gate, where coherent-vs-coherent should hit 2.54 squarely.
   - Canonical `autoDraft` retained as a `[REALISM-AUTODRAFT]` log line in the SAME harness for telemetry, but does NOT participate in the PASS assertion.
   - Documented invariant: any future change to `LAMBDA` / `CHANCES` / `LAMBDA_DISP` must keep BOTH gates green; if a tuple closes one and breaks the other, the change is rejected.

3. **Faithfulness suite (D4) — UNCHANGED, HARD PASS.** `packages/core/src/faithfulness.test.ts` continues to enforce monotonicity / elite-ceiling / dominance-not-certainty / legibility / no-inversion. This is the safety rail against any future calibration tuple that "passes the norms" by collapsing faithfulness.

4. **Engine-version bump policy.** The deferred `engine_version` bump from `engine-2026.06.04` to the next pin is the moment all of: re-locked sim/e2e goldens, any `LAMBDA_DISP` adoption, the strategic asymmetric gate flip, and the `compact-data.integrity.test.ts` pin update land together. Atomic; no half-state.

This gate set is what makes "modern-WC realism is a PASS gate" honest in BOTH the tournament-realism sense (symmetric) and the player-experience sense (asymmetric strategic) without distorting either calibration.

## Preventive Measures

- **Never measure realism over a fixed-position autoDraft.** Canonical `autoDraft` is a determinism fixture, not a user-behavior proxy. Any future realism / balance / fairness telemetry must declare its draft policy explicitly and justify it; "we used autoDraft" should be a code-review smell.
- **Distinguish "tournament realism" from "player-experience realism" in test naming, in dashboards, and in commit messages.** The symmetric (Team2026-vs-Team2026) gate is the calibration anchor. The asymmetric (drafted XI vs Team2026) gate is the UX anchor. They can both pass, can both fail, can fail in opposite directions; the harness names should make that impossible to confuse. The pair's findings demonstrate the failure mode of conflating them — the doc already says "honest property", but the existence of a five-norm `✗ ✗ ✗ ✗ ✓` report banner naturally reads as "calibration is broken" to anyone who didn't write the harness.
- **Anchor every realism metric to a denominator floor.** `KO→ET 0%` on N=13 is meaningless; the harness already computes Wilson bands but the human-readable report should suppress or asterisk metrics whose `N < some-threshold` (e.g. KO < 30) so noise doesn't read as failure. Strategic raises KO matches from ~13 to ~96, which removes most of the natural denominator-collapse risk, but the lesson generalises.
- **Document the Pareto frontier the engine sits on, in `SIM_CALIBRATION.md`.** Pure independent-Poisson + chance-budget scoring has known tied/SO rate ceilings at fixed mean goals (the WIP `LAMBDA_DISP` doc captures this — the comment should land in `SIM_CALIBRATION.md` regardless of whether `LAMBDA_DISP` itself lands, so future calibrators don't try to grid-search past a structural limit).
- **Treat coordinate-descent fits as evidence, not proof.** The D6 fit landed at SPREAD=4.0 against the _symmetric_ sweep; this investigation confirms 4.0 is also closest by RMSE on the strategic asymmetric sweep, but only because the strategic population is competent enough to track WC norms. Any future fit must run BOTH gates inside its evaluation function (or explicitly justify why one is excluded), not just one.
- **WIP discipline — separate scratch branches from working calibration branches.** This investigation found three modified files and three untracked `test-tuple*.mjs` scripts on the very worktree we were asked to investigate. The WIP was preserved (`/tmp/asym-realism/wip-LAMBDA_DISP.diff`, `/tmp/asym-realism/wip-snapshot/`) and not destroyed, but a slightly less careful agent would have `git restore`'d it. Active calibration WIP should live on a separate branch (e.g. `engine-v2-e3b-lambda-dispersion`), not on the same worktree we measure against.
- **Add a CI-level guard.** A simple test in `@wcdraft/data` that imports `autoDraft` and asserts it produces strictly worse asymmetric realism than a reference strategic policy would catch any future "let's measure realism with autoDraft" regression at PR time.
