# Season 2 S1 — availability events and bench substitution model

## Outcome

Implemented on `ws-core/season2-s1-depth` from integration head
`59f74d3de68552f9602f9f849e575c2627c0de91`. This is a RED engine unit and is
not merged or shipped. Fresh-context review, cross-model spot review, PR CI,
and integration-branch merge remain orchestrator-owned gates.

## What changed

- Added an isolated, explicitly labeled `availability` RNG substream, scoped by
  match index. Availability is resolved before the unchanged `match_sim` and
  `event_gen` outcome streams are instantiated.
- Replaced post-outcome flavor injuries/tactical substitutions with mechanical
  pre-match absences: seeded knocks, suspensions, and tournament-ending
  injuries. Minor events last one or two matches and are capped at three per
  run; tournament-ending injuries never expire.
- Added hard bench-replacement eligibility only in the S1 resolver. GK is
  isolated; outfield same/adjacent families are derived from the canonical
  position-compatibility matrix. Missing eligibility fails closed.
- Added deterministic best-replacement selection using the target line's
  sim-internal rating channel multiplied by canonical target-slot fit. Ties are
  broken by canonical card id.
- Rebuilds the active formation slots for every match, recomputes NATION-only
  Synergy over that active XI, then recomputes strength. A missing replacement
  uses the fixed eleven-slot denominator plus an explicit short-handed
  multiplier, so depth failure is strictly worse than inserting an eligible
  replacement.
- Added persisted `MatchTeamFacts`: base/active strength, base/active Synergy,
  absences, activations, and short-handed slots. Each activation carries its
  line, incoming and outgoing slot contributions, and signed factual line
  contribution delta. S6 can render these facts without speculative UI math.
- Added mechanical `availability` events at minute 0 with exact replacement or
  short-handed state. The retired flavor `injury`/`sub` generation no longer
  describes substitutions that did not affect the match.
- Added the pure exported `projectSlotContribution` seam used by S1 replacement
  ranking and reserved for S5 fit teaching. It accepts only engine-facing
  rating/eligibility/slot inputs; UI display mapping remains outside core.
- Threaded authoritative eligibility through production web simulation and the
  worker clone boundary, plus real-data/golden/realism builders.
- Kept `team_facts` optional at the persisted schema boundary so legacy records
  still reach honest version-skew handling. Every new tournament simulation
  emits the facts.

## Reconciliation — Architect-delegated decisions

1. **Internal replacement score.** The dispatch says `internal score × fit`,
   while `Rating.overall` is explicitly display-only and forbidden to the sim.
   S1 therefore defines the relevant internal score as the target line's
   basis-resolved sim channel: GK→goalkeeping, DF→defense, MF→midfield,
   FW→attack. `projectSlotContribution` applies canonical slot compatibility to
   that channel. This is the least-behavior-changing interpretation because it
   uses only the four existing sim-authorized inputs and makes the selected
   replacement legible by the role being filled.
2. **Hard family adjacency.** No second family table was introduced. GK is
   eligible only for GK; outfield same/adjacent families are the entries with
   canonical compatibility `>= 0.75` in `POSITION_COMPATIBILITY_FACTORS`.
   DF↔FW therefore remains ineligible while DF↔MF and MF↔FW are eligible. This
   follows the owner adjudication and prevents a new table from drifting from
   the formation/fit contract.
3. **Short-handed strength.** `aggregateUserXiStrength` correctly requires
   eleven contributions and was left unchanged. S1's active fold keeps the
   eleven-slot denominator (a missing player contributes zero), recomputes
   Synergy on the actual remaining starters, and then applies
   `SHORT_HANDED_STRENGTH_MULTIPLIER=0.92` once per vacancy. Coverage continues
   to average known active-player coverage because it describes evidence
   quality, not playing strength. The constant is exposed for S3 calibration.
4. **Legacy fact compatibility.** New simulations always emit
   `MatchTeamFacts`, but the MatchResult boundary accepts the field as absent.
   Making it required would reject pre-season persisted simulations before the
   existing honest `DIFFERENT_BUILD` path could run. S6 must treat absent facts
   as unavailable/skew and must not reconstruct them.
5. **Event representation.** Availability uses a dedicated minute-0 event
   rather than overloading the old in-match injury/substitution variants. This
   keeps narrative/event facts honest: the unavailable starter never entered
   the mechanical XI, while the replacement is stamped as a starter rather
   than falsely shown as a 60th-minute substitute.

## Golden delta audit before re-lock

The five core scenarios and real-data integration fixture were replayed at
their old fixed seeds before regeneration. All six preserved the outcome
boundary exactly. Event/player-stat bytes changed because the old post-hoc
injury/tactical-sub stream was intentionally removed. The two eventful uniform
core fixtures also preserved outcomes because their eligible bench cards have
the same channel ratings as their starters.

| Fixture                  | New availability events at old seed | Round results / record / score / reached | Narrative |
| ------------------------ | ----------------------------------: | ---------------------------------------- | --------- |
| core `blowout`           |                                   2 | identical · `8-0-0` · 154 · F            | identical |
| core `upset`             |                                   0 | identical · `3-0-2` · 12 · R16           | identical |
| core `draw_into_pens`    |                                   0 | identical · `7-0-1` · 88 · F             | identical |
| core `injury_cascade`    |                                   1 | identical · `6-0-1` · 120 · SF           | identical |
| core `group_elimination` |                                   0 | identical · `0-0-3` · -26 · G3           | identical |
| data `e2e-real-run`      |                                   2 | identical · `2-1-1` · 11 · R32           | identical |

The regenerated `injury_cascade` seed is
`wcb-golden-injury_cascade-387`; it now proves two unique tournament-ending
availability injuries persist out of all later lineups. The other four core
scenario seeds were retained. The real-data generator retained its fixed seed
`wcdraft:e2e-real-run:engine-v2-e3a:881`.

## Validation evidence

- Disk preflight: verified 34 GiB free before S1 after scoped cleanup of
  reconstructable caches and stale runner diagnostics. The wcdraft runner
  `_work` was empty and all recovery/season worktrees were retained.
- Required bootstrap Actions: runs `29197651416` (CI) and `29197651369` (ETL)
  both completed `success` at integration SHA `59f74d3…`.
- Focused availability + sim golden: **67/67 passed** across 2 files.
- Core full test: **405/405 passed** across 27 files.
- Core typecheck and lint: PASS.
- Core RNG/narrative goldens: **69/69 passed**.
- Core draft goldens: **42/42 passed**.
- Affected data/new-formation tests: **18/18 passed**.
- Data integration goldens: **22/22 passed**.
- Data golden/data suite: **59/59 passed** across 4 files.
- Data typecheck and lint: PASS.
- Web simulation/worker/run-record focused tests: **52/52 passed** across 5
  files after building the core/data workspace outputs.
- Web typecheck and lint: PASS.
- Web leaderboard golden: **6/6 passed**.
- Generated-data determinism: `pnpm check:generated` PASS after explicitly
  staging the intentional provisional distribution artifacts.
- Root production build: **4/4 tasks passed** (core cached; data, DB, and web
  executed). Next generated 40/40 static pages; existing circular-chunk and
  Edge/static-generation warnings only.
- Initial exact heavy realism N=2000×3 diagnostic: **6/9 passed**. All four
  pre-S1 strategic shape bands passed and strategic goals/game remained above
  its floor (2.682). The three failures were exact mechanics locks: per-policy
  counts, strategic score population, and shipped distribution quantiles.
- Architect-delegated provisional lock: updated exact mechanics telemetry,
  asserted counts, and strategic score population without changing constants,
  the goals floor, or semantic shape centers/widths. Shape bands now carry
  explicit pre-S1 centers, so current observed telemetry cannot silently
  re-center them; a regression test proves that separation.
- Required artifact order: `build:compact → build:score-distribution →
build:compact` PASS. The regenerated distribution is N=2000, qualifying
  1336, median 9, p95 62, min -24, max 126.
- Generated artifact scope: current score-distribution JSON+Brotli, manifest
  JSON+Brotli, and `packages/data/reports/compact-size.json`. Draft pool,
  scenario, daily salt map, retained bundles, ratings, and rating anchors did
  not move.
- Final exact heavy realism: **10/10 passed** (the original 9/9 gates plus the
  fixed-center regression). This provisional mechanics snapshot is not S3
  calibration acceptance; S3 must replace it after tuning against all binding
  targets.

Heavy measurements at the S1 head:

| Policy                 | Qualifying | Matches | Group |   KO |
| ---------------------- | ---------: | ------: | ----: | ---: |
| autoDraft              |   333/2000 |    6472 |  6000 |  472 |
| strategicAutoDraft     |  1336/2000 |    8866 |  6000 | 2866 |
| greedyOverallAutoDraft |   502/2000 |    6780 |  6000 |  780 |

Strategic score population: mean 14.644, median 9, p95 62, min -24, max 126. These are S1 handoff measurements, not a calibration claim.

## Risks and S3/S6 carryovers

- The initial S1 constants (`AVAILABILITY_EVENT_PROB=0.09`, minor duration
  mix, short-handed multiplier) are intentionally conservative. S3 must tune
  them against all binding bench/manager/hierarchy/difficulty targets.
- The exact mechanics snapshot is explicitly labeled provisional. S1 did not
  tune constants or move semantic realism centers/widths; S3 must deliberately
  replace counts, telemetry, centers, and distribution with the calibrated
  final locks.
- `active_strength` is the pre-tactical S1 strength. S2 will add the distinct
  tactical tier/multiplier/post-tactical strength and explicit
  `tactical_applied_to_outcome` flag to the same `team_facts` row.
- S6 must label activation deltas as **slot/line contribution** facts. It must
  not attribute aggregate base→active strength or Synergy movement to a single
  activation when multiple absences coexist.
- Ratings, offer tiering, rating aggregation, auth/CSRF, leaderboard semantics,
  token codec, team-sheet arrangement, challenge flow, and production anchors
  are untouched.

## PR body material

Use the Outcome, Reconciliation, Golden delta audit, Validation evidence, and
Risks sections above verbatim or by direct summary. Required review focus:
isolated RNG lineage; eligibility fail-closed behavior; active-slot Synergy;
legacy missing-facts decode; short-handed monotonicity; and the intentional S3
calibration carryover.
