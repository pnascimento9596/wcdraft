# Draft screen mobile horizontal overflow — diagnosis (2026-06-12)

**Lane:** `ws-ux/mobile-content` (Yellow) · **Item 3** of the UX + current-basis wave.

## Symptom (owner, iPhone Safari, prod www.wcdraft.com)

The draft/pick screen rendered wider than the visual viewport:

- formation label `4-3-3` clipped on the left to `-3-3`;
- the now-drafting nation flag half off-screen;
- a horizontal scrollbar under the pitch;
- panels reading "zoomed-out, loose, overlapping".

## Method

Measured against a faithful iPhone layout viewport, driving the real dev build
(`next dev --webpack`) with Playwright at 390×844 and 360×800. The desktop
Chromium emulation keeps a 15px classic scrollbar, so `documentElement.clientWidth`
came back as 375 while `window.innerWidth` was 390 — i.e. the emulator's layout
viewport did **not** match the iPhone's (overlay scrollbars → 390 layout). That
375 layout happened to fit and hid the bug. Restoring a faithful 390 layout
(`html{scrollbar-width:none}`) reproduced it. A DOM sweep flagged every element
whose `right > clientWidth` or `left < 0`, plus every element with
`scrollWidth > clientWidth` (excluding `overflow:hidden`/`clip`, which are
intentional ellipsis clips, not layout overflow).

## Measured offenders (390×844, faithful layout, candidate state)

The overflow appears only **after "Reveal squad"**, when the candidate list renders:

| element         | class          | width / scroll                         |
| --------------- | -------------- | -------------------------------------- |
| scroll column   | `.draftScroll` | scrollWidth **402** vs clientWidth 356 |
| candidate panel | `.panel`       | scrollWidth 393 vs clientWidth 338     |
| candidate list  | `.candList`    | scrollWidth 383 vs clientWidth 318     |
| candidate row   | `.candRow`     | **382.6px** wide inside a 318px parent |
| meta line       | `.candRowLine` | 366.6px                                |

The `.candRow` was 382.6px while its `.candList` container was only 318px — the
row refused to shrink to its container, so `.draftScroll` scrolled horizontally.
On iOS that surplus width is what zooms the page out and clips the formation
title / flag on the leading edge.

## Root cause

`.candList` is `display: grid` with **no `grid-template-columns`**. A bare grid
has a single implicit `auto` column, and an `auto` track's _minimum_ is its
content's **min-content**. `.candRowName` and `.candRowSub` are
`white-space: nowrap`, so a long club line (e.g. Yotún → "Orlando City SC",
Hurtado → "Vitória de Guimarães", Farfán → "Lokomotiv Moscow") makes the row's
min-content wider than the viewport. The `auto` track will not shrink below that
min-content, so the track — and the whole draft column — overflows. The
`min-width: 0` already present on `.candRowMain` is inert here because the **grid
track**, not the flex item, is the binding constraint.

This is a layout-level defect, not a content edge case: any sufficiently long
club/name string triggers it, and the live pool has many.

## Fix

`apps/web/components/game/game.module.css` — `.candList`:

```css
grid-template-columns: minmax(0, 1fr);
```

`minmax(0, 1fr)` lets the single column collapse **below** its min-content, which
re-enables the `min-width: 0` + `text-overflow: ellipsis` already on
`.candRowMain` / `.candRowName` / `.candRowSub`. The name/club lines now clip
with an ellipsis instead of widening the row. This is the offender fixed at the
layout level — **no** `.draftScroll { overflow-x }` clamp was added, since a
shell clamp would mask future regressions rather than fix them.

## Verification (post-fix, faithful layout)

| viewport | theme | offenders (right>vw or left<0) | docScrollWidth | real x-scrollers |
| -------- | ----- | ------------------------------ | -------------- | ---------------- |
| 390×844  | light | 0                              | 390            | 0                |
| 360×800  | light | 0                              | 360            | 0                |
| 360×800  | dark  | 0                              | 360            | 0                |

(The only `scrollWidth > clientWidth` elements remaining are `.candRowSub`
spans, which are `overflow: hidden` + ellipsis — intentional clip, not overflow.)

Before/after screenshots at 390 and 360 (light + dark) accompany the PR. The
behavioural proof (a real layout viewport) is browser-measured here rather than
in CI, mirroring `tap-stability.test.ts`; the CI-checkable contract is
`apps/web/lib/game/__tests__/draft-overflow.test.ts`, which fails if the grid
track regresses to a bare `auto`.
