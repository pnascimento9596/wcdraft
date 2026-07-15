# Terrace dark identity — final lane report

- **Date:** 2026-07-15 (America/New_York)
- **Tier:** RED
- **Branch:** `ws-ux/terrace-identity-20260714`
- **Base:** `dddf3ce50b589e409ce38197fc22bb4d2af2a42d`
- **Reviewed code head:** `987f1b898f1e104ec0599c2fc18a967751a9c3ef`
- **Status at report authoring:** implementation and local RED gates PASS; PR, CI, merge,
  deploy, and production live verification remain mandatory before the lane is called shipped.

## Summary

The web product now uses Archivo as its single active shipped family, replaces the neon dark
system with the warm Terrace palette, and fits `/` plus `/play` into real browser viewports
without document overflow. The fit gate now measures the full document across nine
descriptor-derived viewports, Chromium and WebKit, light and dark themes, and both motion
preferences. Dynamic and default OG images render with explicit Archivo bytes; the signed OG
envelope/cache namespace moved coherently from `ogs1`/payload v1 to `ogs2`/payload v2.

This lane is presentation-only. Ratings, simulation, sampling, Synergy, schema, auth,
leaderboard behavior, tokens, ETL, compact runtime bundles, and mobile application code are
unchanged. No data artifact was regenerated. The core, data, and ETL Git trees are byte-equal
to the base, and all required goldens pass without cache.

## Files

The cumulative code diff before this report is 98 files, 4,492 insertions, and 1,178
deletions, all under `apps/web`:

- `apps/web/app`: Archivo faces, Terrace token mappings, standalone error/auth presentation,
  shared manifest colors, and landing/play compaction.
- `apps/web/components`: type-role enforcement, compact home/mode-select layouts, and token-only
  palette use across game, leaderboard, history, results, review, and share surfaces.
- `apps/web/lib`: typography, contrast, compaction, device-matrix, OG, and regression guards;
  OG signing/metadata/palette/render changes.
- `apps/web/public`: licensed Archivo web/OG font assets, re-rendered default OG, and updated
  presentation SVGs. Protected medallion geometry, marketing banner/square, favicons, PWA
  icons, and iOS icons remain pinned.
- `apps/web/scripts`: reproducible OG-tabular font generation, deterministic default-OG
  rendering, descriptor matrix, and semantic one-screen browser evidence.
- `apps/web/package.json`: normal web test envelope registration for the descriptor gate.
- `STATE.md` and this report: measured repository truth and durable adjudication evidence.

No path under `packages/core`, `packages/data`, `packages/db`, `etl`, or `apps/mobile` is in
the feature diff.

## U0 numeral verdict and shipped family

**PASS — Archivo shipped; the Inter fallback was not activated.** The actual candidate is
`@fontsource/archivo@5.2.8` under OFL-1.1. Mechanical fontTools 4.63.0 inspection found a real
`tnum` GSUB feature mapping `zero` through `nine` to the existing `.tf` glyphs. Independent
advance-width measurement showed proportional default digits at lower weights but uniform
advances after the GSUB mapping: 568, 573, 579, 598, 627, and 667 font units at weights
400/500/600/700/800/900 respectively.

Because Satori does not apply that GSUB feature, four deterministic OG-only WOFF derivatives
remap only U+0030–U+0039 to the existing tabular glyphs. An actual ImageResponse probe rendered
six repeated digits at four weights: every derived face had one uniform pixel width, while the
proportional upstream 400/500/800 faces did not. Source and derivative SHA-256 values are
pinned in tests and the generator reproduces the committed bytes. Browser/data surfaces keep
explicit `font-variant-numeric: tabular-nums`; it is not a no-op for Archivo.

The active shipped source scan found zero Space Grotesk load, fallback-stack, CSS, TS/TSX, OG,
or standalone-export dependencies. The only remaining strings describe already-outlined paths
inside the explicitly frozen medallion and out-of-scope mobile/historical files; they do not
load or resolve a font.

## Terrace palette and AA evidence

All ratios below were re-derived from the shipped bytes. The owner target is shown separately
from the shipped stop so minimal adjustments remain visible.

| Role                   | Target              | Shipped   | Measured contrast / adjudication                                               |
| ---------------------- | ------------------- | --------- | ------------------------------------------------------------------------------ |
| Page                   | `#0f100e`           | `#0f100e` | Structural canvas; not a text stop                                             |
| Card                   | `#1a1d19`           | `#1a1d19` | Structural surface; not a text stop                                            |
| Border                 | `#2b2f29`           | `#2b2f29` | Structural hairline; not a text stop                                           |
| Primary bone ink       | `#ebe6da`           | `#ebe6da` | 15.3198 / 13.6690 / 12.4901 on page/card/raised                                |
| Secondary low ink      | `#8a8a7e`           | `#8a8b7f` | Minimal lift; 5.5236 / 4.9284 / **4.5033** on page/card/raised                 |
| Green structure/action | `#3f9268`           | `#3f9268` | 5.0172 page, 4.4766 card; remains structural where below AA                    |
| Green text             | derived from target | `#3fa268` | Minimal text-safe lift; 5.9771 / 5.3330 / 4.8731; 4.5092 on actual tinted card |
| Pressed green action   | `#37805b`           | `#408964` | Uniform sRGB +9; `#3f8863` (+8) is 4.4467, shipped is 4.5074 on `#05130c`      |
| Vintage gold           | `#d4a94e`           | `#d4a94e` | 8.7072 / 7.7690 / 7.0989 on page/card/raised                                   |
| On-green ink           | `#05130c`           | `#05130c` | 4.9984 on structural green                                                     |
| On-gold ink            | `#1a1305`           | `#1a1305` | 8.4130 on gold                                                                 |

The rejected predecessor `#3fa168` measured 4.4611 on the actual 14% green-tinted card,
proving that the one-channel lift to `#3fa268` is necessary and minimal. Derived intermediate
AA text stops also clear their actual surfaces: bone ink 200 has a worst ratio of 8.6032,
bone ink 300 has 5.2041, deep gold has 5.2737, and bright gold has 9.0186 on the raised
surface. The first final rereview exposed that the original pressed fill `#37805b` produced
only 3.9833 against action ink on `.btn--primary:active` and standalone auth hover. The
smallest uniform channel lift that clears AA is +9: `#408964` produces 4.5074, while +8
remains 4.4467. The executable inventory now covers the token plus both actual text-bearing
state surfaces with zero known failures.

Provenance remains hue-based and position remains shape-based. Page/card ratios are historical
8.9384/7.9752, projected 7.8484/7.0027, estimate 8.0189/7.1549, manager
7.3219/6.5329, and unknown 5.0498/4.5057. All 10 pairwise CIE76 comparisons clear 15;
the minimum is manager versus unknown at 17.4938. The base light-theme inventory contains
124 values at SHA-256 `c4f8621e8c68e7b6e0594f15a4605f3e6f8da118781bd14e42400c39c6b0b7e7`;
head contains 132 at `f9c7800e2132efcfc67dea22a6d6aaaf9d1648ba60d92fda2b296386b0649aad`.
The exact shared typography consequence is two changed values plus eight added role values.
Removing those 10 leaves all 122 non-typography values byte-identical between base and head at
`ce8624f9c559a92f30ea2ecc20b098170e412a8bd48238e31971960a392c59ef`; the guard locks both
the preserved inventory and the exact typography exception.
The protected static-share medallion block is byte-equal at SHA-256
`7f4de85f6ace928938bd53bbf0bcdeb496b1c20dfebe1ca14951d0d0472600b6`.

## Fit defect and resolved viewports

U0 proved that dispatch premise §3.6 was incomplete: **(a) and (c) were true; (b) was false**.
The dedicated home harness already measured full document height, so its scope was not
hero-only. However, it asserted handwritten device/screenshot heights rather than real browser
viewports, and the general 218-case suite did not adjudicate full-document fit for mode select.
Both defects were closed.

Playwright 1.61.1 resolved the assertion matrix to:

| Intent              | Descriptor/source                            | Viewport |
| ------------------- | -------------------------------------------- | -------: |
| 320 mobile          | `iPhone SE`                                  |  320×568 |
| 360 mobile          | `Pixel 9`                                    |  360×732 |
| 390 mobile          | `iPhone 13`                                  |  390×664 |
| 430 mobile          | `iPhone 14 Pro Max`                          |  430×740 |
| short landscape     | `iPhone SE (3rd gen) landscape`              |  667×375 |
| tablet portrait     | `iPad Mini`                                  | 768×1024 |
| tablet landscape    | `iPad Mini landscape`                        | 1024×768 |
| desktop             | engine-native Desktop Chrome/Safari          | 1280×720 |
| 1366 desktop intent | same desktop descriptor, width-only override | 1366×720 |

Legacy 360×800 and 390×844 pairs remain separately labeled visual evidence and never prove
fit. The strict gate checks `document.documentElement.scrollHeight <= window.innerHeight`,
body height, horizontal overflow, required semantic paint, route content, 44px targets, zoom
metadata, theme/motion state, collisions, row constraints, and page errors. It passes 144/144
contexts: 2 engines × 9 viewports × 2 themes × 2 motion modes × 2 routes. Dark evidence
contains 72/72 normalized PNGs and 696 semantic target contributions; the minimum contribution
is 0.04414374718834542 against the 0.002 floor. A counterfactual opacity mutation leaves the
DOM geometry intact but correctly fails wordmark/stat-strip paint at 0.000000 contribution.

Mode select deletes all five redundant descriptor boxes and the decorative `00`–`04` ghost
numerals; the now-vacuous numeral/pill guard is deleted. Daily progress and the featured card
are each one row. The hero retains its spin demo, three stats, three CTAs, and Daily CTA; its
lede is at most two lines at the narrowest viewport.

## OG cache and served-byte proof

- Signed envelope/payload: `ogs1` / v1 → **`ogs2` / v2**.
- Public cache key: `ogs1.<token-hash-prefix>` → **`ogs2.<token-hash-prefix>`**.
- Private signer cache namespace is also versioned at v2. The signing secret and boot
  assertion are unchanged.
- Authentic old `ogs1` envelopes and v1 payloads under the new prefix are rejected and return
  the default 307 fallback. Historical run-model/version snapshots remain renderable inside a
  correctly signed v2 envelope.
- A fixed model rendered twice at the base with Space Grotesk to SHA-256
  `d1cfa9ea251df19718ce01cedd1588ae33ad6ebb3e9342201c515f84fec0acc6`, then twice at
  the reviewed head with Archivo to
  `ae513856505060cc7b7f7311048653f80d8b2ef13f46601c52d6f3e58f52555e`. This is
  deterministic proof that served card bytes changed.
- The explicit edge font set is 150,032 bytes, below the 500 KB ImageResponse ceiling.
- `og-default.png` changed deterministically from
  `5be6ea958af1ac2ad3b7726764bfe31dfe802e142a0defc751b8ba67985e266a` to
  `5f1af97f956ba67d52de6a9cb25231a234e4399cccaa4830db6165a3080cdb01` (1200×630,
  135,585 bytes). A font-adversary test proves its generator uses the supplied Archivo 800
  bytes: 800 is deterministic, substituting 400 changes output, and invalid bytes fail.
- Banner `809a8dfe09b8396fc65083fee5981a128e6407cfd66513988d1f0df678936331` and square
  `17b4d9f12d3d7dbe4ad275cd2c0a6d109ea8386b3f9117100e5c4352dfb44282` remain pinned.
- 415-before-body, 4,000ms client bound, 12,624-byte pre-decode ceiling, malformed/foreign/
  unsigned fallback, share/signing decoupling, durable rate limiting, cache-hit behavior,
  `fc1` friend signing, and secret/boot behavior all remain covered and green.

## Architect-delegated decisions

1. **Active shipped font dependencies, not inert provenance strings.** “Remove Space Grotesk
   entirely” is applied to every active shipped web load/resolution seam. The explicit mobile
   and medallion exclusions control inert mobile text and the frozen medallion's comment/path
   provenance. Redrawing the mark or editing mobile would violate narrower non-negotiable scope.
2. **Fix both verified fit defects.** Although §3.6 initially says exactly one cause is true,
   repository evidence proves both fictional device-height assertions and an absent mode-select
   document gate. Correcting both is the least change that satisfies the outcome; (b) remains
   honestly false.
3. **1366 is a disclosed descriptor-derived override.** Playwright has no built-in 1366-wide
   desktop descriptor. The matrix changes only width 1280→1366 while retaining each engine's
   native 720px desktop height and other descriptor properties, rather than inventing a device.
4. **Route-bounded footer suppression.** Keeping the multi-link/information footer in flow is
   incompatible with exact 320×568 and 667×375 full-document fit while preserving required
   content and 44px targets. It is hidden only on `/` and `/play`; attribution and other routes
   retain it. Broad suppression, overlay, content shrinkage, or smaller targets would change
   more behavior.
5. **Delete redundant hero facts instead of responsive rewrites.** `hero__daily` and
   `hero__live` are removed at all widths under “redundancy first” and “cut, do not rewrite.”
   Their facts remain on `/play` and/or How to Play; restoring them would break the zero-slack
   320×568 contract or create responsive-only copy variants.
6. **Shared light-theme typography roles.** The single global light/default block owns the type
   variables used by both themes, so the required all-surface Archivo system cannot leave its
   complete custom-property inventory byte-identical. The minimal light consequence changes
   only `--font-family` and `--font-weight-bold`, adds the eight locked weight/tracking role
   variables required by Terrace, and preserves the other 122 base values byte-for-byte. This
   is the dispatch's allowed shared-architecture exception; redesigning or duplicating the
   light theme would change more behavior.
7. **Shared PWA theme color.** The manifest exposes one unqualified install `theme_color`.
   Mapping that shared structural field to Terrace green is the minimal install-surface
   consequence; it does not mutate any light color or palette token.

## Validation run

All lane-boundary commands below ran at reviewed code head `987f1b8` with no Turbo cache unless
noted:

- `TURBO_FORCE=1 pnpm typecheck` — **9/9 tasks**, 0 cached.
- `TURBO_FORCE=1 pnpm lint` — **6/6 tasks**, 0 cached, zero warnings.
- `TURBO_FORCE=1 pnpm test` — **9/9 tasks**, 0 cached, one uninterrupted 18m56s run:
  - core 423; DB 161; data 183 + 9 expected skips; marketing 69; mobile 7; web 1,350 +
    1 expected skip = **2,193 passed / 10 expected skips**;
  - game-flow Playwright PASS;
  - responsive shell **218/218**: desktop 84, mobile 56, interactions 40, mode setup 30,
    mobile nav 8;
  - one-screen **144/144**, failures 0.
- The 33-test increase over the measured 2,160-pass baseline is attributable to this lane's
  typography, contrast, device-matrix, semantic-paint, compaction, and OG regression guards.
- `TURBO_FORCE=1 pnpm build` — **5/5 tasks**, 0 cached, **40/40 pages**; protected traces
  `/api/og/sign` 8/8 and `/api/challenge/verify` 8/8.
- Forced core goldens — **69/69** core + **42/42** draft, 0 cached.
- Forced data goldens — **59/59** data + **22/22** integration, 0 cached.
- Forced leaderboard golden — **6/6**, 0 cached.
- Protected tree objects are identical at base/head: core
  `344ced76f8d6fd1b9c959f4d3acd0308ac7acba7`, data
  `a9ca53a187d218e92e4da633acee788936e4bb45`, ETL
  `f0c64a99c8124ddc813e20fde58f91f2b68b4b4f`.
- Protected ignored artifacts remain exact: `etl/output/ratings.json`
  `896301819a2988e4e93b3038b35ffa44bcef4182b4a55ac82c7569241801cee0`; compact draft
  pool `ae5376c917377b00ac9dee7a166dcaceb28dd1416fc9fbe8b00b1116ca8e8d07`.

Build emits the pre-existing circular-chunk warnings and standard edge/static-generation
warning, but exits 0. Turbo also warns that the mobile preparation task has no declared output;
that task exits 0 and this lane does not touch mobile.

## Independent reviews

Every unit received a fresh-context, exact-SHA review with re-executed evidence and fix-forward
until PASS:

| Unit | Exact PASS head                            | Preserved report            | SHA-256                                                            |
| ---- | ------------------------------------------ | --------------------------- | ------------------------------------------------------------------ |
| U0   | base inspection                            | `/tmp/u0-rereview.md`       | `0caf3b374e139ff0240b619f3c9d0abe08787eab786815840b380e028c5bf9e9` |
| U1   | `b49bf923c0691190c000e661c68f8b442e02d065` | `/tmp/u1-b49bf92-review.md` | `5d0534c3acbdc5de7a20152a51b9ad26e2bcb5a4ceb7a5441104dfeb155fb4fa` |
| U2   | `bf7e3f8c48ab3ac7422d05024b190f253a48c0d0` | `/tmp/u2-bf7e3f8-review.md` | `a17bd46b3be283652ee527f1a76f162ef7458a90d1c531535efecde6a3bbd4b3` |
| U3   | `e8596989e26ca7ad4ad1b31a07b0dba97796683c` | `/tmp/u3-e859698-review.md` | `82f31885910d804273dcefdcf5434f45541bc5eb23b61d15d96db569b4564f76` |
| U4   | `b4e10a50f23400409d15d19333e35cdc18c4554a` | `/tmp/u4-b4e10a5-review.md` | `fdf5d81a9273c5dd81e21f456113558dbee88f47346420c6df60248c26fab5f3` |
| U5   | `987f1b898f1e104ec0599c2fc18a967751a9c3ef` | `/tmp/u5-987f1b8-review.md` | `ea1035d6c084e07266bc0b90254c3dad23f45c72d7790645c8a92659c96da731` |

The required lane-boundary cross-model reviewer was the primary model,
`ollama-cloud/glm-5.2` with max thinking. It independently inspected the cumulative diff and
re-executed web tests, forced goldens, typecheck/lint, build, font/asset checks, and the full
144-case one-screen gate. Its verdict is persisted verbatim in
[`terrace-dark-identity-cross-model-2026-07-15.md`](./terrace-dark-identity-cross-model-2026-07-15.md):

```text
PASS
Model: ollama-cloud/glm-5.2
Head: 987f1b898f1e104ec0599c2fc18a967751a9c3ef
Base: dddf3ce50b589e409ce38197fc22bb4d2af2a42d
```

## Not run + why

- ETL, `build:compact`, Daily salt-map generation, score-distribution generation, and heavy
  realism were not run. The dispatch forbids data regeneration, and this lane changes no
  engine, rating, simulation, data, or CI semantics. Ordinary tests and golden verifiers read
  and compare the already-materialized byte-pinned artifacts.
- GitHub CI, PR merge, Vercel deployment observation, and production live verification were
  not yet possible at report authoring because this report and `STATE.md` must first be part of
  the exact branch head. They are mandatory ship gates, not waived work.
- Physical iPhone Safari was not used. The dispatch requires repository Playwright WebKit plus
  production live verification, both of which are the machine-adjudicated gates.

## Risks

- 320×568 has zero document-height slack. The registered descriptor gate is intentionally
  expensive and must remain in the normal web envelope to catch future metric/copy drift.
- Footer attribution is absent only on the two one-screen acquisition routes. The attribution
  route and footer elsewhere remain; broadening this policy requires a separate decision.
- Old `ogs1` links now deliberately fall back to the newly rendered default card. That is the
  required coherent cache cutover, not backward dynamic-render support.
- Next's existing circular chunk warnings remain. No changed file touches the simulation
  worker/import graph.

## Commit / branch

- Branch: `ws-ux/terrace-identity-20260714`
- Base: `dddf3ce50b589e409ce38197fc22bb4d2af2a42d`
- Reviewed implementation head: `987f1b898f1e104ec0599c2fc18a967751a9c3ef`
- Unit commits are conventional, scoped to web presentation/tests, and listed in Git history.
- The documentation closeout commit necessarily advances the branch after the code-head
  reviews; a fresh exact-head RED review is required before merge.
- The first final exact-head review correctly returned **FAIL** at
  `dbebf3df8c34f70476080354ab90c2edd39d9518`: its immutable report
  `/tmp/terrace-final-review-dbebf3d.md` has SHA-256
  `32018d81dd883707e6c7ae82dd519e672903be965ea4b531278489834bfae323`. Runtime and all
  re-executed gates were green, but the report/test falsely described the new 132-entry light
  inventory as identical to the 124-entry base and omitted the shared-typography delegated
  decision. This fix-forward locks the 122 unchanged values plus the exact 10 intended
  typography consequences and corrects every claim. Its new commit voids the failed head and
  requires a new exact-head independent review.
- The replacement exact-head rereview correctly returned **FAIL** at
  `5dd7edc4446b60ce2bb60a9d9e102d3dcf053bb6`: immutable report
  `/tmp/terrace-final-rereview-5dd7edc.md`, SHA-256
  `ea3c71c646e64035b9af2a7363ea6f9771192b9bf0c7f111bdb53f65a8a36e10`. It independently
  confirmed the light proof was repaired, then found the pressed/hover action pairing omitted
  by the 87-pair guard. This second fix-forward minimally lifts the pressed fill, covers both
  real usages, and again requires a new exact-head review.

## Git status

The implementation worktree was clean at `987f1b8` before adding this report and `STATE.md`.
Only those explicit documentation paths are intended for the closeout commit. The owner
checkout was not modified.

## HUMAN ACTIONS

None. There is no human approval gate in this lane. The agent must continue through final
exact-head review, CI, SHA-pinned squash merge, Vercel READY, production live verification,
auto-revert on any live failure, and repository hygiene.
