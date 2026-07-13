# Native app-feel R3 evidence — 2026-07-13

## Outcome

Implemented on `ws-ux/native-app-feel-r3` from base `2add71b2e5daf0e7305350e8144b9860e8cb67c2`.
This report is pre-deploy evidence for a Yellow-tier pull request. It does not claim a physical
iPhone, Mobile Safari, Vercel deployment, or live-site verification.

## Scope and collision decision

The Gate 0 comparison against `origin/season/squad-depth` found changes only in the protected
workflow/STATE, game token-record-OG-simulation, leaderboard validation/fixture, Season 2 report,
`packages/core/**`, and `packages/data/**` paths. R3 edits none of those paths and edits none of the
player-facing draft, review, results, share, or team-sheet components.

Architect-delegated decision: implement native touch behavior in the existing global app-shell
stylesheet and keep the interaction probe outside the protected game tests. This is the least
behavior-changing option because it does not alter handlers, navigation, game state, viewport
metadata, or component structure.

## What changed

- Interactive controls use a transparent WebKit tap highlight and `touch-action: manipulation`.
  Page pinch zoom remains enabled because the viewport metadata was not restricted.
- Buttons, app navigation, button-styled links, and ARIA control chrome suppress press-hold text
  selection and the WebKit callout. Text inputs and prose are excluded and remain selectable.
- An immediate opacity-only active response provides visible feedback without changing box
  geometry. The existing reduced-motion rule collapses all transitions, and this response itself
  has no animation.
- `html`, `body`, and `.shell` suppress overscroll chaining. `body` and `.shell` use a `100svh`
  minimum rather than dynamic viewport height.
- Only the mobile menu and account popover gained bounded `overflow-y: auto`, contained
  overscroll, and WebKit momentum scrolling. Long document prose remains ordinary document
  scroll; no blanket overflow rule was added.

## Automated interaction evidence

Command:

```sh
WCDRAFT_NATIVE_APP_FEEL_PHASE=after \
WCDRAFT_NATIVE_APP_FEEL_STRICT=1 \
WCDRAFT_NATIVE_APP_FEEL_OUT_DIR="$PWD/docs/reports/native-app-feel-r3/after" \
pnpm --filter @wcdraft/web verify:native-app-feel
```

The Playwright probe uses Chromium mobile emulation with touch enabled and reduced motion enabled.
It presses the home PLAY DAILY CTA, the `/play` Daily and START DRAFTING mode cards, and mobile-nav
Play. It prevents navigation only after the browser has performed pointer-down/up so it can measure
the press, focus, viewport, and layout frames on the same element.

| Evidence                                      |                Before |        After |
| --------------------------------------------- | --------------------: | -----------: |
| Device/theme contexts                         |                     4 |            4 |
| Presses                                       |                    16 |           16 |
| Strict failures                               | baseline capture only |            0 |
| Immediate active response                     |                  4/16 |        16/16 |
| Transparent tap highlight                     |                  0/16 |        16/16 |
| `touch-action: manipulation`                  |                  0/16 |        16/16 |
| Non-selectable control chrome                 |                  0/16 |        16/16 |
| Active-frame layout shifts                    |                  0/16 |         0/16 |
| Maximum horizontal shift                      |                  0 px |         0 px |
| Scroll stable through press, focus, release   |                 16/16 |        16/16 |
| Root/body/shell overscroll contract           |          0/4 contexts | 4/4 contexts |
| Selectable prose and unrestricted zoom checks |          4/4 contexts | 4/4 contexts |

For every after press at both 390×844 and 360×800, in both themes, the exact scroll sequence was
`before=0, active=0, focused=0, after=0`; horizontal shift was exactly `0 px`; and the active-frame
layout box was unchanged. The computed tap highlight was `rgba(0, 0, 0, 0)`, touch action was
`manipulation`, and control `user-select` was `none`.

The raw before file records 76 findings. Four are an older probe classification of the Classic card
growing its selected-content row after pointer-up; the current probe correctly isolates
pointer-down focus/active geometry from intentional post-click application state. The underlying
raw frames are retained rather than rewritten. The remaining baseline findings are the missing
tap, touch-action, chrome-selection, active-feedback, and overscroll contracts summarized above.

Raw evidence:

- `docs/reports/native-app-feel-r3/before/native-app-feel-before.json`
- `docs/reports/native-app-feel-r3/after/native-app-feel-after.json`

## Manual visual checks

I inspected all four after screenshots at 390×844 and 360×800 in light and dark themes. The header,
spin card, hero copy, PLAY DAILY CTA, and secondary CTA row preserve their baseline geometry; no
horizontal clipping or unexpected visual reflow is visible. The screenshots are committed beside
the raw JSON in the `before/screenshots` and `after/screenshots` folders. Each before/after pair is
byte-identical by SHA-256, which is expected because R3 changes only transient press/scroll behavior
and preserves resting layout and paint.

This cannot visually capture the sub-second pressed frame or iOS rubber-band physics. The JSON
records the automated press frame. Physical Mobile Safari must be checked on the deployed URL after
merge: press PLAY DAILY, START DRAFTING, the menu toggle, and mobile-nav Play; confirm no grey flash,
page bounce, focus jump, selection callout, or horizontal movement; then pinch-zoom prose to confirm
zoom remains available.

## Validation

- Frozen install: 274 packages reused; lockfile unchanged.
- R3 Playwright interaction probe: 4 contexts, 16 presses, 0 failures.
- Web typecheck and lint: passed.
- Web Vitest: 1,168 passed, 1 skipped across 112 files.
- Web game-flow Playwright: passed.
- Responsive shell fit: 218 metrics, 0 failures (84 desktop, 56 mobile, 40 interaction, 30
  mode/setup, 8 mobile-nav). This completed once in the narrow web gate and again in the root gate.
- Web production build: passed, 40 static pages generated.
- Root typecheck: 9/9 tasks passed. Root lint: 6/6 tasks passed.
- Root tests: 1,976 passed and 10 skipped across db (161), core (391), data (182 passed/9 skipped),
  marketing-x (68), mobile (6), and web (1,168 passed/1 skipped); Turbo completed 9/9 tasks.
- Root build: 5/5 tasks passed.
- `git diff --check`: passed.

The production build emitted the repository's existing webpack circular-chunk warnings, edge-page
static-generation notice, and Turbo no-output warning for `@wcdraft/mobile#build`; none failed a gate.

## Gate 0 note

Initial web tests reported 933 passing tests and 20 import failures because the gitignored local
`packages/data/src/generated/draft-pool.compact.json` was absent. Root typecheck had replayed a
shared Turbo cache entry and therefore did not materialize that ignored file in this worktree. The
repository-owned `node packages/data/scripts/ensure-generated-artifacts.mjs` command regenerated
and fingerprint-validated it. No generated data path is tracked, changed, or staged by R3.

## Risks and rollback

- `overscroll-behavior` support and native rubber-band behavior must still be verified on real
  Mobile Safari after deployment; Chromium emulation is not a substitute.
- The active response applies to all app controls. It is compositor-only and reversible by removing
  the R3 global selector block.
- The mobile menu/account popover become their own bounded momentum scroll regions only when their
  content exceeds available `100svh` space. Rollback is isolated to their four overflow properties.

## Deferred by boundary

All Season 2 engine/data/token/game-surface work; workflow/STATE changes; leaderboard validation and
fixture work; OG-card art; the responsive-harness contract; player-facing draft/review/results/share
and team-sheet components; and all `packages/core/**`, `packages/data/**`, and `packages/db/**` files.
