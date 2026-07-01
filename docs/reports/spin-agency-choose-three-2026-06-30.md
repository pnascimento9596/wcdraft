# Spin Agency / Choose-from-3

Date: 2026-06-30  
Branch: `ws-core/spin-agency-20260630`  
Base: `421587cf553df8894fc6d27085b6844288ee52f7`

## Outcome

Implemented locally. Not shipped.

This is RED-tier because it changes draft semantics, replay tokens, runtime-data
anchors, leaderboard seasoning, and golden fixtures. Under the current v5
contract it still requires a fresh independent reviewer who re-executes the
gates, fix-forward to PASS, SHA-pinned squash merge, deploy observation, live
verification, and auto-revert on any failed live check. No human approval gate
applies.

## What changed

- Draft spins now materialize up to three deterministic player choices per
  team-year instead of exposing the full roster.
- Choice generation uses rating-derived `choice_overall`, coarse rating tiers,
  and position-bucket diversity while staying deterministic from the draft seed,
  spin index, team-year, and prior player picks.
- `t3.` run tokens replace player card ids with choice indices (`ci`) into the
  re-derived choices. `t1.`/`t2.` remain decode-compatible for skew handling,
  but replay is intentionally `t3.`-only.
- Leaderboard anti-cheat replay now rejects out-of-range choice indices and
  keeps legacy token replay from silently validating under the new rules.
- The draft UI now shows the manager plus the materialized player choices; the
  slot-machine reveal CTA is `Reveal choices`.
- Runtime anchors moved to `runtime-data-2.9.0` /
  `engine-2026.06.30-spin-agency`; the explicit leaderboard season default is
  `season-2026-spin-agency`.
- Marketing token replay can consume current `t3.` tokens while preserving its
  legacy `t2.` fixture encoder for existing marketing tests.

## Golden / artifact updates

- Regenerated core draft golden.
- Regenerated compact data artifacts and reports.
- Regenerated e2e real-run, era preset, strategic-pick canary, leaderboard
  validation, token-skew, and asymmetric realism goldens.
- The heavy asymmetric realism gate initially failed only on run-count drift:
  the pre-relock strategic shape metrics still landed inside the prior
  merit-v4.6 bands. The relock records the intentional choose-from-3 draft
  population shift with sim calibration constants unchanged.

## Version anchors

| Field                     | Value                                                              |
| ------------------------- | ------------------------------------------------------------------ |
| schema_version            | `runtime-data-2.9.0`                                               |
| dataset_version           | `2026-06-04`                                                       |
| engine_version            | `engine-2026.06.30-spin-agency`                                    |
| rating_version_historical | `wc-perf-6.6.0`                                                    |
| rating_version_projected  | `proj-career-5.6.0`                                                |
| ruleset_version           | `ruleset-2026.06.04`                                               |
| active leaderboard season | `season-2026-spin-agency`                                          |
| draft-pool sha256         | `4daaf209900759b1acc1ef59574ec223e636ced828f541a37bf561c20aab2bf0` |
| scenario sha256           | `7846fa3abe0eab4aa283efd1e8382959593ec1248030eba13913fac0ae8da398` |
| manifest sha256           | `44965216b46ef63b85584d2b350629a430d29b643d58a16d67112f4d01d2c919` |
| compact brotli total      | `2,231,808` bytes                                                  |

## Validation

- `pnpm --filter @wcdraft/core test`:
  23 files, 383 tests passed.
- `pnpm --filter @wcdraft/data test:golden:data`:
  2 files, 31 tests passed.
- `pnpm --filter @wcdraft/data test:golden:integration`:
  2 files, 22 tests passed.
- `pnpm --filter @wcdraft/data exec vitest run test/realism/strategic-pick-canary.golden.test.ts`:
  1 file, 1 test passed.
- `pnpm --filter @wcdraft/data test:realism:heavy`:
  1 file, 7 tests passed after the measured spin-agency realism relock.
- `pnpm --filter @wcdraft/web exec vitest run lib/leaderboard/__tests__/validate.test.ts lib/leaderboard/__tests__/submit-route.test.ts lib/leaderboard/__tests__/validate.golden.test.ts lib/leaderboard/__tests__/public-payload-email-sweep.test.ts lib/leaderboard/__tests__/ranked-attempt-route.test.ts lib/game/__tests__/run-token.test.ts lib/game/__tests__/run-token-v2.test.ts lib/game/__tests__/run-og.test.ts lib/game/__tests__/run-record.test.ts`:
  9 files, 181 tests passed.
- `pnpm --filter @wcdraft/marketing-x test`:
  8 files, 67 tests passed.
- `pnpm exec turbo run test --concurrency=1`:
  8 tasks successful. Counts: core 23/383, db 3/104, data 11 passed + 1 skipped
  / 84 passed + 7 skipped, marketing 8/67, web 73 passed + 1 skipped / 794
  passed + 1 skipped, plus `game-flow-playwright: ok`.
- `pnpm typecheck && pnpm lint`:
  typecheck 8/8 tasks, lint 5/5 tasks.
- `pnpm build`:
  4/4 tasks passed. Next.js emitted existing-style webpack circular-chunk
  warnings and the edge-runtime static-generation warning, but exited 0.
- `git diff --check`:
  passed.

## Review focus

- `packages/core/src/draft.ts`: deterministic choice selection and diversity
  rules, especially target-slot independence and prior-pick dedup.
- `packages/core/src/run-token.ts` and `apps/web/lib/game/run-token.ts`:
  `t3.` schema, legacy decode / replay refusal, choice-index replay errors.
- `apps/web/lib/leaderboard/validate.ts` and leaderboard tests:
  anti-cheat order and `ILLEGAL_PICK` behavior for out-of-range `ci`.
- Runtime-data anchor bump and generated fixtures, especially asymmetric
  realism relock rationale.

## Carryovers

- No production merge, deploy, or live readback was performed.
- Fresh independent RED-tier review has not been performed.
- Current v5 ship gates have not been completed.
