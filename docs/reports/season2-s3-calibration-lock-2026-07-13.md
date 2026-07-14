# Season 2 S3 — Option A calibration lock

Date: 2026-07-13

Base: `de019efa3d2d2acd04c7505d8f93c352bf9d99d4`

Risk: RED (simulation mechanics, persisted facts, replay token, calibration)

Status: **CALIBRATED — all frozen N=2000 acceptance gates pass; repository
closure gates are recorded below.**

The prior blocked attempt remains intact in
`docs/reports/season2-s3-calibration-blocked-2026-07-13.md`. Its diagnostics
are historical evidence and are not overwritten by this re-dispatch.
Preserved SHA-256:
`12af57b772504c1abe75f45600213c62a86fb2284c8ed59329ce296efd92b87e`.

## Architect-authorized changes

**Move 1 — RED contract change: manager presence tactical tier.** The original
manager reach target was structurally impossible because the merged mechanic
only acted on the minority of squads with `manager_link`. Option A adds a
deterministic manager-presence tier for every drafted manager and composes it
additively with the existing link contribution. Managerless stays neutral.
Production ships no ManagerRating rows or sim-legal per-card quality signal,
so the architect-delegated honest implementation uses stable presence 0/1,
preserves S2's link 0/1/2 tier, and refuses to fabricate quality from manager
placement, match counts, or display `ManagerRating.overall`.

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
same existing bodies and reserve compact key `mp` for the stable manager
presence tier, leaving `a` untouched. Per-match link and composed bands remain
derived MatchTeamFacts because availability can change active XI links. When both units integrate, the bodies carry both
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

The final candidate retains the λ tuple, scoring and progression semantics,
the `SYNERGY.*` weights/multiplier formula, and S2's manager-link derivation and
`+0/+1/+2` discretization. The separate aggregate manager-link uplift is an
engine calibration constant, not a `SYNERGY.*` weight; S3 deliberately retunes
it below and records that change explicitly. All final S3 constants are:

| Constant                                           | Previous value | Final value | Mechanical scope                                                                      |
| -------------------------------------------------- | -------------: | ----------: | ------------------------------------------------------------------------------------- |
| `INJURY.AVAILABILITY_EVENT_PROB`                   |         `0.09` |     `0.125` | At most one seeded pre-match availability draw per fixture                            |
| `INJURY.TOURNAMENT_ENDING_PROB`                    |         `0.12` |      `0.12` | Existing persistent-absence split; unchanged                                          |
| `INJURY.MINOR_TWO_MATCH_PROB`                      |         `0.35` |      `0.05` | Conditional minor-event duration                                                      |
| `INJURY.MAX_MINOR_EVENTS_PER_RUN`                  |            `3` |         `2` | Minor-event run cap                                                                   |
| `INJURY.BENCH_REPLACEMENT_CONTRIBUTION_MULTIPLIER` |            n/a |      `0.70` | Scales only the incoming canonical replacement's active contribution                  |
| `INJURY.SHORT_HANDED_STRENGTH_MULTIPLIER`          |         `0.92` |      `0.72` | Existing all-channel short-handed path                                                |
| `MANAGER_MODIFIER.BAND`                            |         `0.10` |      `0.06` | Pre-existing aggregate manager-link uplift; retuned for the combined manager envelope |
| `MANAGER_TACTICAL.MAX_BAND`                        |            `2` |         `3` | Presence `+1` plus preserved link `+0/+1/+2`                                          |
| `MANAGER_TACTICAL.WIDTH`                           |        `0.010` |     `0.020` | Maximum continuous post-aggregation tactical uplift                                   |

The `0.70` bench multiplier is a deliberately narrow calibration seam. Exact
constant sweeps showed that raising event frequency alone could make an
eligible replacement improve the strategic squad often enough to reduce the
literal-zero-bench changed-run reach. The multiplier is applied only after
canonical replacement selection, so it cannot change replacement identity,
eligibility, target-slot fit, assignment tie-breaks, RNG consumption, or
Synergy. Persisted facts expose the multiplier and both the effective
replacement contribution and exact outgoing delta. Focused tests lock that
identity/fit are unchanged, a filled replacement remains strictly better than
the equivalent short-handed result, and stronger canonical replacements
remain monotonic under the common multiplier.

The manager tier uses the only honest stable signal available in the shipped
runtime: drafted-manager presence. Runtime data contains no `ManagerRating`
rows and no sim-legal per-card tactical-quality field. Presence is therefore
`0/1`; the preserved S2 `round(clamp(manager_link) * 2)` tier remains
`0/1/2`; their additive match-dynamic composition is `0..3`. The resulting
continuous multiplier is applied to the four post-availability team channels
before both sides of `lambdaForFour`, exactly once. A managerless draft is
strictly neutral. No manager placement, match count, or display overall is
repurposed as fabricated tactical quality.

S2 already used `manager_link` in two distinct seams: the continuous
aggregate `MANAGER_MODIFIER.BAND` uplift and the discretized per-match tactical
channel. Option A preserves that architecture and the link signal's derivation,
but the new universal presence contribution increases the combined manager
envelope. S3 therefore retunes the aggregate link band from `0.10` to `0.06`
while raising the tactical maximum from `0.010` to `0.020`. This is an
architect-authorized season-constant calibration, not a target reduction: at
the final constants the literal no-manager reach is `28.30%` and its paired
per-match movement is `0.0101751`, simultaneously passing the preregistered
`>=25%` reach and `<=0.0150` magnitude gates. The `SYNERGY.*` weights and
multiplier formula, manager-link calculation/discretization, λ tuple, and RNG
consumption remain unchanged.

Final N=2000 all-policy calibration evidence uses the frozen seed prefix and
exact paired-fixture construction:

| Policy                   |             Qualifying |  Mean score |      Bench activation |     Bench sensitivity | Bench mean paired win-p delta |   Manager sensitivity | Manager mean paired win-p delta | XI runner-up sensitivity |
| ------------------------ | ---------------------: | ----------: | --------------------: | --------------------: | ----------------------------: | --------------------: | ------------------------------: | -----------------------: |
| `autoDraft`              |      336/2000 (16.80%) |     -7.7955 |     683/2000 (34.15%) |     548/2000 (27.40%) |                     0.0141595 |     305/2000 (15.25%) |                       0.0043829 |        584/2000 (29.20%) |
| `strategicAutoDraft`     | 1338/2000 (**66.90%**) | **14.8365** | 839/2000 (**41.95%**) | 763/2000 (**38.15%**) |                 **0.0394470** | 566/2000 (**28.30%**) |                   **0.0101751** |    953/2000 (**47.65%**) |
| `greedyOverallAutoDraft` |      508/2000 (25.40%) |     -4.0295 |     690/2000 (34.50%) |     578/2000 (28.90%) |                     0.0201437 |     349/2000 (17.45%) |                       0.0056550 |        730/2000 (36.50%) |

For the binding strategic row, exact paired-fixture denominators are 8,340
bench pairs with 543 post-divergence fixtures excluded, and 8,707 manager
pairs with 176 excluded. Every frozen gate passes: bench reach is at least
35%, activation lies within 40–55%, bench magnitude is at most 0.0500,
manager reach is at least 25%, manager magnitude is at most 0.0150, XI reach
is strictly greater than both, qualifying lies within 64–68%, and mean score
lies within 14.0–15.0. Final-score mean absolute deltas, reported only as
diagnostics, are 4.4505 for bench and 1.5520 for manager.

## Deliberate realism re-lock

The final asymmetric N=2000 x three-policy run re-locks exact mechanics
counts, telemetry, and score populations while retaining the pre-S3 semantic
shape-band centers and widths. This is deliberate, not a silent weakening:
the new strategic landing passes all four existing bands, so recentering them
around the new observation would reduce the gate's independence.

| Policy                   |         Qualifying |    Mean | Median | p95 | Min | Max |
| ------------------------ | -----------------: | ------: | -----: | --: | --: | --: |
| `autoDraft`              |  336/2000 (16.80%) | -7.7955 |   -8.5 |  10 | -41 |  59 |
| `strategicAutoDraft`     | 1338/2000 (66.90%) | 14.8365 |      9 |  62 | -26 | 126 |
| `greedyOverallAutoDraft` |  508/2000 (25.40%) | -4.0295 |     -6 |  21 | -34 | 118 |

Final strategic shape observations are goals/game `2.6813014`, group draw
`0.2468333`, margin-at-least-four `0.0434538`, knockout-to-extra-time
`0.3232744`, and shootout `0.2029136`. The retained centers/half-widths are:
draw `0.2501667 +/- 0.015`, margin-at-least-four `0.0416007 +/- 0.015`,
knockout-to-extra-time `0.3197470 +/- 0.0174844`, and shootout `0.1981729 +/-
0.015`. Lambda was not re-fit: S3 does not change the rating
display-to-channel mapping, and the final candidate already preserves both
the explicit difficulty envelope and every realism-shape contract. Re-fitting
lambda would create a larger, unjustified semantic change. The mapping
contract was re-executed directly with
`uv run pytest -q tests/test_unified_display.py`: PASS, 13/13.

## Validation and artifacts

Calibration evidence:

- Untuned preregistration log:
  `/tmp/season2-s3-prereg-untuned-n2000.json.log`, SHA-256
  `83ca67f0a12f6dd6e6e8f6ff62d4084fcd97f93b73e457c0e18d8eeedd49e075`.
- Final binding strategic log:
  `/tmp/season2-s3-final-strategic-n2000.json.log`, SHA-256
  `afd7f2f0aaf06b70e1b97297243ca3ddca6769ea70db6218e96f45845804f6f7`.
- Final all-policy calibration log:
  `/tmp/season2-s3-final-all-policy-n2000.json.log`, SHA-256
  `fdb08ba5c41796d1aee0290639fa64c620956970bbb7cfa15358bbad69e282af`.
- First realism report-mode run against the deliberately stale exact lock:
  `/tmp/season2-s3-realism-relock-report.log`, SHA-256
  `06c96af054ba9438cc90f45ecec6bed972d7aafb09fb7aab6901ffac4f714305`.
  It failed only the expected exact mechanics/score-population fields while
  all semantic shape bands passed.
- Raw final three-policy realism evidence:
  `/tmp/season2-s3-realism-raw.json`, SHA-256
  `dd2a382f1a39634efa9ef894ff8caaca794177fbe8004ba838b5ecca38ed984b`.

Generated-artifact closure used the required order
`build:compact -> build:score-distribution -> build:compact`, followed by the
pinned 45-day daily salt-map regeneration and one final `build:compact` so
manifest metadata describes the final bytes. The score-distribution reference
population is the final strategic N=2000 row above. Artifact hashes are:

| Artifact                           | Raw SHA-256                                                        | Brotli SHA-256                                                     |
| ---------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `score-distribution.compact.json`  | `3fcbb10d679a23d9d306c9c9021e530df8f33d631d4116bd68ce55a0704d0df3` | `59cad09592860dbcd62dc40a4fe23d6f49620f5043887665dd3b026326c441b9` |
| `daily-seed-salt-map.compact.json` | `5946ea685d1bc6e8a530e083ea43ec6c771143fbe0edaa3ff3d1210c0cf245a3` | `67e138f1cd1fc498d3794c11c09cf9c28e46d4dc954ec2d38dcbedfccb4756c8` |
| `manifest.json`                    | `a99bcc6fce78a29209ff6e9536c03d96de119df68cb1e45139b389dcccd97996` | `075df51055eaadead47e59a85a13e70767543557dc38dbfc5ee7e00c70551c3d` |

The pinned daily build was then rerun uncached and followed by another compact
build. `cmp` proved byte identity for Daily raw (`18,982` bytes), Daily Brotli
(`1,682` bytes), manifest raw (`7,147` bytes), and manifest Brotli (`2,158`
bytes). The proof log is `/tmp/season2-s3-daily-regen-proof.log`, SHA-256
`f6c976e406bb4701ca2227029417f4ced43e85d46d1bd29e8487c3f5b9378616`.

Replay-token closure uses optional compact field `mp: 0|1` in existing `t3`
and `t4` bodies; concurrent S4 field `a` remains untouched. Decode,
run-record reconstruction, OG verification, and leaderboard deterministic
re-simulation share the same presence-reconciliation rule. Legacy tokens
without `mp` derive presence from their version-anchored draft; explicit
tampering is rejected. Per-match manager presence, link tier, composed tier,
multiplier, and post-tactical strength persist as engine facts.

Executed closure gates:

- `pnpm exec turbo run test:golden test:golden:draft --filter=@wcdraft/core`:
  PASS, 69 + 42 tests.
- `pnpm exec turbo run test:golden:data --filter=@wcdraft/data`: PASS, 59
  tests.
- `pnpm exec turbo run test:golden:integration --filter=@wcdraft/data`:
  PASS, 22 tests.
- `pnpm exec turbo run test:golden:leaderboard --filter=@wcdraft/web`: PASS,
  6 tests.
- Normal strategic-pick canary: PASS, 1 test. Regeneration is byte-identical
  before/after at SHA-256
  `7b1a360798d991668d2d007d861be5f251516b931ddcb00b6514503f9d1f5c43`,
  proving zero pick flips.
- `pnpm --filter @wcdraft/data run test:realism:heavy`: PASS, 10 tests. Log
  `/tmp/season2-s3-realism-final-pass.log`, SHA-256
  `7109fa1d428e6f5d8d9d98bbf4ce911d4f1a6dae89fd35cd5aa8be98cbc0d112`.
- CI-form `pnpm --filter @wcdraft/data run test:calibration:squad-depth`:
  PASS at the binding strategic N=2000 row. Log
  `/tmp/season2-s3-ci-calibration-final.log`, SHA-256
  `1dde2829adf160afdf8bab083c1d905543f2fc8a86d74f00c3c6edd93aa36412`.
- `uv run pytest -q tests/test_unified_display.py`: PASS, 13/13; the rating
  display-to-channel mapping contract is unchanged, so the conditional lambda
  refit was correctly not triggered.
- `pnpm typecheck`: PASS, 8/8 tasks. Log SHA-256
  `f30094343a4924db2eed693b935fa9a581870ebc70bdea36148124e15fd6f155`.
- `pnpm lint`: PASS, 5/5 tasks. Log SHA-256
  `bb0a947a2379c83e95ff25c376a273b8fbd2785e9baa0df71256733dbdc2d432`.
- `pnpm test`: PASS, 8/8 tasks. Core 422, data 183 with 9 expected
  skips, DB 161, marketing 68, and web 1,158 with 1 expected benchmark skip;
  game-flow PASS; responsive shell 218 metrics with zero failures. Log
  SHA-256
  `937855aaf49b3474059fe1c7b59f9e34b24e2c7cbbfa5069cbb25e040371ffe1`.
- `pnpm build`: PASS, 4/4 tasks and 40 pages. Output contained only the known
  circular-chunk and edge-runtime warnings.
- `git diff --check`: PASS.

Exact-head independent review, cross-model review, PR CI, and integration
merge remain outside the results claimed above until executed.
