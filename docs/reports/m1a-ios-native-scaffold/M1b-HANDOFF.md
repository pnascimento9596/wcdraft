# M1b handoff — App Store path (owner, paid)

**M1a stops here.** Everything below requires the **Apple Developer Program ($99/yr)**
and/or manual Apple-account work. Do **not** execute these from an agent lane
without owner authorization and payment.

Prerequisite (already done in M1a, free):

- Capacitor iOS project at `apps/mobile`
- Hybrid load of `https://www.wcdraft.com`
- Medallion app icon (opaque 1024 PNG) + splash assets
- Scripts: `pnpm mobile:sync`, `pnpm mobile:build`, `pnpm mobile:open`
- Simulator smoke validated on free tooling

---

## Ordered steps (execute top → bottom)

### 1. Apple Developer Program enrollment — **[PAID] $99/yr**

- Enroll at https://developer.apple.com/programs/
- Accept agreements; wait for enrollment to become Active.
- **Repo support:** none (account-side only).

### 2. Create signing certificate + App ID — **[MANUAL/APPLE-ID]**

- In Apple Developer portal → Certificates, Identifiers & Profiles:
  - Register App ID: `com.wcdraft.app` (matches `apps/mobile/capacitor.config.ts` `appId`).
  - Create Apple Distribution certificate (or let Xcode Automatic manage).
  - Create App Store provisioning profile for `com.wcdraft.app`.
- **Repo support:** open Xcode via `pnpm mobile:open` → Signing & Capabilities → Team.

### 3. App Store Connect app record — **[MANUAL]**

- Create new app: name **wcdraft**, bundle id `com.wcdraft.app`, primary language, SKU.
- **Repo support:** none.

### 4. Bundle-id registration confirmation — **[MANUAL]**

- Confirm portal App ID and Connect record use exact `com.wcdraft.app`.
- **Repo support:** `apps/mobile/capacitor.config.ts` / Xcode `PRODUCT_BUNDLE_IDENTIFIER`.

### 5. Archive + upload build (TestFlight) — **[PAID-tier]** (requires Active membership)

```bash
pnpm mobile:sync
pnpm mobile:open
# Xcode: Product → Archive → Distribute App → App Store Connect
```

- Or CLI once signing identity exists:
  - `xcodebuild -scheme App -configuration Release -archivePath build/wcdraft.xcarchive archive`
  - `xcodebuild -exportArchive …` with exportOptions for app-store.
- **Repo support:** `pnpm mobile:build` prepares webDir/assets; archive/signing is Xcode + paid team.

### 6. Privacy nutrition labels + export compliance — **[MANUAL]**

- Answer App Privacy questionnaire (data collected: auth email/username if leaderboard/account used; no tracking SDK in M1a shell).
- Export compliance: typically standard HTTPS-only encryption → “No” for proprietary crypto (confirm current year questionnaire).
- **Repo support:** document any new native plugins that change privacy surface before answering.

### 7. Screenshots + metadata — **[MANUAL]**

- Store listing screenshots (use M1a simulator captures under
  `docs/reports/m1a-ios-native-scaffold/screenshots/` as drafts; regenerate at
  required device sizes for Connect).
- Description, keywords, support URL (wcdraft.com), marketing URL, age rating.
- **Repo support:** design identity tokens (emerald/gold, medallion) already in app icon.

### 8. TestFlight internal/external testing — **[PAID-tier]**

- Process build in Connect; invite testers.
- **Repo support:** none beyond producing archives.

### 9. App Review submission — **[MANUAL]**

- Submit for review with demo notes (public PWA behavior; hybrid wrapper).
- **Repo support:** none.

### 10. Release — **[MANUAL]**

- Manual or automatic release after approval.

---

## Explicitly blocked until paid program

| Capability                                              | Status                                             |
| ------------------------------------------------------- | -------------------------------------------------- |
| Physical device install beyond free 7-day personal team | **BLOCKED [PAID]**                                 |
| Push notifications (APNs)                               | **BLOCKED [PAID]** + out of M1a product scope      |
| TestFlight                                              | **BLOCKED [PAID]**                                 |
| App Store Connect entries                               | **BLOCKED [MANUAL/PAID]**                          |
| App Store submission                                    | **BLOCKED [MANUAL/PAID]**                          |
| Paid CI macOS / codemagic / etc.                        | **Out of scope** (self-hosted free runner remains) |

---

## $99 Apple Developer Program required to proceed past this lane

No further agent work can ship a public iOS binary without step 1.
