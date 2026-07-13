# M1a iOS native scaffold — lane report

**Date:** 2026-07-12  
**Orchestrator/implementer:** Grok 4.5 (lane P)  
**Cross-model reviewer (P1):** GLM 5.2 only (`ollama glm-5.2:cloud`) — Grok fallback void by owner clarification  
**Baseline:** `origin/main` `0955b1f9424f0be1c8ce5d2001155048607eeb67`

## Gate 0 — toolchain (honest)

| Probe | Result |
| --- | --- |
| Xcode | 26.6 (Build 17F113) — present |
| iOS Simulator SDK | iphonesimulator26.5 — present |
| iOS Simulator runtime | **Installed free during lane:** iOS 26.5 (23F77) arm64 (~8.5 GB) |
| Devices used | iPhone 17, iPhone SE (3rd gen) |
| CocoaPods | **Absent** — Capacitor 8 SPM used instead (free) |
| Node / pnpm | v22.22.3 / 11.5.1 |
| Runner `wcdraft-m4` | Online; shared with Season 2 / UX queue (contention) |
| Disk | Host was ~13 GiB free at start; runtime install + CI contended for free space |

## Units

### P1 — Capacitor workspace (PR #256)
- SHA: `cc1f06e2c57a915b7f5937d07deec263c2500fd5`
- Hybrid `server.url = https://www.wcdraft.com` (Next SSR — not static export)
- Root scripts `mobile:sync` / `mobile:build` / `mobile:open`
- Fresh-context review: **PASS**
- GLM 5.2 cross-model: **PASS** (warnings only; icons deferred to P3)
- CI: in shared-runner queue; static/format passed; db job failed once on host disk exhaustion (not code); typecheck/realism still queued behind other PRs

### P2 — Shell correctness (branch `ws-mobile/m1a-p2-shell`)
- SHA: `6a3312eda04cf330805b58ad6809c6d0989c997f`
- Portrait lock + status bar light content
- `viewport-fit=cover`, masthead/shell safe-area insets
- SW coexistence: keep Season-1 SW for hybrid remote load (documented + unit tests)

### P3 — Icon/splash pipeline (branch `ws-mobile/m1a-p3-icons`)
- SHA: `596f2cb4ac7bbfe31cf4420000e97b8c74a9e03c`
- Generator from `medallion-badge-master.webp` (1087px ceiling)
- Opaque 1024 RGB PNG (no alpha) — store-format validated
- Mobile tests: 6/6 pass

### P4 — Simulator smoke (evidence in this report)
- **BUILD SUCCEEDED** for Debug-iphonesimulator (`com.wcdraft.app`)
- Real screenshots under `screenshots/`:
  - `iphone17-app-clean.png` — production home shell
  - `iphone-se-shell.png` — SE production home shell (light theme)
  - `iphone17-launch.png` / `iphone-se-launch.png` — dark splash launch frames

## Capability matrix

| Capability | M1a status |
| --- | --- |
| Capacitor OSS iOS project | **Works** |
| Xcode project open / sync | **Works** (`pnpm mobile:sync`, `mobile:open`) |
| Free iOS Simulator debug build | **Works** |
| Hybrid load of production PWA | **Works** (screenshots) |
| Safe-area / portrait / status bar config | **Works** (code + smoke) |
| Medallion app icon + splash pipeline | **Works** (opaque 1024) |
| Offline shell after first online visit | **Same as PWA SW** (hybrid origin) |
| Free personal-team on-device ≤7 days | **Not attempted** this lane (optional free; not required) |
| Physical device beyond free 7-day | **BLOCKED [PAID]** |
| Push / APNs | **BLOCKED [PAID]** + out of scope |
| TestFlight | **BLOCKED [PAID]** |
| App Store Connect / submission | **BLOCKED [PAID/MANUAL]** |

## Architect-delegated decisions
1. Hybrid production URL (not static export) because Next SSR + auth/leaderboard APIs.
2. Capacitor 8 SPM instead of CocoaPods (pods not installed; SPM free).
3. Keep SW registration inside native WKWebView when loading remote origin.
4. Free iOS 26.5 runtime download (~8.5 GB) as $0 host setup.

## M1b
See `M1b-HANDOFF.md` — **$99 Apple Developer Program required to proceed past this lane.**

## Risks / carryovers
- Shared self-hosted runner queue + disk pressure caused CI delay / one db setup failure (disk).
- `package.json` / `pnpm-lock` / `turbo.json` / `ci.yml` on P1 trip `core_data` + `ci_config` → heavy gates on first merge (expected; mobile-only later stays off realism_inputs).
- Turbo task names `mobile:sync` vs package script `sync` mismatch (non-blocking; root pnpm scripts work).
- Springboard icon screenshot not cleanly captured (home gesture unreliable in automation); icon validated via asset catalog + opaque format checks.
