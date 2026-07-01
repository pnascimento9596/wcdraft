# Engine Season: manager attrition + soft spread

Date: 2026-06-30
Branch: `ws-core/engine-season-20260630`
Base after final rebase: `origin/main` `7b31d1b`
Status: local implementation, gates, and fresh-context review PASS; production
merge/deploy/live verification pending at report time.

## Summary

This lane moves the engine anchor from `engine-2026.06.30-spin-agency` to
`engine-2026.06.30-manager-attrition` and the active leaderboard season default
to `season-2026-manager-attrition`.

The branch includes the in-flight owner amendment: U5 softens choose-from-3 by
raising the weakest offered candidate floor. It preserves choose-from-3 agency,
keeps position diversity in the offer builder, and does not change ratings,
legend catalog weights, era mass, or draw availability.

The final rebase landed over the spin-agency baseline, OG durability,
lineup-cache deploy recovery, and OG durability closeout lanes. Those fixes are
base context for this branch, not additional season scope.

Rating anchors remain `wc-perf-6.6.0` and `proj-career-5.6.0`. That is
intentional: U1 revalidated the committed owner-override resolver and found no
additional high-confidence recoveries beyond the existing merit-v4.5 recovered
set. Relabeling unchanged ratings as a new rating version would be misleading.

Runtime schema remains `runtime-data-2.9.0`; no replay shape field changed.
Replay semantics still change because U5 changes offered player sampling under
the new engine anchor.

## Season Units

### U1 - honest-miss recovery

Command:

```sh
PYTHONPATH=etl/src python3 -m wcdraft_etl.manual_overrides
```

Measured output:

- v4.3: 2,300/2,516 matched (91.41%); 216 unmatched
- v4.5: 2,336/2,516 matched (92.85%); 180 unmatched; 36 recovered v4.3 honest misses
- v4.4: 515/515 matched (100.00%); 0 unmatched; 2,691 combined effective card pins

Current v4.5 unresolved count is 180. New recoveries in this lane: 0. The
unmatched artifact remains dominated by `no_unambiguous_match` (112 rows),
`duplicate_conflict_weaker_match` (34), `source_hint_not_player_name` (19),
`ambiguous_unapplied` (11), and `duplicate_conflict_weak_only` (4). No row was
force-matched.

Confidence threshold: apply only rows that resolve to one canonical card in the
same nation/year block under the existing committed resolver and recovered-row
validation. Ambiguous, weak, duplicate-conflict, source-hint, or absent rows stay
as honest misses.

Recovered sample for this lane: none, because recovered count is 0.

### U2 - manager band

`managerBandModifier()` now applies the reserved positive band:

```ts
1 + MANAGER_MODIFIER.BAND * clamp(synergy.manager_link, 0, 1);
```

`MANAGER_MODIFIER.BAND` is `0.1`. The sim path still does not read
`ManagerRating.overall`; manager display overall remains display-only. The
mechanical manager signal is `SynergyResult.manager_link`, derived from the
drafted manager nation and starter nation mix.

N=2000 realism telemetry moved manager modifier mean from `1.0000` to `1.0031`
for all three policy populations. Synergy multiplier mean and coverage mean were
unchanged.

### U3 - injury attrition

This lane chose the lower-probability branch rather than full opponent
tournament attrition symmetry. The engine tracks persistent injury attrition for
the user's run path, while opponents are regenerated fixture-by-fixture. Making
opponent attrition symmetric would require a broader tournament-roster state
model.

`INJURY.TOURNAMENT_ENDING_PROB` moved from `0.34` to `0.12`. With the existing
per-match injury probabilities (`0.5` primary, `0.2` second), expected
persistent injury events per match move from about `0.238` to `0.084`.

### U4 - position-fit assessment

No position-fit weighting change was added. The post-U1-through-U3 N=2000 policy
comparison showed choose-from-3 already makes fit non-trivial before U5:

| Policy                   | Qualifying | Goals/game | Margin >=4 | KO -> ET | Shootout |
| ------------------------ | ---------: | ---------: | ---------: | -------: | -------: |
| `strategicAutoDraft`     |  1090/2000 |     2.7041 |      4.45% |   32.60% |   19.85% |
| `greedyOverallAutoDraft` |   463/2000 |     3.0039 |     11.17% |   26.31% |   16.39% |
| `autoDraft`              |   211/2000 |     2.8322 |     15.22% |   25.19% |   13.74% |

Strategic slot-fit materially outperforms position-blind max-overall on
qualification and lands on the intended shape bands. Greedy max-overall remains
the negative control, not the dominant strategy.

### U5 - choose-from-3 soft-floor spread

U5 changes `rankedChoiceCandidates()` from three full-roster thirds to an
eight-bucket spread. A full three-player offer now samples one candidate from
bucket 0, one from bucket 1, and one from bucket 2; buckets 3-7 are omitted from
forced choice offers. This raises the floor of the weakest offered player without
changing player ratings, display OVR, legend availability, era mass, or catalog
draw weights.

Agency is preserved because offers still contain top/middle/soft-floor tiers,
not three near-identical cards. Position diversity is preserved by the existing
`selectDiverseChoice()` scoring and was measured at 99.975% of full offers after
U5.

Strategic difficulty, N=2000:

| Metric                | Post-U1-U3 baseline |            Post-U5 |           Delta |
| --------------------- | ------------------: | -----------------: | --------------: |
| Qualifying            |  1090/2000 (54.50%) | 1329/2000 (66.45%) | +239 / +11.95pp |
| Champion              |                  30 |                 53 |             +23 |
| Undefeated regulation |                   6 |                 10 |              +4 |
| Perfect 8-0           |                   4 |                  7 |              +3 |
| Mean score            |               8.229 |             14.479 |          +6.250 |

This lands inside the owner starting target for qualifying rate (65-70%) and
mean score (14-18), while undefeated/perfect rises modestly rather than
ballooning.

Offer composition, N=2000 strategic drafts:

| Metric                         | Post-U1-U3 baseline |           Post-U5 |              Delta |
| ------------------------------ | ------------------: | ----------------: | -----------------: |
| Total player choices           |              96,000 |            96,000 |                  0 |
| Full three-player offers       |              32,000 |            32,000 |                  0 |
| 90+ offered choices            |     8,694 (9.0563%) | 10,316 (10.7458%) | +1,622 / +1.6895pp |
| Legend offered choices         |     7,717 (8.0385%) |   9,442 (9.8354%) | +1,725 / +1.7969pp |
| Full-offer position diversity  |            100.000% |           99.975% |           -0.025pp |
| Full-offer min OVR mean        |              71.319 |            78.210 |             +6.891 |
| Full-offer min OVR p05/p50/p95 |        66 / 71 / 78 |      71 / 78 / 87 |             raised |

The offered 90+ and legend shares rose materially because U5 intentionally omits
the bottom five-eighths of legal ranked rosters from full forced-choice offers.
That is not a catalog draw-probability change, but it is real offered-card
exposure and should be reviewed as the main feel/invariant risk.

## Combined Realism Re-lock

The asymmetric realism golden was regenerated over the combined U1+U2+U3+U5
effect, N=2000 per policy:

| Policy                   | Qualifying | Goals/game |  Draws | Margin >=4 | KO -> ET | Shootout |
| ------------------------ | ---------: | ---------: | -----: | ---------: | -------: | -------: |
| `strategicAutoDraft`     |       1329 |     2.6810 | 25.02% |      4.16% |   31.97% |   19.82% |
| `autoDraft`              |        326 |     2.7880 | 19.17% |     12.09% |   25.77% |   14.32% |
| `greedyOverallAutoDraft` |        500 |     3.0263 | 19.22% |     10.68% |   26.54% |   15.13% |

Post-U1-U3 baseline to post-U5 deltas:

| Policy                   | Qualifying delta | Goals/game delta | Draw delta | Margin >=4 delta | KO -> ET delta | Shootout delta |
| ------------------------ | ---------------: | ---------------: | ---------: | ---------------: | -------------: | -------------: |
| `strategicAutoDraft`     |             +239 |          -0.0231 |    -0.20pp |          -0.29pp |        -0.63pp |        -0.03pp |
| `autoDraft`              |             +115 |          -0.0441 |    +2.58pp |          -3.13pp |        +0.58pp |        +0.58pp |
| `greedyOverallAutoDraft` |              +37 |          +0.0224 |    +0.38pp |          -0.49pp |        +0.23pp |        -1.26pp |

The strategic target difficulty moved from too hard to the requested easier band.
Realism shape stayed plausible: lower blowout share, similar draw/KO profile, and
goals/game still above the re-locked lower floor.

## Canary And Replay Semantics

Strategic pick canary comparison against the committed spin-agency canary:

- Records: 5
- Picks compared: 85
- Pick flips: 60
- Manager pick flips: 0

The flips are expected: U5 changes which player cards are offered in the
choose-from-3 spread. The canary was regenerated under
`engine-2026.06.30-manager-attrition`, then re-run normally and passed. Legacy
tokens must be treated as a different build; same-token determinism under the new
engine still holds byte-for-byte.

## Legend Preservation

Ratings and catalog draw probabilities are unchanged in this lane.

Display OVR before/after:

| Population | Count | Min | p05 | Median | p95 | Max | Verdict   |
| ---------- | ----: | --: | --: | -----: | --: | --: | --------- |
| Legends    |   295 |  81 |  88 |     91 |  98 |  99 | unchanged |
| Elite 90+  |   324 |  90 |  90 |     92 |  98 |  99 | unchanged |

Catalog draw-probability before/after:

| Metric               |         Before |          After | Verdict   |
| -------------------- | -------------: | -------------: | --------- |
| Total catalog weight | 1.000000000000 | 1.000000000000 | unchanged |
| Legend pair weight   | 0.315350389194 | 0.315350389194 | unchanged |
| Elite pair weight    | 0.332211767399 | 0.332211767399 | unchanged |
| Rare pair weight     | 0.100000000000 | 0.100000000000 | unchanged |

Rating-pool 90+ share remains 324/12,219 = 2.6516%. The separate offered-choice
90+ share rose from 9.0563% to 10.7458%; that is reported under U5 because it is
an offer-composition consequence, not a rating-pool or catalog-probability
change.

## Anchors

| Field                     | Value                                                              |
| ------------------------- | ------------------------------------------------------------------ |
| schema_version            | `runtime-data-2.9.0`                                               |
| dataset_version           | `2026-06-04`                                                       |
| ruleset_version           | `ruleset-2026.06.04`                                               |
| engine_version            | `engine-2026.06.30-manager-attrition`                              |
| rating_version_historical | `wc-perf-6.6.0`                                                    |
| rating_version_projected  | `proj-career-5.6.0`                                                |
| active leaderboard season | `season-2026-manager-attrition`                                    |
| draft-pool sha256         | `4daaf209900759b1acc1ef59574ec223e636ced828f541a37bf561c20aab2bf0` |
| scenario sha256           | `7846fa3abe0eab4aa283efd1e8382959593ec1248030eba13913fac0ae8da398` |
| manifest sha256           | `688a9d15feb24eaa6816e4bfad1ccbc14bee1bcf4c19c738bad5bef02bbde68a` |

## Validation

- `pnpm --filter @wcdraft/core build` - PASS
- `pnpm --filter @wcdraft/core run gen:golden:draft` - PASS
- `pnpm --filter @wcdraft/data run build:compact` - PASS
- `pnpm --filter @wcdraft/data run gen:e2e-golden` - PASS; selected first satisfying seed `wcdraft:e2e-real-run:engine-v2-e3a:881`
- `pnpm --filter @wcdraft/data run gen:era-golden` - PASS
- `WCDRAFT_CANARY_REGEN=1 pnpm --filter @wcdraft/data exec vitest run test/realism/strategic-pick-canary.golden.test.ts` - PASS, 1 file / 1 test
- `pnpm --filter @wcdraft/data exec tsx scripts/regen-asym-golden.mts` - PASS
- `pnpm --filter @wcdraft/web run gen:leaderboard-golden` - PASS
- `pnpm --filter @wcdraft/core exec vitest run src/draft.golden.test.ts src/lock-on-pick.golden.test.ts src/position-compatibility.golden.test.ts src/entity-resolution.golden.test.ts src/manager-identity.golden.test.ts` - PASS, 5 files / 42 tests
- `pnpm --filter @wcdraft/data run test:golden:data` - PASS, 2 files / 31 tests
- `pnpm --filter @wcdraft/data run test:golden:integration` - PASS, 2 files / 22 tests
- `pnpm --filter @wcdraft/data exec vitest run test/realism/strategic-pick-canary.golden.test.ts` - PASS, 1 file / 1 test
- `pnpm --filter @wcdraft/data run test:realism:heavy` - PASS, 1 file / 7 tests
- `pnpm --filter @wcdraft/web run test:golden:leaderboard` - PASS, 1 file / 6 tests
- `pnpm --filter @wcdraft/core exec vitest run src/draft.golden.test.ts src/manager-modifier-decoupling.guard.test.ts src/synergy.golden.test.ts src/sim.golden.test.ts` - PASS, 4 files / 95 tests
- `pnpm typecheck` - PASS, 8/8 Turbo tasks
- `pnpm lint` - PASS, 5/5 Turbo tasks
- `pnpm --filter @wcdraft/web exec vitest run lib/leaderboard/__tests__/lineup-inspector.test.ts` - PASS, 1 file / 9 tests
- `pnpm --filter @wcdraft/web run typecheck` - PASS
- `pnpm test` - PASS, 8/8 Turbo tasks; core 384 tests, data 84 passed / 7 skipped, db 104 tests, marketing 67 tests, web 818 passed / 1 skipped plus `game-flow-playwright`
- `pnpm build` - PASS, 4/4 Turbo tasks; Next emitted existing circular-chunk and edge-runtime warnings

Resolved transient: `test:golden:integration` initially failed after U5 because
the generated E2E fixture moved to seed `:881` while the test constant still
pointed at `:105`. The constant was updated and the integration golden reran
PASS.

## Fresh-context Review

Independent fresh-context RED review re-read the current working-tree diff and
reported no blockers. The reviewer re-executed the requested gates from
`/tmp/wcdraft-engine-season-20260630`:

- `git diff --check` - PASS, no output; re-run after build side effects also PASS
- core targeted draft/lock/position/entity/manager goldens - PASS, 5 files / 42 tests
- `pnpm --filter @wcdraft/data run test:golden:data` - PASS, 2 files / 31 tests
- `pnpm --filter @wcdraft/data run test:golden:integration` - PASS, 2 files / 22 tests
- strategic pick canary - PASS, 1 file / 1 test
- heavy realism - PASS, 1 file / 7 tests
- leaderboard golden - PASS, 1 file / 6 tests
- `pnpm typecheck` - PASS, 8/8 Turbo tasks
- `pnpm lint` - PASS, 5/5 Turbo tasks
- `pnpm test` - PASS, 8/8 Turbo tasks
- `pnpm build` - PASS, 4/4 Turbo tasks

Reviewer non-blocking probe for the U5 bucket edge: 5,000 real-pool drafts,
85,000 player spins, `minRolled=3`, `short=0`.

## Not Run

- Production merge/deploy/live verification were not run.
- Auto-revert was not exercised because no production deployment was made.
- Lambda refit was not run because no display curve, rating inputs, or
  `LAMBDA`/`CHANCES` constants moved. The realism golden was re-locked for the
  combined manager/injury/U5 engine behavior change.

## Risks / Review Focus

- The checked-in WCDraft operating contract now uses the v5 autonomous RED
  model: fresh-context implementer/reviewer separation, machine gates,
  SHA-pinned merge, deploy observation, live verification, and auto-revert on
  failed live checks. No human approval gate applies.
- U5 materially increases offered 90+ share (+1.6895pp) and offered legend share
  (+1.7969pp). It does not change legend draw probability or rating strength,
  but the player will see elite cards in the choice set more often because the
  weak offer floor was raised.
- There is a narrow synthetic small-roster U5 coverage gap: legal rosters of 4
  or 5 cards can theoretically produce fewer than three offered player choices
  because the top-three-of-eight bucket filter has sparse buckets. The real pool
  probe found no current short offers across 85,000 player spins, so this is a
  carryover hardening item rather than a current blocker.
- Opponent injury attrition is still not persistent tournament state. This lane
  reduced user-path persistent injury probability rather than introducing a new
  opponent tournament-roster model.
- Active leaderboard season rotation is code-default only in this branch. Live
  production must still verify env/default behavior after deploy.

## Git State

This report was prepared on the integration branch before production
merge/deploy/live verification. The post-deploy live readback belongs in the
operator closeout.
