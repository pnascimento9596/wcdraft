# Frontend Polish Wave 2 - R4 user-facing prose em-dash classification

## Outcome

Implemented the collision-safe prose sweep on `ws-ux/prose-em-dash-r4` from Gate 0 base `2add71b2e5daf0e7305350e8144b9860e8cb67c2`. Eleven U+2014 occurrences were rewritten across landing, mode selection, contact, how-to-play, metadata/manifest, the site-header accessibility label, and the magic-link interstitial. A TypeScript-AST guard now rejects every new em dash in the cleaned prose surfaces; legitimate honest-state null tokens remain protected on the explicitly deferred surfaces.

The scan is deliberately syntax-aware. It classifies string literals, template fragments, and JSX text in shipped TS/TSX source; comments are not user-facing copy. Non-code assets were scanned separately. En dashes such as `1930–2026` were not matched or changed.

## Collision check

No R4 file appears in `git diff --name-only origin/main...origin/season/squad-depth`. Even so, the dispatch explicitly reserves Draft, setup, Review, Results, Share, and team-sheet copy for Season 2 S5/S6. Those occurrences are classified below and left unchanged. `STATE.md` remains deferred because it is on the active Season 2 denylist.

## Rewritten prose occurrences

Line references identify the original occurrence; each row is one U+2014 decision.

| Original occurrence                                                              | Decision and replacement                                                                       |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `app/page.tsx:92` `One shared draft for everyone today — a new one drops daily.` | Rewrite as two sentences.                                                                      |
| `app/play/page.tsx:7` `Pick a wcdraft game mode — start...`                      | Rewrite as `Pick a wcdraft game mode. Start...`.                                               |
| `app/play/page.tsx:17` `Seventeen spins, one all-time XI — live...`              | Rewrite as `Seventeen spins, one all-time XI. Play live...`; preserve the `1930–2026` en dash. |
| `app/contact/page.tsx:15` `press — here’s how...`                                | Rewrite with a colon.                                                                          |
| `app/how-to-play/page.tsx:211` `reference drafts” — your score...`               | End the quoted sentence and start `Your score is placed...`.                                   |
| `app/manifest.ts:5` `wcdraft — World Cup draft game`                             | Use a colon in app metadata.                                                                   |
| `components/game/mode-select.tsx:42` `today — a new one...`                      | Rewrite as two sentences.                                                                      |
| `components/site-header.tsx:53` `wcdraft — home`                                 | Rewrite the accessibility label as `wcdraft home`.                                             |
| `lib/auth/verify-flow.ts:104` `close this page — no account...`                  | Rewrite as two sentences.                                                                      |
| `lib/site-metadata.ts:1` `wcdraft — draft...`                                    | Use a colon in the site title.                                                                 |
| `lib/site-metadata.ts:3` `full 2026 bracket — free...`                           | Rewrite as two sentences.                                                                      |

The actual rewrite count is 11 U+2014 code points. The HTML entity in `here&rsquo;s`, curly quotation marks, and numeric en dashes remain unchanged.

## Protected honest-state and functional placeholders

Every listed occurrence remains unchanged. Unless stated otherwise, each line contains one exact `—` null token. Multiple line numbers in a row are separate classified occurrences.

| File and occurrence lines after rewrite                                                                     | Decision                                                |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `app/account/account-client.tsx:183,625,675,683`                                                            | Preserve exact null placeholders.                       |
| `app/account/account-client.tsx:660`                                                                        | Preserve `Squad summary —` empty-state token.           |
| `components/game/candidate-card.tsx:43,143,179,187,249,350`                                                 | Preserve unknown rating/provenance display tokens.      |
| `components/game/draft-screen/index.tsx:1031`                                                               | Preserve hidden/unknown display token.                  |
| `components/game/local-progress-band.tsx:65,100` (placeholder occurrence); `lib/game/local-progress.ts:136` | Preserve unknown streak/record/best-score tokens.       |
| `components/game/pitch.tsx:223`                                                                             | Preserve functional `— empty slot` accessibility token. |
| `components/game/results-screen.tsx:374`                                                                    | Preserve `Daily field: —` honest-state placeholder.     |
| `components/game/results-screen.tsx:701`                                                                    | Preserve exact unknown result token.                    |
| `components/game/share-screen.tsx:1102,1134,1351,1585`                                                      | Preserve exact unknown share-card/result tokens.        |
| `components/game/slot-machine.tsx:182,240,244,249`                                                          | Preserve unrevealed spin tokens.                        |
| `components/game/squad-header-flag.tsx:40`                                                                  | Preserve missing flag/name token.                       |
| `components/game/synergy-bar.tsx:103,149,155,166`                                                           | Preserve hidden/unknown Synergy tokens.                 |
| `components/leaderboard/board-views.tsx:239,240,394`                                                        | Preserve unknown rank/score/card tokens.                |
| `lib/account/run-format.ts:10,11,12`                                                                        | Preserve null W-D-L tokens.                             |
| `lib/account/runs.ts:188,190,199,212,277,282,287`                                                           | Preserve missing run-summary values.                    |
| `lib/game/display-names.ts:26,31`                                                                           | Preserve missing display names.                         |
| `lib/game/memory-reveal-model.ts:54`                                                                        | Preserve missing nation code.                           |
| `lib/game/results-adapters.ts:132`                                                                          | Preserve absent summary token.                          |
| `lib/game/run-og-image.tsx:481` (two occurrences), `580`                                                    | Preserve OG unknown-value tokens.                       |
| `lib/game/server-history-provider.ts:220,222,223,232`                                                       | Preserve missing historical summary values.             |
| `lib/game/slot-reveal.ts:155`                                                                               | Preserve unrevealed value token.                        |
| `lib/game/view-models.ts:288,294`                                                                           | Preserve unknown view-model values.                     |
| `lib/leaderboard/board-view.ts:69,71`                                                                       | Preserve unknown relative-time values.                  |

## Season 2 and player-surface deferrals

Every occurrence below is prose, but editing it would violate the dispatch boundary. Each line is an explicit `Season-2-deferred` decision, not a missed rewrite.

| File                                            | Deferred occurrence lines after rewrite                        |
| ----------------------------------------------- | -------------------------------------------------------------- |
| `app/play/review/page.tsx`                      | 9                                                              |
| `app/play/share/page.tsx`                       | 23                                                             |
| `components/game/candidate-card.tsx`            | 131, 324, 355, 360                                             |
| `components/game/draft-screen/constants.ts`     | 9                                                              |
| `components/game/draft-screen/index.tsx`        | 521, 682, 761, 768, 778, 866, 903, 940, 1048, 1141             |
| `components/game/draft-screen/setup.tsx`        | 136, 195, 340, 373, 378                                        |
| `components/game/local-progress-band.tsx`       | 100 (prose occurrence), 118; shared with Draft/Results         |
| `components/game/manager-slot.tsx`              | 47, 49, 50, 72, 77, 86                                         |
| `components/game/memory-reveal.tsx`             | 70                                                             |
| `components/game/pitch.tsx`                     | 222; team-sheet accessibility label                            |
| `components/game/results-screen.tsx`            | 106, 120, 153, 587                                             |
| `components/game/review-screen.tsx`             | 70, 91, 286, 340, 578, 626                                     |
| `components/game/share-screen.tsx`              | 90, 104, 136, 633, 659, 687, 868, 957, 1148, 1183, 1375        |
| `components/game/slot-machine.tsx`              | 127                                                            |
| `components/game/synergy-bar.tsx`               | 112                                                            |
| `components/leaderboard/submit-panel-views.tsx` | 246, 262; result-submission surface owned with Results copy    |
| `lib/game/config-badges.ts`                     | 85                                                             |
| `lib/game/errors.ts`                            | 174, 182, 189; player recovery copy shared by reserved screens |
| `lib/game/local-progress.ts`                    | 20; shared label consumed by Results and Share adapters        |
| `lib/game/reference-standing.ts`                | 29; shared player-surface explainer                            |
| `lib/game/results-adapters.ts`                  | 486, 487, 488, 491, 492, 493, 494, 495, 497                    |
| `lib/game/run-og-image.tsx`                     | 359; OG/game-share art copy                                    |
| `lib/game/share-adapters.ts`                    | 305, 315, 323; shared Share caption copy                       |
| `lib/game/slot-reveal.ts`                       | 92                                                             |
| `lib/leaderboard/submit-copy.ts`                | 45, 61, 98; result-submission copy                             |

## Data, code, diagnostics, comments, tests, and explicitly excluded assets

| Occurrence                                                                             | Decision                                                                                                      |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `lib/game/errors.ts:31`                                                                | Code-generated diagnostic delimiter, not prose copy.                                                          |
| `lib/game/formation-layout.ts:155`                                                     | Developer error text identifying malformed JSON, not user-facing prose.                                       |
| `lib/leaderboard/ranked-attempts.ts:98`                                                | Server diagnostic log, not user-facing prose.                                                                 |
| `lib/leaderboard/submit-rate-limiter-db.ts:98`                                         | Server diagnostic log, not user-facing prose.                                                                 |
| `lib/leaderboard/submit-route.ts:97`                                                   | Server diagnostic log, not user-facing prose.                                                                 |
| `public/og/share-default.svg:1`                                                        | OG-card art is explicitly out of scope.                                                                       |
| `public/flags/README.md:6,29`                                                          | Repository documentation, not shipped prose UI.                                                               |
| CSS, `next.config.mjs`, `public/sw.js`                                                 | All matches are comments or the quoted null token in a comment. No CSS `content` value contains U+2014 prose. |
| `scripts/**`, `**/__tests__/**`, leaderboard golden fixture                            | Test names, fixtures, generator comments, and evidence only; not production prose.                            |
| player/team/config/seed/token data and `packages/core`, `packages/data`, `packages/db` | Hard-excluded and untouched.                                                                                  |

## Guard and grep proof

`prose-em-dash.test.ts` parses the nine cleaned TS/TSX surfaces with the TypeScript AST and fails on every U+2014 inside string/template/JSX nodes. Those cleaned surfaces contain no legitimate null-placeholder token, so the guard does not need an exception that could also hide a rendered separator. Mutation cases cover template expressions, JSX expressions, and `&mdash;`. Comments are intentionally outside the guard.

Post-edit AST inventory reports 145 remaining production-string occurrences. This report classifies all 145 as protected placeholders, Season 2/player-surface deferrals, or non-user-facing code diagnostics. The cleaned-surface guard reports zero prose violations. The numeric range `1930–2026` remains unchanged.

## Validation

- focused prose/local-progress/reference-standing tests: 4 files, 31/31 passed;
- full web Vitest: 112 files passed, 1 skipped; 1,169 tests passed, 1 skipped;
- full game-flow Playwright: passed across mode select, setup, draft, review, results, and share;
- strict responsive shell: 218 metrics, 0 failures (desktop 84, mobile 56, interaction targets 40, mode/setup 30, mobile navigation 8);
- web typecheck: passed after building the Core, Data, and DB workspace dependencies;
- web lint: passed with zero warnings allowed;
- web production build: passed, 40/40 static pages generated; existing Webpack circular-chunk and Edge Runtime warnings remained non-fatal;
- Prettier and `git diff --check`: passed.

The first direct focused run failed before tests because Core/Data package outputs had not been built in the fresh worktree. After building those dependencies, two expected copy assertions failed and revealed that the proposed daily-progress edits flowed into Results/Share contracts. Those four edits were reverted and classified as Season 2 deferrals. A later direct typecheck similarly required the DB build output. The final commands above all passed; the precondition and boundary failures are not represented as product regressions or hidden from this record.

## Risks and rollback

Copy changes can affect snapshot/source-contract tests even when runtime behavior is unchanged, so focused and full web validation are required before merge. Rollback is a normal PR revert. No schema, engine, data, token, native, or responsive-harness contract changed.
