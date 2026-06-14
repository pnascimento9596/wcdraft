/*
 * wcdraft service worker - per-deploy cache versioning via /sw-version.js.
 *
 * The cache-name anchors live in the build-generated `/sw-version.js`,
 * imported below. The committed source here is intentionally version-free
 * so this file does NOT need to be edited on every deploy.
 *
 * v3 change (root-cause cure for "I deploy and don't see it"):
 *   - Both the data cache and the navigation/shell cache include a
 *     per-deploy revision. UI-only deploys (mobile CSS, copy edits)
 *     rotate the shell cache; data deploys ALSO rotate the data cache
 *     via its bundle-sha component. Either change triggers a SW update
 *     because /sw-version.js bytes differ.
 *   - sw-register.tsx registers with `updateViaCache: "none"` so the
 *     imported version script bypasses HTTP cache on every update check.
 *
 * Behaviour preserved from v1/v2:
 *   - Pre-cache the compact bundles on install so the draft works offline.
 *   - Serve `/data/wcdraft/*` cache-first (hash-pinned by the manifest).
 *   - Network-first for navigations with shell-cache fallback.
 *   - On activate, evict every `wcdraft-*` cache outside KNOWN_CACHE_NAMES
 *     so old (pre-rotation) caches are dropped atomically.
 *
 * Intentional limit: this worker does NOT cache the full `/_next/static`
 * tree. Those assets are content-hashed and cached by browser HTTP cache
 * via Next's default headers.
 */

importScripts("/sw-version.js");

// Hard contract with apps/web/scripts/generate-sw-version.mjs. If
// `/sw-version.js` is missing or malformed, throw during worker
// evaluation so the new worker fails installation and the previously
// active worker stays in control (vs. installing one with `undefined`
// cache names).
const SW_CONFIG = self.__WCDRAFT_SW_CONFIG__;
if (!SW_CONFIG || typeof SW_CONFIG !== "object") {
  throw new Error("wcdraft sw: /sw-version.js did not set self.__WCDRAFT_SW_CONFIG__");
}
if (!SW_CONFIG.cache_names || typeof SW_CONFIG.cache_names !== "object") {
  throw new Error("wcdraft sw: __WCDRAFT_SW_CONFIG__.cache_names missing");
}
const CACHE_NAME_DATA = SW_CONFIG.cache_names.data;
const CACHE_NAME_SHELL = SW_CONFIG.cache_names.shell;
const PRECACHE_DATA_URLS = SW_CONFIG.precache_data_urls;
if (
  typeof CACHE_NAME_DATA !== "string" ||
  !CACHE_NAME_DATA.startsWith("wcdraft-data-") ||
  typeof CACHE_NAME_SHELL !== "string" ||
  !CACHE_NAME_SHELL.startsWith("wcdraft-shell-")
) {
  throw new Error("wcdraft sw: cache_names must include wcdraft-data-* and wcdraft-shell-* values");
}
if (
  !Array.isArray(PRECACHE_DATA_URLS) ||
  PRECACHE_DATA_URLS.length === 0 ||
  !PRECACHE_DATA_URLS.every((url) => typeof url === "string" && url.startsWith("/data/wcdraft/")) ||
  PRECACHE_DATA_URLS.some((url) => url.endsWith("/draft-pool.compact.json"))
) {
  throw new Error(
    "wcdraft sw: precache_data_urls must point at versioned runtime assets and the compressed draft pool",
  );
}

const DATA_PREFIX = "/data/wcdraft/";

// The full set of cache names this build expects to own. The activation
// handler evicts anything outside this set whose name starts with
// `wcdraft-` (so we never stomp other origins' caches).
const KNOWN_CACHE_NAMES = new Set([CACHE_NAME_DATA, CACHE_NAME_SHELL]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME_DATA);
      // Pre-cache the compact bundles. We tolerate individual failures
      // so a single missing file doesn't block install (the page still
      // works online; cache-first will fall through to network).
      await Promise.all(
        PRECACHE_DATA_URLS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: "no-cache" });
            if (res.ok) await cache.put(url, res.clone());
          } catch {
            /* swallow - fetch handler falls back to network on demand */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.map((name) => {
          if (KNOWN_CACHE_NAMES.has(name)) return undefined;
          // Limit eviction to our prefix so we never stomp other origins'
          // caches when scoped same-origin.
          if (!name.startsWith("wcdraft-")) return undefined;
          return caches.delete(name);
        }),
      );
      await self.clients.claim();
    })(),
  );
});

function isCompactDataRequest(url) {
  return url.origin === self.location.origin && url.pathname.startsWith(DATA_PREFIX);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Cache-first for the compact data - hash-pinned by the manifest and
  // version-keyed by CACHE_NAME_DATA (which embeds both the deploy
  // revision and the bundle sha). If either moves, the cache name
  // changes and activation evicts the old cache.
  if (isCompactDataRequest(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME_DATA);
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const res = await fetch(request);
          if (res.ok) cache.put(request, res.clone()).catch(() => undefined);
          return res;
        } catch (err) {
          // No cache hit AND network failed - surface a clean 504 so the
          // client can show a recovery panel instead of crashing.
          return new Response(
            JSON.stringify({
              error: "offline-and-uncached",
              detail: String(err),
              url: request.url,
            }),
            {
              status: 504,
              headers: { "content-type": "application/json" },
            },
          );
        }
      })(),
    );
    return;
  }

  // Network-first for HTML navigations with a tolerant cache fallback.
  // Keeps the app shell installable while always serving fresh HTML
  // when the network is reachable (the OLD worker's shell cache is
  // dropped by the new worker's activate handler).
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          if (res.ok) {
            const cache = await caches.open(CACHE_NAME_SHELL);
            cache.put(request, res.clone()).catch(() => undefined);
          }
          return res;
        } catch {
          const cache = await caches.open(CACHE_NAME_SHELL);
          const cached = await cache.match(request);
          if (cached) return cached;
          return new Response("offline", { status: 503 });
        }
      })(),
    );
    return;
  }

  // Everything else: pass through. The default browser fetch path is
  // sufficient for `/_next/static/*` (already aggressively cached by
  // Cache-Control headers + content-hashed filenames) and other same-
  // origin assets.
});
