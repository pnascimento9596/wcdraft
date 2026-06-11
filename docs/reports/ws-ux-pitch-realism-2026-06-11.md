# ws-ux/pitch-realism — Realistic Pitch Geometry

- **Date:** 2026-06-11
- **Branch:** `ws-ux/pitch-realism`
- **Base verified:** `origin/main` =
  `d3353fd6fe2d931f29b46cf6091f582bc2d7e392`
- **Tier:** Yellow, presentation-only
- **Scope guard:** no engine/data changes, no `formations.json` coordinate changes, no
  `blindCardRatingView` changes.

## What changed

- Replaced the abstract pitch-frame spans with one reusable normalized SVG layer:
  touchlines, halfway line, center circle + spot, penalty areas, six-yard boxes,
  penalty spots, penalty arcs, and corner arcs.
- Reused the same layer in the formation picker mini-pitches with low-ink styling;
  miniature detail marks are hidden by CSS so the compact tiles stay quiet.
- Kept player nodes and synergy overlays above the markings. Position shape encoding
  stays unchanged: GK square, DF triangle, MF diamond, FW circle.
- Kept all pitch-specific color usage token-driven via `var(...)`; removed the prior
  hardcoded pitch emerald literal from the synergy legend dot.

## Screenshots

All screenshots are 390x844 viewport captures with `prefers-reduced-motion: reduce`.

| Surface          | Theme | Before                                                                       | After                                                                       |
| ---------------- | ----- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Formation picker | Light | `docs/validation/ws-ux-pitch-realism/before/formation-light-390x844.png`     | `docs/validation/ws-ux-pitch-realism/after/formation-light-390x844.png`     |
| Formation picker | Dark  | `docs/validation/ws-ux-pitch-realism/before/formation-dark-390x844.png`      | `docs/validation/ws-ux-pitch-realism/after/formation-dark-390x844.png`      |
| Squad review     | Light | `docs/validation/ws-ux-pitch-realism/before/review-light-390x844.png`        | `docs/validation/ws-ux-pitch-realism/after/review-light-390x844.png`        |
| Squad review     | Dark  | `docs/validation/ws-ux-pitch-realism/before/review-dark-390x844.png`         | `docs/validation/ws-ux-pitch-realism/after/review-dark-390x844.png`         |
| Memory reveal    | Light | `docs/validation/ws-ux-pitch-realism/before/memory-reveal-light-390x844.png` | `docs/validation/ws-ux-pitch-realism/after/memory-reveal-light-390x844.png` |
| Memory reveal    | Dark  | `docs/validation/ws-ux-pitch-realism/before/memory-reveal-dark-390x844.png`  | `docs/validation/ws-ux-pitch-realism/after/memory-reveal-dark-390x844.png`  |

## Verification

- `pnpm --filter @wcdraft/web exec vitest run lib/game/__tests__/pitch-markings.test.ts`
  - 1 file passed, 3 tests passed.
  - Locks marking-layer render, layer order below synergy/nodes, and the rendered 4-3-3
    slot coordinate snapshot.
- `pnpm --filter @wcdraft/web typecheck` — passed.
- `pnpm --filter @wcdraft/web lint` — passed.
- `pnpm --filter @wcdraft/web test`
  - 44 files passed, 1 skipped.
  - 540 tests passed, 1 skipped.
- `pnpm typecheck` — passed.
- `pnpm lint` — passed.
- `pnpm test`
  - 7/7 Turbo tasks successful.
  - Web test count: 540 passed, 1 skipped.
- `pnpm build`
  - 4/4 Turbo tasks successful.
  - Next build emitted the pre-existing circular chunk warnings for
    `sim_worker_ts` / `simulate_ts`; build completed.
- `pnpm exec turbo run typecheck lint test build --force`
  - 16/16 tasks successful.
  - 0 cached.
  - Final rebased run time: 1m48.661s.
  - Core tests: 302 passed, 3 skipped.
  - Data tests: 50 passed, 7 skipped.
  - DB tests: 74 passed.
  - Web tests: 540 passed, 1 skipped.

## Browser probes

- Playwright screenshots covered formation picker, squad review, and Memory reveal in
  both themes at 390x844, reduced motion.
- Node text contrast over pitch chips:
  - Light: worst measured contrast 12.4:1.
  - Dark: worst measured contrast 10.16:1.
- Compact layout budget at 390px viewport:
  - Full review pitch box: 312 x 293.27.
  - Formation mini-pitch box: 48 x 57.59.
- Browser plugin note: the in-app Browser connector did not expose `iab`, so
  screenshot/probe evidence used Playwright.

## Risks / carryovers

- This is display-only. The new markings share the existing 0-100 pitch coordinate
  space and do not alter formation layout data or render-time node coordinates.
- Existing Next circular chunk warnings remain unrelated to this change.
