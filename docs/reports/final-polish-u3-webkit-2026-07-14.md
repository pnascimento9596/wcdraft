# Final polish U3: WebKit native app-feel verification — 2026-07-14

## Outcome

U3 is implemented on `ws-ux/final-polish-u3-webkit` from
`e751639c2c5a4fc20d8c1ecee24708ff967e0235`, the U4 integration head that also contains U1 and U2.
The strict local pass used Playwright WebKit 26.5
against a production build and completed 4 iPhone-sized contexts, 16 press interactions, 4
boundary-scroll attempts, and 160 assertions with 0 failures.

This is real WebKit engine coverage, not a physical iPhone and not Mobile Safari. A short
physical-device Safari smoke remains an owner action after deployment. This report does not claim
that on-device smoke or production live verification; the branch is intentionally unmerged.

## Architect-delegated decisions

- Extend the repository's existing `verify-native-app-feel-browser.mts` probe and add a thin WebKit
  entry point rather than introduce a second Playwright test framework. Existing browser coverage
  in this repository is script-based and imports `playwright-core` directly.
- Install the WebKit revision declared by the checked-in `playwright-core` package through that
  package's CLI. This avoids accidentally using a different globally installed Playwright version.
- Playwright rejects `mouse.wheel` in a mobile-flagged WebKit context. The 16 press interactions and
  page contracts remain in mobile-flagged contexts. The boundary-scroll attempt runs in a sibling
  real-WebKit context at the exact same 390×844 or 360×800 CSS viewport with touch enabled. This
  verifies that the root shell does not move under an automated boundary input, but it does not
  pretend to reproduce physical iOS rubber-band physics.
- A production build served over loopback HTTP uses the real production CSP, including
  `upgrade-insecure-requests`. WebKit correctly upgraded its HTTP JS/CSS subresources to HTTPS,
  which an HTTP-only loopback server cannot answer. The harness therefore uses the repository's
  existing CSP report-only switch only for its local production server. The deployed HTTPS policy
  is not changed.

## Interaction matrix and assertions

The strict matrix covers both 390×844 and 360×800, in light and dark themes. Each context presses:

1. Home `PLAY DAILY`.
2. `/play` Daily mode card.
3. `/play` Classic mode card, whose CTA is `START DRAFTING`.
4. Mobile-nav `Play`.

Each of the 16 presses executes 8 assertions: transparent tap highlight through the before, active,
focused, and released frames; `touch-action: manipulation`; non-selectable control chrome; visible
active feedback by the next paint; no horizontal shift; unchanged active-frame layout metrics; no
viewport scroll through press/focus/release; and no horizontal overflow. That is 128 press
assertions.

Each of the 4 contexts adds 7 page assertions: `100svh` shell height, `overscroll-behavior: none`
on the shell/body/html, prose not carrying control selection suppression, successful range
selection of prose, and viewport metadata that does not disable zoom. The 4 boundary-scroll
attempts add one displacement assertion each. Total: `128 + 28 + 4 = 160`.

Final measured results:

| Contract                                           |               Result |
| -------------------------------------------------- | -------------------: |
| WebKit contexts                                    |           4/4 passed |
| Press interactions                                 |         16/16 passed |
| Transparent tap highlight                          |         16/16 passed |
| `touch-action: manipulation`                       |         16/16 passed |
| Non-selectable control chrome                      |         16/16 passed |
| Active feedback by next paint                      |         16/16 passed |
| Active-frame layout stable                         |         16/16 passed |
| Maximum horizontal shift                           |                 0 px |
| Viewport scroll stable through press/focus/release |         16/16 passed |
| Selectable prose and zoom allowed                  |  4/4 contexts passed |
| Automated boundary-scroll displacement             | 0 px in 4/4 attempts |
| Assertions                                         |       160/160 passed |

The same generalized probe also passed its Chromium compatibility run with 4 contexts, 16 presses,
160 assertions, and 0 failures.

## WebKit findings and fix

The first complete WebKit measurement produced 22 probe failures: 2 were fractional WebKit CSSOM
serialization (`843.999939px` for an 844px `100svh`), 16 were WebKit exposing
`-webkit-user-select` rather than the standard CSSOM property, and 4 were delayed mobile-nav active
feedback. The first two categories were probe portability issues and now use a 0.01px equality
tolerance and prefixed-property fallback.

The 4 mobile-nav findings were real. Within the momentum-scroll menu, WebKit matched `:active`
immediately but delayed the opacity paint by two frames because the global reduced-motion contract
sets a tiny nonzero transition duration. `.mobile-menu__link:active` now sets a zero transition
duration. The change is opacity-only, does not alter box metrics, and leaves prose selection and
page zoom untouched.

The probe also exposed two harness-specific differences that are now handled explicitly: local
production CSP resource upgrading and WebKit's unsupported mobile-context wheel API. Neither
resulted in a shipped security or scrolling change.

## Commands and validation

WebKit 26.5 was installed from the repository dependency with:

```sh
node apps/web/node_modules/playwright-core/cli.js install webkit
```

The final strict built-app command was:

```sh
WCDRAFT_NATIVE_APP_FEEL_PHASE=local-built \
WCDRAFT_NATIVE_APP_FEEL_STRICT=1 \
WCDRAFT_NATIVE_APP_FEEL_OUT_DIR=/tmp/wcdraft-final-polish-u3-webkit-evidence \
pnpm --filter @wcdraft/web verify:native-app-feel:webkit
```

Result:

```text
native-app-feel: engine=webkit target=local Next production phase=local-built contexts=4 presses=16 assertions=160 failures=0
```

A non-strict pre-merge run against the currently deployed production head completed all 160
assertions and recorded the expected pre-fix baseline: 158 passed and 2 failed. Both failures were
the mobile-nav active feedback check at 360×800 (light and dark). The 390×844 contexts happened to
paint within the one-frame budget. This is baseline evidence, not post-fix live verification.

Additional completed gates:

- Chromium compatibility probe: 4 contexts, 16 presses, 160/160 assertions passed.
- Focused tap-stability Vitest: 13/13 passed.
- Web typecheck and lint: passed.
- Generated-data determinism check: passed.
- Root typecheck: 9/9 tasks passed.
- Root lint: 6/6 tasks passed.
- Root build: 5/5 tasks passed; Next generated 40/40 pages and both runtime-data traces found 8/8
  current-schema files.

After rebasing onto the U4 integration head, the exact-head root aggregate passed 9/9 tasks: 2,160
package/unit tests passed with 10 expected skips (core 423, data 183 + 9 skipped, DB 161,
marketing 69, mobile 7, and web 1,317 + 1 skipped), followed by a passing game-flow run and the
218/218 responsive-shell result. The exact-head WebKit and Chromium probes both retained their
160/160 results after the integrated U1/U2/U4 changes. No unrelated game-flow source change is
included in U3.

CI now caches Chromium and WebKit together, installs both through the repository's exact
`playwright-core` CLI, builds the app, and runs this strict WebKit contract. CI configuration changes
also cause the repository's heavy-realism workflow policy to run through the existing CI routing.

## Risks, rollback, and residual

- CI downloads and caches one additional Playwright browser (the local WebKit archive was 77.2
  MiB). Rollback is isolated to the added CI install/cache/verification lines and package scripts.
- The app behavior change is one WebKit-motivated active-state transition-duration override on
  mobile-menu links. Rollback is a single CSS rule.
- Playwright WebKit is the closest automatable engine proxy available here, but it does not expose
  physical iPhone Safari toolbar behavior, rubber-band physics, haptics, or hardware touch latency.
  The irreducible residual is an owner smoke on a physical iPhone after deploy: press PLAY DAILY,
  START DRAFTING, and mobile-nav Play; verify no flash, bounce, focus jump, selection callout, or
  horizontal movement; then pinch-zoom prose.
- Production live verification is pending merge and Vercel READY. After deploy, run the committed
  WebKit pass with `WCDRAFT_NATIVE_APP_FEEL_BASE_URL=https://www.wcdraft.com` and strict mode.

## Scope

No draft, simulation, rating, synergy, token, auth, data, schema, or player-surface semantics were
changed. U1, U2, U4, and U5 paths are outside this unit.
