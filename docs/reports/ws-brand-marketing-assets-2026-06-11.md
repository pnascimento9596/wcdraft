# ws-brand/marketing-assets - Marketing OG Assets + X Plan

- **Date:** 2026-06-11
- **Branch:** `ws-brand/marketing-assets`
- **Base verified:** `origin/main` =
  `6dc0c46eb8233ef5fd88fbee8bd658260de6e33f`
- **Tier:** Yellow
- **Scope guard:** no engine, data, seam, canonical in-app SVG mark, header mark,
  or PWA icon changes. The medallion/banner family is marketing-only.

## What changed

- Copied owner-provided originals from `/Users/paulo/wcdraft-inbox/` into
  `apps/web/public/brand/marketing/`:
  - `banner.png` - 2172x724, 2,099,820 bytes,
    SHA256 `809a8dfe09b8396fc65083fee5981a128e6407cfd66513988d1f0df678936331`.
  - `logo-medallion.png` - 1254x1254, 2,498,972 bytes,
    SHA256 `92ae6371547efe5354f72b5d3db53fe29a198574386c685929a6119ab18b31c3`.
- Added reproducible Sharp generation via
  `apps/web/scripts/generate-marketing-assets.mjs`, wired into `predev` and
  `prebuild`.
- Generated and committed:
  - `og-default.png` - 1200x630, 141,545 bytes,
    SHA256 `68f0d2cc97b08515186eb3572226ce86ed2e9ac4335f26b5d5f32e3693cce0d7`.
  - `og-square.png` - 1200x1200, 258,732 bytes,
    SHA256 `5ba22820c276fa6d371d561ddcdec0ba091b0137129511b8adeb71df710850f5`.
- Centralized site metadata in `apps/web/lib/site-metadata.ts` and set the
  default Open Graph/Twitter card image to `/brand/marketing/og-default.png`.
- Kept `/play/share` on the same static default image and documented that
  per-run dynamic OG remains the F-4-server backlog item.
- Added `/attribution` and folded the compact attribution line into the
  draft pick screen's internal scroll region:
  `Data: Fjelstul (CC-BY-SA 4.0) · Wikipedia (CC-BY-SA)`.
- Added the organic-first X operating plan and future poster queue item:
  `docs/plans/marketing-x-2026-06.md` and
  `docs/queue/q-007-marketing-automation.md`.

## Metadata proof

Built with:

```bash
WCDRAFT_SITE_URL=http://127.0.0.1:3017 pnpm --filter @wcdraft/web build
pnpm --filter @wcdraft/web exec next start -p 3017
```

Curl-verified rendered metadata on `/`, `/play/share`, `/play/draft`, and
`/play/results`:

- `og:title` / `twitter:title`:
  `wcdraft — draft your all-time World Cup XI`.
- `og:description` / `twitter:description`:
  `Draft your all-time World Cup XI. 17 spins, one squad, the full 2026 bracket — free in your browser.`
- `twitter:card`: `summary_large_image`.
- `og:image` / `twitter:image`:
  `http://127.0.0.1:3017/brand/marketing/og-default.png`.
- `/play/share` retains its page URL:
  `http://127.0.0.1:3017/play/share`.
- Image HEAD checks:
  - `og-default.png`: `200 OK`, `Content-Type: image/png`,
    `Content-Length: 141545`.
  - `og-square.png`: `200 OK`, `Content-Type: image/png`,
    `Content-Length: 258732`.

## Screenshots

Browser plugin note: the in-app Browser connector did not expose `iab`, so
screenshot evidence used Playwright against the local production server.

| Surface                  | Path                                                                     |
| ------------------------ | ------------------------------------------------------------------------ |
| OG card preview          | `docs/screenshots/ws-brand-marketing-assets/og-card-preview.png`         |
| Pick attribution - light | `docs/screenshots/ws-brand-marketing-assets/draft-attribution-light.png` |
| Pick attribution - dark  | `docs/screenshots/ws-brand-marketing-assets/draft-attribution-dark.png`  |

The pick-screen evidence was captured from a real draft flow: formation lock,
spin, reveal squad, then the attribution element inside the anchored draft
scroll region. Reduced motion was used only to skip animation timing.

## Marketing plan sources

The plan cites official FIFA sources checked on 2026-06-11:

- `https://digitalhub.fifa.com/m/1be9ce37eb98fcc5/original/FWC26-Match-Schedule_English.pdf`
- `https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures`
- `https://www.fifa.com/en/articles/mexico-south-africa-preview-live-stream-team-news-tickets`

Hard gates preserved:

- Paid promotion / X Premium advertising remains blocked on trademark counsel
  `[HUMAN]`.
- Share-token posts require real replay-checked URLs.
- No player photos, likenesses, official marks, trophy likenesses, or affiliation
  copy.

## Verification

- `pnpm --filter @wcdraft/web generate:marketing-assets` - passed.
- Fresh-worktree package bootstrap:
  - `pnpm --filter @wcdraft/core build` - passed.
  - `pnpm --filter @wcdraft/db build` - passed.
  - `pnpm --filter @wcdraft/data build` - passed.
- `pnpm --filter @wcdraft/web typecheck` - passed after bootstrap.
- `pnpm --filter @wcdraft/web lint` - passed.
- `pnpm --filter @wcdraft/web test`
  - 45 files passed, 1 skipped.
  - 548 tests passed, 1 skipped.
- `pnpm exec turbo run typecheck lint test build --force`
  - 16/16 tasks successful.
  - 0 cached.
  - Runtime: 1m47.997s after rebasing onto `origin/main`
    `6dc0c46eb8233ef5fd88fbee8bd658260de6e33f`.
  - Core tests: 302 passed, 3 skipped.
  - Data tests: 50 passed, 7 skipped.
  - DB tests: 74 passed.
  - Web tests: 548 passed, 1 skipped.
- `WCDRAFT_SITE_URL=http://127.0.0.1:3017 pnpm --filter @wcdraft/web build`
  - passed; emitted the pre-existing Next circular chunk warnings.

## Risks / carryovers

- Dynamic per-run OG remains future server work, not part of this Yellow lane.
- The marketing plan intentionally uses `{reproducible_share_url}` placeholders
  in example Daily Draft posts until a real token is generated and replayed.
- The local synthetic OG preview page produced a `/favicon.ico` 404 console entry;
  the app build and image fetches were otherwise clean.
