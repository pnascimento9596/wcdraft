# Season 2 S4 — team-sheet arrangement and reconciled token contract

## Outcome

Implemented on `ws-f4/season2-s4-team-sheet` from exact integration head
`98c0e07abd992b624cf44e500ad6b2199c5a25d3`. This RED unit is not merged or
shipped. Fresh exact-head independent review, the required cross-model spot
review, PR CI, and integration-branch merge remain gates owned by the
orchestrator.

## User flow and legality

The existing pre-simulation Review route is now the team-sheet step after pick 17. It presents the 16 drafted player cards in the formation's canonical 11
starter destinations plus `bench.0` through `bench.4`, alongside the manager.
Tap one player and then another to swap them. The default is exactly the
as-drafted assignment, so a zero-interaction run preserves prior behavior.

Legality is structural only: 16 cards, all unique, all from the legal-pick
reconstruction, and one card per destination. A duplicate spanning the first
11 and final five destinations is typed `SLOT_BENCH_OVERLAP`; other structural
codes are `WRONG_COUNT`, `DUPLICATE_PLAYER`, and `UNKNOWN_PLAYER`. Position
compatibility is recomputed with the existing graduated fit function. Severe
mismatches, including an outfielder in goal, receive explicit fit-strength
warnings and existing position shape/hue, but never block confirm.

Memory and Blind Open keep all pick decisions blind, then reveal full card,
rating, line-strength, provenance, and Synergy information on the team sheet
before arrangement. Classic, Open Draft, Daily, Memory, and Blind Open all use
the same route. Filled starter and bench controls retain the 44 px minimum tap
target, visible pressed state, keyboard semantics, reduced-motion behavior, and
the existing emerald/gold/Space Grotesk design system.

## `mp` + `a` reconciliation

`t3` and `t4` now allow the optional compact field `a`. Its 16 integers map
canonical destination order to the corresponding card index in the canonical
as-drafted order. Identity permutations are omitted. The persisted authority
is always the original legal-pick `DraftState` plus optional arrangement; the
arranged `DraftState` is an ephemeral simulation/view projection because
rewriting it as pick authority would violate immutable spin assignment
evidence.

One `reconcileRunToken` path now owns legal-pick reconstruction, optional `a`
decode/application, and optional `mp` validation against deterministic match
facts. Ordinary Results/Share replay, OG verification, ranked leaderboard
re-simulation, and the lineup inspector all consume this path. The inspector
therefore renders the arranged XI and bench. S1 availability, hard-family bench
replacement selection, active Synergy, S2/S3 manager tactics, scoring, and the
worker/main-thread simulation paths all receive the same ephemeral arranged
draft. The score remains server-authoritative through legal-pick reconstruction
and deterministic re-simulation; there is no signing change.

`encodeRunTokenBody` reconstructs every supported body in the established
canonical field order before JSON serialization, including canonical nested
config/pick/challenge keys and adjacent `mp`, then `a`, then `ch`. Arbitrary
caller insertion order therefore cannot change token bytes. Vestigial untrusted
`og` data remains wire-compatible and non-authoritative. Semantic arrangement
defects decode shallowly and fail replay as `ILLEGAL_PICK`, preserving the
typed leaderboard HTTP 422 contract rather than collapsing them into malformed
transport errors. The paused marketing composer explicitly fails closed on an
arranged token; S4 does not consolidate marketing into web replay authority.

## Exact compatibility matrix

| Current `t3`/`t4` fields                                     | Decode                                  | Manager presence                                            | Arrangement                                           | Verification result                                                          |
| ------------------------------------------------------------ | --------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| neither `mp` nor `a`                                         | supported                               | derived from version-anchored deterministic matches         | exact as drafted                                      | pre-S3/pre-S4 casual replay remains compatible                               |
| `mp` only                                                    | supported                               | explicit `0/1` reconciled against every deterministic match | exact as drafted                                      | S3 token behavior preserved                                                  |
| `a` only                                                     | supported                               | derived from deterministic matches                          | compact permutation structurally verified and applied | arranged replay accepted                                                     |
| both `mp` and `a`                                            | supported                               | explicit value reconciled                                   | compact permutation structurally verified and applied | both facts accepted or the token is rejected through one path                |
| identity arrangement                                         | encoder omits `a`                       | unchanged                                                   | exact as drafted                                      | no token growth                                                              |
| wrong count, duplicate, overlap, negative/out-of-range index | shallow body decode succeeds            | not trusted                                                 | reconciliation fails                                  | leaderboard `ILLEGAL_PICK`, HTTP 422; OG/inspector reject                    |
| forged in-domain `mp`                                        | shallow body decode succeeds            | reconciliation fails after re-sim                           | `a` is still decoded by the same path                 | OG, leaderboard, inspector, Results, and Share reject consistently           |
| legacy `t1`/`t2`                                             | existing decode/skew behavior unchanged | no new fact channel                                         | no arrangement channel                                | current replay remains intentionally unsupported; no silent reinterpretation |
| any six-anchor mismatch                                      | body may decode                         | not replayed                                                | not replayed                                          | existing `WRONG_SEASON` / `DIFFERENT_BUILD` honest state                     |

## Architect-delegated decisions

1. **Compact representation:** a 16-entry permutation is smaller and safer
   than repeated card IDs, makes destination order explicit, and allows server
   replay to prove every card came from the legal draft.
2. **Projection, not pick mutation:** arrangement never rewrites spin picks or
   `assigned_slot_id`; base draft plus `arrangement` stays authoritative.
3. **Current prefixes stay optional until S8:** S4 extends current `t3`/`t4`
   bodies compatibly. S8 owns the coordinated codec/engine/season version bump
   and real shipped skew fixtures.
4. **Full hidden-mode reveal before arrangement:** blindness governs picks, not
   the post-pick team-sheet decision, matching the continuation contract.
5. **Paused marketing fails closed:** arranged tokens are not silently scored
   as drafted, while the explicitly out-of-scope shared marketing replay
   consolidation remains untouched.

## Validation evidence

- Integration-tip floor at `98c0e07`: generated check, typecheck 8/8, lint
  5/5, root suites/build, core goldens 69+42, data/integration goldens 59+22,
  leaderboard golden 6, strategic canary 1/1, and heavy realism 10/10 at
  N=2000 x three policies all passed before implementation. Logs:
  `/tmp/s4-baseline-*.log`.
- Focused exact-feature coverage: core token 4/4 and 11 web files 177/177.
  Logs: `/tmp/s4-focused-core-token.log`, `/tmp/s4-focused-web.log`.
- Final root typecheck: 8/8 tasks. Final lint: 5/5 tasks.
- Final root tests: 8/8 tasks; core 423/423, data 183 passed with 9 expected
  skips, DB 161/161, marketing 69/69, and web 1,179 passed with one
  expected benchmark skip. Game-flow passed. The responsive harness passed
  218/0 metrics: 84 desktop, 56 mobile shell, 40 interaction, 30 mode/setup,
  and 8 opened-mobile-navigation. Logs: `/tmp/s4-root-test.log`; responsive
  artifacts: `/tmp/wcdraft-ci-*-*` from the recorded run. Final exact-tree
  aggregate log: `/tmp/s4-final-root-test.log`.
- Final root build: 4/4 tasks, 40 routes/pages. The pre-existing webpack
  circular-chunk and edge-runtime static-generation warnings remain; there was
  no build failure. Logs: `/tmp/s4-root-build.log`,
  `/tmp/s4-final-root-build.log`.
- Forced goldens: core 69+42, data 59, integration 22, leaderboard 6. Strategic
  pick canary 1/1 remains byte-stable with zero pick flips. Heavy realism
  passed 10/10 at N=2000 x three policies. Logs: `/tmp/s4-*-golden*.log`,
  `/tmp/s4-canary.log`, `/tmp/s4-heavy-realism.log`.
- `pnpm check:generated` passed. The exact pinned five-step Daily closure also
  passed: compact → score distribution → compact → Daily → compact, with Daily
  pinned to 2026-07-10, 45 days, population 128, and maximum 8 salt attempts.
  Before/after SHA-256 remained byte-identical: score distribution
  `3fcbb10d679a23d9d306c9c9021e530df8f33d631d4116bd68ce55a0704d0df3`,
  Daily salt map
  `5946ea685d1bc6e8a530e083ea43ec6c771143fbe0edaa3ff3d1210c0cf245a3`,
  and manifest
  `a99bcc6fce78a29209ff6e9536c03d96de119df68cb1e45139b389dcccd97996`.
  Scoped `git diff --exit-code -- packages/data etl` passed after regeneration.
  Logs: `/tmp/s4-check-generated.log`, `/tmp/s4-daily-step*.log`,
  `/tmp/s4-daily-closure-{pre,post}-hashes.log`, and
  `/tmp/s4-daily-closure-zero-diff.log`.
- The first broad test run exposed that canonical reconstruction dropped the
  historically tolerated vestigial `og` field. This was fixed by preserving it
  explicitly as untrusted/non-authoritative; focused marketing parity and
  replay tests then passed 11/11. No failed result is presented as a pass.

## Risks and carryovers

- S8 must bump the coordinated token/engine/season anchors, add real shipped
  PREV skew fixtures, and re-run cumulative goldens/canary/live verification.
- Marketing replay authority remains intentionally separate and paused. Its S4
  behavior is fail-closed for `a`; future arrangement-aware marketing is
  explicitly out of scope.
- This unit changes optional arranged-run simulation output by design. Default
  no-`a` runs, RNG consumption, offer order, ratings, auth, database schema,
  and generated runtime artifacts are unchanged.
