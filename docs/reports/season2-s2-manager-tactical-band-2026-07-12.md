# Season 2 S2 — manager tactical band

Date: 2026-07-12

Branch: `ws-core/season2-s2-manager-tactics`

Base: `7123d3d7182852715b0006aedd3a001e3b22855f` (`season/squad-depth`)

Risk: RED (match outcome semantics)

Status: local implementation complete; independent and cross-model reviews,
CI, and integration merge remain pending

## Outcome

Unit S2 adds the adjudicated second manager channel without changing the
existing aggregate-time `managerBandModifier`. The new channel derives solely
from the active match's sim-legal `SynergyResult.manager_link`, maps that value
to a canonical internal `+0/+1/+2` tier, and applies a bounded multiplicative
adjustment uniformly to all four user strength channels at the per-match lambda
seam. No display rating is read and no RNG is added or consumed.

The initial calibration is deliberately conservative: the full `+2` tier has a
maximum width of `0.01` (1%), while `+1` receives half that width. `S3` owns the
final value of `MANAGER_TACTICAL.WIDTH` and must judge both manager channels
together against the binding manager-sensitivity and hierarchy targets.

## Architect-delegated decision

The dispatch specified a bounded tier and gave `manager_tactical_band: +2` as
the factual shape, but did not prescribe thresholds. The least-behavior-changing
interpretation is a three-tier non-negative channel: clamp the internal
`manager_link` to `[0,1]`, multiply by two, and round to `0 | 1 | 2`. This keeps
the no-manager case exactly neutral, makes a fully linked manager legibly `+2`,
and adds only one S3-owned magnitude constant. A signed or display-derived band
would introduce behavior and data that the adjudication did not authorize.

## Exact-once lambda application

The tactical transform is separate from both the Synergy multiplier and the
existing aggregate-time manager-link modifier. `simulateMatchCore` computes it
once from `team_facts.active_synergy.manager_link`, then passes the resulting
`post_tactical_strength` to both lambda directions:

- user lambda: post-tactical user strength attacks opponent strength;
- opponent lambda: opponent strength attacks post-tactical user strength.

Using the same transformed strength on both sides makes the channel symmetric:
attack/midfield can raise the user's scoring expectation while
defense/goalkeeping/midfield can lower the opponent's. It is not multiplied
onto lambda a second time. An exact-once regression test compares this path to
an already-adjusted neutral path under identical RNG and proves identical win
probability, scoreline, and events.

## Persisted factual contract

Every `team_facts` row now carries:

- `manager_tactical_band` (`0 | 1 | 2`);
- `manager_tactical_multiplier`;
- `post_tactical_strength` (four rounded channels; coverage unchanged);
- `tactical_applied_to_outcome`.

The MatchResult boundary independently recomputes the tier from active
`manager_link`, the multiplier from the tier and calibration width, and every
post-tactical strength channel from active strength. Forged tier, multiplier,
post-strength, or application-flag combinations reject. `team_facts` itself
remains optional, preserving legacy records that predate factual channels.

`tactical_applied_to_outcome=true` means the post-tactical channel was consumed
by normal outcome simulation. That is true even for a neutral tier: it records
which mechanical path ran, not whether integer rounding changed a channel.
Forfeits bypass outcome simulation, so they preserve neutral applied facts and
set the flag false rather than claiming a tactical effect.

## Managerless reachability

Managerless squads are reachable at the defensive engine boundary: a
`DraftState` may be `ready` with eleven starters and no manager, and the
existing `upset` and `group_elimination` core fixtures exercise that path.
Those runs complete deterministically with band `0`, multiplier `1`, and
post-tactical strength equal to active strength. Persisted status `simulated`
still requires a manager under `DraftStateSchema`; S2 does not weaken that
completion invariant.

## Guard and adversarial coverage

- The static decoupling guard continues to scan engine and API production code
  for `manager.overall` / `managerRating.overall` reads.
- The functional guard now runs complete manager-linked tournaments with
  display overall `0` versus `99` and proves byte-equal run and match output,
  including tactical facts.
- Bounds cover tier thresholds and malformed/out-of-range direct helper inputs.
- Determinism covers pure adjustment output and repeated full managerless runs.
- Schema probes forge each persisted tactical channel independently.
- A bypassed-outcome shape proves false/neutral facts parse honestly.

## Golden delta audit

`pnpm --filter @wcdraft/core run gen:sim-golden` retained all five canonical
scenario seeds and defining paths. Four RunResults remain byte-identical. The
fully manager-linked `draw_into_pens` fixture keeps seed
`wcb-golden-draw_into_pens-1`, reaches the final, remains champion at `7-0-1`,
and retains one shootout; its score moves `88 -> 85` because the changed
match-event path records one additional yellow (`24 -> 25`) and one missed
penalty (`0 -> 1`). This is an expected seeded outcome delta from the new RED
mechanic, not a calibration claim.

## Validation evidence

- `pnpm --filter @wcdraft/core exec vitest run src/engine/manager-tactics.test.ts src/manager-modifier-decoupling.guard.test.ts src/engine/availability.test.ts`
  — PASS, 3 files / 30 tests.
- `pnpm --filter @wcdraft/core typecheck` — PASS.
- `pnpm --filter @wcdraft/core lint` — PASS.
- `pnpm --filter @wcdraft/core run gen:sim-golden` — PASS; five scenario
  fixtures regenerated with the delta audited above.
- `pnpm --filter @wcdraft/core test` — PASS, 28 files / 418 tests.
- Five-step artifact closure (`build:compact` -> `build:score-distribution` ->
  `build:compact` -> pinned `build:daily-seed-salt-map` -> `build:compact`) —
  PASS. Daily parameters: start `2026-07-10`, 45 days, N=128, maximum eight
  salt attempts.
- Forced core goldens — PASS, 69 + 42 tests.
- Forced data goldens — PASS, 4 files / 59 tests.
- Regenerated real-run integration fixture, then forced integration goldens —
  PASS, 2 files / 22 tests.
- Forced leaderboard golden — PASS, 1 file / 6 tests.
- `WCDRAFT_REALISM_HEAVY=1 ... realism.gate.test.ts` — PASS, 10/10 at
  N=2000 x 3 policies.
- `pnpm typecheck` — PASS, 8/8 tasks.
- `pnpm lint` — PASS, 5/5 tasks.
- `pnpm test` — PASS, 8/8 tasks: core 418; data 183 passed / 9 skipped;
  database 161; marketing 68; web 1,156 passed / 1 skipped plus game-flow and
  responsive-shell audits (218 metrics, zero failures).
- `pnpm build` — PASS, 4/4 tasks; Next generated 40 pages. Existing webpack
  circular-chunk warnings remain warnings, not failures.

## Per-unit artifact closure

The controlling Season 2 rule requires every engine unit to close affected
artifacts independently, even though S3 will re-close the cumulative tuned
engine. S2 therefore ran the full five-step sequence. The tactical channel did
not move the N=2000 strategic population or the pinned Daily runway, so both
generated artifacts returned byte-identical to S1:

| Artifact           | Raw SHA-256                                                        | Brotli SHA-256                                                     |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Score distribution | `2ef76e41bae2ca70c38da5586cab5b7506a44b212b10769119386850805fc219` | `5bbe9e4562a80c1af9f18518ce502cc3ae6f73ea8f7ab0af67c9ccd6fe24c848` |
| Daily salt map     | `1081ae1c73f52dbbd731677c9b14aec6aeb256266021e8032144be21f750bc62` | `7d9adf41414995250229067a4ca5ce10a4e3a70ae76be3f60448c0b5c059d2ac` |

Daily retains four salts: `2026-07-24#2`, `2026-07-27#2`,
`2026-08-17#2`, and `2026-08-21#2`. The strategic population remains 1,336
qualifying runs, mean 14.641, median 9, p95 62, min -24, max 126.

Heavy realism remains byte-locked to the S1 provisional mechanics snapshot:

| Policy                 | Qualifying | Matches | Group |    KO |
| ---------------------- | ---------: | ------: | ----: | ----: |
| autoDraft              |   333/2000 |   6,472 | 6,000 |   472 |
| strategicAutoDraft     | 1,336/2000 |   8,866 | 6,000 | 2,866 |
| greedyOverallAutoDraft |   503/2000 |   6,781 | 6,000 |   781 |

The real-data integration golden needed regeneration only because each of its
four match facts rows gained the four S2 factual fields. Its fixed seed,
outcomes, score, match path, and existing facts did not move.

## Risks and S3 carryovers

- S2 deliberately does not claim the 1% width is calibrated. S3 owns the
  combined existing-manager-plus-tactical sensitivity, hierarchy, difficulty,
  realism, and counterfactual gates and may change the width.
- Uniform integer channel rounding means a low strength at tier `+1` can record
  an applied band without changing a rounded channel. The factual record is
  still honest: it exposes both the multiplier and resulting strength.
- Runtime compact artifacts, score distribution, Daily salt map, and heavy
  realism were re-closed per unit and are byte-identical to S1. S3 must still
  re-close them cumulatively after final tuning; it also owns strategic-canary
  regeneration, production engine/version rollover, combined
  manager-sensitivity evidence, and final semantic bands. The unchanged canary
  passed as part of the S2 root test run.
- Ratings, draft offer mechanics, leaderboard semantics, auth/security,
  arrangement/token codec, and UI copy are untouched.

## Review focus

Reviewers should concentrate on the exact-once seam, symmetric use of
post-tactical strength in both lambda directions, schema reconciliation,
forfeit flag semantics, managerless neutrality, display-overall decoupling,
and whether the provisional constant is clearly left to S3 rather than
mistaken for final calibration.
