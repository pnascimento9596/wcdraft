# ws-brand/gold-mark — Canonical Mark Gold Re-Ink

- **Date:** 2026-06-11
- **Branch:** `ws-brand/gold-mark`
- **Base verified:** `origin/main` = `ca014322ac29d7b84543cf45b9918109e6f4e178`
- **Tier:** Yellow, presentation/brand-only
- **Scope guard:** no engine/data changes, no gameplay color-token changes, no manifest
  reference-shape changes.

## What changed

- Re-inked the canonical brand SVG geometry in `apps/web/public/brand/` from
  emerald pitch line-work to the marketing gold-gradient family.
- Kept the tactical pitch + draft-arrow + pick-node geometry locked; only
  stroke/fill gradient references changed.
- Added `wcdraft-mark-light.svg`, same geometry, with deeper gold-family stops for
  the light masthead because external SVGs loaded through `next/image` cannot read
  the app's `data-theme` CSS variables.
- Extended `apps/web/app/ds/tokens.css` with marketing gold stops and light-theme
  brand-mark stops; gameplay/action tokens remain unchanged (`--accent` stays emerald,
  `--gold` stays rare pick/win/legend).
- Regenerated the committed PWA/favicons through
  `pnpm --filter @wcdraft/web generate:icons`.

## Wordmark decision

Rendered both header treatments. I chose **gold mark + current wordmark** over a
full-gold wordmark. The full-gold wordmark makes the masthead read as a single gold
block and weakens the existing product hierarchy where emerald remains the everyday
interaction/structure color. The chosen treatment gives the owner-requested gold
canonical mark, preserves the current `wc` ink + emerald `draft` recognition, and
keeps gold scarce outside the brand mark itself. Owner can still override to the
full-gold treatment from the proof screenshot.

## Screenshots

All browser captures used Playwright with a 390x844 viewport and reduced motion.

| Surface | Artifact |
| --- | --- |
| Header, light theme | `docs/validation/ws-brand-gold-mark/header-light-390x844.png` |
| Header, dark theme | `docs/validation/ws-brand-gold-mark/header-dark-390x844.png` |
| Wordmark option: gold mark + current wordmark | `docs/validation/ws-brand-gold-mark/wordmark-option-current.png` |
| Wordmark option: full-gold wordmark | `docs/validation/ws-brand-gold-mark/wordmark-option-full-gold.png` |
| Lockup preview | `docs/validation/ws-brand-gold-mark/lockup-preview.png` |
| Installed icon previews | `docs/validation/ws-brand-gold-mark/installed-icons-preview.png` |
| Browser source probe | `docs/validation/ws-brand-gold-mark/browser-probe.json` |

Browser probe confirmed:

- Light theme header uses `/brand/wcdraft-mark-light.svg`.
- Dark theme header uses `/brand/wcdraft-mark.svg`.

## Contrast

Measured contrast of the brand-mark gradient stops against the header surfaces:

| Stop | Surface | Contrast |
| --- | --- | --- |
| `#6e4e00` | light page `#efe9db` | 6.30:1 |
| `#8a6200` | light page `#efe9db` | 4.53:1 |
| `#a66f00` | light page `#efe9db` | 3.54:1 |
| `#6e4e00` | light panel `#e7dfcd` | 5.75:1 |
| `#8a6200` | light panel `#e7dfcd` | 4.14:1 |
| `#a66f00` | light panel `#e7dfcd` | 3.23:1 |
| `#c8861a` | dark page `#0c1411` | 6.12:1 |
| `#f5b62a` | dark page `#0c1411` | 10.33:1 |
| `#ffd86a` | dark page `#0c1411` | 13.60:1 |

The light variant clears the 3:1 UI/non-text contrast floor for every stop on the
light masthead; dark keeps the brighter marketing gradient.

## Icon determinism

Ran `pnpm --filter @wcdraft/web generate:icons` twice and compared SHA-256 hashes;
the second run was byte-identical.

| File | SHA-256 |
| --- | --- |
| `apps/web/public/icons/icon-192.png` | `6326a8417502e941d93a8f0dd07fe72c49b17307d97a708d4ba4d8c4cc284195` |
| `apps/web/public/icons/icon-512.png` | `c20298c23c0a9c83a502ae8cc80de35b359cbce39387b15b90a0b7304de92690` |
| `apps/web/public/icons/apple-touch-icon.png` | `ca30973de33e8f2489a761e9855ec5c5612318772273e8643733a0ac6c1cdc85` |
| `apps/web/public/icons/icon-maskable-512.png` | `ec216fc0909ee09559f69ad6960e35fbbde9dde6301adc9a5a01d8f08266ab2c` |
| `apps/web/app/icon.png` | `c20298c23c0a9c83a502ae8cc80de35b359cbce39387b15b90a0b7304de92690` |
| `apps/web/app/apple-icon.png` | `ca30973de33e8f2489a761e9855ec5c5612318772273e8643733a0ac6c1cdc85` |

## Import and literal checks

- Touched component-code literal grep:
  `rg -n "#[0-9A-Fa-f]{3,8}" apps/web/components/site-header.tsx` returned no hits.
- Brand SVG emerald grep:
  `rg -n "#2ecf92|#54e3ab|#1c9e6e" apps/web/public/brand` now only hits
  `wcdraft-lockup.svg`'s retained `draft` wordmark gradient.
- Import sweep found the canonical mark is imported on app surfaces via
  `/brand/wcdraft-mark.svg` or `/brand/wcdraft-lockup.svg`.
- Inline copy flag: `apps/web/public/og/share-default.svg` still embeds the old
  canonical mark geometry (`M22 111 ...`). I did not change it in this lane because
  the dispatch explicitly calls out the parallel `ws-brand/marketing-assets` lane for
  OG/meta work.

## Verification

- `pnpm install --frozen-lockfile` — passed.
- `pnpm --filter @wcdraft/core build` — passed.
- `pnpm --filter @wcdraft/db build` — passed.
- `pnpm --filter @wcdraft/data build` — passed.
- `pnpm --filter @wcdraft/web typecheck` — passed after workspace package builds.
- `pnpm --filter @wcdraft/web lint` — passed.
- `pnpm --filter @wcdraft/web test`
  - 45 files passed, 1 skipped.
  - 548 tests passed, 1 skipped.
- `pnpm exec turbo run typecheck lint test build --force`
  - 16/16 tasks successful.
  - 0 cached.
  - Final post-rebase runtime: 2m10.386s.
  - Core tests: 302 passed, 3 skipped.
  - Data tests: 50 passed, 7 skipped.
  - DB tests: 74 passed.
  - Web tests: 548 passed, 1 skipped.
  - Next build completed with the pre-existing circular chunk warnings.

## Risks / carryovers

- `wcdraft-mark-light.svg` is an extra brand asset, not a new geometry. It exists
  because external SVG images cannot consume the app's `data-theme` tokens.
- The default OG image still has an inline copy of the old mark geometry and should be
  handled by the parallel marketing/OG lane, or by a later cleanup that replaces inline
  copies with a single source of truth.
- Browser plugin note: the in-app Browser connector reported `Browser is not available:
  iab`; saved visual evidence used Playwright instead.
