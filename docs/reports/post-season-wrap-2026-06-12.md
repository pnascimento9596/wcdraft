# Post-season wrap wave — 2026-06-12

Branch: `ws-wrap/post-season`
Base: `origin/main` `a0d0828612f6103ea37e310aa76389e4ead28a3e`
Risk tier: Yellow

## Scope result

All four requested items stayed inside Yellow boundaries. No schema, contract,
sim, rating, synergy, draft-sampling, or entitlement files were changed. No
golden files were regenerated or modified.

## Changes

- Service-worker registration now handles the post-`load` hydration case by
  registering immediately when `document.readyState !== "loading"`. Existing
  production-only gating and `updateViaCache: "none"` are preserved.
- Results and share screens render compact non-default config badges derived
  from decoded replay tokens. Local records are encoded and decoded through the
  same token path before badge rendering. Default `t2` and legacy `t1` tokens
  show no badge noise.
- Position-first lock-bar idle copy names the committed target slot/line, e.g.
  `Locked target: GK XI (4-3-3.GK). Select a player for this slot.`
- `STATE.md` and dated report addenda now reflect post-#105 reality:
  merit-v3 V8 is current (`runtime-data-2.0.0` / `engine-2026.06.12`), while
  draft-config anchors are historical PREV-skew fixtures.

## Validation

- Focused:
  - `pnpm exec vitest run lib/game/__tests__/sw-register.test.ts lib/game/__tests__/sw-cache-version.test.ts lib/game/__tests__/config-badges.test.ts`
    from `apps/web`: 3 files, 28 tests passed.
  - `pnpm --filter @wcdraft/web test`: 52 files passed, 1 skipped; 603 passed,
    1 skipped.
- Full forced gate:
  - `pnpm exec turbo run typecheck lint test build --force`: 16/16 tasks
    successful, 0 cached.
  - Counts in forced `test`: core 331 passed / 3 skipped; data 65 passed /
    7 skipped; db 74 passed; web 603 passed / 1 skipped.
  - Build warnings: existing Next/Webpack circular chunk warnings only.
- Explicit golden command also returned green:
  - core `test:golden` 3; core `test:golden:draft` 37
  - data `test:golden:data` 31; data `test:golden:integration` 22
  - web `test:golden:leaderboard` 5
- Golden/generated diff check:
  - no diffs under `packages/core/test/fixtures`,
    `packages/data/test/fixtures`, `packages/data/src/generated`,
    `packages/data/reports`, or web leaderboard fixtures.
- Browser evidence:
  - `docs/validation/post-season-wrap-2026-06-12/local-browser-probe.json`
  - 12 screenshots under `docs/validation/post-season-wrap-2026-06-12/`
  - local production-build SW registered, PWA manifest present, stale test
    caches evicted, config badges/copy rendered in both themes at 390x844 and
    360x800, console errors empty.

## Dropped / ledgered

None.

## Pending before ship

Fresh-context final PR review, PR creation, CI, squash merge with
`--match-head-commit`, Vercel READY wait, and live production verification.
