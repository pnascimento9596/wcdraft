# merit-v4.3 Explained Pick Flips

Generated from current v4.3 artifacts in `/tmp/wcdraft-merit-v43-20260615151133`
against the isolated v4.2 baseline worktree at `/tmp/wcdraft-retain-v24-20260615154423`
(`origin/main` at `6164abd`). No owner-checkout files were modified.

## Rating Movement Summary

- Compared cards: 12,219 / 12,219.
- Effective manual pins applied: 2,246 canonical cards.
- Non-manual movement: 0 cards changed.
- Manual movement: 1,261 down, 863 up, 122 unchanged.
- Average OVERALL: 75.2619 -> 75.0147 (delta -0.2472).
- 90+ share: 2.5043% -> 2.6516%.

Interpretation: the owner override is net-downward by mean OVERALL and by down/up
count. The 90+ share still rises slightly because a small number of high owner
pins move formerly sub-90 reserve/rotation players into the 90+ band. That is a
distribution-shape fact, not an application error; every moved card is manual-pinned
and every non-manual card is unchanged.

## Strategic Canary Pick Flips

- Before: `wc-perf-6.2.0+proj-career-5.2.0`, `engine-2026.06.15-merit-v4.2`.
- After: `wc-perf-6.3.0+proj-career-5.3.0`, `engine-2026.06.15-merit-v4.3`.
- Canary slots compared: 85 picks across 5 fixed seeds.
- Changed picks: 34 / 85.
- Changed player picks: 34.
- Changed manager picks: 0.

Per-seed changed picks:

| Seed | Parent seed | Changed picks | Total picks | Manager changed |
|---:|---|---:|---:|---|
| 0 | `wcdraft:realism:e3a:v1:0000` | 2 | 17 | no |
| 1 | `wcdraft:realism:e3a:v1:0001` | 8 | 17 | no |
| 2 | `wcdraft:realism:e3a:v1:0002` | 8 | 17 | no |
| 3 | `wcdraft:realism:e3a:v1:0003` | 7 | 17 | no |
| 4 | `wcdraft:realism:e3a:v1:0004` | 9 | 17 | no |

## Largest Downward Manual Moves

| Card | Player | From | To | Delta |
|---|---|---:|---:|---:|
| `P-52641:WC-2006` | Boumnijel | 77 | 51 | -26 |
| `P-12652:WC-2006` | Dossevi | 71 | 46 | -25 |
| `P-98486:WC-2006` | Osorio | 85 | 61 | -24 |
| `P-00640:WC-2006` | Jaziri | 81 | 59 | -22 |
| `P-14267:WC-2006` | Zaccardo | 84 | 63 | -21 |
| `P-77467:WC-2006` | Mendez | 84 | 63 | -21 |
| `P-79048:WC-2014` | Oshaniwa | 76 | 55 | -21 |
| `P-99473:WC-2006` | Grosso | 86 | 65 | -21 |
| `P-10860:WC-2006` | Pineda | 84 | 65 | -19 |
| `P-54768:WC-2006` | Ben Saada | 70 | 51 | -19 |

## Largest Upward Manual Moves

| Card | Player | From | To | Delta |
|---|---|---:|---:|---:|
| `P-53723:WC-2002` | Toldo | 72 | 92 | +20 |
| `P-53533:WC-2002` | Cisse | 72 | 90 | +18 |
| `P-28151:WC-2018` | Dybala | 71 | 88 | +17 |
| `P-23336:WC-2002` | Luque | 71 | 87 | +16 |
| `P-81947:WC-2022` | Trapp | 70 | 86 | +16 |
| `P-82191:WC-2002` | Andrade | 71 | 87 | +16 |
| `P-03367:WC-2022` | ter Stegen | 73 | 88 | +15 |
| `P-29172:WC-2002` | Inzaghi | 75 | 90 | +15 |
| `P-71130:WC-2002` | Tristan | 72 | 87 | +15 |
| `P-01311:WC-2002` | Montella | 72 | 86 | +14 |

## Reproduction Commands

```sh
node --input-type=module <<'JS'
// Compare v4.3 ratings/canary artifacts against the isolated v4.2 worktree.
// The command used for this report read:
//   /tmp/wcdraft-retain-v24-20260615154423/etl/output/{ratings,ratings_2026}.json
//   /tmp/wcdraft-merit-v43-20260615151133/etl/output/{ratings,ratings_2026}.json
//   packages/data/test/realism/strategic-pick-canary-golden.json in each worktree.
JS
```
