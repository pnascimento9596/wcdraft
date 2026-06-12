# merit-v3 V7 — Lambda Refit + Realism Re-lock

Date: 2026-06-12  
Branch: `merit-v3-v7-lambda` off post-V6 `merit-v3` (`b416199`)  
Scope: lambda constants, fitter grid/logging, realism/sim goldens, SIM calibration docs. The public `engine_version` stamp remains `engine-2026.06.09`; V8 owns the single season stamp.

## Fitter

Command:

```sh
pnpm --filter @wcdraft/data exec tsx scripts/fit-calibration.mjs
```

Grid adjustment:

- First run extended `GAMMA_MID` upward from the old edge (`0.60`) to `[0.40, 0.50, 0.60, 0.70, 0.80]`.
- That run landed on grid edges (`GAMMA_MID=0.80`, `MIN=0.60`, `GROUP_OUTER_PROB=0.06`), so the grid was extended again before accepting a tuple.
- Final grid extensions: `MIN=[0.30,0.40,0.50,0.60,0.70,0.80]`, `GAMMA_MID=[0.40,0.50,0.60,0.70,0.80,0.90,1.00]`, `GROUP_OUTER_PROB=[0.00,0.02,0.04,0.06,0.10,0.14,0.18]`.

Seed landing:

```text
SPREAD=6.5 BASE=0.85 MIN=0.4 MAX=3.4 W_DEF=0.7/W_GK=0.30 gamma_mid=0.5 ko_f=0.85 n=50 DISP(p=0.2,A=0.75,group_p=0.1,group_A=0.5)
score=4002.2339 goals=2.168 down draw=29.17% up m4=3.49% down ET=38.27% up SO=24.40% ok
```

Winner:

```text
score=0.0089 evals=175
SPREAD=6.5 BASE=1.05 MIN=0.7 MAX=3.4 W_DEF=0.7/W_GK=0.30 gamma_mid=0.8 ko_f=0.82 n=50 DISP(p=0.2,A=0.75,group_p=0.1,group_A=0.5)
goals=2.534 ok draw=25.18% ok m4=4.96% ok ET=33.47% ok SO=21.33% ok
```

No accepted fitted parameter is on an extendable grid boundary.

## Constants

Changed in `packages/core/src/engine/calibration.ts`:

| Constant | Before | V7 |
|---|---:|---:|
| `LAMBDA.BASE` | 1.00 | 1.05 |
| `LAMBDA.SPREAD` | 7.00 | 6.50 |
| `LAMBDA.MIN` | 0.40 | 0.70 |
| `LAMBDA.GAMMA_MID` | 0.60 | 0.80 |

Unchanged: `MAX=3.4`, `W_DEF/W_GK=0.70/0.30`, `KO_LAMBDA_FACTOR=0.82`, `CHANCES=50/17`, `LAMBDA_DISP={0.20,0.75,0.10,0.50}`.

## Gates

Focused gates run on the branch:

```text
pnpm --filter @wcdraft/data exec vitest run test/realism-modern-norms.golden.test.ts
PASS 5/5
mean_goals=2.534, group_draw=25.18%, margin_ge_4=4.96%, ko_et=33.47%, ko_shootout=21.33%

pnpm --filter @wcdraft/core exec vitest run src/faithfulness.test.ts
PASS 11/11

pnpm --filter @wcdraft/data test:realism:heavy
PASS 7/7

pnpm --filter @wcdraft/core exec vitest run src/sim.golden.test.ts
PASS 53/53 after regenerating sim-golden

pnpm --filter @wcdraft/data exec vitest run test/e2e-real-run.golden.test.ts
PASS 10/10

pnpm typecheck && pnpm lint && pnpm test && pnpm build
PASS
```

The initial `sim.golden.test.ts` run failed 5/53 before relock, proving the constants moved deterministic engine output. The pure sim fixture was regenerated with:

```sh
pnpm --filter @wcdraft/core run gen:sim-golden
```

Generator output:

```text
blowout: score=152 champion=true
upset: score=15 champion=false
draw_into_pens: score=38 champion=false
injury_cascade: score=138 champion=true
group_elimination: score=-9 champion=false
```

The leaderboard validation golden also moved by one deterministic event under the
new tuple: hidden fixture `Offsides.raw` `3 -> 2`; season key and verified score
remain unchanged (`engine-2026.06.09_..._69eb7e4a`, hidden score `-25`).
Regenerated with:

```sh
pnpm --filter @wcdraft/web gen:leaderboard-golden
```

## Asymmetric Re-lock

Regenerated with:

```sh
pnpm --filter @wcdraft/data exec tsx scripts/regen-asym-golden.mts
```

Strategic landing:

```text
qualifying=1574/2000
matches=9724
groupMatches=6000
knockoutMatches=3724
goals/game=2.554
draw=26.08%
margin>=4=4.41%
KO->ET=32.95%
shootout=20.49%
```

Shape bands were re-derived from the V7 strategic landing using the pre-existing recipe:

```text
draw_pct half_width=max(1.13pp, 1.50pp)=1.50pp
margin4plus_pct half_width=max(0.42pp, 1.50pp)=1.50pp
ko_et_pct half_width=max(1.54pp, 1.50pp)=1.54pp
shootout_pct half_width=max(1.32pp, 1.50pp)=1.50pp
```

Greedy negative control:

```text
qualifying=271/2000
matches=6390
groupMatches=6000
knockoutMatches=390
draw=16.00%
margin>=4=17.20%
KO->ET=22.31%
shootout=11.79%
```

All four greedy shape metrics are outside the strategic bands.

## Current-Basis Baseline For DC-7

Computed from `packages/data/src/generated/draft-pool.compact.json`, `n=12,219` for both bases.

| Basis | Channel | min | p10 | p25 | median | p75 | p90 | p95 | max | mean |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Career | overall | 66 | 70 | 71 | 73 | 82 | 88 | 88 | 99 | 76.673 |
| Career | attack | 20 | 21 | 26 | 33 | 39 | 51 | 60 | 100 | 34.582 |
| Career | midfield | 20 | 23 | 28 | 35 | 44 | 52 | 60 | 100 | 36.838 |
| Career | defense | 20 | 24 | 27 | 33 | 41 | 51 | 60 | 96 | 35.570 |
| Career | goalkeeping | 20 | 20 | 20 | 20 | 20 | 33 | 47 | 84 | 22.887 |
| Current | overall | 66 | 70 | 71 | 73 | 82 | 88 | 88 | 91 | 76.360 |
| Current | attack | 20 | 21 | 26 | 33 | 38 | 47 | 57 | 80 | 33.960 |
| Current | midfield | 20 | 23 | 28 | 34 | 44 | 50 | 57 | 80 | 36.238 |
| Current | defense | 20 | 24 | 27 | 33 | 41 | 51 | 60 | 72 | 35.116 |
| Current | goalkeeping | 20 | 20 | 20 | 20 | 20 | 33 | 47 | 80 | 22.834 |

## Anchor Policy

V7 intentionally does not bump `engine_version`. The committed asymmetric golden header says the runtime manifest remains `engine-2026.06.09` until V8, and the new tuple is pending the V8 season stamp. Runtime manifest, leaderboard season key, run-token skew fixtures, and public version anchors are V8 work.
