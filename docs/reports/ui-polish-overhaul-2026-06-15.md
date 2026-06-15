# UI polish overhaul — local integration report

Branch: `ui-polish` from `origin/main` `ccb80a81b5ce90921ee181532dbe00b0f5fbec94`.

Status: **local implementation + validation evidence captured; not merged or deployed yet**.
RepoPrompt review was attempted first, but its active workspace was bound to BiotraxIQ and a later
rebind to `/tmp/wcdraft-ui-polish` failed with an MCP broken-pipe transport error. A separate
ephemeral Codex CLI process then performed the fresh-context independent review from this WCDraft
worktree and returned **PASS / no Yellow blockers**. Durable review artifact:
`docs/reports/ui-polish-overhaul-independent-review.md`.

## Task 0 — production board cleanup

Completed via Neon production branch `br-blue-heart-aqcejtyf`.

- Deleted leaderboard entries: `ranked_qeouuwt`, `memory_qeouuwt`, `casual_qeouuwt`,
  sibling `cas44a029af`, `rankbd996402`, `membd996402`, `cash1bd002d7`.
- Deleted only clearly synthetic backing rows: 3 test-only sessions and 3 test-only users.
- Re-select after deletion returned zero matching probe rows.
- Live API checks returned 200 with no probe rows for ranked Classic, ranked Memory,
  casual Classic, and casual Memory.

No production secrets were printed. Temp env/body files were removed after use.

## What changed

- Rebuilt the squad pitch as a thin vertical SVG backdrop matching the owner spec:
  `viewBox="0 0 100 150"`, rounded outer box, halfway line, center circle/spot,
  penalty boxes, and goal boxes.
- Kept formation coordinates sourced from `formations.json`; render-only overlap adjustment remains
  unchanged and the coordinate test pins it.
- Added compact national flags to locked starters, bench/subs, and manager via
  `MiniNationFlag`, which only resolves existing `/flags/*.svg` assets by `nation_id` and falls back
  to the runtime nation code.
- Rendered existing `computeSynergy(...).linked_pairs` on the pitch as presentation-only adjacency
  lines: neutral inactive mesh plus live `--accent` line for same-nation linked adjacent slots.
- Thinned the synergy surface into the existing compact aggregate strip; detailed line work now lives
  on the pitch.
- Compacted mobile route chrome, setup disclosure, share surface, and squad review. Squad review now
  fits the viewport by tightening the pitch, manager, bench, ratings, warnings, and simulate panel.
  Variable-length warning details stay accessible inside a small internal warning scroll surface.
- Added transform/opacity-only motion for route entry, slot settling, and live line ignition, with
  `prefers-reduced-motion: reduce` snapping animation state.
- Fixed axe findings from the post-implementation browser pass: low-contrast light-theme accent text
  now uses `--accent-text`, the manager slot is a labelled group instead of a nested complementary
  landmark, draft/review have real `h1` headings, and the compact warning scroller is keyboard
  focusable.

## Screenshots and measurements

Committed screenshot set: `docs/screenshots/ui-polish-overhaul/`.

- 72 screenshots: 18 surfaces × 2 viewports × 2 themes.
- Viewports: `390x844` and `360x800`.
- Themes: light and dark.
- Machine-readable measurements: `docs/reports/ui-polish-overhaul-local.json`.
- Post-a11y browser/axe proof for the changed draft/review surfaces:
  `docs/reports/ui-polish-overhaul-axe.json`.

Viewport-fit summary from the local JSON:

| Surface | Max document overflow | Status |
| --- | ---: | --- |
| home | 0 | fits |
| mode-select | 0 | fits |
| leaderboard | 0 | fits |
| history | 0 | fits |
| settings | 0 | fits |
| sign-in | 0 | fits |
| position-first-target | 0 | fits |
| setup-formation-lock | 0 | fits |
| spin-stage | 0 | fits |
| draft-lineup-initial | 0 | fits |
| draft-candidates | 0 | fits |
| draft-assign | 0 | fits |
| squad-review | 0 | fits |
| share | 0 | fits |
| attribution | 518 | permitted static/legal content |
| how-to-play | 2510 | permitted long static content |
| privacy | 3907 | permitted long static content |
| results | 630 | permitted long 8-match results content |

Squad-review proof after the final compact pass:

- `390x844`, light/dark: `documentScrollDelta=0`, `flags=17`, `idleSynergyLines=33`.
- `360x800`, light/dark: `documentScrollDelta=0`, `flags=17`, `idleSynergyLines=33`.

The deterministic auto-drafted screenshot fixture did not happen to produce a same-nation adjacent
pair (`liveSynergyLines=0`), so the live-line behavior is pinned by a render-level test that fills
two adjacent `4-3-3` slots from the same nation and asserts the `Pitch` paints `synergyLineLive`.

## Guard checks

- Changed tracked source files are limited to web UI/CSS/component/test files.
- No `formations.json`, schema, database, sim, rating, compact data, or synergy mechanic files were
  changed.
- Diff grep for hardcoded color literals found no `#...`, raw `rgb(`, `rgba(`, `hsl(`, or `hsla(`
  additions in changed source/report files.
- Lexicon/forbidden-term grep found no added `chemistry`, `FIFA`, crest, kit, logo, or face usage.
- New flag code uses bundled national flag assets only; no crests, kits, manufacturer logos, or
  player/manager faces.
- Motion guard: new animations are transform/opacity-only; reduced-motion rules disable slot/line
  animations and force live line opacity to the final state.
- Post-axe patch keeps the no-hardcoded-color rule: contrast fixes use the existing
  `--accent-text` token.

## Gates run

- `pnpm --filter @wcdraft/web typecheck` — PASS.
- `pnpm --filter @wcdraft/web lint` — PASS.
- `pnpm --filter @wcdraft/web exec vitest run lib/game/__tests__/pitch-markings.test.ts lib/game/__tests__/synergy-overlay.test.ts` — PASS, 2 files / 11 tests.
- `git diff --check` — PASS.
- Browser measurement/screenshot harness against `http://localhost:3002` — PASS for all
  non-permitted-scroll routes at both requested mobile viewports and both themes.
- Independent fresh-context Codex CLI review from `/tmp/wcdraft-ui-polish` — PASS, no Yellow
  blockers. It inspected the diff, verified path/color/lexicon guards, re-checked the axe and local
  measurement JSON with `jq`, confirmed screenshot/JSON parity and PNG dimensions, and re-ran the
  focused Pitch/Synergy Vitest gate.
- Post-fix Playwright + axe browser probe against `http://127.0.0.1:3018` — PASS:
  `draft-complete` and `review`, `390x844` and `360x800`, light and dark, 8/8 axe runs with zero
  violations, zero console/page errors, zero document overflow, `flags=17`, and one lit Synergy line
  from seed `wcdraft:ui-polish-browser:v1:6`.
- Reduced-motion browser proof — PASS: `prefers-reduced-motion: reduce` matched, live line animation
  name `none`, live line opacity `1`, slot animation name `none`.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — PASS:
  typecheck 8/8, lint 5/5, test 8/8, build 4/4. Test counts included core 366,
  data 73 passed / 7 skipped, db 79, marketing-x 64, web 694 passed / 1 skipped.
  Build emitted the existing Next/Webpack circular chunk warnings and the existing Edge-runtime
  static-generation warning.

CI, PR merge, deploy, and live production UI verification are still pending at this report point.

## Local browser noise

The measurement JSON recorded 18 local dev/browser errors:

- 4 hydration warnings from local JSON-LD nonce mismatch.
- 4 local 404 resource loads from `/leaderboard` in the local env.
- 8 local 503 API responses from auth/OG endpoints without local `DATABASE_URL`.
- 2 existing `LeaderboardPage` `performance.measure` negative-timestamp page errors.

These did not affect the route-fit measurements, but they should be separated from production
verification.

## Surface Inventory update

Add to the external Surface Inventory v6 successor:

- Squad pitch now uses a thin vertical SVG field, compact position-shaped nodes, provenance hue,
  national mini flags, and presentation-only synergy adjacency lines.
- Locked entities now expose mini national flags on starters, bench/subs, and manager.
- Synergy detail moved from chunky card to compact aggregate strip plus on-pitch lines.
- Mobile core loop now has committed 390×844 and 360×800 light/dark evidence for no document scroll.
- New UI motion is transform/opacity-only and reduced-motion-safe.

## Open status

- Independent fresh-context review: **PASS via ephemeral Codex CLI**. RepoPrompt remained unavailable
  because of workspace mismatch / broken-pipe on attempted rebind.
- Local axe on changed draft/review surfaces: **PASS** after a focused a11y fix-forward.
- Merge SHA / PR / deploy ID / live production verification / revert status: **not yet available**.
