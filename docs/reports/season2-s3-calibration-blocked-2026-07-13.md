# Season 2 S3 — squad-depth calibration frontier

Date: 2026-07-13

Base: `de019efa3d2d2acd04c7505d8f93c352bf9d99d4`

Risk: RED (simulation calibration)

Status: **BLOCKED — the binding sensitivity and mean-absolute-delta targets do
not intersect under the dispatched mechanics.** No realism band or generated
artifact has been re-locked to a failing candidate.

## Outcome

The candidate S3 harness is implemented at
`packages/data/scripts/measure-squad-depth-calibration.mts`. It runs N=2000 on
all three existing realism policies, uses identical parent seeds for every
baseline/counterfactual pair, reports changed-run sensitivity and mean absolute
score delta over **all N runs**, and hard-asserts every binding strategic target.

The calibration sweep and an independent fresh-context review found a genuine
target conflict rather than a missing constant:

- The binding **literal absent-bench** counterfactual misses the targets. At
  p=.15 it lands 33.35% sensitivity and 2.3955 all-run mean |delta|. The S1/S2
  handoff lands 28.0% and 2.6705.
- A more optimistic zero-channel diagnostic (bench identities and eligibility
  retained) can reach 35.65% with activation inside 40–55%, but mean |delta|
  is 2.585 points. Because literal absence invokes S1's intentionally harsher
  short-handed path, the optimistic diagnostic cannot establish a passing
  literal zero-bench candidate.
- Manager is a direct reachability contradiction: merged S2 derives every
  manager effect from `manager_link`, but only 392/2000 (19.6%) strategic runs
  have a positive link. No S3 width or probability constant can meet the
  binding 25% no-manager sensitivity floor.
- Presence-based +1 and fractional post-strength diagnostics can exceed the
  manager reach floor, but they are new mechanics/contracts rather than S3
  constant tuning; their measured points also miss the mean cap and difficulty
  mean.
- The XI offer-runner-up perturbation remains strictly dominant throughout
  (46.9–48.45%), satisfying the hierarchy direction.

This unit therefore does not claim PASS and does not weaken any target. A
binding adjudication is required before realism/difficulty goldens can be
honestly re-locked.

## Harness definitions

No prior committed L3 counterfactual harness exists in the repository. The
dispatch's historical 49% XI sensitivity is reference context, not reproduced
provenance. S3 defines the controlled perturbations explicitly:

1. **Zero bench.** Clear the five bench slots while preserving the baseline XI,
   completed board, and tournament seed. Availability draws stay paired; an
   unavailable starter therefore takes S1's truthful short-handed path. The
   separate zero-channel rows in this report retain identities/eligibility and
   are explicitly optimistic diagnostics, not the binding interpretation.
2. **No manager.** Preserve the completed draft and tournament seed; clear only
   `manager_card_id`. This removes manager-link Synergy, the aggregate manager
   channel, and the tactical channel together.
3. **XI offer runner-up.** Scan starter picks in original spin order and replace
   the first selected policy winner with that actual offer's policy-ranked
   second card, preserving the starter slot. Skip a runner-up that later appears
   elsewhere in the completed squad. The strategic row reuses the exact
   slot-fit/channel/overall/card-id ordering from `draft-policies.ts`; canonical
   and greedy rows use their own existing policy order. The draft is not rerun,
   so later offers and all tournament RNG remain fixed.

Every pair runs with the same
`wcdraft:realism:e3a:v1:${index.padStart(4, "0")}` parent seed. Mean |delta|
uses all 2,000 runs, including zero-delta runs.

## Exact N=2000 strategic sweep

All rows below completed in report-only mode. They are measurements, not
passing locks.

| Candidate                     | Availability / minor shape                 | Manager shape                             | Qualifying | Mean score | Activation |                      Bench changed / mean | Manager changed / mean | XI changed |
| ----------------------------- | ------------------------------------------ | ----------------------------------------- | ---------: | ---------: | ---------: | ----------------------------------------: | ---------------------: | ---------: |
| S1/S2 handoff                 | p=.09, duration2=.35, cap=3, short=.92     | link-only, rounded width=.01              |     66.80% |    14.6410 |     33.00% | 28.00% / 2.6705 (bench absent diagnostic) |          9.35% / .5390 |     47.45% |
| probability/penalty           | p=.12, duration2=.35, cap=3, short=.99     | link-only, rounded width=.05              |     67.00% |    14.8190 |     40.20% | 29.60% / 2.3570 (bench absent diagnostic) |          9.55% / .6430 |     47.60% |
| one-match-heavy               | p=.15, duration2=.05, cap=3, short=.99     | link-only, rounded width=.05              |     66.95% |    14.8045 |     48.45% | 33.35% / 2.3955 (bench absent diagnostic) |          9.50% / .6480 |     47.65% |
| zero-channel bench            | p=.15, duration2=.05, cap=3, short=.99     | same                                      |     66.95% |    14.8045 |     48.45% |                           31.20% / 2.1190 |          9.50% / .6480 |     47.65% |
| continuous presence           | p=.15, duration2=.05, cap=3, short=.99     | present +1, linked +2, width=.012         |     68.00% |    15.5490 |     48.75% |                           31.35% / 2.1910 |    **26.50% / 1.5765** |     47.65% |
| combined manager diagnostic   | p=.15, duration2=.05, cap=3, short=.99     | aggregate band=.02, continuous width=.012 |     67.40% |    15.2135 |     48.65% |                           30.80% / 2.2240 |        21.60% / 1.1930 |     47.15% |
| manager reach diagnostic      | p=.15, duration2=.05, cap=3, short=.99     | aggregate band=0, continuous width=.014   |     67.60% |    15.2405 |     48.70% |                           31.10% / 2.2145 |    **25.15% / 1.2820** |     47.15% |
| **optimistic cap=1 frontier** | **p=.17, duration2=.05, cap=1, short=.99** | diagnostic manager combination            |     67.75% |    15.2770 | **53.00%** |                       **32.80% / 2.1015** |        24.90% / 1.2450 |     46.95% |
| **optimistic cap=2 frontier** | **p=.17, duration2=.05, cap=2, short=.99** | diagnostic manager combination            |     67.80% |    15.3285 | **53.50%** |                       **35.65% / 2.5850** |        25.25% / 1.2920 | **46.90%** |

The diagnostic manager combination in the final two rows used a reduced
manager Synergy weight only to test feasibility. It is not a proposed lock:
silently leaving the Synergy weights summing to 0.9 would alter old Synergy
semantics outside S3's authorized tuning surface.

## Bench frontier distribution

The cap sweep below used the **optimistic zero-channel diagnostic**. It tests
the remaining authorized S1 shape knob: the dispatch binds a maximum of three
minor events, so caps one and two are legal candidates while tournament-ending
conditional probability remains exactly 0.12. These numbers are not presented
as literal absent-bench acceptance.

| Cap | Activated runs | Activation events | Events / activated run | Changed runs | Total abs delta | All-N mean abs delta | delta=1 | delta=2–3 | delta=4–7 | delta>=8 |
| --: | -------------: | ----------------: | ---------------------: | -----------: | --------------: | -------------------: | ------: | --------: | --------: | -------: |
|   1 |  1,060 (53.0%) |             1,510 |                 1.4245 |  656 (32.8%) |           4,203 |               2.1015 |     127 |       191 |       203 |      135 |
|   2 |  1,070 (53.5%) |             1,786 |                 1.6692 | 713 (35.65%) |           5,170 |               2.5850 |     122 |       201 |       213 |      177 |

Cap one minimizes repeated-event amplification but cannot reach 35% before the
55% activation ceiling. Cap two reaches sensitivity, but additional changed
runs include enough progression-scale deltas that mean |delta| moves farther
from 1.5. The binding literal absent-bench path is harsher by design: it must
preserve S1's invariant that a true short-handed XI is worse than every
eligible replacement. Tuning that invariant away to improve the mean would be
an invalid fix.

## Manager seam findings

At the S2 handoff, only 392/2000 (19.6%) strategic runs had any positive
`manager_link`, and only 43/2000 (2.15%) reached a nonzero rounded tactical
tier under the later p=.15 sample. Width tuning alone therefore could not reach
25%.

The diagnostic route to exceed the reach ceiling was an explicit
manager-presence fact:

- managerless => tier 0, neutral;
- drafted but unlinked => tier 1;
- sufficiently linked => tier 2.

That route would require a new persisted fact and schema contract to distinguish
managerless from present-unlinked. It also requires fractional post-tactical
channels because rounding back to rating-channel integers creates a
discontinuity (.020 was inert, .025 jumped to 39.35% sensitivity and 2.7025 mean
|delta|). Independent review correctly classified both changes as new S2
mechanics, not an S3 constant re-lock.

Even after removing that quantization defect, manager points on the tested
frontier either miss reach or miss the 1.0 mean cap. Lowering the older
aggregate manager modifier redistributes the effect but does not close both
targets. No display `ManagerRating.overall` field was read.

## Independent fresh-context verdict

**FAIL — no defensible in-scope correction.** The independent reviewer
confirmed:

1. Harness seed pairing, all-N mean denominator, activation-run counting, and
   actual-offer XI runner-up construction are sound.
2. Literal zero bench means absent bench. The zero-channel variant is an
   optimistic diagnostic; correcting it invokes the intentionally worse S1
   short-handed path and does not rescue magnitude.
3. Merged S2's manager-link-only tier has an exact 19.6% reachability ceiling,
   below the binding 25% floor. Presence-based +1 is a new mechanic/contract,
   not S3 constant tuning.
4. A lambda refit is unauthorized: the dispatch makes it conditional on a
   failed display/channel mapping, and that mapping did not move or fail.

## What was deliberately not done

- No lambda refit: the display curve and rating/channel population did not
  move, and the target conflict appears before realism re-lock.
- No realism-band change: re-centering bands around a target-failing candidate
  would be a silent weakening.
- No score-distribution or Daily artifact regeneration: those must follow a
  selected passing engine in the required compact -> distribution -> compact
  order.
- No rating, offer, RNG, auth, leaderboard, token, or display-curve change.
- No CI task registration for a gate that is known to fail. The harness itself
  keeps the binding assertions so a future adjudicated candidate cannot claim
  PASS without satisfying them.
- Every diagnostic production/core edit was restored to exact base
  `de019efa`; only the candidate evidence harness, its exact-policy ranking
  export, and this blocked report remain in the worktree.
- Nothing is staged, committed, or pushed.

## Required adjudication

At least one binding definition must change. The narrow choices are:

1. retain final-score sensitivity and raise the mean |delta| caps to the
   measured feasible frontier;
2. retain the magnitude caps and lower sensitivity floors;
3. redefine the measured outcome away from final `RunResult.score` (not
   authorized by the dispatch and not done here); or
4. authorize a broader mechanical change to scoring/progression semantics,
   which is materially outside S3 constant tuning and risks changing the
   shipped feel the difficulty target is intended to preserve.

Until a binding definition is changed, the honest S3 result is BLOCKED.
