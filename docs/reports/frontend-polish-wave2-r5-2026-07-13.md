# Frontend Polish Wave 2 - R5 vector medallion

## Outcome

Implemented on `ws-ux/vector-medallion-r5` from Gate 0 base `2add71b2e5daf0e7305350e8144b9860e8cb67c2`. The site header now renders a resolution-independent SVG in the same 48 x 48 CSS box, and the web/PWA plus iOS icon and splash pipelines deterministically rasterize the same committed vector source.

## Collision check

`git diff --name-only origin/main...origin/season/squad-depth` was captured at Gate 0. R5 touches none of the denied Season 2 workflow, engine, data, token, leaderboard, Draft, Review, Results, Share, or team-sheet files. `STATE.md` is on the active Season 2 denylist, so its normal same-change update is deferred for collision avoidance as required by this dispatch.

## Architect-delegated design decision

The source raster was too degraded to recover its small trophy detail faithfully. The replacement keeps the identity anchors that remain legible: circular dark-green field, dual gold ring, three stars, cup, `WC DRAFT` wordmark, laurels, and football pitch. The cup is a clean geometric interpretation rather than a trace. Space Grotesk 700 glyphs are stored as vector outlines so browsers and the Sharp raster pipeline cannot fall back to another font or blur while a font loads. Locked colors are `#2ecf92` and `#f5b62a`.

## Browser evidence

Production-before and local-after were captured at 390 x 844 in Chromium with device scale factors 1, 2, and 3. The header badge bounding box was byte-for-byte identical across every probe:

| Probe                    | CSS box                          | Source                                  | Natural size reported by browser | Horizontal overflow |
| ------------------------ | -------------------------------- | --------------------------------------- | -------------------------------- | ------------------- |
| production before, DPR 1 | 48 x 48 at x=9.59375, y=2.796875 | Next-optimized `/brand/logo-header.png` | 48 x 48                          | none, 390/390       |
| production before, DPR 2 | same                             | Next-optimized `/brand/logo-header.png` | 24 x 24                          | none, 390/390       |
| production before, DPR 3 | same                             | Next-optimized `/brand/logo-header.png` | 24 x 24                          | none, 390/390       |
| local after, DPR 1       | same                             | `/brand/medallion-badge.svg`            | resolution-independent SVG       | none, 390/390       |
| local after, DPR 2       | same                             | `/brand/medallion-badge.svg`            | resolution-independent SVG       | none, 390/390       |
| local after, DPR 3       | same                             | `/brand/medallion-badge.svg`            | resolution-independent SVG       | none, 390/390       |

The production DPR 2/3 probe reproduces the owner report directly: a 24-pixel raster is painted into a 48-pixel CSS box. The SVG replacement removes that resolution ceiling without changing layout.

Screenshots:

- [before production DPR 1](frontend-polish-wave2-r5-2026-07-13/before-production-390x844-dpr1.png)
- [before production DPR 2](frontend-polish-wave2-r5-2026-07-13/before-production-390x844-dpr2.png)
- [before production DPR 3](frontend-polish-wave2-r5-2026-07-13/before-production-390x844-dpr3.png)
- [after local DPR 1](frontend-polish-wave2-r5-2026-07-13/after-local-390x844-dpr1.png)
- [after local DPR 2](frontend-polish-wave2-r5-2026-07-13/after-local-390x844-dpr2.png)
- [after local DPR 3](frontend-polish-wave2-r5-2026-07-13/after-local-390x844-dpr3.png)

The local development capture produced only Next development HMR WebSocket and CSP report-only console entries. No asset load or SVG parse error was observed. Production had no browser error.

## Regenerated assets

Web/PWA assets regenerated from `apps/web/assets/brand/medallion-badge.svg`:

- public SVG and 48-pixel legacy game-surface PNG;
- 32, 64, 120, 152, 180, 192, and 512 pixel PNGs;
- app-router 180 and 512 pixel icons;
- public and app-router ICO files.

iOS assets regenerated from the same SVG without touching Capacitor config or native code:

- opaque RGB `AppIcon-1024.png`, validated as PNG, 1024 x 1024, no alpha;
- three 2732 x 2732 splash assets on the existing `#0a0e13` background.

## Determinism and validation

Two consecutive generator runs produced identical SHA-256 fingerprints:

| Artifact                   | SHA-256                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| source and public SVG      | `069ab6c40f3d0e79d39fec9ab1f3d9ce159028ae1144a3a9dc74438efb03952b` |
| 48-pixel legacy header PNG | `7f45b4375db83e3edb85e4930ec81b8f04f6155c1d45a6fc1f21ee9ba788ebd3` |
| PWA 512 icon               | `f599e8620e3c25b362754001593f8472001efa69ecafc326976ccd1a2e7c551a` |
| iOS 1024 icon              | `ccf7157ab8d2f47d61d142df10a3852fc754eb709300649adbdb113e5c5fea2b` |
| iOS 2732 splash            | `1c713cec395afb4edb1607639f1a5b9a1d8e525e524dd3bfb0b1f9f8082c003a` |

Focused gates completed before commit:

- web vector contract: 2/2 passed;
- mobile config and asset tests: 7/7 passed;
- mobile typecheck: passed;
- web typecheck: passed;
- web lint: passed with zero warnings;
- web production build: passed, 40/40 static pages generated; existing Webpack circular-chunk warnings remained non-fatal;
- deterministic regeneration: 6/6 sampled fingerprints identical across consecutive runs;
- Playwright header probes: 6/6 completed with identical layout boxes and zero horizontal overflow.

Gate 0 root validation on the untouched base completed typecheck 9/9 tasks and lint 6/6 tasks. Reported unit suites passed for web Vitest 1,168/1,168 active tests, core 391/391, db 161/161, marketing 68/68, and mobile 6/6. The subsequent web browser flow was not green: the shared parallel run lost its browser context at `/play/review?run=pw-complete-classic` with `Target page, context or browser has been closed`. Turbo then terminated the still-running aggregate, so the data suite did not emit a final package count. The browser and aggregate gates must be rerun in isolation before merge; neither is represented as a pass.

## Risks and rollback

This is a new interpretation, not a pixel-exact recreation. The primary review risk is visual fidelity at small sizes. Rollback is a normal PR revert: the previous raster master and generated assets remain in history. Player-facing game components continue using the regenerated legacy PNG because they are explicitly outside this unit; only the allowed site header swaps directly to SVG.
