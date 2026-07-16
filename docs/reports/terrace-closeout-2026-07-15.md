# Terrace close-out — final lane report

- **Date:** 2026-07-15 (America/New_York)
- **Tier:** RED
- **Branch:** `ws-ux/terrace-closeout-20260715`
- **Base:** `bc9402d668b1423a1f58f44e27ace74205b96b41`
- **Unit implementation head:** `b9406df0f582435670bb77878fe8b9262da73c14`
- **Status at report authoring:** implementation and per-unit reviews are complete; final-head
  RED review, CI, squash merge, deployment observation, and production live verification
  remain mandatory before this lane is called shipped.

## Summary

The two one-screen routes now expose the existing CC-BY-SA attribution and not-affiliated
notice as readable content instead of hiding their only copy with the route footer. Historical
`ogs1` links regain read-only compatibility without creating new v1 signatures or weakening
HMAC/token binding. Build generation is the sole owner of the default OG raster, so the repo
no longer commits macOS bytes that Vercel Linux overwrites. The 320×568 descriptor remains in
the browser matrix with strict horizontal, interaction, paint, theme, motion, zoom, error, and
reachability checks, but may scroll vertically. Light-mode evidence is committed unchanged.

This lane does not change ratings, simulation, sampling, Synergy, engine or season anchors,
schema, run-token codecs, leaderboard behavior, auth, ETL, compact runtime bundles, the
Terrace palettes, the medallion, PWA/iOS icons, or mobile application code. The implementation
did not regenerate or change a data artifact, and no golden was re-locked.

## Files

- `apps/web/app/page.tsx`, `apps/web/app/play/page.tsx`, and
  `apps/web/components/{legal-disclosure,site-footer}.tsx`: one shared source of the unchanged
  legal substance, embedded visibly on both one-screen routes while the multi-link footer
  remains suppressed there.
- `apps/web/components/one-screen-disclosure.module.css`: compact typography and bounded
  spacing, including separation from the mode-select dock; it introduces no color value.
- `apps/web/lib/game/run-og-{signing,metadata}.ts` and `run-og.test.ts`: exact v1 read
  verification, current-v2 cache re-keying, and positive/negative compatibility coverage.
- `apps/web/scripts/generate-marketing-assets.mjs`, `.gitignore`, and typography contracts:
  generated default-OG ownership plus a `git ls-files` recommit guard.
- `apps/web/scripts/{one-screen-device-matrix,verify-home-fold-browser}.mts` and focused
  contracts: 320 scroll policy, user-scroll interaction proof, dock/disclosure collision
  proof, full-page normalized evidence, and retained non-fit assertions.
- `docs/reports/terrace-closeout-2026-07-15/light-mode`: 18 normalized light PNGs, two raw
  browser receipts, and a SHA-256 manifest; no product style or token changed for U5.
- `STATE.md` and this report: shipped-truth ledger and durable evidence.

No path under `packages/core`, `packages/data`, `packages/db`, `etl`, or `apps/mobile` is in
the lane diff.

## U0 measured findings

U0 completed before implementation and made zero tracked changes. Its machine-readable receipt
`/tmp/u0-disclosure.json` covers 72 engine/route/theme/viewport contexts and 144 disclosure-line
records. On base, each line itself computed `display:block`, `visibility:visible`, `opacity:1`,
`clip:auto`, and `clip-path:none`, with no visually-hidden class. The `.site-footer` ancestor,
however, computed `display:none`; every line therefore had a 0×0 box, was absent from the
accessibility tree, and had no human interaction path. **Base verdict: CSS-hidden in all 144
line records; U1 was required and is a fix, not a no-op.**

The post-fix browser matrix measures both exact substantive lines as painted and reachable.
For strict descriptors, both lines intersect the initial layout viewport. For 320×568, the
committed interaction scrolls each line into the layout viewport and restores all document and
nested-scroller offsets before evidence capture. The following compact table is per
route/theme/viewport; Chromium and WebKit and both motion modes agree in every cell.

| Registered viewport | `/` light                                  | `/` dark                                   | `/play` light                              | `/play` dark                               |
| ------------------- | ------------------------------------------ | ------------------------------------------ | ------------------------------------------ | ------------------------------------------ |
| 320×568             | rendered-and-reachable by vertical scroll  | rendered-and-reachable by vertical scroll  | rendered-and-reachable by vertical scroll  | rendered-and-reachable by vertical scroll  |
| 360×732             | rendered-and-reachable in initial viewport | rendered-and-reachable in initial viewport | rendered-and-reachable in initial viewport | rendered-and-reachable in initial viewport |
| 390×664             | rendered-and-reachable in initial viewport | rendered-and-reachable in initial viewport | rendered-and-reachable in initial viewport | rendered-and-reachable in initial viewport |
| 430×740             | rendered-and-reachable in initial viewport | rendered-and-reachable in initial viewport | rendered-and-reachable in initial viewport | rendered-and-reachable in initial viewport |
| 667×375             | rendered-and-reachable in initial viewport | rendered-and-reachable in initial viewport | rendered-and-reachable in initial viewport | rendered-and-reachable in initial viewport |
| 768×1024            | rendered-and-reachable in initial viewport | rendered-and-reachable in initial viewport | rendered-and-reachable in initial viewport | rendered-and-reachable in initial viewport |
| 1024×768            | rendered-and-reachable in initial viewport | rendered-and-reachable in initial viewport | rendered-and-reachable in initial viewport | rendered-and-reachable in initial viewport |
| 1280×720            | rendered-and-reachable in initial viewport | rendered-and-reachable in initial viewport | rendered-and-reachable in initial viewport | rendered-and-reachable in initial viewport |
| 1366×720            | rendered-and-reachable in initial viewport | rendered-and-reachable in initial viewport | rendered-and-reachable in initial viewport | rendered-and-reachable in initial viewport |

### Tracking and typography

- The guard exists in `apps/web/lib/game/__tests__/typography-system.test.ts`. It inventories
  active authored CSS/SVG/TS/TSX, rejects any resolvable positive `letter-spacing` above
  `0.10em`, and fail-closes on ambiguous unitless SVG and unresolved `calc(...)` values.
- Independent production-computed evidence sampled **48,076 visible elements** across 60
  font-audit surface contexts in both themes and 44 interaction targets. The maximum positive
  tracking was exactly `0.10em`; values above `0.10em`: **0**. Receipt:
  `/tmp/u0-font-audit-computed.json`, SHA-256
  `c3cb66a7ba33f653243e7da46092cea7cbb578889612df437832e78a3d1f8ed8`.
- The shipped role table matches: display `900/-0.035em`; headings `800/-0.02em`; body
  `400/0`; micro-labels `500/0.10em`; buttons `800/0.02em`. Source/computed violations: **0**.
- The em-dash AST guard has 13 protected files and 38 exact values. Its exact multiset still
  matches; stale allowlist entries: **0**. The focused four-test guard passed.

### Theme-color mechanisms

The shared install manifest uses `#3f9268` for PWA/install chrome. HTML emits media-qualified
`#f1ecdf` in light and `#0f100e` in dark for current-page browser chrome. These legitimately
different mechanisms and values are unchanged by this lane.

## U2 OG durability and verification strength

The recovered v1 envelope is complete: it contains its version, token hash, versions, and
normalized render model. The read path now recognizes only the exact historical `ogs1` prefix,
verifies the exact v1 signed message with the same secret and constant-time HMAC comparison,
validates the complete versioned payload, and binds `payload.token_hash` to the supplied run
token exactly as v2 does. Accepted v1 metadata is re-keyed publicly under `ogs2`; every signer
continues to emit v2 only. **Verification strength is unchanged.**

The independent negative matrix passed **38 tests**:

| Class                           | Expected and measured result                       |
| ------------------------------- | -------------------------------------------------- |
| Valid v1                        | real per-run image; metadata cache key uses `ogs2` |
| Tampered v1 payload             | rejected to default 307                            |
| Forged v1 signature             | rejected to default 307                            |
| Valid v2                        | unchanged real per-run image                       |
| Payload/run token-hash mismatch | rejected to default 307                            |
| Malformed, foreign, or unsigned | rejected to default 307                            |

Historical served-byte baseline on rollback deployment `2576f2d…`: HTTP 200 PNG, 77,398
bytes, SHA-256 `91cd1d5e83314acc3e5dd9fcc0b29b3b76056fab6acb95ad55eedc0213e7ba31`.
Current base production rejects the same signed value to default-card SHA-256
`e7f4c69b01cd7d57bd2e0cd8e243c7f9d1d491a2ba55b8f131bde8660cb6a708`.
The PR preview cannot adjudicate the real fixture because `WCDRAFT_OG_SIGNING_SECRET` is
intentionally Production-only in Vercel; its route boot assertion returns 500 in Preview.
The lane does not broaden secret scope. The mandatory post-merge production check will record
the after SHA-256, HTTP 200 PNG bytes distinct from the default, and `ogs2` cache namespace.
The signed fixture remains only in `/tmp/u0-v1-fixture.json` and is never printed or committed.

## U3 default-OG ownership

**Chosen owner: build generation.** The committed raster was not a semantic input. Supported
`pnpm dev` and build lifecycles regenerated it before serving; the generator's existence check
and typography byte-hash test were circular ownership checks. The tracked raster is deleted,
ignored, generated when absent, and guarded by `git ls-files` so recommitting it fails.

This general risk outlives one file: self-hosted CI is macOS ARM64 while production builds on
Vercel Linux/Edge, so build-time raster bytes can diverge invisibly. The other exposed tracked
artifacts are listed, not changed:

- `apps/web/public/brand/logo-header.png`
- `apps/web/public/icons/icon-{32,64,120,152,192,512}.png`
- `apps/web/public/icons/apple-touch-icon.png`
- `apps/web/app/icon.png`
- `apps/web/app/apple-icon.png`
- `apps/web/public/favicon.ico`
- `apps/web/app/favicon.ico`

All twelve are regenerated by `apps/web/scripts/generate-icons.mjs` through Sharp/libvips in
predev and prebuild. The protected medallion is an exact SVG copy, service-worker version is
ignored deterministic text, and runtime data is copied with fingerprint validation rather than
rasterized.

## U4 320×568 retarget

The matrix remains **144 contexts before and after**: 2 engines × 9 viewports × 2 themes × 2
motion states × 2 routes. Strict-vertical-fit contexts move from **144 to 128**; the retained
320×568 descriptor accounts for **16 scroll-allowed contexts**. It keeps every non-fit gate:

- no horizontal overflow;
- all substantive content painted and human-reachable;
- a committed scroll interaction that makes all 3 home CTAs or all 5 mode cards plus dock
  action operable, and both disclosure lines readable, then restores document and nested
  scrollers;
- 44×44 minimum control targets;
- correct light/dark and reduced/no-preference motion state;
- zoom-preserving viewport metadata;
- zero page errors, mode collisions, or dock/disclosure overlap;
- normalized full-page screenshot evidence with semantic paint contribution.

Only `documentElement/body scrollHeight <= innerHeight`, initial-viewport target placement,
and initial-viewport disclosure placement are relaxed for 320. All descriptors at 360px and
above retain strict full-document vertical fit.

## U5 light-mode evidence only

U5 commits **18 normalized PNGs**: home, mode-select available, and squad review at 360×800,
390×844, and 430×932 in Chromium and WebKit. The manifest with file dimensions, byte counts,
and SHA-256 values is
`docs/reports/terrace-closeout-2026-07-15/light-mode/manifest.json`; engine receipts sit beside
their `screenshots/` directories. Chromium recorded 9/9 clean captures. WebKit's only console
entry is the local development server's report-only CSP diagnostic, not a page/runtime error.

Observed but deliberately not fixed: the 360px squad-review capture shows the fixed lower-left
`N` control overlapping the “Squad Warnings” copy. U5 is a camera, not a hand. The feature diff
changes **zero light-mode or Terrace-dark color values**.

## Architect-delegated decisions

1. **Treat circular byte/existence guards as ownership checks, not consumers.** No supported
   runtime reads the committed default-OG pixels before generation overwrites them. Build
   ownership and deletion remove the cross-platform drift class with less behavior change than
   pinning native rasterization across macOS and Linux.
2. **Make 320 screenshot evidence full-page.** A viewport-only image would omit the newly
   permitted below-fold disclosures. A normalized full-page capture preserves visual evidence
   without pretending that screenshot tooling proves reachability; the separate committed
   scroll-and-hit interaction supplies that proof.
3. **Use squad review for U5's delegated results surface.** It is a real downstream review state
   and exposes a concrete narrow-screen issue without mutating the intentionally deferred light
   palette or expanding this close-out into redesign.
4. **Keep the production signing secret Production-only.** Preview served-byte verification of
   the historical fixture is impossible under the existing fail-closed boot contract. Expanding
   the secret into Preview would be a deploy/environment change outside this lane and would
   weaken isolation. The exact real-fixture proof therefore runs immediately after the reviewed
   squash reaches Production, with auto-revert on failure.

## Validation run

Validation completed before exact-head review will be recorded here before merge. Evidence
already complete at report authoring:

- U0 evidence review: initial FAIL for three stale source line references; corrected receipt
  re-review **PASS**.
- U1 initial review: **FAIL** for mode-dock/disclosure overlap; fixed by responsive spacing and
  a geometric overlap gate. Fresh-context fix-forward review: **PASS** at `b9406df`, including
  144/144 matrix contexts, 64 independent >=360 accessibility/geometry contexts, exact legal
  text and link naming, 0px maximum overlap, and 25/25 focused tests.
- U2 independent fresh-context review: **PASS**; 38 focused positive/negative tests.
- U3 independent fresh-context review: **PASS**; absence generation and recommit guard.
- U4 initial review: **FAIL** because geometry alone could not prove user scrolling; fixed with
  a real scroll/read/hit/restore interaction. Fresh-context fix-forward review: **PASS** at
  `b9406df`, with 144/144 contexts, exactly 128 strict plus 16 retained scroll contexts, maximum
  dock/disclosure overlap 0px, 25/25 focused tests, root typecheck 9/9 tasks, and exact
  nested/window scroll restoration. Its independent negative probe made a geometry-valid CTA
  non-hit-testable and measured `geometryOnlyPasses:true`, `interactionPasses:false`, and
  `blockerWasHit:true`. Receipt:
  `/tmp/terrace-closeout-review-u4-fixforward-b9406df.md`, SHA-256
  `81b5812a8ec2b338ff6f12c3971dc03a6c640226bd4fb70fc9c061072e2a0d82`.
  Process note: because a fresh reviewer clone lacked workspace `dist` outputs, root typecheck
  transitively ran `@wcdraft/data:build` and its artifact-ensuring path in that disposable clone,
  including `build-compact-data`. This was not an explicit lane `build:compact` command, touched
  neither the implementation worktree nor the branch diff, and the reviewer checkout ended
  clean; it is nevertheless recorded because the dispatch prohibited data regeneration. The
  implementation base/head data trees remain byte-identical.
- U5 initial and post-normalization independent fresh-context reviews: **PASS**; 18
  evidence-only PNGs, exact manifest byte/dimension/SHA agreement, and zero product changes.
- Formatting: `pnpm run format:check` **PASS** after normalizing all three committed U5 JSON
  receipts.
- Forced root typecheck **9/9 tasks**, zero cached; forced root lint **6/6 tasks**, zero cached,
  zero warnings.
- Focused disclosure/device contracts: **25/25 tests PASS**; web typecheck **PASS**.
- Exact-unit full one-screen matrix: **144/144 PASS**, with 128 strict-fit and 16
  scroll-allowed contexts, all 16 scroll interaction proofs passing (5 targets on `/`, 8 on
  `/play`), and maximum dock/disclosure overlap 0px. Receipt:
  `/tmp/terrace-closeout-one-screen-final-unit/one-screen-fit.json`, SHA-256
  `8ea016dc48b18fcfd51308061735fa24b68eb2ad697d21df804c0d1991becfec`.
- Forced goldens, all with zero Turbo cache and no re-lock: core RNG/narrative **69/69**;
  draft **42/42**; compact data **59/59**; integration **22/22**; leaderboard **6/6**.
- Forced root build: **5/5 tasks**, zero cached, **40/40 pages**, and protected runtime-data
  traces **8/8** for both `/api/og/sign` and `/api/challenge/verify`. The two pre-existing
  webpack circular-chunk warnings remain; the build exited 0.
- Native app-feel: Chromium local-dev **4 contexts, 16 presses, 180 assertions, 0 failures**;
  WebKit local-production **4 contexts, 16 presses, 180 assertions, 0 failures**.
- Strict font/a11y browser audit: **60 surfaces, 44 targets, 0 failures**, with zero non-Archivo
  family, axe, target-size, thumb-reachability, or uppercase-role violations. Receipt:
  `/tmp/terrace-closeout-font-a11y-final.json`, SHA-256
  `795747f15060d6e12656e3b7164f98f581d45c147968073ee1fad53061bed608`.
- Post-gate Git proof: `packages/core`, `packages/data`, and `etl` tree objects are identical
  to base (`344ced76…`, `a9ca53a1…`, `f0c64a99…` respectively), and the worktree contains no
  tracked generated-artifact delta.
- The forced exact-unit root-test attempt completed the package/unit layers with core **423
  passed**, DB **161 passed**, data **183 passed + 9 expected skips**, marketing **69 passed**,
  mobile **7 passed**, and web **1,353 passed + 1 expected skip**; U2's real-envelope suite
  passed **38/38** and game flow passed. Its responsive-shell phase then timed out waiting for
  `Spin`/`Reveal choices` after **10m39s** while this lane's exact matrix, independent reviewer
  matrix, and CI browsers were competing on the same machine. An isolated rerun of that exact
  responsive-shell command passed **218/218**: 84 desktop-shell, 56 mobile-shell, 40
  interaction, 30 mode-setup, and 8 mobile-navigation metrics, all with zero failures. The
  initial combined `pnpm test` invocation therefore did not exit 0 and is not represented as a
  root-test PASS; final-head CI remains the authoritative full-envelope result.
- An earlier root envelope before the final U1/U4 gate strengthening passed typecheck **9/9
  tasks**, lint **6/6 tasks**, root tests **9/9 tasks**, game flow, responsive shell **218/218**,
  and embedded one-screen **144/144**. Exact-head validation and CI remain authoritative.
- CI at implementation head `b9406df` passed its static, contract, change-detection, golden,
  secrets, GitGuardian, and Vercel jobs. The aggregate verify job failed after **31m10s** when a
  WebKit tablet-landscape `/play` navigation timed out at `DOMContentLoaded`; the preceding 105
  one-screen contexts were green. That run overlapped the local forced root attempt and the
  independent browser matrix. It is recorded as a failure, not waived; final-head CI will run
  without local browser competition and must pass before merge.

## Not run at report authoring

- Real historical-fixture bytes on Preview: impossible because the signing secret is
  Production-only; post-merge Production is the required gate.
- Production health, live browser checks, Vercel READY observation, and branch hygiene: only
  valid after the reviewed squash merge.

## Risks and rollback

- U2 expands accepted signed-envelope versions on a read path. Its blast radius is bounded to
  already-authentic v1 values; exact-prefix parsing, versioned payload validation, constant-time
  HMAC verification, token binding, negative tests, and v2-only signing constrain it.
- One-screen disclosures deliberately spend recovered vertical budget. The strict matrix and
  dock-overlap check cover the registered browser geometries; future copy growth should fail the
  gate rather than silently hide legal text.
- Build-owned OG default bytes can still differ across platforms by design; the repository now
  stops making a false committed-byte claim. The twelve analogous icon artifacts remain a
  recorded carryover.
- Any failed production health, disclosure, historical OG, OG-health, or font-request check
  triggers immediate revert of the squash merge.

## Git status and human actions

The implementation worktree must be clean at the reviewed head before merge. There are no
irreducible human actions; all remaining review, CI, merge, deploy, live verification, rollback,
and hygiene gates are autonomous.
