The patch mostly validates and typechecks, but it can propagate an unverified or mismatched incoming signed OG parameter into newly generated share URLs, breaking large-card unfurls in that scenario. That should be fixed before treating the change as correct.

Review comment:

- [P2] Revalidate incoming OG signatures before reuse — /private/tmp/wcdraft-pwa-launch-hardening-20260628/apps/web/components/game/share-screen.tsx:327-329
  When a share page is opened with an `og` query param that is stale or belongs to a different run token, this early return treats it as ready based only on `isLikelySignedRunOg`; the generated share URL later pairs that same value with the freshly encoded `shareLink.token`, and `/api/og/run` will reject the token_hash/version mismatch and fall back to the default preview while the UI says the signed preview is ready. Reuse the incoming value only after confirming it matches the token being emitted, or fall back to `/api/og/sign`.
