# Guard proof of life, production target, raster measurement, and evidence recapture

Date: 2026-07-17
Risk: YELLOW
Base: `76a1d2140871acb9048cdfc47797d7310d1a680f` (PR #307)
Branch: `ws-ux/guard-proof-life`

## Summary

The collision guard scans the optimized `next build` artifact through `next start`, and its six
permanent browser-session controls prove Class A, Class B, both clear cases, and both allowlist
boundaries in Chromium and WebKit. The tightened same-control rule exposed a real selected-Daily
card collision instead of absorbing it. The product fix assigns the pill/title, descriptor, and
in-card CTA to separate rows at narrow widths and short landscape. The complete exact-code matrix
now passes 264/264 with 4,489 Class A findings, zero Class B product findings, zero unexpected
findings, and the exact known-failure list empty. The guard machinery that existed only to suppress
and authenticate Next development chrome remains deleted.

All 12 generated rasters are byte-identical to the corresponding production responses, so none
was deleted. All 18 historical light-mode captures contain the Next development-tools button and
are stale after PR #307. Their manifest is additively annotated, and a dev-chrome-free optimized-production
replacement contains 24 screenshots covering home, mode select, formation setup, and squad review
at 360/390/430 in both engines.

The only product-source change is bounded Daily-card geometry plus the tests and browser assertion
that bind it. Colour values, core, data, ETL, schema, ratings, simulation, leaderboard, auth, and
mobile remain outside the diff. Local validation is complete; final exact-head independent reviews,
protected CI, merge, deployment observation, and live verification are recorded outside this
pre-review commit so their evidence cannot invalidate the reviewed head.

## U0 — evidence-only verification

U0 ran before source changes and is preserved at `/tmp/u0-guard-findings.md` for the active lane.

### 3.1 Class B verdict

> **Class B was implemented, but had never fired in a recorded product-route matrix or live
> receipt.**

`apps/web/scripts/narrow-collision-scan.ts` enumerated painted elements whose computed
`pointer-events` is `none`, required a visible overlap with substantive text or a control,
temporarily enabled hit testing, and emitted Class B only when the browser confirmed the candidate
painted above the target:

```ts
const pointerTransparentPaint = [...document.querySelectorAll<HTMLElement>("body *")].filter(
  (candidate) =>
    elementPainted(candidate) &&
    getComputedStyle(candidate).pointerEvents === "none" &&
    paints(candidate),
);
// ... clipped target/candidate intersection ...
candidate.style.setProperty("pointer-events", "auto", "important");
// ... hitAtPoint confirms the candidate before pushFinding({ class: "B", ... }) ...
```

The historical 252-cell report-only receipt had 808 Class A and zero Class B findings. The fresh
current-main 264-cell dev baseline had 4,499 Class A and zero Class B findings. Recorded live
receipts had no Class B product finding. A prior synthetic unit test reached the code, but no
route-level proof exercised the real scanner against the real application DOM.

### 3.2 Allowlist inventory

The pre-lane predicates were exactly:

```ts
same-interactive-composition: finding.sharedInteractiveAncestor
scrolling-under-app-shell: finding.intentionalScrollShell
```

The fresh current-main development baseline reconciled as follows:

| Pattern                        | Findings | Representative evidence                                                                                                                                                                        |
| ------------------------------ | -------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `same-interactive-composition` |       52 | `classic-pick` 36 and `mode-select-available` 16. Example: `/play`, 320×568 light Chromium, `Today's Draft` and `Play daily →` inside the same Daily button, `sharedInteractiveAncestor=true`. |
| `scrolling-under-app-shell`    |    4,447 | Across 19 surfaces. Example: `/`, 320×568 light Chromium, `Pick 01` under the sticky app header at `scrollY=108`, `intentionalScrollShell=true`.                                               |

The dispatch's 8/44/26 values were from bounded live receipts, not the full scrolling-position
inventory. The final predicates retain the semantic boundary while refusing opaque sibling box
paint and fixed/sticky targets; U1 proves those refusal paths with adversarial collisions.

### 3.3 Production-build feasibility

Repointing was feasible. The repository-supported build lifecycle materializes runtime data,
generates build-time rasters and marketing/service-worker assets, completes `next build`, and
verifies both protected runtime-data traces. `next start --hostname 127.0.0.1 --port <dynamic>`
serves that same worktree-local `.next` artifact. Deterministic route state comes from committed
runtime bundles, local storage, init scripts, and browser-session request fixtures; no scanned
state exists only in dev, and no production credential is required.

### 3.4 Raster measurement

Every resolved URL returned 200. `same` in the served column means the full 64-character hash is
identical to the adjacent committed hash.

| Artifact                            | Resolved production URL         | Committed SHA-256                                                  | Served SHA-256 | Verdict/action    |
| ----------------------------------- | ------------------------------- | ------------------------------------------------------------------ | -------------- | ----------------- |
| `public/brand/logo-header.png`      | `/brand/logo-header.png`        | `7f45b4375db83e3edb85e4930ec81b8f04f6155c1d45a6fc1f21ee9ba788ebd3` | same           | identical; retain |
| `public/icons/icon-32.png`          | `/icons/icon-32.png`            | `6447519fec6c8d21155ebb84f0cdab0c34501828984584f99f9cab16b5b2b679` | same           | identical; retain |
| `public/icons/icon-64.png`          | `/icons/icon-64.png`            | `7321053f5efccf842973751753229635afb52a3188dd931b66b37f715c904dd6` | same           | identical; retain |
| `public/icons/icon-120.png`         | `/icons/icon-120.png`           | `5f54096ea3122ef8a2028b8a0f155f8977f15f7ea2f19de48d83b5773c1d3da9` | same           | identical; retain |
| `public/icons/icon-152.png`         | `/icons/icon-152.png`           | `c4086509c375dddfb51cf1ef2c29f25de7c01935921e0837adbb56555ba842c1` | same           | identical; retain |
| `public/icons/apple-touch-icon.png` | `/icons/apple-touch-icon.png`   | `e2f8d2907cc9e74228d3ef091b581a78b39ab39e5d3f5986633e733e92950212` | same           | identical; retain |
| `public/icons/icon-192.png`         | `/icons/icon-192.png`           | `50ee3b001e1dcd332b559c96fb4506b1e05453f03ab4cef378afdb38c1f647e4` | same           | identical; retain |
| `public/icons/icon-512.png`         | `/icons/icon-512.png`           | `f599e8620e3c25b362754001593f8472001efa69ecafc326976ccd1a2e7c551a` | same           | identical; retain |
| `app/icon.png`                      | `/icon.png`                     | `f599e8620e3c25b362754001593f8472001efa69ecafc326976ccd1a2e7c551a` | same           | identical; retain |
| `app/apple-icon.png`                | `/apple-icon.png`               | `e2f8d2907cc9e74228d3ef091b581a78b39ab39e5d3f5986633e733e92950212` | same           | identical; retain |
| `public/favicon.ico`                | `/favicon.ico`                  | `a87c569461cecb949c110ecb339990e1ef7620c5a3c231f0c238f43e05dad142` | same           | identical; retain |
| `app/favicon.ico`                   | `/favicon.ico?6bb712493c407b1b` | `a87c569461cecb949c110ecb339990e1ef7620c5a3c231f0c238f43e05dad142` | same           | identical; retain |

Identity today does not promise identity after a future Sharp, Node, or runtime bump. The durable
control is to repeat this resolved-URL/hash table, not to delete identical build-time inputs.

### 3.5 Historical light evidence

Every image listed below contains the lower-left Next.js development-tools button and is stale
against PR #307:

| Engine   | Surface      | Contaminated files                                                      |
| -------- | ------------ | ----------------------------------------------------------------------- |
| Chromium | home         | `u5-chromium-home-{360x800,390x844,430x932}-light.png`                  |
| Chromium | mode-select  | `u5-chromium-mode-select-available-{360x800,390x844,430x932}-light.png` |
| Chromium | squad review | `u5-chromium-squad-review-{360x800,390x844,430x932}-light.png`          |
| WebKit   | home         | `u5-webkit-home-{360x800,390x844,430x932}-light.png`                    |
| WebKit   | mode-select  | `u5-webkit-mode-select-available-{360x800,390x844,430x932}-light.png`   |
| WebKit   | squad review | `u5-webkit-squad-review-{360x800,390x844,430x932}-light.png`            |

The original PNG bytes were not changed. The original manifest now says all 18 captures contain
development chrome, identifies the lower-left control as non-product UI, records that the set is
stale after PR #307, and points to the clean replacement.

### 3.6 Runner baseline

Lane-start free space on `/System/Volumes/Data` was 44,798,148 KiB (42.72 GiB), above the 30 GiB
floor. Main CI logs proved that `agent-temp-lifecycle.ts`,
`mark-agent-temp-cleanup-ready.mts`, and `scripts/ci/self-hosted-runner-hygiene.sh` had executed
since PR #306. Surviving positive cleanup-ready markers and the CI log's successful lifecycle
messages proved execution; production-root logs did not prove any stale real path was reclaimed.
No runner sweep was performed in this lane.

## U1 — permanent proof controls

`apps/web/scripts/narrow-collision-proof-controls.ts` injects each fixture with `page.evaluate`
against `/` in a real Chromium/WebKit session. It runs under the same optimized-production server
as the matrix. `verify:narrow-collision-controls` is explicit, and the default web responsive test
runs the controls before the shell/matrix work, keeping them in root CI.

| Control                          | Expected proof                                               | Final result per engine | Deliberate defect that made it red                                 |
| -------------------------------- | ------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------ |
| `class-b-fires`                  | opaque pointer-transparent higher paint is reported          | 2 unexpected findings   | disable Class B enumeration                                        |
| `class-b-transparent-clear`      | transparent pointer-transparent element is clear             | 0                       | force transparent elements through `paints`                        |
| `class-a-fires`                  | opaque pointer-active blocker is reported                    | 2                       | ignore fixed-over-fixed Class A                                    |
| `class-a-separated-clear`        | same blocker moved away is clear                             | 0                       | substitute a non-overlap element into Class A hit resolution       |
| `same-interactive-blocker`       | substantive text overlap inside one button is still reported | 1                       | broaden the pattern to allow every non-box same-control overlap    |
| `scrolling-shell-pinned-blocker` | pinned target under semantic sticky shell is still reported  | 2                       | broaden the pattern back to every intentional scroll-shell finding |

The temporary defects were applied one at a time, each named control failed, and the exact source
was restored before the clean two-engine run. The independent reviewers re-execute these mutations
from raw source rather than relying on this narrative; their verbatim verdicts are recorded below.

The narrowed allowlists are:

```ts
same-interactive-composition:
  finding.sharedInteractiveAncestor &&
  !finding.occluderOpaqueBoxPaint &&
  (finding.intersectionRect.width <= 1 || finding.intersectionRect.height <= 1)
scrolling-under-app-shell:
  finding.intentionalScrollShell &&
  finding.targetPosition !== "fixed" &&
  finding.targetPosition !== "sticky"
```

### U1 product fix and redundancy adjudication

At `max-width: 430px`, the featured Daily card now uses one grid column with explicit top,
descriptor, and bottom rows. The same separation applies in short landscape because the five-card
board otherwise remains horizontally dense even above 430px. Wider layouts retain the existing
one-row presentation. No copy, colour token, font rule, selection behavior, target size, or route
transition changed.

The five descriptors remain verbatim:

1. `Everyone gets the same board today. One try.`
2. `Spin, then pick one of three players.`
3. `Spin a nation, pick anyone from its squad.`
4. `Pick from three with ratings hidden until the end.`
5. `Full squad to pick from, ratings hidden until the end.`

The in-card `Play daily →` CTA remains. All five cards are full-card radio controls and each carries
an in-card mode-specific action label; removing only Daily's label would save space by breaking a
consistent affordance. The sticky dock is the actual navigation control, while the card CTA explains
what selecting that radio mode will do. Row separation resolves the collision without deleting
load-bearing copy or creating a one-card exception.

Before the fix, the tightened group-1 scan reported 8 unexpected mode-select findings per engine:
two at each 320px theme (`Daily`/title and title/CTA) and one at each 360px and 390px theme
(title/CTA), for 16 unexpected findings across 12 cells. After the fix, every one of those 12 cells
has zero unexpected findings. At 320px, the remaining literal Daily-card contacts are all adjudicated
hairline glyph-boundary contacts; every 360px and 390px Daily cell has zero literal collision. The
full matrix confirms no displacement into another surface.

## U2 — optimized production target and finding reconciliation

`test-responsive-shell-fit.mts` now builds once through Turbo, starts the optimized artifact on a
dynamic loopback port, verifies the real unauthenticated `/account` redirect contract, and runs
the permanent controls and requested browser matrices against that server. The deleted
dev-only surface is `dev-overlay-suppression.ts`, its callers/types, nonce provenance and
wrapper/portal shape checks, fail-closed suppression path, and suppression-only tests.

The final matrix passed 264/264 with the following raw totals. The superseded scan is retained to
show how the product fix and narrowed adjudication changed the inventory:

| Inventory                       | Cells | Class A | Class B |     Same control |     Scroll shell |  Unexpected |
| ------------------------------- | ----: | ------: | ------: | ---------------: | ---------------: | ----------: |
| Historical report-only dev scan |   252 |     808 |       0 | mixed historical | mixed historical | report-only |
| Fresh current-main dev baseline |   264 |   4,499 |       0 |               52 |            4,447 |           0 |
| Superseded optimized scan       |   264 |   4,488 |       0 |               52 |            4,436 |           0 |
| Final optimized scan            |   264 |   4,489 |       0 |               36 |            4,453 |           0 |

Against the like-for-like fresh-current-main development baseline, the final production inventory
drops by 10: same-control findings drop by 16 because the substantive Daily-card contacts were
fixed, while bounded scrolling-shell sampling increases by 6. This is smaller than the 212
development-tools findings named in the older 808-finding report-only inventory, so it does not
trigger the dispatch's unexplained-loss red flag. That older scan used 21 route states, earlier
sampling/adjudication, and development chrome; its 212 `nextjs-portal` findings cannot exist under
`next start` and its total is not numerically comparable to the current 22-state bounded-scroll
inventory. The final production total being 3,681 higher than 808 is coverage expansion, not a
missing-chrome claim. The per-surface totals and SHA-256s of all eight final raw receipts are committed in
`docs/reports/guard-proof-life-2026-07-17/collision-summary.json`.

The root test then ran all four groups again in one uninterrupted orchestration and reported
`metrics=264 failures=0`. No allowlist was added or broadened and
`NARROW_COLLISION_KNOWN_FAILURES` remains exactly `[]`.

## U3 — raster action

No raster was deleted or changed. All 12 measured pairs are identical, and the tracked inputs are
still needed by the build-time file-convention and public-asset consumers. `STATE.md` replaces the
unmeasured carryover with the measured verdict and remeasurement rule.

## U4 — dev-chrome-free light-mode evidence and product finding

The dev-chrome-free replacement is
`docs/reports/guard-proof-life-2026-07-17/light-mode/manifest.json`: 24 images plus two raw browser
receipts and one manifest. It covers four surfaces × three widths × two engines × light theme.
Both engine receipts contain 12/12 metrics, zero console errors, zero axe violations, zero
horizontal overflow, and no dev portal. Those receipts deliberately have `collisionMode: off`, so
their empty `collisionFindings` arrays are not collision claims. Fresh-context visual review found
the selected-card title overlapping the inline Daily CTA in both 360px captures; the strict scanner
then reproduced it as an unexpected Class A text collision. U1 fixes that geometry in product CSS,
and both the focused 12-cell comparison and complete 264-cell strict scan are green. The original
dated manifest was annotated; its 18 PNGs were not rewritten. Light-mode redesign remains deferred;
the evidence pointer is unchanged.

## Architect-delegated decisions

1. **Normalize loopback document CSP transport only.** The production policy contains
   `upgrade-insecure-requests`, but the isolated `next start` target deliberately has no TLS
   endpoint. WebKit otherwise upgrades local assets to HTTPS and fails before product code can
   hydrate. The harness removes only that directive from browser-delivered loopback document
   headers, preserving every other CSP directive and the optimized application artifact. This is
   the least-behavior-changing way to measure production output without inventing a local TLS
   deployment.
2. **Split the account redirect transport assertion from its browser geometry scan.** Playwright
   cannot fulfill a redirect response fetched with `maxRedirects: 0` while rewriting its CSP.
   The wrapper therefore asserts the real `/account` 307/308 and exact
   `/sign-in?next=/account` destination over HTTP, then scans that exact unauthenticated surface in
   the browser. This preserves both contracts without weakening either assertion.
3. **Intercept deterministic challenge verification in the page fetch boundary.** The optimized
   artifact's registered service worker can handle the request before `page.route` observes it.
   An init-script fetch interceptor returns the same deterministic committed fixture in the real
   browser session. It changes no product source or production behavior and keeps the collision
   recipe hermetic.
4. **Use report-only CSP for the HTTP loopback server.** The built application is production
   output, but the isolated harness intentionally serves HTTP while the public deployment is
   HTTPS. The repository's existing production-mode browser harness uses the same report-only
   setting for this transport mismatch. Unknown browser diagnostics still fail the collision
   gate; only the exact locked report-only messages are accepted. Product CSP source and the
   production deployment's enforced policy are unchanged.
5. **Keep Daily's in-card CTA and separate its rows.** The five mode cards are full-card radio
   controls with consistent mode-specific action labels; removing only Daily's label would make its
   affordance structurally different even though the sticky dock performs navigation. The bounded
   row separation is the least-behavior-changing fix: it preserves all descriptors, selection and
   navigation semantics, 44px targets, colors, and the wider layout while clearing the strict gate.

## Files

- Scanner proof and adjudication: `apps/web/scripts/narrow-collision-scan.ts`,
  `narrow-collision-proof-controls.ts`, `responsive-layout-contract.ts`.
- Daily geometry and its contracts: `apps/web/components/game/game-styles/shared.module.css`,
  `apps/web/lib/game/__tests__/one-screen-compaction.test.ts`,
  `one-screen-device-matrix.test.ts`, and `apps/web/scripts/verify-home-fold-browser.mts`.
- Production wrapper and browser harness: `apps/web/scripts/test-responsive-shell-fit.mts`,
  `verify-responsive-layout-browser.mts`, `apps/web/package.json`.
- Deleted dev-only machinery: `apps/web/scripts/dev-overlay-suppression.ts` and suppression-only
  contract tests in `responsive-layout-contract.test.ts`.
- Durable evidence: this report, `collision-summary.json`, the new 24-image light-mode set, and the
  additive historical-manifest correction.
- Measured state: `STATE.md`.

## Validation run

- Focused Daily geometry contracts: **18/18 passed**; web typecheck passed.
- Optimized-production proof controls: **6 controls × 2 engines passed**; observed counts per
  engine were 2, 0, 2, 0, 1, and 2.
- Each deliberate defect was re-applied alone and made only its named control red in both engines:
  disable Class B enumeration → `class-b-fires` 0; force transparent paint →
  `class-b-transparent-clear` 2; skip fixed-over-fixed Class A → `class-a-fires` 0; substitute
  separated hit geometry → `class-a-separated-clear` 2; broaden same-control to any shared
  ancestor → `same-interactive-blocker` 0; broaden scrolling shell to any intentional shell →
  `scrolling-shell-pinned-blocker` 0. Exact source was restored and the clean 12-control run passed.
- Final optimized-production collision matrix: **264/264**, 4,489 literal Class A findings,
  0 Class B product findings, 0 unexpected, and 0 browser errors. The root test ran all four groups
  to completion in one orchestration; this is not a group-1-only inference.
- Fresh light capture: **24/24 dev-chrome-free captures**, with 12/12 axe/console/overflow metrics
  in each engine receipt; collision measurement was off for this screenshot pass.
- Uncached root typecheck: **9/9 tasks**, 0 cached.
- Uncached root lint: **6/6 tasks**, 0 cached; repository format check clean.
- Uncached root test: **9/9 tasks**, 0 cached, completed in 30m48.663s:
  - core 423, database 161, data 183 + 9 expected skips, marketing 69, mobile 7, web
    1,367 + 1 expected skip = **2,210 passed / 10 expected skips**;
  - game-flow Playwright passed;
  - permanent proof controls passed in both engines;
  - responsive shell **218/218**, final collision **264/264**, one-screen **216/216**.
- Uncached root build: **5/5 tasks**, 0 cached, 40/40 pages; `/api/og/sign` and
  `/api/challenge/verify` each include 8/8 protected runtime-data traces.
- Dedicated uncached goldens without regeneration or re-lock: core **69/69**, draft **42/42**,
  data **59/59**, integration **22/22**, leaderboard **6/6**.
- Native app-feel: Chromium **180/180** and production-mode WebKit **180/180**, each across four
  contexts and 16 presses.
- Strict font/a11y audit: **60 surfaces / 44 targets**, zero failures, axe violations, non-Archivo
  families, tracking-role violations, target failures, or horizontal overflow. Receipt
  `/tmp/wcdraft-guard-font-a11y.json`, SHA-256
  `3c57db51580b55e604bd6a0e1319222508fae5a5af5649ad4efc8912c2ec551a`.
- The source tracking guard passed within the 1,367-test web suite. Ratings and draft-pool hashes
  remained exact, no tracked data changed, and no golden was regenerated or re-locked.

## Independent reviews

The table preserves the blocked-head review history. Those U0-U4/cross-model verdicts are not
represented as final-head approval because U1 changes the reviewed code. The required fresh-context
and cross-model reviews run only after this report commit establishes the exact candidate head;
their verbatim artifacts, hashes, and durable PR citations are release evidence rather than a
post-review commit that would void them. U5 was independently re-observed at implementation head
`452b39de4d450f013a4ee2222e5d97454192a256` and returned PASS.

| Unit                             | Verdict                | Verbatim artifact                                  | SHA-256                                                            |
| -------------------------------- | ---------------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| U0                               | PASS                   | `/tmp/wcdraft-guard-u0-review.txt`                 | `b9ffb880b6408623ae9a90f22f8c382ea191096843b0b5f937d7cd4187bbe04b` |
| U1                               | PASS                   | `/tmp/wcdraft-guard-u1-review.txt`                 | `f2000d41576afd1f17b704fc08e6586c16771669bc1a874c886628b86e90c1f5` |
| U2 initial                       | FAIL, fixed forward    | `/tmp/wcdraft-guard-u2-review.txt`                 | `a70cee71d208f57d8cdf1116caa614173be3e9c31e7643b29363b34c99e7b44c` |
| U2 exact-head re-review          | PASS, shipping blocked | `/tmp/wcdraft-guard-u2-rereview.txt`               | `8e0fef5e13245648a1cf2593cbb1cfc7c9584c8854788a2bd7782825676a0988` |
| U3                               | PASS                   | `/tmp/wcdraft-guard-u3-review.txt`                 | `2c13809978e6f7747c7f347a3dfdf333ae5e06d55f481b61a362c06618779403` |
| U4 initial                       | FAIL, fixed forward    | `/tmp/wcdraft-guard-u4-review.txt`                 | `2732dd759027caae1b2a4081b1bafc03d088bc939979057fcea0e375a92bb97e` |
| U4 exact-head re-review          | PASS, shipping blocked | `/tmp/wcdraft-guard-u4-rereview.txt`               | `1175f52aca02c736fdb8b7116d9c56c32283781b9eeda96d8f2294e5104450a1` |
| U1/U2 cross-model GLM exact head | PASS, shipping blocked | `/tmp/wcdraft-guard-crossmodel-rereview-final.txt` | `749b849cfc432535476806319286af8cac366170acf41dd358a24751b3eb9ae7` |
| U5 final observation             | PASS                   | `/tmp/wcdraft-guard-u5-final-review.txt`           | `c26de83abdc9496cd1301470918ec39ecca1cf389ef0ae1c6504da1800d1c431` |

The initial U4 FAIL is the review that exposed the real product collision. Its historical PASS
re-review proved the guard but remained shipping-blocked. U1 fixes the product geometry; the final
exact-head reviewers must independently prove both the fix and the unchanged guard before merge.

## U5 — runner end observation

The resumed lane began with approximately 53 GiB free in the direct U0 observation. The earliest
raw protected-CI start reading was 54,500,980 KiB; the final independent observation was 51,235,324
KiB. Every production hygiene invocation remained above its 37,748,736 KiB target. No production
invocation printed `pruning` or `after_free_kb`, so no real production-root reclamation is attributed
to this lane. The only pruning occurred inside the isolated contract probe with a synthetic root.

GitHub Actions run `29606985824` completed successfully at the exact implementation head and its
aggregate gate passed. The one-screen lifecycle wrote `cleanup-ready-v1` only to its disposable
output, while `/private/tmp/wcdraft-guard-proof-20260717` stayed unmarked, linked to the owner Git
common directory, and preserved. At the observation end, runner `wcdraft-m4` was online and idle.
The verbatim PASS is `/tmp/wcdraft-guard-u5-final-review.txt` with SHA-256
`c26de83abdc9496cd1301470918ec39ecca1cf389ef0ae1c6504da1800d1c431`.

Post-merge cleanup remains **NOT RUN at this pre-review commit**. Its precondition is successful
merge plus live verification; the final release record must report the actual cleanup and end-space
measurement rather than pre-claiming them here.

## Not run and why

- Final exact-head fresh-context and cross-model review are intentionally not run until this
  report/STATE commit establishes the immutable candidate they must review.
- Final-head protected CI, merge, Vercel READY observation, production live verification, and
  post-merge cleanup are downstream of those reviews. The draft PR exists and implementation-head
  CI is green; no production claim is made in this pre-review artifact.
- No manual runner sweep was performed.

## Risks and carryovers

- The production loopback harness depends on a narrowly documented CSP transport normalization;
  a future policy change should be reviewed against that single-directive rewrite.
- Product-route Class B remains zero, which is an observed application state rather than a guard
  blind spot because the permanent positive and transparent controls execute the same scanner.
- Raster equality must be remeasured after Sharp, Node, generation-code, or deploy-platform changes.
- The geometry fix is intentionally limited to widths through 430px and short landscape; the full
  one-screen, responsive-shell, native-feel, and collision matrices bound its measured blast radius.
- Ship, READY observation, live checks, and cleanup remain pending at this pre-review commit.

## Commit, branch, and git status

- Branch: `ws-ux/guard-proof-life`
- Preserved blocked-lane tip: `ceffdc0f8b12a174b5f398e36aefdc52c247c170`
- Daily geometry implementation head: `452b39de4d450f013a4ee2222e5d97454192a256`
- Draft PR: #308, opened before U1; branch was pushed and remotely confirmed before any product edit
- This report/STATE closeout is the next commit and becomes the final candidate-review head
- Merge/deploy/live verification: pending required final-head reviews and protected CI

## HUMAN ACTIONS

None at the pre-review boundary. The corrected dispatch authorizes the bounded product geometry
fix, all local gates are green, and the remaining review/ship/live/cleanup sequence is autonomous.

## Explicit invariants

- Product geometry changed only for selected Daily content separation at narrow widths and short
  landscape.
- Zero colour values changed in either theme.
- No tracked core/data/ETL/mobile diff.
- Ratings SHA-256 remains
  `896301819a2988e4e93b3038b35ffa44bcef4182b4a55ac82c7569241801cee0`.
- Draft-pool raw SHA-256 remains
  `ae5376c917377b00ac9dee7a166dcaceb28dd1416fc9fbe8b00b1116ca8e8d07`.
- All dedicated goldens passed without regeneration or re-lock.
