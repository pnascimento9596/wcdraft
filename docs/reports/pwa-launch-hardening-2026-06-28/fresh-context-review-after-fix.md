The patch introduces user-visible regressions in the new narrative share/OG surfaces by exposing unlabeled core narrative text, and it can propagate an unverified OG payload into newly shared URLs. The focused tests and web typecheck pass, but these correctness issues should be fixed before shipping.

Full review comments:

- [P2] Refill share narrative with display labels — /private/tmp/wcdraft-pwa-launch-hardening-20260628/apps/web/lib/game/share-adapters.ts:156-156
  For any run whose selected narrative template uses label-only tokens such as the team name or scenario opponent, this now puts the persisted core narrative directly into the share view even though that text is generated without display labels; for example, a normal simulated run can render `Unavailable's tournament ... against WC2026-F4` in the share card and copied caption, while the results screen rebuilds the same narrative with labels before display. Build/refill the share narrative with the same display labels (loading the scenario for local runs as needed) before exposing it in `ShareView`.

- [P2] Refill signed OG narrative with display labels — /private/tmp/wcdraft-pwa-launch-hardening-20260628/apps/web/lib/game/run-og-server.ts:78-78
  When `/api/og/sign` signs a run token, the re-simulation also returns the unlabeled core narrative here, so signed large-card images for affected runs can display `Unavailable` and raw scenario IDs such as `WC2026-F4` even though the app has the scenario/game data needed to label them. Refill the narrative with display labels before building the signed OG model, otherwise the new narrative block regresses public unfurls for many normal runs.

- [P2] Verify incoming OG before re-emitting it — /private/tmp/wcdraft-pwa-launch-hardening-20260628/apps/web/components/game/share-screen.tsx:377-379
  If a share page is opened with a forged `og=` value whose unsigned payload merely contains the current run's `token_hash`, this branch marks it as ready and re-emits it in copied/native/social share URLs without ever verifying the HMAC; `/api/og/run` will later reject that URL and fall back to the default preview while the UI says the signed preview is ready. Treat the incoming value as reusable only after server verification, or fall back to `/api/og/sign` instead of relying on the unsigned hash peek.
