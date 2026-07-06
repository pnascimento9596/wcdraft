# Concept A logo system - Yellow lane report

Date: 2026-07-06
Branch: `ws-ux/logo-system-concept-a`
Base: `origin/main` at `1274ff9b8cf3c36831be145fcff42e13d7bd48c5`

## Outcome

Local build lane PASS. The new Concept A logo system is implemented and validated locally. Fresh-context visual review initially BLOCKED on generated `apps/web/next-env.d.ts` drift from `next dev`; that file was restored to the committed import path and the reviewer returned final PASS.

This report is pre-merge. Production live verification still belongs to the post-merge ship step.

## Mark Geometry

Full mark, `apps/web/public/brand/logo-mark.svg`:

- Globe is a flat gold `#f5b62a` sphere with ink under-strokes for contrast on both pale and dark headers.
- Football/globe read comes from clipped great-circle seams: vertical meridians, horizontal equator, upper/lower latitude arcs, and pentagon connector seams.
- Pentagon layout uses one bold central pentagon plus five fainter partial pentagons around the limb. All patches are clipped to the globe and connected to the seam structure instead of being scattered as unrelated symbols.
- Orbit is an emerald `#2ecf92` dashed ellipse tilted around the globe.
- Pennants use a consistent construction: 24-unit poles, 19x12 triangular flags, dark/white keylines, and varied rotations at four orbit positions. Colors are abstract emerald, gold, and white, with no national flag detail.
- No gradients, shadows, or glow were added to the SVG mark.

Compact mark, `apps/web/public/brand/logo-mark-compact.svg`:

- Same globe and center-pentagon core as the full mark.
- Orbit and pennants are removed for favicon, Apple touch, 192 PWA, maskable, and other `<48px` contexts.
- 512 PWA any-purpose icon uses the full mark because local visual inspection showed the orbit and pennants remain legible at 512px. The 192, 180, 48, 32, and 16 contexts use compact.

Lockup, `apps/web/public/brand/logo-lockup.svg`:

- Full Concept A mark plus Space Grotesk 700 wordmark.
- `WC` is white and `DRAFT` is emerald, matching the approved wordmark direction.

## Swap Sites

- Header: `apps/web/components/site-header.tsx` now uses `/brand/logo-mark.svg` at a 48px box in both themes and both breakpoints.
- Header sizing: `apps/web/app/globals.css` preserves masthead layout while giving the full mark enough space for pennants to read.
- Game app bars: `draft-screen/app-bar.tsx`, `history-screen.tsx`, `review-screen.tsx`, `share-screen.tsx`, and `results-screen.tsx` now use `/brand/logo-mark-compact.svg` at 28px.
- Draft setup: `draft-screen/setup.tsx` now uses `/brand/logo-lockup.svg`.
- Dynamic per-run OG: `apps/web/app/api/og/run/route.tsx` fetches `/brand/logo-mark.svg`; `run-og.test.ts` stubs and validates the same asset.
- Static share SVG: `apps/web/public/og/share-default.svg` embeds the new full mark geometry.
- Favicons/PWA: `apps/web/scripts/generate-icons.mjs` now generates `app/favicon.ico` with 16/32/48 compact PNG entries, `app/icon.png`, `app/apple-icon.png`, and `public/icons/*` from the full/compact tiered sources.
- Manifest metadata: `apps/web/app/layout.tsx` explicitly advertises `/favicon.ico`; `apps/web/app/manifest.ts` continues to reference 192, 512, and maskable icons.
- Static marketing/OG: `apps/web/scripts/generate-marketing-assets.mjs` now uses `logo-mark.svg` and `logo-lockup.svg`, regenerates `logo-medallion.png`, `og-default.png`, and `og-square.png`, and inlines Space Grotesk only during raster generation.
- Old SVG sources removed after runtime reference cleanup: `wcdraft-mark.svg`, `wcdraft-mark-light.svg`, `wcdraft-icon.svg`, `wcdraft-maskable.svg`, and `wcdraft-lockup.svg`.

Runtime/source grep under `apps/web` is clean for the old asset names:

```text
rg -n "wcdraft-mark|wcdraft-lockup|wcdraft-icon|wcdraft-maskable|wcdraft-mark-light" apps/web
# no matches, rg exit 1
```

Historical docs still mention the retired asset names; those are provenance records and were not rewritten.

## Render Matrix

Header screenshots:

- [Desktop light](logo-system-concept-a-2026-07-06/header-desktop-light.png)
- [Desktop dark](logo-system-concept-a-2026-07-06/header-desktop-dark.png)
- [Mobile 390x844 light](logo-system-concept-a-2026-07-06/header-mobile-light.png)
- [Mobile 390x844 dark](logo-system-concept-a-2026-07-06/header-mobile-dark.png)

Icon and OG matrix:

- [Favicon, Apple touch, PWA 192/512/maskable, static OG, signed OG](logo-system-concept-a-2026-07-06/icon-og-matrix.png)
- [Fresh signed per-run OG PNG](logo-system-concept-a-2026-07-06/run-og-signed.png)
- [Fresh signed per-run OG headers](logo-system-concept-a-2026-07-06/run-og-signed.headers)
- [Fresh signed per-run OG summary](logo-system-concept-a-2026-07-06/run-og-summary.json)
- [Local manifest capture](logo-system-concept-a-2026-07-06/manifest.webmanifest.json)

Local asset HTTP probe from `http://127.0.0.1:3107`:

```text
/favicon.ico 200 image/x-icon 7754
/icons/icon-192.png 200 image/png 29771
/icons/icon-512.png 200 image/png 132156
/icons/icon-maskable-512.png 200 image/png 85853
/icons/apple-touch-icon.png 200 image/png 26740
/brand/marketing/og-default.png 200 image/png 121622
/brand/logo-mark.svg 200 image/svg+xml 4871
/brand/logo-mark-compact.svg 200 image/svg+xml 3100
/brand/logo-lockup.svg 200 image/svg+xml 5513
```

Fresh signed per-run OG response:

```text
HTTP/1.1 200 OK
cache-control: public, max-age=31536000, immutable
content-type: image/png
```

## Validation

Package/export prerequisite:

```text
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@wcdraft/core --filter=@wcdraft/data --filter=@wcdraft/db --force
# PASS: 3 successful, 3 total
```

Focused checks:

```text
git diff --check
# PASS

pnpm --filter @wcdraft/web lint
# PASS: eslint . --max-warnings=0

pnpm --filter @wcdraft/web run pretest && pnpm --filter @wcdraft/web exec vitest run lib/game/__tests__/run-og.test.ts
# PASS: 1 file, 29 tests
```

Root gates:

```text
pnpm typecheck
# PASS: 8 successful, 8 total

pnpm lint
# PASS: 5 successful, 5 total

pnpm test
# PASS: 8 successful, 8 total
# web: 83 passed files, 1 skipped file; 904 passed tests, 1 skipped test
# game-flow-playwright: ok - mode-select CTA, draft setup, position-first target, lock-pick, manager guard, review simulate, results, and share

pnpm build
# PASS: 4 successful, 4 total
# Note: Next build emitted existing warnings about webpack chunk circularity and edge-runtime static generation, then completed successfully.
```

Fresh-context visual review:

- Initial verdict: BLOCK on generated-file drift in `apps/web/next-env.d.ts` caused by local `next dev`.
- Fix: restored import to `./.next/types/routes.d.ts`; `git diff -- apps/web/next-env.d.ts` is empty.
- Final verdict: PASS.

## Scope And Risk

- No `packages/`, `etl/`, schema, rating, sim, draft-engine, or runtime-data source changes.
- The only game screen code changes are image source swaps for brand marks.
- The largest behavior surface is asset generation: `generate-icons.mjs` now emits ICO plus tiered full/compact PNG icons, and `generate-marketing-assets.mjs` regenerates marketing PNGs from the new logo sources.
- Previously cached signed OG cards may continue to show old pixels. New static OG assets and newly signed per-run OG renders use the new mark.
