# Terrace light Programme — lane report

- Date: 2026-07-17 (America/New_York)
- Tier: YELLOW
- Base: `1b2281e9c9f64bc13effacb2d2a071d518addfb7`
- Branch: `ws-ux/terrace-light-programme`
- PR: #309
- Status: implementation complete; full U2 validation, exact-head reviews, merge, deploy, and
  production live verification remain before this lane is shipped.

## Summary

Programme gives the existing Terrace identity a deliberate light treatment: paper `#f1ecdf`,
card `#faf7ee`, border `#ddd6c4`, primary ink `#16180f`, secondary ink `#5c5c4e`, green text
`#0f5f3f`, and gold text `#7a5a12`. Structural green/gold stay identical to dark at
`#3f9268`/`#d4a94e`. The implementation changes palette roles only; it changes no geometry,
layout, copy, type, OG code, or runtime data.

## U0 — what light was before Programme

The complete pre-change inventory is `/tmp/u0-light-findings.md` (SHA-256
`48dc41417b6365a7392e4565d71e983917d9a922023f0f8c337e927a8cfffcc8`). The primary
application has two central token surfaces because `app/ds/tokens.css` loads before
`app/globals.css`: 62 explicit DS light overrides plus 70 default/light global properties.
The standalone `global-error.tsx` document owns six more light colour overrides plus a shared
font token. The operative pre-Programme ramps were:

- surface: `#e7e1d2` outer → `#f1ecdf` paper → `#fbf8f0` card → `#ffffff` raised;
- line: one `rgb(24, 36, 28)` family at 0.10/0.16/0.28 alpha;
- ink: `#16211a` → `#2f3a33` → `#46524b` → `#566158` → `#9aa399`;
- green text: flat `#067044`, with separate but still pre-Terrace neon fills
  `#2ecf92`/`#25b07c`;
- gold text: flat `#765100`, with pre-Terrace neon fill `#f5b62a`.

The reported Terrace contradiction is resolved exactly: two existing shared values changed
(`--font-family` Space Grotesk→Archivo and `--font-weight-bold` 700→800), while eight role
variables were added (`--font-weight-display`, `--font-weight-heading`,
`--font-weight-button`, and the five tracking roles). Removing those ten typography entries
left all 122 non-typography light values byte-identical. “Ten values moved” was loose wording
for two mutations plus eight additions.

The main application resolves light/dark from stored preference or `prefers-color-scheme` in the
inline bootstrap and `ThemeProvider`, then materializes `data-theme` on `<html>`. The standalone
global-error document instead switches its inline palette directly with CSS
`@media (prefers-color-scheme: light)`, and `layout.tsx` selects browser-chrome theme colours with
media metadata. Cross-theme central stops are the three DS brand-gradient colours, two
theme-resolving ring aliases, the full typography/type-scale/radius/spacing/motion system, and the
three global container widths. Shared typography—not a palette stop—caused the Terrace light
drift.

The first fresh-context U0 review correctly failed the incomplete central-only inventory. After
the standalone error palette and both media-selected surfaces were added, a new isolated review
at the same exact base passed. Persisted verdict:
`/tmp/wcdraft-terrace-light-u0-review.txt` (SHA-256
`a30273e8308f6125e5b10e310c2baef0b763f8bb4ddb3dfcb239953110d913d5`).

OG is not theme-aware. `run-og-palette.ts` binds the sole renderer palette to
`RUN_SURFACE_PALETTE.dark`; there is no theme input or light render.

## U1 — target to shipped values and measured evidence

All ratios were computed from the shipped candidate bytes with the repository's sRGB/WCAG
helpers. None of the requested paper text targets needed luminance adjustment.

| Role / stop | Target | Shipped | Page `#f1ecdf` | Card `#faf7ee` | Raised `#fefef5` |
| --- | --- | --- | ---: | ---: | ---: |
| page / paper | `#f1ecdf` | `#f1ecdf` | structural | structural | structural |
| card | `#faf7ee` | `#faf7ee` | structural | structural | structural |
| raised (derived) | relative ramp | `#fefef5` | structural | structural | structural |
| sunken / well (derived) | relative ramp | `#e8e2d1` | structural | structural | structural |
| hairline | `#ddd6c4` | `#ddd6c4` | structural | structural | structural |
| ink 100 | `#16180f` | `#16180f` | 15.1954 | 16.7315 | 17.6752 |
| ink 200 (derived) | relative ramp | `#333529` | 10.5848 | 11.6549 | 12.3122 |
| ink 300 / `tx2` (derived) | relative ramp | `#4c4d40` | 7.2881 | 8.0248 | 8.4774 |
| ink 400 / secondary | `#5c5c4e` | `#5c5c4e` | 5.7507 | 6.3321 | 6.6892 |
| green text | `#0f5f3f` | `#0f5f3f` | 6.5240 | 7.1836 | 7.5887 |
| gold text | `#7a5a12` | `#7a5a12` | 5.3972 | 5.9428 | 6.2780 |

The disabled ink stop derives to `#a09e8c`; it retains the old ramp position and remains a
non-body disabled/faint stop. The old/new ink normalized luminance positions differ by at most
0.0029. The paper/card/raised relative position differs by less than 0.0011.

| Structural pair | Shipped | Ratio | Adjudication |
| --- | --- | ---: | --- |
| actual dark on-green ink / green fill | `#05130c` / `#3f9268` | 4.9984 | preserved exactly |
| on-gold ink / gold fill | `#1a1305` / `#d4a94e` | 8.4130 | preserved exactly |
| rejected hand-provided bone / green fill | `#ebe6da` / `#3f9268` | 3.0534 | not AA body text and not the current dark stop |

Existing `--accent`/`--gold`/`--ember` aliases had mixed structural and text use. Programme maps
the existing base/solid aliases to the dark structural fills and the existing
`--accent-text`, `--gold-bright`, bright/deep aliases to the AA text ramps. Component text rules
that previously consumed base gold now use the existing `--gold-bright` role. In dark,
`--gold` and `--gold-bright` are both `#d4a94e`, so this role correction is computed-value
neutral there.

The five required provenance hues remain historical `#0d687f`, projected `#4655b8`, estimate
`#93450c`, and manager `#566472`; unknown grey receives the smallest successful correction,
`#566158`→`#566156`. The old manager/unknown ΔE76 was 14.1257; changing either unknown-blue
channel by one step was insufficient, while two steps produce 15.3425. Unknown remains 5.4951
on paper and 6.0506 on card. Every other provenance hue is byte-stable and all five remain at
least 5.1433:1 on paper and 5.6633:1 on card.

## Architect-delegated decisions

1. **Preserve the actual dark on-green ink.** The dispatch labeled `#ebe6da` “unchanged from
   dark,” but repository evidence proves dark uses `#05130c`. Bone on green is only 3.0534:1;
   the actual dark pair is 4.9984:1. Preserving `#05130c` is the least-changing interpretation
   that satisfies both “unchanged from dark” and AA.
2. **Map mixed legacy aliases by semantic role.** The architecture has the requested solid/text
   names, but several legacy base names still serve both. Base accent/gold and `ember` remain
   structural; existing bright/text/deep names carry small text. This avoids a new namespace,
   leaves dark computed values unchanged, and prevents structural solids being promoted to text.
3. **Adjust only the collapsed provenance pair.** The existing light manager/unknown pair missed
   the inventory's ΔE76 15 floor. The two-blue-step unknown correction is mechanically minimal;
   no other provenance hue changes.
4. **Make the fixture-driven responsive audit service-worker deterministic.** The first forced
   root run reached the strict collision matrix but failed three WebKit leaderboard cells because
   a newly activated production service worker bypassed Playwright's API fixture route and exposed
   the intentionally DB-unconfigured local endpoint's honest 503. This was a verifier transport
   race, not a collision or product response regression. `makeContext` now blocks service workers
   only in this fixture-driven responsive harness, with a source contract. Product service-worker
   code and behavior are unchanged. The previously failing WebKit group-3 slice then passed 36/36
   before the full envelope was restarted from typecheck.

## Validation run

- Focused Programme contrast contract: 14/14 passed.
- Adjacent typography, palette, protected-medallion contracts: 27/27 passed.
- Provenance inventory: 4/4 passed after materializing the package's generated runtime bundle.
- Web lint: passed, zero warnings.
- Web typecheck: passed after building dependency packages.
- `git diff --check`: passed.
- Tracked data diff: empty after an actual `@wcdraft/data` artifact-ensuring build.
- Pinned data hashes after materialization: ratings
  `896301819a2988e4e93b3038b35ffa44bcef4182b4a55ac82c7569241801cee0`; draft pool
  `ae5376c917377b00ac9dee7a166dcaceb28dd1416fc9fbe8b00b1116ca8e8d07`.
- Strict font/accessibility browser audit: 60 surfaces and 44 interaction targets; zero
  failures, axe violations, horizontal overflow, sub-44px targets, non-Archivo families, or
  uppercase role violations. Raw receipt: `/tmp/wcdraft-programme-font-a11y.json` (SHA-256
  `7451a388f913c236995f1c93cb8dfe474b2bd1194223e5cb3ecd4f28dc33738d`).
- New light capture set: 24/24 images across four surfaces, three widths, and Chromium/WebKit;
  zero axe violations, console errors, horizontal overflow, or small targets. The committed
  receipts, image hashes, named WebKit CSP mechanism, and visual-inspection record are in
  `docs/reports/terrace-light-programme-2026-07-17/light-mode/manifest.md`.
- Forced root envelope after the verifier fix: typecheck 9/9; lint 6/6; test tasks 9/9 with
  2,213 passed and 10 expected skips; responsive shell 218/218; narrow collisions 264/264;
  one-screen 216/216 (192 strict-fit and 24 scroll-permitted); build 5/5, 40/40 pages, and both
  protected runtime traces at 8/8.
- Forced, exact-worktree goldens without re-lock: core 69/69, draft 42/42, data 59/59,
  integration 22/22, leaderboard 6/6. `TURBO_FORCE=1` was used after an initial invocation
  exposed shared-cache log replay from an older guard worktree; only the forced results count.
- Native-app-feel production harness: Chromium 180/180 and WebKit 180/180. Raw receipts:
  `/tmp/wcdraft-programme-native-chromium/native-app-feel-programme-light-chromium.json`
  (`84ecca837f30f742c7900727082469219e0a83f7a6fcefc9f651f931ca4d47d5`) and
  `/tmp/wcdraft-programme-native-webkit/native-app-feel-programme-light-webkit.json`
  (`70332b9d9929ac80d162313a2e6b496974ed369dbc09617deed774447dcc39bb`).
- One-screen raw receipt: `/tmp/wcdraft-one-screen-Wx55qi/one-screen-fit.json` (SHA-256
  `1267111f431c49613b4fbecb410926df6f2d89cb08b3617f4c27d1bc516d4b3e`).

## U2 mutation proof

The clean control command passed all six controls in Chromium and WebKit before and after the
mutations. Each valid mutation was applied alone, run in both engines against the same optimized
production server, observed red on its intended control, and exactly restored before the next.

| Deliberate mutation | Chromium | WebKit | Intended red |
| --- | ---: | ---: | --- |
| disable Class-B candidate enumeration | `class-b-fires 0` | `class-b-fires 0` | positive control absent |
| treat every pointer-transparent candidate as painted | `class-b-transparent-clear 2` | `class-b-transparent-clear 2` | transparent negative fires |
| suppress fixed-over-fixed Class A | `class-a-fires 0` | `class-a-fires 0` | positive control absent |
| force the separated Class-A fixture to overlap | `class-a-separated-clear 2` | `class-a-separated-clear 2` | separated negative fires |
| broaden same-control allowlist beyond hairline contact | `same-interactive-blocker 0` | `same-interactive-blocker 0` | blocker incorrectly allowed |
| broaden scrolling-shell allowlist to pinned targets | `scrolling-shell-pinned-blocker 0` | `scrolling-shell-pinned-blocker 0` | pinned blocker incorrectly allowed |

Two intermediate mutation designs were explicitly rejected rather than counted: changing only
the literal `transparent` parser branch stayed green because browsers expose computed transparent
paint as alpha-zero rgba, and an imprecise restoration patch caused an unrelated reference error.
The final table contains only control-specific reds reproduced in both engines.

## Remaining release gates

Exact-head U1/U2 independent reviews, the required cross-model U2 verdict, merge/deploy
observation, and production live verification remain. This report must be closed with their exact
SHAs and outcomes before PR #309 merges.

## Risks

- Palette changes can expose collisions or paint/contrast problems that source tests cannot see;
  the full local two-engine matrix is green, but production remains the final authority.
- Structural green/gold remain exempt as chrome, but every actual text role is separately AA
  asserted. Review should reject any future component use that bypasses the text aliases.
- The responsive harness now blocks service workers so fixture APIs cannot be bypassed. Product
  service-worker behavior retains its separate unit/integration coverage; this verifier no longer
  exercises registration timing while measuring deterministic layout fixtures.
