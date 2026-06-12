# Post-season wrap validation — 2026-06-12

Branch: `ws-wrap/post-season`
Base: `origin/main` `a0d0828612f6103ea37e310aa76389e4ead28a3e`
Local target: production build served at `http://localhost:3019`

## Service worker

Diagnosis: registration code existed and was included from the root layout, but
`ServiceWorkerRegister` only attached a `window.load` listener from a client
effect. In production, hydration/effect execution can happen after the `load`
event has already fired, which leaves a clean page with no registration even
though `/sw.js` and `/sw-version.js` are valid.

Fix: compute a registration plan from `document.readyState`. Production pages
with service-worker support register immediately after `load`, and only wait
for `load` while the document is still loading. The registration still uses
`updateViaCache: "none"` so `/sw-version.js` stays the per-deploy update
handshake.

Local production-build browser probe (`local-browser-probe.json`):

- `serviceWorkerSupported`: `true`
- `registrationScope`: `http://localhost:3019/`
- `activeScriptURL`: `http://localhost:3019/sw.js`
- `updateViaCache`: `none`
- `controllerPresent`: `true`
- manifest present: `manifest.webmanifest`, display `standalone`, icons
  `192x192`, `512x512`, and maskable `512x512`
- version config loaded from `/sw-version.js`:
  `runtime-data-2.0.0`, `data_revision` `ad009e280c8fdd70`,
  cache names `wcdraft-data-d:2b0f6f3a11ca73ff-b:ad009e280c8fdd70` and
  `wcdraft-shell-d:2b0f6f3a11ca73ff`
- stale-cache probe: seeded `wcdraft-shell-stale-test` and
  `wcdraft-data-stale-test`; activation reported `oldCachesEvicted: true`
- console errors: none

## Config badges

The replay token used for browser proof is a non-default `t2` token with
`era_preset: modern` and `draft_flow: position_first`. Browser probes read the
rendered badge row on both results and share surfaces:

- Results, both themes and both viewport sizes: `2018-2026`, `Position First`
- Share, both themes and both viewport sizes: `2018-2026`, `Position First`

Default-config coverage is in `apps/web/lib/game/__tests__/config-badges.test.ts`:
default `t2` and legacy `t1` tokens render no badges.

## Lock-bar copy

The locked-target fixture uses `target_slot_id: "4-3-3.GK"`. Browser probes read
the rendered lock-bar copy in both themes and both viewport sizes:

`Locked target: GK XI (4-3-3.GK). Select a player for this slot.`

The 360px screenshots were visually checked after the wrapping fix; the target
copy is no longer ellipsized.

## Screenshots

- `results-light-390x844.png`
- `share-light-390x844.png`
- `lockbar-light-390x844.png`
- `results-dark-390x844.png`
- `share-dark-390x844.png`
- `lockbar-dark-390x844.png`
- `results-light-360x800.png`
- `share-light-360x800.png`
- `lockbar-light-360x800.png`
- `results-dark-360x800.png`
- `share-dark-360x800.png`
- `lockbar-dark-360x800.png`

## Doc grep

Ran:

```bash
rg -n "engine-2026\\.06\\.09|engine-2026\\.06\\.11|runtime-data-1\\.|runtime-data-2\\.0\\.0|legend 302|302 legend|19 gate tests|19 tests|a0d0828|ac91db8|1552e44|service worker|Service worker|SW" STATE.md docs README.md apps packages
```

Corrections were made in `STATE.md` plus dated addenda in the draft-config and
merit-v3 reports. Historical plans/reports that intentionally describe prior
season anchors were left intact. No `19 gate tests` / `19 tests` stale prose was
found by the grep.
