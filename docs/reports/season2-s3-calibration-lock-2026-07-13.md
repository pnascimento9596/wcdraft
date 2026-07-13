# Season 2 S3 — Option A calibration lock

Date: 2026-07-13

Base: `de019efa3d2d2acd04c7505d8f93c352bf9d99d4`

Risk: RED (simulation mechanics, persisted facts, replay token, calibration)

Status: **PREREGISTERED — bounds frozen before production tuning.**

The prior blocked attempt remains intact in
`docs/reports/season2-s3-calibration-blocked-2026-07-13.md`. Its diagnostics
are historical evidence and are not overwritten by this re-dispatch.
Preserved SHA-256:
`12af57b772504c1abe75f45600213c62a86fb2284c8ed59329ce296efd92b87e`.

## Architect-authorized changes

**Move 1 — RED contract change: manager presence tactical tier.** The original
manager reach target was structurally impossible because the merged mechanic
only acted on the minority of squads with `manager_link`. Option A adds a
deterministic manager-presence quality tier for every drafted manager and
composes it additively with the existing link contribution. Managerless stays
neutral. The simulation uses internal manager quality only and never reads the
display `ManagerRating.overall`.

**Move 2 — measurement change: per-match win-probability movement replaces the
final-score mean-|delta| cap.** A small match-level effect can truthfully cause
a large tournament-score delta by changing progression. Final-score
changed-run sensitivity remains the reach gate; magnitude is bounded at the
mechanical seam using the already-exposed pre-match win probability. Option A
was chosen instead of lowering the original reach targets.

## Frozen construction and targets

This block is written before any production constant is changed. The first
untuned N=2000 strategic-policy measurement at the exact merged S1/S2 head is
used once to derive the two numeric bounds below. Those values are committed
separately before tuning and cannot move during S3.

The magnitude instrument is the mean absolute movement in
`MatchResult.pre_match_win_probability` over exact paired fixtures. For every
baseline run and counterfactual run, a fixture enters the denominator only
when both executions expose the same `match_index`, `round`, `phase`, and
`opponent_team_id`. Such a pair necessarily reuses the completed draft,
scenario, parent seed, match-index RNG substreams, and availability substream;
the counterfactual consumes no new RNG. A baseline fixture after path
divergence is recorded as excluded, never compared with a different opponent.
The denominator is the count of exact same-fixture pairs across all N runs,
including zero-movement pairs. This measures a causal mechanical change and
does not contaminate magnitude with post-divergence opponent selection.

Win probability is selected instead of xP because the engine already exposes
the λ-derived group/knockout-adjusted `pre_match_win_probability` on every
`MatchResult`, while no equally direct expected-points value exists. The metric
reads no sampled result and introduces no extra simulation draw.

Binding strategic-policy gates at N=2000:

- Bench literal counterfactual: clear all five bench slots; final-score
  changed-run sensitivity >=35%; baseline activation rate 40–55%; mean paired
  per-match absolute win-probability movement <= **0.0500**.
- Manager literal counterfactual: clear `manager_card_id`, producing presence
  tier zero and link zero; final-score changed-run sensitivity >=25%; mean
  paired per-match absolute win-probability movement <=
  **0.0150**.
- Master hierarchy: the offer-faithful XI runner-up final-score sensitivity is
  strictly greater than both bench and manager sensitivities.
- Difficulty: qualifying 64–68%; mean score 14.0–15.0.
- Final-score mean-|delta| remains reported diagnostically but is not an
  acceptance cap.

## Concurrent S4 codec coordination

Concurrent S4 commit `caf2f3ba0a69c59871f4080251405cfec10d12f1`
extends existing `t3` and `t4` bodies with optional key `a` for the canonical
team-sheet permutation; it does not create a new token version. S3 will use the
same existing bodies and reserve compact key `mt` for the manager tactical
band, leaving `a` untouched. When both units integrate, the bodies carry both
optional fields and share one decode/reconstruction/verification path.

## Untuned baseline derivation

The one authorized run used exact head
`de019efa3d2d2acd04c7505d8f93c352bf9d99d4`, policy
`strategicAutoDraft`, locked seed prefix `wcdraft:realism:e3a:v1`, and N=2000.
The raw log is `/tmp/season2-s3-prereg-untuned-n2000.json.log`, SHA-256
`83ca67f0a12f6dd6e6e8f6ff62d4084fcd97f93b73e457c0e18d8eeedd49e075`.

| Untuned merged model        | Final-score sensitivity | Same fixtures | Excluded after divergence | Mean absolute win-prob movement |
| --------------------------- | ----------------------: | ------------: | ------------------------: | ------------------------------: |
| Literal zero bench          |                  28.00% |         8,558 |                       308 |                       0.0228328 |
| Literal no manager          |                   9.35% |         8,801 |                        65 |                       0.0038458 |
| Offer-faithful XI runner-up |                  47.45% |         8,417 |                       449 |                       0.0314948 |

The bench ceiling projects the measured footprint from the 33% untuned
activation rate to the maximum allowed 55% exposure, adds 25% calibration
headroom, and rounds upward to the next 0.005:
`0.0228328 * (0.55 / 0.33) * 1.25 = 0.0475683`, frozen as **0.0500**.

The manager ceiling projects the measured footprint from 9.35% changed-run
reach to the required 25% reach, adds the same 25% calibration headroom, and
rounds upward to the next 0.005:
`0.0038458 * (0.25 / 0.0935) * 1.25 = 0.0128549`, frozen as **0.0150**.

These are acceptance ceilings, not tuning objectives. The derivation is fixed
before the manager-presence mechanic or any season constant is changed.

## Final calibration table

Pending implementation and tuning against the frozen spec.

## Validation and artifacts

Pending final calibrated candidate.
