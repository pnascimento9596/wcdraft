# Cookie, OG signing, and Resend secret rotation

Never print secret values, pass them as CLI arguments, commit them, or place them in a PR/log. Vercel environment changes apply to a subsequent deployment; they do not mutate an already-built deployment.

## Inventory and classify

```bash
set -euo pipefail
vercel env ls production --scope pnascimento9596s-projects --cwd apps/web
curl --fail-with-body -sS https://www.wcdraft.com/api/health | jq .
curl --fail-with-body -sS https://www.wcdraft.com/api/og/health | jq .
```

- `AUTH_COOKIE_SECRET`: rotating the current single-key implementation invalidates existing sessions and CSRF state.
- `WCDRAFT_OG_SIGNING_SECRET`: rotating the current single-key implementation invalidates previously signed OG requests.
- `RESEND_API_KEY`: keep the old provider key active until the new deployment sends successfully, then revoke it at Resend.

## Planned zero-downtime design

Before a planned cookie or OG rotation, ship dual verification support:

1. Add a server-only `*_PREVIOUS` variable.
2. Sign/mint with the new primary only.
3. Verify with primary first, then previous using the same constant-time comparison rules.
4. Emit only a key-slot label (`primary` or `previous`) in metrics; never key material.
5. Keep the previous key for at least the maximum accepted artifact lifetime (session TTL for cookies; accepted signed-OG lifetime for OG).
6. Remove previous-key verification in a separately reviewed deploy after the window expires.

The repository does not currently implement the `*_PREVIOUS` variables. Do not claim a dual-key window until that code and its negative tests ship.

## Emergency single-key rotation

Read new values silently, update Vercel from stdin, and unset the shell variables after use:

```bash
set -euo pipefail
read -r -s -p 'New cookie secret: ' NEW_COOKIE_SECRET; printf '\n'
printf '%s' "$NEW_COOKIE_SECRET" \
  | vercel env update AUTH_COOKIE_SECRET production --sensitive --yes \
      --scope pnascimento9596s-projects --cwd apps/web
unset NEW_COOKIE_SECRET

read -r -s -p 'New OG signing secret: ' NEW_OG_SECRET; printf '\n'
printf '%s' "$NEW_OG_SECRET" \
  | vercel env update WCDRAFT_OG_SIGNING_SECRET production --sensitive --yes \
      --scope pnascimento9596s-projects --cwd apps/web
unset NEW_OG_SECRET
```

For Resend, create a new key in Resend first, then:

```bash
read -r -s -p 'New Resend API key: ' NEW_RESEND_KEY; printf '\n'
printf '%s' "$NEW_RESEND_KEY" \
  | vercel env update RESEND_API_KEY production --sensitive --yes \
      --scope pnascimento9596s-projects --cwd apps/web
unset NEW_RESEND_KEY
```

Vercel's supported stdin update flow is documented at <https://vercel.com/docs/cli/env>.

## Deploy and verify

Create/redeploy a production build so it receives the new values. Do not paste values into `--value`.

```bash
vercel redeploy '<current-production-deployment-id-or-url>' \
  --scope pnascimento9596s-projects
curl --fail-with-body -sS https://www.wcdraft.com/api/health | jq -e '.ok == true'
curl --fail-with-body -sS https://www.wcdraft.com/api/og/health | jq -e '.ok == true'
```

Then verify sign-in/session creation, CSRF-protected mutation, one signed OG render, and one Resend delivery to an operator-controlled address. Revoke the old Resend key only after delivery succeeds.

## Rollback

- With dual verification shipped: promote previous to primary and redeploy; keep the compromised key out of both slots.
- Emergency cookie/OG rotation: rolling code back does not restore the prior secret. Re-add the prior value only if it is known not to be compromised; otherwise fix forward and accept session/link invalidation.
- Resend: if the new key fails and the old key is still active, restore the old Vercel value from the secret store and redeploy. Never recover it from logs.
