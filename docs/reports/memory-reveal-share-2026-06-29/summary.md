# Memory reveal share / progression / leaderboard IA — local implementation report

Date: 2026-06-29
Branch: `ws-ux/memory-reveal-share-20260629`
Base after rebase: `2de107c4e7088c5296cbf7a113e1b08c0c215430`
Scope: Yellow `apps/web` UI / flow / share lane

## Outcome

Implemented locally. Full local gates passed. PR, merge, deploy, and live
production verification are still pending at the time this report was written.

## Unit 1 — reveal as a before/after shareable

- Added a shared Memory reveal view model that derives the drafted-against
  blind values from the existing masked display path and derives revealed
  values from the normal basis path.
- Reused that reveal model in the on-screen `MemoryReveal` component, the
  in-app SVG share card, share caption/intent copy, and trusted OG model.
- Hidden-mode share cards now render a Memory reveal variant with blind OVR
  as honest `—`, revealed squad/line values, the resulting XI, top reveals,
  and the caption line `drafted blind, ended with ...`.
- Trusted OG signing/verification now validates hidden reveal payloads while
  preserving the existing forged/unsigned fallback behavior.

## Unit 2 — surface Memory after run #1

- Cold `/play` starts on Daily, keeps Classic as the primary base-game path,
  and keeps Memory reachable as a secondary blind challenge rather than a
  co-equal intake default.
- Results for non-hidden runs now include a `Try drafting blind` progression
  affordance linking to `/play/draft?mode=hidden`.
- Hidden results continue to render the reveal instead of the progression CTA.

## Unit 3 — reduce board fragmentation honestly

- Daily leaderboard copy remains the cold-user default and now calls out the
  sighted Classic default.
- Advanced leaderboard filters label draft visibility as `Sighted Classic` vs
  `Blind Memory`.
- Ranked Memory remains separate from sighted ranked; only IA/copy/row-label
  surfaces changed.

## Scope guard

- No `blindCardRatingView` seam change.
- No engine, draft, sim, compact data, ETL, run-token schema, leaderboard
  server route, leaderboard store, scoring, migration, or season-key change.
- Did not touch `apps/web/app/page.tsx`, root layout, or theme-provider files.

## Blind-seam integrity proof

- `apps/web/lib/game/memory-reveal-model.ts` calls `pitchSlotViews`,
  `lineStrengthViews`, and `squadAverageOverall` with `blindRatings: true` for
  the pre-reveal state, then separately calls the normal basis path for the
  revealed state.
- `apps/web/lib/game/__tests__/memory-hidden-mode.test.ts` covers hidden mode
  pre-reveal masking and now asserts the reveal model has null before values
  and numeric after values.
- `apps/web/lib/game/__tests__/run-og.test.ts` covers hidden OG reveal signing
  and verifies reveal before values stay null while after values and lineup
  OVRs are numeric.

## Visual proof

Browser proof file:
`docs/reports/memory-reveal-share-2026-06-29/local-browser-proof.json`

Screenshot set:
`docs/reports/memory-reveal-share-2026-06-29/screenshots/`

Recorded proof:

- 12 mobile screenshots: light/dark × 360x800/390x844 × cold mode-select,
  post-run try-blind affordance, Memory reveal share card.
- axe violations: 0.
- contrast failures: 0.
- overflow failures: 0.
- page errors: 0.
- console errors: 0.
- HTTP errors: 0.

Runtime anchors recorded in the browser proof:

- schema: `runtime-data-2.8.0`
- dataset: `2026-06-04`
- rating: `wc-perf-6.6.0+proj-career-5.6.0`
- engine: `engine-2026.06.28-merit-v4.6`
- ruleset: `ruleset-2026.06.04`

## Fresh-context review

Report:
`docs/reports/memory-reveal-share-2026-06-29/fresh-context-review.md`

Result: no blockers found.

Fresh-review gates:

- Unit 1 rebased clone: package build PASS, 3/3 tasks; focused Vitest PASS,
  3 files / 56 tests.
- Unit 2 rebased clone: package build PASS, 3/3 tasks; web typecheck PASS.
- Unit 3 rebased clone: package build PASS, 3/3 tasks; focused Vitest PASS,
  1 file / 37 tests.

## Local gates

Completed so far:

- `pnpm --filter @wcdraft/web exec vitest run lib/game/__tests__/memory-hidden-mode.test.ts lib/game/__tests__/share-adapters-intent.test.ts lib/game/__tests__/run-og.test.ts lib/leaderboard/__tests__/ui-gating.test.ts lib/game/__tests__/contrast-tokens.test.ts`: PASS, 5 files / 95 tests.
- `pnpm --filter @wcdraft/web typecheck`: PASS.
- Browser screenshot/axe/contrast/overflow proof: PASS, 12 screenshots, zero
  failures.
- Fresh-context review: PASS, no blockers.
- Root `pnpm typecheck`: PASS, 8/8 tasks.
- Root `pnpm lint`: PASS, 5/5 tasks.
- Root `pnpm test`: PASS, 8/8 tasks; web Vitest 72 files passed / 1 skipped,
  790 tests passed / 1 skipped; `game-flow-playwright` PASS.
- Root `pnpm build`: PASS, 4/4 tasks. Existing Next chunk circular-dependency
  warnings and edge-runtime static-generation warning were observed.
- `pnpm exec turbo run test:golden:leaderboard --filter=@wcdraft/web`: PASS,
  4/4 tasks; golden file 1 passed / 6 tests.

Pending before ship:

- `git diff --check`.
- PR creation, CI, squash merge, deployment READY wait, and live production
  verification.

## Risks / carryovers

- Memory and Classic ranked lanes intentionally remain separate. This lane
  improves labels and default IA only; it does not merge competitive lanes.
- Local share-page browser proof runs without production OG signing secrets, so
  the in-app page shows the existing signed-preview-unavailable fallback while
  still rendering the token-backed SVG/caption artifact. OG signing and forgery
  behavior are covered by focused tests and still require production live
  readback after deploy.
