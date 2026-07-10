# Stale service worker or missing runtime-data path

Use this when the UI build stamp is stale, the PWA loops on old assets, or a versioned `/data/wcdraft/...` request returns 404/504.

## Capture server truth

```bash
set -euo pipefail
incident_dir="$(mktemp -d /tmp/wcdraft-sw-incident.XXXXXX)"
health_status="$(curl -sS -o "$incident_dir/health.json" -w '%{http_code}' \
  https://www.wcdraft.com/api/health)"
printf 'health HTTP %s\n' "$health_status"
jq . "$incident_dir/health.json"
schema_version="$(jq -er '.data.schema_version' "$incident_dir/health.json")"
curl --fail-with-body -sS https://www.wcdraft.com/sw-version.js \
  | tee "$incident_dir/sw-version.js"
curl --fail-with-body -sS \
  "https://www.wcdraft.com/data/wcdraft/$schema_version/manifest.json" \
  | tee "$incident_dir/manifest.json" | jq '{schema_version,dataset_version,bundles}'
```

Use the schema/path advertised by `/api/health` and the manifest; do not guess a version. For every required bundle path in the manifest, verify HTTP 200. The draft pool is shipped as Brotli:

```bash
curl --fail-with-body -sSI \
  "https://www.wcdraft.com/data/wcdraft/$schema_version/draft-pool.compact.json.br"
curl --fail-with-body -sSI \
  "https://www.wcdraft.com/data/wcdraft/$schema_version/scenario-2026.compact.json"
```

## Decide

- Server paths and hashes are coherent, one device is stale: repair that browser only.
- Manifest exists but a required artifact is 404: deployment is incomplete; roll Vercel back or redeploy the exact commit after `pnpm check:generated` and web build pass.
- `/sw-version.js` advertises a different schema/data revision from `/api/health`: build output is incoherent; roll back the deployment.
- Many devices are stale after a READY deployment: verify `sw.js` and imported `sw-version.js` are both served and that registration uses `updateViaCache: "none"` before changing cache logic.

## Repair one browser

In DevTools on `www.wcdraft.com`, run this origin-scoped cleanup. It deletes only wcdraft-owned caches:

```js
for (const registration of await navigator.serviceWorker.getRegistrations()) {
  await registration.update();
}
for (const name of await caches.keys()) {
  if (name.startsWith("wcdraft-")) await caches.delete(name);
}
location.reload();
```

If update still fails, unregister the wcdraft service worker in DevTools, reload online once, then confirm a new worker controls the page. Do not instruct users to clear unrelated site data first.

## Verify

- The visible build stamp matches `/api/health.build.sha` (shortened in the UI).
- Required runtime-data requests return 200 and match manifest hashes.
- Online draft setup loads; then airplane-mode reload reaches the previously cached draft path.
- Browser cache names contain the current values from `/sw-version.js`; no obsolete `wcdraft-*` cache remains after activation.

## Rollback

For a server-wide missing artifact or incoherent worker graph:

```bash
vercel rollback '<last-known-good-deployment-id-or-url>' \
  --scope pnascimento9596s-projects --yes
vercel rollback status wcdraft-web --scope pnascimento9596s-projects
curl --fail-with-body -sS https://www.wcdraft.com/api/health | jq .
curl --fail-with-body -sS https://www.wcdraft.com/sw-version.js
```

After rollback, remember that Vercel Instant Rollback may restore the older deployment's build-time configuration. Verify the production domain and runtime paths; do not infer recovery from the dashboard alone.
