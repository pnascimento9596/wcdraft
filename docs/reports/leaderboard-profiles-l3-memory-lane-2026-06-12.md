# Leaderboard profiles L3 — Memory ranked lane

Branch: `ws-leaderboard/memory-lane`
Base: `origin/leaderboard-profiles` `2884571e1517df817fc8f56d2f29aeedfb0f46d5`
Risk tier: Red

## Scope result

L3 is server/UI-only. No schema, migration, core engine, data fixture, or golden
fixture files were regenerated or modified. Memory is now a first-class ranked
lane alongside Classic, using the existing `leaderboard_entries.draft_mode`
column. Casual submit/share behavior remains supported, and explicit
`mode=casual` board reads still work for casual artifacts.

## Changes

- Submit bodies now require explicit `draft_mode: "classic" | "hidden"`.
- Server validation rejects Classic↔Memory token/lane mismatches with
  `NON_CANONICAL_CONFIG` before persistence.
- Board reads default to ranked Classic and accept explicit ranked Memory via
  `draft_mode=hidden`; the mixed `All` lane is removed from the board UI.
- `/api/leaderboard/me`, submit-response rank lookup, recent entries, and board
  pagination all filter by `(season_key, mode, draft_mode)`.
- The board page sends `mode=ranked&draft_mode=classic|hidden` on every board
  and `/me` request; the lane switcher renders Classic and Memory only.
- Ranked Memory submit rank is proven lane-scoped: a user with a better Classic
  ranked entry receives the Memory-lane rank for a Memory submission.

## Validation

- Focused L3 suite:
  - `pnpm --filter @wcdraft/web exec vitest run lib/leaderboard/__tests__/validate.test.ts lib/leaderboard/__tests__/validate.golden.test.ts lib/leaderboard/__tests__/submit-route.test.ts lib/leaderboard/__tests__/board-route.test.ts lib/leaderboard/__tests__/ui-board-view.test.ts lib/leaderboard/__tests__/ui-gating.test.ts lib/leaderboard/__tests__/privacy-serializer.test.ts`
  - Result: 7 files, 145 tests passed.
- Leaderboard golden:
  - `pnpm --filter @wcdraft/web test:golden:leaderboard`
  - Result: 1 file, 6 tests passed.
  - The committed hidden token re-sims through the server pipeline with its
    committed score and breakdown; no golden was regenerated.
- Full web package:
  - `pnpm --filter @wcdraft/web test`
  - Result: 56 files passed, 1 skipped; 649 passed, 1 skipped.
  - `pnpm --filter @wcdraft/web typecheck` passed.
  - `pnpm --filter @wcdraft/web lint` passed.
  - `pnpm --filter @wcdraft/web build` passed; only the pre-existing
    Next/Webpack circular chunk warnings appeared.
- Formatting:
  - `pnpm exec prettier --check` over the changed source/test files passed.
- Mutation/non-vacuity proof:
  - Temporarily weakened the server guard to `false && token.md !== targetDraftMode`.
  - `validate.test.ts` and `submit-route.test.ts` cross-lane negative tests failed
    exactly on the lane mismatch assertions.
  - Restored the guard and reran the same two files: 77 tests passed.

## Pending before integration merge

Fresh-context Red review for L3 must re-execute the lane gates from an isolated
clone, then the L3 PR can be squash-merged into `leaderboard-profiles` with a
SHA pin. Season merge to `main` still requires cumulative review pinned to the
exact head SHA, CI, deploy READY, live probes, and auto-revert on any failed
live check.
