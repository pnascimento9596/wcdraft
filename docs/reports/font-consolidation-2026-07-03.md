# Single-font consolidation — Space Grotesk everywhere

Date: 2026-07-03 · Branch: `ws-ux/space-grotesk-20260703` · Tier: Yellow

Outcome: local implementation candidate with local gates green. The report
records the before/after font audit, payload delta, and validation results. It
does not claim production ship until CI, review, merge, deploy, and live
verification complete.

## Scope

- Removed the Space Mono public font payload and all app references to
  `Space Mono`, `space-mono`, `ui-monospace`, and `monospace` under `apps/web`.
- Consolidated app typography tokens to
  `--font-family: "Space Grotesk", system-ui, sans-serif`.
- Kept the existing Space Grotesk webfont files and made body text request
  tabular numerics globally with `font-variant-numeric: tabular-nums` and
  `font-feature-settings: "kern", "liga", "tnum"`.
- Repointed former mono/display/body/serif token consumers to the same family
  token, including game CSS modules, account/sign-in styles, leaderboard
  styles, share SVG JSX, the global error page, and the raw auth verify
  interstitial.
- Updated static text-bearing SVGs to use the same token and embed same-origin
  Space Grotesk `@font-face` declarations.
- Updated the Download card path to clone dynamic share-card SVGs and embed
  Space Grotesk WOFF2 data URIs into the exported standalone SVG blob.
- Updated the dynamic run OG image renderer to embed only Space Grotesk faces.
  The renderer uses the literal ImageResponse font family name because it does
  not run inside the DOM token cascade.
- Email templates remain the documented exception: no attempt was made to force
  webfonts inside email-client markup.

## Font / Payload Proof

Leak sweep after implementation:

```text
rg -n -e 'Space Mono|space-mono|SpaceMono|ui-monospace|monospace|--font-display|--font-text|--font-mono|--f-display|--f-body|--f-mono|--f-serif' apps/web -S
```

Result: no matches.

Payload size from `origin/main` versus the working tree:

| Payload                |    Before |     After |     Delta |
| ---------------------- | --------: | --------: | --------: |
| Space Grotesk          | 172,521 B | 172,521 B |       0 B |
| Space Mono             |  94,510 B |       0 B | -94,510 B |
| Total web font payload | 267,031 B | 172,521 B | -94,510 B |

OpenType feature inspection was run against the committed Space Grotesk WOFF
and WOFF2 files with `fontTools`. All Latin faces, including the WOFF faces
used by the OG renderer, contain `tnum`. Latin-ext faces do not contain `tnum`,
but their unicode ranges do not include ASCII digits; numeric glyphs resolve to
the Latin faces.

## Mobile Browser Audit

Verifier: `apps/web/scripts/verify-font-consolidation-browser.mts`.

The verifier starts a local Next dev server, enables the leaderboard surface
for measurement, loads both mobile widths in light and dark themes, seeds local
run records, and checks mode select, setup, spin, Classic pick, Open roster,
Blind Open roster, squad review, results, share, leaderboard, account, and
How-to-Play. It records scroll dimensions, horizontal overflow, computed font
families, numeric tabular samples, axe violations, and primary tap-target
geometry.

Post-change strict command after the share-export fix:

```text
WCDRAFT_FONT_AUDIT_VARIANT=after-fix WCDRAFT_FONT_AUDIT_STRICT=1 WCDRAFT_FONT_AUDIT_OUT=/tmp/wcdraft-font-after-fix.json pnpm --filter @wcdraft/web exec tsx scripts/verify-font-consolidation-browser.mts
```

Result: PASS, 48 surfaces, 40 targets, 0 failures.

| Check                                              | Before                                                                                      | After |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----- |
| Non-Grotesk computed families                      | `"Space Mono", ui-monospace, monospace`; `system-ui, -apple-system, "Segoe UI", sans-serif` | none  |
| Numeric surfaces with digits but no tabular sample | 32                                                                                          | 0     |
| Horizontal overflow                                | 0                                                                                           | 0     |
| Tap targets below 44x44                            | 0                                                                                           | 0     |
| Strict failures                                    | baseline non-strict only; 4 local `/leaderboard` dark-route/script-injection noise entries  | 0     |

The share surface now also clicks Download card and inspects the resulting SVG
blob. The audit fails if the exported SVG lacks `Space Grotesk`, lacks the
`--font-family` token, lacks embedded `data:font/woff2;base64` font data, or
contains any mono font reference.

Core in-game shells stayed at one viewport height after the font change:

| Surface           | 390x844 light/dark | 360x800 light/dark |
| ----------------- | -----------------: | -----------------: |
| Spin              |      1.000 / 1.000 |      1.000 / 1.000 |
| Classic pick      |      1.000 / 1.000 |      1.000 / 1.000 |
| Open roster       |      1.000 / 1.000 |      1.000 / 1.000 |
| Blind Open roster |      1.000 / 1.000 |      1.000 / 1.000 |

Expected long-form pages still scroll by content length. The largest
post-change scroll ratios were How-to-Play at 6.673 on 360x800 and results at
2.991 on 360x800; neither had horizontal overflow or sub-44px controls.

Smallest measured visible controls after the change remained compliant:

| Control                    | Viewport |   Size |
| -------------------------- | -------- | -----: |
| Daily play CTA             | 390x844  | 371x44 |
| Formation lock             | 390x844  | 355x44 |
| Open roster row pick       | 390x844  |  61x44 |
| Blind Open roster row pick | 390x844  |  61x44 |
| Copy caption               | 390x844  |  99x44 |

## Validation Ledger

Run so far:

- `pnpm install --frozen-lockfile` — PASS.
- `pnpm exec turbo run build --filter=@wcdraft/core --filter=@wcdraft/data --filter=@wcdraft/db` — PASS.
- `pnpm --filter @wcdraft/web run predev` — PASS.
- Font leak sweep — PASS, no matches.
- Space Grotesk OpenType feature inspection — PASS for Latin numeric faces.
- Strict browser font/mobile/tap audit — PASS, 48 surfaces / 40 targets / 0
  failures. The after-fix run also inspected downloaded share SVG blobs for
  embedded Space Grotesk font data.
- Focused web Vitest
  (`lib/game/__tests__/broadcast-tactics-ui.test.ts`,
  `lib/game/__tests__/run-og.test.ts`) — PASS, 2 files / 32 tests.
- `pnpm --filter @wcdraft/web typecheck` — PASS.
- `pnpm --filter @wcdraft/web lint` — PASS.
- `pnpm --filter @wcdraft/web test` — PASS, 83 files passed / 1 skipped,
  902 tests passed / 1 skipped, plus `game-flow-playwright`.
- `pnpm typecheck` — PASS, 8/8 tasks.
- `pnpm lint` — PASS, 5/5 tasks.
- `pnpm test` — PASS, 8/8 tasks; core 26 files / 391 tests, data 13 files
  passed / 1 skipped with 101 passed / 9 skipped, db 3 files / 108 tests,
  marketing 8 files / 68 tests, web 83 files passed / 1 skipped with 902
  passed / 1 skipped plus `game-flow-playwright`.
- `pnpm build` — PASS, 4/4 tasks. Existing Next circular-chunk and
  edge-runtime static-generation warnings only.
- `pnpm exec turbo run test:golden:leaderboard --filter=@wcdraft/web` — PASS,
  4/4 tasks; leaderboard golden 1 file / 6 tests.
- `pnpm check:generated` — PASS; compact-data anchors unchanged.
- `git diff --check` — PASS.
- Fresh-context reviewer initially BLOCKED on downloaded share-card SVGs
  serializing unresolved `var(--font-family)` without an embedded font contract;
  fixed by adding data-URI font embedding on export.
- Targeted `prettier --check` on supported changed files — PASS after
  formatting the two new reports and audit script. SVGs were inspected by diff;
  this repo's default Prettier invocation does not infer an SVG parser.

Still required before ship: fresh-context review, PR, CI, merge, deploy
observation, and live verification.

## Risks / Review Focus

- Static SVG text is still text, not paths. The SVGs now declare Space Grotesk
  internally, but reviewers should verify rendered marketing assets and the
  generated PNG diff.
- ImageResponse does not consume CSS custom properties, so its Grotesk family
  name is direct by necessity. The font data still comes from the same local
  Space Grotesk assets.
- The consolidation intentionally changes the visual width of former mono
  numeric clusters. The strict browser proof shows no mobile overflow or tap
  regression across the audited draft surfaces, but reviewers should focus on
  dense result/share/leaderboard rows.
