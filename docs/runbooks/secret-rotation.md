# Cookie, OG signing, and Resend secret rotation

Never print secret values, pass them as CLI arguments, commit them, or place them in a PR/log. Vercel environment changes apply to a subsequent deployment; they do not mutate an already-built deployment.

## Inventory and classify

Before changing a value, export the exact READY production deployment ID or
URL as `PRE_ROTATION_DEPLOYMENT`. It is the rebuild source if the rotation must
be reversed; do not try to recover it after an incident from shell history.

```bash
set -euo pipefail
vercel env ls production --scope pnascimento9596s-projects --cwd apps/web
test -n "${PRE_ROTATION_DEPLOYMENT:-}"
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
set +x
clear_rotation_secrets() {
  unset NEW_COOKIE_SECRET NEW_OG_SECRET
}
trap clear_rotation_secrets EXIT HUP INT TERM
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
trap - EXIT HUP INT TERM
```

For Resend, create a new key in Resend first, then:

```bash
set -euo pipefail
set +x
clear_resend_secret() {
  unset NEW_RESEND_KEY
}
trap clear_resend_secret EXIT HUP INT TERM
read -r -s -p 'New Resend API key: ' NEW_RESEND_KEY; printf '\n'
printf '%s' "$NEW_RESEND_KEY" \
  | vercel env update RESEND_API_KEY production --sensitive --yes \
      --scope pnascimento9596s-projects --cwd apps/web
unset NEW_RESEND_KEY
trap - EXIT HUP INT TERM
```

Vercel's supported stdin update flow is documented at <https://vercel.com/docs/cli/env>.

## Deploy and verify

Create/redeploy a production build so it receives the new values. Do not paste values into `--value`.

```bash
vercel redeploy "$PRE_ROTATION_DEPLOYMENT" --target production \
  --scope pnascimento9596s-projects
curl --fail-with-body -sS https://www.wcdraft.com/api/health \
  | jq -e '.ok == true and .db.status == "ready"'
curl --fail-with-body -sS https://www.wcdraft.com/api/og/health | jq -e '.ok == true'
```

Then verify sign-in/session creation, CSRF-protected mutation, one signed OG render, and one Resend delivery to an operator-controlled address. Revoke the old Resend key only after delivery succeeds.

## Rollback

- With dual verification shipped: promote a known-good previous value to
  primary and redeploy; keep a compromised value out of both slots.
- Emergency cookie/OG rotation: rolling code back does not restore the prior
  secret. Restore it only when incident evidence confirms it was not
  compromised. Otherwise fix forward and accept session/link invalidation.
- Resend: restore the old key only while the provider still reports it active
  and it is retrieved from the approved secret store, never from logs.

For an allowed previous-value rollback, set `SECRET_NAME` to exactly one of the
three supported names, set `ROLLBACK_SOURCE_DEPLOYMENT` to the known-compatible
deployment ID or URL to rebuild, and explicitly set
`CONFIRMED_PREVIOUS_NOT_COMPROMISED=yes`. The previous value is read silently,
sent only over stdin, and removed from the shell on both success and failure:

```bash
set -euo pipefail
set +x
umask 077
case "${SECRET_NAME:-}" in
  AUTH_COOKIE_SECRET|WCDRAFT_OG_SIGNING_SECRET|RESEND_API_KEY) ;;
  *) echo 'Unsupported SECRET_NAME.' >&2; exit 1 ;;
esac
test "${CONFIRMED_PREVIOUS_NOT_COMPROMISED:-}" = "yes"
test -n "${ROLLBACK_SOURCE_DEPLOYMENT:-}"
rollback_receipt="$(mktemp -d /tmp/wcdraft-secret-rollback.XXXXXX)"

read -r -s -p "Known-good previous value for $SECRET_NAME: " PREVIOUS_SECRET
printf '\n' >&2
test -n "$PREVIOUS_SECRET"
clear_previous_secret() {
  unset PREVIOUS_SECRET
}
trap clear_previous_secret EXIT HUP INT TERM
printf '%s' "$PREVIOUS_SECRET" \
  | vercel env update "$SECRET_NAME" production --sensitive --yes \
      --scope pnascimento9596s-projects --cwd apps/web
unset PREVIOUS_SECRET
trap - EXIT HUP INT TERM

vercel redeploy "$ROLLBACK_SOURCE_DEPLOYMENT" --target production \
  --scope pnascimento9596s-projects \
  | tee "$rollback_receipt/redeploy.txt"
vercel list wcdraft-web --environment production --status READY \
  --scope pnascimento9596s-projects \
  | tee "$rollback_receipt/deployments-after.txt"
curl --fail-with-body -sS https://www.wcdraft.com/api/health \
  | tee "$rollback_receipt/health.json" \
  | jq -e '.ok == true and .db.status == "ready"'
curl --fail-with-body -sS https://www.wcdraft.com/api/og/health \
  | tee "$rollback_receipt/og-health.json" | jq -e '.ok == true'
printf 'rollback receipts: %s\n' "$rollback_receipt"
```

The health probes prove configuration and deployment readiness, not the whole
secret-specific contract. Before closing the incident, create a fresh session
and complete one CSRF-protected mutation for `AUTH_COOKIE_SECRET`; generate and
render a newly signed OG request for `WCDRAFT_OG_SIGNING_SECRET`; or send and
receive one message at an operator-controlled address for `RESEND_API_KEY`.
Record only pass/fail, deployment ID, timestamps, and non-secret request IDs.
Vercel documents the stdin environment update at
<https://vercel.com/docs/cli/env> and production-target redeploy at
<https://vercel.com/docs/cli/redeploy>.
