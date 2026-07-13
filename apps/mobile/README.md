# @wcdraft/mobile — Capacitor iOS shell (M1a)

Native **wrapper** around the shipped PWA at [wcdraft.com](https://www.wcdraft.com).
M1a stops at the free tooling boundary (Xcode + Simulator + Capacitor OSS).
App Store / paid Apple Developer Program work is **M1b** — see
`docs/reports/m1a-ios-native-scaffold/M1b-HANDOFF.md` after that report lands.

## Hybrid load model

`apps/web` is Next.js SSR (auth, leaderboard, CSP nonces). It is not a static
export, so the shell loads the **production origin** by default:

```ts
server.url = process.env.WCDRAFT_MOBILE_SERVER_URL ?? "https://www.wcdraft.com";
```

Offline parity uses the existing Season-1 service worker on that origin (atomic
lifecycle via `/sw-version.js`). A minimal `www/index.html` placeholder exists
only because Capacitor requires a `webDir` for sync bookkeeping.

## Scripts (root)

| Script              | Purpose                                             |
| ------------------- | --------------------------------------------------- |
| `pnpm mobile:sync`  | Prepare `www/` + `cap sync ios`                     |
| `pnpm mobile:build` | Prepare `www/` (native archive needs signing → M1b) |
| `pnpm mobile:open`  | Open the iOS project in Xcode                       |

## Local commands

```bash
pnpm install
pnpm --filter @wcdraft/mobile typecheck
pnpm --filter @wcdraft/mobile test
pnpm mobile:sync
pnpm mobile:open
```

Point at a local Next dev server (cleartext allowed only for localhost):

```bash
WCDRAFT_MOBILE_SERVER_URL=http://localhost:3000 pnpm mobile:sync
```

## Boundaries

- Does **not** touch `packages/core`, `packages/data`, `packages/db`, or game
  engine surfaces.
- No paid Apple Developer Program enrollment, provisioning, TestFlight, or
  App Store Connect steps in this package.
