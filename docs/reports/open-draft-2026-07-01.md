# Open Draft / RED-contract reconciliation — 2026-07-01

Outcome: local RED implementation candidate on branch
`ws-ux/open-draft-contract-ship-20260701`, based on `origin/main` `9c154dd`.
This report records the implementation and local proof. It does not claim
production ship until the fresh-context reviewer, SHA-pinned merge, deploy, and
live-readback gates complete.

## Scope

- Added `DraftMode: "open"` as a casual-only draft mode.
- Open Draft spins a nation and offers that nation's era-filtered available
  roster, deduped by player, plus nation managers until one manager is picked.
- Open Draft replays through `t4.` tokens that carry selected player card ids
  and manager card ids. Tampered Open tokens reject during replay.
- Leaderboard submission remains Classic/Memory only. Open runs can be saved
  and shared but cannot post to casual or ranked boards.
- Marketing X fails closed for Open tokens instead of fabricating a replay body.
- `/how-to-play`, mode labels, setup copy, app badges, share copy, local history,
  and run APIs understand Open without changing runtime-data artifacts.
- Current/future-facing RED-contract references were reconciled to the v5 chain:
  fresh-context reviewer, fix-forward to PASS, SHA-pinned merge, deploy
  observation, live verification, and auto-revert on failed live checks.

## Contract Reconciliation

Searches were run after the doc edits:

```text
rg -n -i "hold for explicit human approval|HOLD for explicit human|human-approved|human approval gate|explicit human approval" .
```

The remaining hits are positive v5 statements such as "no human approval gate".
No remaining scoped hit preserves the old RED flow that inserted a human hold
between independent review and SHA-pinned merge.

Files updated to remove stale current/future-facing wording:

- `docs/reports/accounts-auth-2026-06-30.md`
- `docs/reports/spin-agency-choose-three-2026-06-30.md`
- `docs/reports/engine-season-manager-attrition-2026-06-30.md`
- `docs/reports/daily-draft-2026-06-29.md`
- `docs/reports/merit-v4.3-override-2026-06-15.md`
- `docs/reports/merit-v4.1-ratings-coverage-season-2026-06-14.md`
- `docs/reports/merit-v4.2-decluster-2026-06-15.md`
- `docs/reports/leaderboard-profiles-l3-memory-lane-2026-06-12.md`
- `docs/reports/f4-u5-abuse-review-2026-06-10.md`
- `docs/reports/mv212-ratings-audit-2026-06-10.md`
- `docs/reports/merit-v3.1-season-summary.md`
- `docs/reports/merit-v4-ratings-rebuild-2026-06-13.md`

Historical reports that merely record past approvals or old-era decisions were
not rewritten unless their wording acted like current process guidance.

## Local Validation

| Gate                                                                                                                                     | Result                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                                         | PASS                                                                                                                                |
| `pnpm --filter @wcdraft/core build`                                                                                                      | PASS                                                                                                                                |
| `pnpm --filter @wcdraft/data build`                                                                                                      | PASS                                                                                                                                |
| `pnpm --filter @wcdraft/db build`                                                                                                        | PASS                                                                                                                                |
| `pnpm --filter @wcdraft/core test`                                                                                                       | PASS: 23 files / 384 tests                                                                                                          |
| Focused web Vitest: run-token, run-token-v2, run-screen-loader, config-badges, a11y-focus-perf, leaderboard validate/submit/public-email | PASS: 8 files / 160 tests                                                                                                           |
| `pnpm --filter @wcdraft/marketing-x typecheck`                                                                                           | PASS                                                                                                                                |
| `pnpm --filter @wcdraft/marketing-x test`                                                                                                | PASS: 8 files / 68 tests                                                                                                            |
| `pnpm typecheck`                                                                                                                         | PASS: 8/8 tasks                                                                                                                     |
| `pnpm lint`                                                                                                                              | PASS: 5/5 tasks                                                                                                                     |
| `pnpm test`                                                                                                                              | PASS: 8/8 tasks; web 837 passed / 1 skipped plus `game-flow-playwright`; data 84 passed / 7 skipped; core 384; db 106; marketing 68 |
| `pnpm build`                                                                                                                             | PASS: 4/4 tasks; known Next circular-chunk and edge-runtime static-generation warnings only                                         |
| `pnpm exec turbo run test:golden test:golden:draft --filter=@wcdraft/core`                                                               | PASS: RNG/narrative 2 files / 68 tests; draft goldens 5 files / 42 tests                                                            |
| `pnpm exec turbo run test:golden:data test:golden:integration --filter=@wcdraft/data`                                                    | PASS: compact/data 2 files / 31 tests; integration 2 files / 22 tests                                                               |
| `pnpm exec turbo run test:golden:leaderboard --filter=@wcdraft/web`                                                                      | PASS: 1 file / 6 tests                                                                                                              |
| `pnpm check:generated`                                                                                                                   | PASS                                                                                                                                |
| `git diff --check`                                                                                                                       | PASS                                                                                                                                |
| Repeated `pnpm --filter @wcdraft/web build` after mobile/accessibility CSS fixes                                                         | PASS                                                                                                                                |

## Browser Proof

Proof command:

```text
BASE_URL=http://localhost:3021 pnpm --filter @wcdraft/web verify:open-draft-browser > docs/reports/open-draft-2026-07-01/browser-proof.json
```

The verifier ran against a production build served by `next start -p 3021` with
`prefers-reduced-motion: reduce`. It exercised Open setup, spin, full roster,
results, local share, `t4.` token share replay, tampered-token rejection, and
How to Play.

| Viewport | Theme | Open roster count | Token | Tamper rejected | Surfaces checked | Overflow | Small targets | Axe |
| -------- | ----- | ----------------: | ----- | --------------- | ---------------: | -------- | ------------- | --- |
| 390x844  | light |               114 | `t4.` | yes             |                7 | 0        | 0             | 0   |
| 390x844  | dark  |               187 | `t4.` | yes             |                7 | 0        | 0             | 0   |
| 360x800  | light |                79 | `t4.` | yes             |                7 | 0        | 0             | 0   |
| 360x800  | dark  |               151 | `t4.` | yes             |                7 | 0        | 0             | 0   |

Minimum visible interactive target measured at least 44x44 on every checked
surface. The run also caught and fixed unrelated mobile/accessibility regressions
that became part of the ship surface: compressed pitch slots, share action
buttons, in-draft attribution link target size, footer link target size, and
dark-mode rating-key contrast.

No trustworthy pre-change mobile measurements exist for this lane because the
Open Draft work arrived as an uncommitted local-only worktree diff. The after
proof above is measured from the reconstructed fresh worktree.

## Risks / Review Focus

- Core draft semantics changed, so reviewer should inspect Open roster generation,
  dedupe-by-player behavior, manager selection, placement status, and token replay.
- Leaderboard boundaries must stay closed to Open. Review should verify both
  client hiding and server validation.
- Marketing X intentionally does not replay Open tokens. It must keep returning a
  failure classification rather than generating a misleading post.
- Runtime data artifacts should remain unchanged; the mode uses existing compact
  data.
- The report intentionally does not claim live production verification before the
  deploy/live gates have actually run.
