# Dynamic OG Share Images — Red Lane Report

Date: 2026-06-13
Branch: `feature/dynamic-og`
Base: `origin/main` at `88ae0c3b6294b3f35ca973371d59ce7ef42a1d6f`

## Scope

This lane changes the share-link unfurl surface from one static default image to
per-run OpenGraph/Twitter images for newly minted completed-run `t2` tokens.

The route is token-only and sessionless. It does not run the tournament
server-side. New completed-run tokens carry a compact `og` result summary copied
from the already-computed persisted simulation; the image route replays the pick
log only to validate and render the starting XI.

## Surface Inventory Update

`/play/share` now has two honest unfurl states:

- Current-anchor `t2` tokens with an `og` summary: `og:image` and
  `twitter:image` point to `/api/og/run?run=<token>&v=<deploy-data-key>`,
  `1200x630`, `summary_large_image`, with run-specific alt text.
- Malformed tokens, legacy `t1` tokens, pre-summary `t2` tokens, and
  foreign-build/skew tokens: metadata keeps the existing
  `/brand/marketing/og-default.png` fallback and the image route redirects to
  that asset instead of throwing.

The image content is names, national codes, position shapes, formation, mode,
non-default config badges, manager, key rated starters, and the compact final
record. It uses committed local fonts and the committed wcdraft mark; no external
runtime assets, no player likenesses, no kits, no crests, and no competition
marks were added.

## Validation So Far

- `pnpm --filter @wcdraft/core build` — PASS
- `pnpm --filter @wcdraft/data build` — PASS after core build
- `pnpm --filter @wcdraft/db build` — PASS
- `pnpm --filter @wcdraft/web exec vitest run lib/game/__tests__/run-og.test.ts --reporter verbose` — PASS, 9 passed
- `pnpm --filter @wcdraft/web exec vitest run lib/game/__tests__/run-og.test.ts lib/game/__tests__/run-token-v2.test.ts` — PASS, 36 passed
- `pnpm --filter @wcdraft/web typecheck` — PASS
- `pnpm --filter @wcdraft/web lint` — PASS
- `pnpm --filter @wcdraft/web test` — PASS, 60 files passed, 674 tests passed, 1 skipped
- `pnpm --filter @wcdraft/web build` — PASS; Next emitted existing-style
  circular chunk warnings and listed `/api/og/run` plus dynamic `/play/share`
  in the route table
- `pnpm typecheck` — PASS, 8 turbo tasks successful
- `pnpm lint` — PASS, 5 turbo tasks successful
- `pnpm test` — PASS, 8 turbo tasks successful; core 338 passed, db 79 passed,
  data 65 passed / 7 skipped, marketing-x 64 passed, web 674 passed / 1 skipped
- `pnpm build` — PASS, 4 turbo tasks successful; web build warnings were the
  same circular chunk warnings plus the expected edge-runtime/static-generation
  warning for the OG route
- `rg -n "FIFA|UEFA|soccer|crest|kit|likeness|World Cup" apps/web/app/api/og apps/web/lib/game/run-og* apps/web/app/play/share/page.tsx apps/web/public/fonts/og/README.md docs/reports/dynamic-og-2026-06-13.md`
  — PASS for runtime strings; only this report's licensing sentence matched
- Local production-server check (`WCDRAFT_SITE_URL=http://127.0.0.1:3027 pnpm exec next start -H 127.0.0.1 -p 3027`) —
  PASS:
  - dynamic `/api/og/run?...` returned `200`, `content-type: image/png`,
    `cache-control: public, max-age=31536000, immutable`, `1200x630`, 63,610 bytes
  - two dynamic fetches for the same token were byte-identical
  - malformed token returned `307` with `cache-control: public, max-age=300`
    and followed to byte-identical `/brand/marketing/og-default.png`
  - tokenized `/play/share` HTML emitted `og:image`, `og:image:width=1200`,
    `og:image:height=630`, run-specific `og:image:alt`, `twitter:card=summary_large_image`,
    and matching `twitter:image`
  - visual PNG inspection confirmed the XI/result card renders nonblank and
    default-config runs do not show a default badge

## Guard Coverage

- Token summary is added only for records that already have a persisted
  simulation.
- Malformed result summaries fail decode.
- Malformed, legacy, pre-summary, and foreign-build tokens choose static OG.
- Current-anchor summary tokens produce cache-keyed dynamic image URLs.
- OG model reconstructs the XI from the existing token replay path.
- `ImageResponse` renders deterministic bytes for the same model/assets and
  stays under the asserted 500 KB output cap.
- A static route-scope guard asserts the OG route/model do not import
  `runSimulation` or `runSimulationSync`.
- The route-level malformed-token test asserts the crawler fallback is a 307
  instead of a thrown/500 response.
