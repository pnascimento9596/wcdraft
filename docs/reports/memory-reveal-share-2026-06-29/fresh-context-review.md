# Fresh-context review — Memory reveal share / progression / leaderboard IA

Date: 2026-06-29
Base after rebase: `2de107c4e7088c5296cbf7a113e1b08c0c215430`
Branch under review: `ws-ux/memory-reveal-share-20260629`

## Outcome

No blockers found across the three unit reviews.

Each unit was reviewed in its own fresh clone checked out at base `2de107c`,
with only that unit's file subset applied. The owner checkout and the
implementation worktree were not used for the review gates.

## Unit 1 — Memory reveal share card / OG / caption

Fresh clone: `/tmp/wcdraft-memory-review-rebased-unit1`

Scope applied:

- `apps/web/lib/game/memory-reveal-model.ts`
- `apps/web/components/game/memory-reveal.tsx`
- `apps/web/components/game/share-screen.tsx`
- `apps/web/lib/game/share-adapters.ts`
- `apps/web/lib/game/run-og-model.ts`
- `apps/web/lib/game/run-og-signing.ts`
- `apps/web/lib/game/run-og-image.tsx`
- focused game tests under `apps/web/lib/game/__tests__/`

Findings:

- No blocker found. The reveal model uses the existing masked display seams
  (`pitchSlotViews`, `lineStrengthViews`, `squadAverageOverall` with
  `blindRatings: true`) for the drafted-against state and separately derives
  the revealed state from the normal basis path.
- No engine, compact data, run-token schema, leaderboard route, or scoring
  contract change was present in the applied unit diff.
- Signing validation preserves the trusted OG/forgery boundary by accepting a
  reveal payload only when hidden-mode before values are null and the signed
  model validates.

Commands:

```bash
git clone --no-local /private/tmp/wcdraft-memory-reveal-share-20260629 /tmp/wcdraft-memory-review-rebased-unit1
cd /tmp/wcdraft-memory-review-rebased-unit1
git checkout --detach 2de107c4e7088c5296cbf7a113e1b08c0c215430
# applied Unit 1 patch only
git diff --check
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@wcdraft/core --filter=@wcdraft/data --filter=@wcdraft/db
pnpm --filter @wcdraft/web exec node ../../packages/data/scripts/copy-web-assets.mjs
pnpm --filter @wcdraft/web exec vitest run \
  lib/game/__tests__/memory-hidden-mode.test.ts \
  lib/game/__tests__/share-adapters-intent.test.ts \
  lib/game/__tests__/run-og.test.ts
```

Result:

- `git diff --check`: PASS.
- Package build: PASS, 3/3 tasks.
- Focused Vitest: PASS, 3 files / 56 tests.

## Unit 2 — Cold mode-select ordering / post-run Memory progression

Fresh clone: `/tmp/wcdraft-memory-review-rebased-unit2`

Scope applied:

- `/play` metadata and mode-select component/CSS.
- Results-screen Memory progression panel and styles.
- CSS module exports required by those surfaces.

Findings:

- No blocker found. Daily remains the selected cold path, Classic remains a
  primary visible path, and Memory remains reachable while reading as a
  secondary blind challenge.
- The post-run affordance is results-only for non-hidden runs and links to
  `/play/draft?mode=hidden`; hidden runs still render the reveal instead.
- No draft engine, token, storage, leaderboard, or data contract change was
  present in the applied unit diff.

Commands:

```bash
git clone --no-local /private/tmp/wcdraft-memory-reveal-share-20260629 /tmp/wcdraft-memory-review-rebased-unit2
cd /tmp/wcdraft-memory-review-rebased-unit2
git checkout --detach 2de107c4e7088c5296cbf7a113e1b08c0c215430
# applied Unit 2 patch only
git diff --check
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@wcdraft/core --filter=@wcdraft/data --filter=@wcdraft/db
pnpm --filter @wcdraft/web typecheck
```

Result:

- `git diff --check`: PASS.
- Package build: PASS, 3/3 tasks.
- Web typecheck: PASS.

## Unit 3 — Leaderboard IA / lane labels

Fresh clone: `/tmp/wcdraft-memory-review-rebased-unit3`

Scope applied:

- Leaderboard config labels.
- Board view copy and row badges.
- Submit panel badge copy.
- Leaderboard UI gating test expectations.

Findings:

- No blocker found. Daily remains the default board path; advanced board copy
  explicitly separates sighted Classic and blind Memory.
- Memory ranked is still a distinct lane label. No leaderboard server route,
  store, schema, season key, scoring, submit validation, or API contract
  change was present in the applied unit diff.

Commands:

```bash
git clone --no-local /private/tmp/wcdraft-memory-reveal-share-20260629 /tmp/wcdraft-memory-review-rebased-unit3
cd /tmp/wcdraft-memory-review-rebased-unit3
git checkout --detach 2de107c4e7088c5296cbf7a113e1b08c0c215430
# applied Unit 3 patch only
git diff --check
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@wcdraft/core --filter=@wcdraft/data --filter=@wcdraft/db
pnpm --filter @wcdraft/web exec node ../../packages/data/scripts/copy-web-assets.mjs
pnpm --filter @wcdraft/web exec vitest run lib/leaderboard/__tests__/ui-gating.test.ts
```

Result:

- `git diff --check`: PASS.
- Package build: PASS, 3/3 tasks.
- Focused Vitest: PASS, 1 file / 37 tests.

## Review conclusion

The three units are file-scope coherent and do not cross into the prohibited
parallel lane files (`app/page.tsx`, root layout/theme) or into engine/data/
leaderboard-server contracts. Local full-repo gates and production verification
still remain required before shipping.
