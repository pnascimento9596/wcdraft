# Service worker · Capacitor coexistence (M1a)

## Decision (architect-delegated)

**Keep the Season-1 service worker registered inside the native shell.**

| Mode                                                             | SW policy              | Why                                                                                                                  |
| ---------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Capacitor `server.url` → `https://www.wcdraft.com` (M1a default) | **register-as-pwa**    | Same origin as the installable PWA. Atomic lifecycle (`/sw.js` + `/sw-version.js`) remains the single offline owner. |
| Local `file://` / pure `webDir` bundle (not used in M1a)         | **disable-local-file** | Avoid double-managing static assets with Capacitor’s copy step.                                                      |

Encoded in `apps/web/components/sw-register.tsx` as
`serviceWorkerNativeShellPolicy({ usesRemoteServerUrl })`. Registration timing
is unchanged for production browsers and the hybrid native container.

## Offline cold launch

1. First launch requires network to load the remote origin and install the SW.
2. After install, the SW precaches compact runtime data and network-first
   navigations fall back to the shell cache — same as the PWA.
3. A cold launch with **no** prior cache and **no** network shows the remote
   load failure (or the local `www` placeholder if `server.url` is unset), not
   a fabricated offline app. Honest state.

## What we do not do

- No second SW registration path owned by Capacitor.
- No push / background-fetch (paid / out of M1a scope).
- No disabling SW “just because native” — that would regress offline parity.
