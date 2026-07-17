# Terrace polish — final implementation and validation report

## Outcome

Terrace polish is implementation-complete and validated on code head
`d20e12cac326f29b046b063664d61d08dd5917dd`, based on the collision-safe production main
`cc226371538b0717d538f86824643efd95af4d3c`. The exact code head received an independent
cross-model **PASS**. This report and its cross-model receipt are the only post-review additions.

The lane remains Yellow: the application change is bounded presentation, accessibility, and
browser-verification work. It does not alter schema, rating, draft, simulation, authentication,
leaderboard semantics, runtime data, or deployment configuration.

## What changed

### Home (`/`)

- Kept the legal disclosure component and its exact attribution and independence text.
- Made the home shell a flex column and used `margin-block-start: auto` to anchor the disclosure to
  the bottom in normal flow. It is not fixed or sticky.
- Integrated the existing stat strip into the composition without adding palette literals.
- Preserved 44px minimum interactive targets, safe-area padding, and full scroll reachability.

### Mode selection (`/play`)

- Added the five owner-approved functional descriptions verbatim:
  - Daily: `Everyone gets the same board today. One try.`
  - Classic: `Spin, then pick one of three players.`
  - Open: `Spin a nation, pick anyone from its squad.`
  - Memory: `Pick from three with ratings hidden until the end.`
  - Blind: `Full squad to pick from, ratings hidden until the end.`
- Kept the deliberately measured five-column short-landscape board. A four-column alternative
  measured 393–463px of content height and did not satisfy the full-copy/no-scroll contract.
- Kept the 320px tier scroll-permitted and moved only its dock into normal flow to prevent the
  Memory/Blind row from painting beneath the action.
- Used body-copy typography for descriptions and preserved full-card radio semantics.

### Formation setup (`/play/draft` before lock)

- Removed only the duplicate branding-only `DraftAppBar`; the global site header and formation
  heading remain, and no warning, action, or state was removed.
- Rendered all eight formation choices in a three-column grid from 360px upward.
- Reused canonical formation coordinates while rendering selector-private mini-pitches as ten
  uniform outfield dots plus one outlined goalkeeper box, with pitch outline, halfway line, and
  center circle.
- Added the two-word descriptors `Wide attack`, `Compact block`, `Two strikers`,
  `Screened defence`, `Midfield control`, `Front three`, `Twin creators`, and `Deep defence`.
- Used existing tokens only. `var(--line)` is the pitch-line token because the repository has no
  `--ln` token; no new color system or literal was introduced.
- Preserved Position=SHAPE everywhere it represents player identity. The uniform-dot choice is
  local to the owner-approved formation-selector comparison diagram and is recorded in `STATE.md`.
- Integrated with the shipped PR #306 geometry: the formation content is bounded/scrollable and
  the actual `.formationDock` is a disjoint static row at widths up to 430px; wider behavior stays
  sticky.

### Browser harness integrity

- Discarded only stale hit-test elements whose `ownerDocument` is not the current page. A real
  current-page blocker beneath such a foreign hit remains blocking.
- Replaced tag-name trust for development chrome with the installed Next 16 App Router structure:
  exactly one `body > script[data-nextjs-dev-overlay="true"]` wrapper and exactly one direct-child
  `nextjs-portal`.
- Suppressed the verified wrapper as a paint group, propagated the request nonce through the DOM
  `nonce` property, and recorded only verified portal nodes in the stale-hit registry.
- A bare or differently wrapped `nextjs-portal`, a missing/mismatched nonce, an unattached style
  sheet, a visible portal, or visible dev-tools controls all fail closed.
- No collision allowlist or known-failure entry changed.

## Architect decisions and tradeoffs

- **Five columns at 667×375:** retained because the board must show all five functional
  descriptions and actions without scrolling. The four-column alternative was taller in measured
  browser output and broke that contract.
- **Formation labels:** concise two-word character descriptions were derived from the established
  formation intent; they do not change engine or formation semantics.
- **Mini-pitch markers:** uniform dots are intentionally limited to the selector diagram. The
  platform Position=SHAPE encoding remains authoritative on draft cards, choice cards, rosters,
  team sheets, review, and results.
- **320px behavior:** the existing 320×568 tier remains scroll-permitted. The action dock is static
  only below 360px to prevent overlap; no hidden no-scroll exception was introduced.
- **Next wrapper coupling:** the harness intentionally couples to the installed Next 16 App Router
  wrapper. A future framework shape change fails the gate rather than silently broadening trust.

## Validation run

### Production prerequisite

- PR #306 shipped as production main `cc226371538b0717d538f86824643efd95af4d3c`.
- Canonical deployment `dpl_29uixjrLkaf93hfkWKp9NvPhgoHz` was READY and aliased to both public
  domains before this branch was rebased.
- No-cache health, runtime schema/engine/draft-pool anchors, migration, database readiness, and OG
  health matched the prerequisite dispatch.
- Required prerequisite live gates passed: three-route 18/18, squad review 2/2, and exact
  light/dark disclosure/theme assertions.

### Focused and browser gates

- Responsive/dev-overlay contract: **27/27**.
- Independent GLM reviewer focused suite: **64/64**, plus web typecheck and lint.
- WebKit collision group 1 replay: **36/36**, run twice independently, zero failures.
- Public collision command: **264/264**; 22 route/states × 2 engines × 3 widths × 2 themes; zero
  failures; no product allowlist or known failure added.
- One-screen matrix: **216/216**; 9 viewport descriptors × 2 themes × 2 motion modes × 3 routes ×
  2 engines. Split: 192 strict-fit and 24 retained 320×568 scroll-permitted contexts.
- Exact formation heights in every engine/theme/motion combination:
  - 360px: **732/732**
  - 390px: **664/664**
  - 430px: **740/740**
- Formation measurements: 8 cards, 80 uniform outfield dots, 8 goalkeeper boxes, 0 shape-marker
  classes, 0 duplicate app bars, minimum text 12px, and zero card content overflow/collisions.
- Root test one-screen receipt: `/tmp/wcdraft-one-screen-p7Ai3z/one-screen-fit.json`, SHA-256
  `95881609059f14474ac5da038cc4f88433015d8eacd4ca1e2b5007baaaa6f415`.
- Retained implementation receipt: `/private/tmp/terrace-final-one-screen/one-screen-fit.json`,
  SHA-256 `5e528a7c6a7971106da6619dfd5d9ccc2499207e4e8ab474cff12193faac73ec`.
- Required no-preference screenshot set: **36/36** under
  `docs/reports/terrace-polish-2026-07-16/screenshots/`, with per-file SHA-256 values in
  `docs/reports/terrace-polish-2026-07-16/manifest.md`.
- Native-app-feel Chromium: 4 contexts, 16 presses, **180/180 assertions**, zero failures.
- Native-app-feel WebKit: 4 contexts, 16 presses, **180/180 assertions**, zero failures.
- Open Draft: 4 viewport/theme cases, 28 measured surfaces, 44px target floor, no horizontal
  overflow or axe violations, `t4` replay succeeded, and tampered replay was rejected.
- Strict font audit: 60 surfaces, 44 targets, zero failures, zero non-Archivo families, zero
  uppercase-role violations, zero target/reachability failures, zero overflow, and zero axe
  violations. Receipt: `/tmp/wcdraft-font-terrace-final.json`, SHA-256
  `c699b624432ffad96ec0dcbb8726b6bdfb6940d0c8f81ec212b3118f7887a5f9`.

### Uncached root envelope

- `TURBO_FORCE=1 pnpm typecheck`: **9/9 tasks**, 0 cached.
- `TURBO_FORCE=1 pnpm lint`: **6/6 tasks**, 0 cached.
- `TURBO_FORCE=1 pnpm test`: **9/9 tasks**, 0 cached, completed in 30m27s.
  - Core: 423 passed.
  - Database: 161 passed.
  - Data: 183 passed, 9 skipped.
  - Marketing: 69 passed.
  - Mobile: 7 passed.
  - Web unit: 1,374 passed, 1 skipped.
  - Game flow: passed.
  - Responsive shell: 218/218 (84 desktop + 56 mobile + 40 interaction + 30 mode/setup + 8
    mobile navigation), zero failures.
  - Embedded collision: 264/264, zero failures.
  - Embedded one-screen: 216/216, zero failures.
- `TURBO_FORCE=1 pnpm build`: **5/5 tasks**, 0 cached; 40/40 pages; `/api/og/sign` and
  `/api/challenge/verify` each included 8/8 runtime-data traces.

### Dedicated golden gates

- Core RNG/narrative: **69/69**, uncached.
- Core draft/lock/compatibility/entity/manager: **42/42**, uncached.
- Data compact/integrity/score/salt: **59/59**, uncached.
- Data integration/era: **22/22**, uncached.
- Leaderboard golden: **6/6**, uncached.

### Scope and artifact reconciliation

- Added/removed authored hex/RGB/HSL/OKLCH/LAB literals: **0**.
- Protected tree hashes are identical between base and reviewed head:
  - `packages/core`: `344ced76f8d6fd1b9c959f4d3acd0308ac7acba7`
  - `packages/data`: `a9ca53a187d218e92e4da633acee788936e4bb45`
  - `etl`: `f0c64a99c8124ddc813e20fde58f91f2b68b4b4f`
- `etl/output/ratings.json`: `896301819a2988e4e93b3038b35ffa44bcef4182b4a55ac82c7569241801cee0`.
- Current runtime manifest: `214df946a291016f34ae689a1c2e52a857ae5590e1aa66870ec12b172211eb82`.
- Draft pool: `ae5376c917377b00ac9dee7a166dcaceb28dd1416fc9fbe8b00b1116ca8e8d07`.
- Brotli draft pool: `76a5833748f34968b2666ae8c8f346d8d7e440a7f5f73f83de19c488c307b36d`.
- `git diff --check`: passed.

### Independent review

- OpenCode 1.17.10 with `ollama-cloud/glm-5.2`, variant `max`, reviewed exact code head
  `d20e12cac326f29b046b063664d61d08dd5917dd` against production base `cc226371...`.
- Verdict: **PASS**, no blocking correctness, regression, accessibility, contract, trust-boundary,
  or scope defect.
- Receipt: `docs/reports/terrace-polish-cross-model-2026-07-16.md`.

## Not run and why

- ETL `ruff`/`pytest`: not run because the ETL tree is byte-identical to production main.
- Heavy realism: not run as a dedicated lane because no core, data, rating, simulation, engine,
  draft, or CI configuration changed. The ordinary data realism/golden suite ran inside the
  uncached root tests and the dedicated data goldens.
- Database migration application beyond the ordinary suite: not run because there is no database,
  schema, or migration diff; all 161 database tests passed.

## Risks and rollback

- The exact Next wrapper selector is version-coupled by design. A future Next upgrade may fail the
  development collision harness until provenance is re-established; it will not silently mask a
  product portal.
- The retained 320×568 tier scrolls by contract. Controls and disclosures were browser-proven
  reachable; strict no-scroll begins at 360px.
- The five-column 667×375 layout is dense. Full descriptions, actions, 44px card targets,
  typography, and collision/overflow behavior were measured in both engines.
- Rollback is the ordinary squash revert of the eventual merge. No data, schema, or migration
  rollback is required.
