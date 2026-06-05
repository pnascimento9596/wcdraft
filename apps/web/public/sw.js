/*
 * wcdraft service worker — versioned compact-data cache.
 *
 * Responsibilities:
 *   1. Pre-cache the three compact-data artifacts under `/data/wcdraft/*`
 *      on install so the draft route works offline after first online
 *      install (the dataset is large enough that the network-first path
 *      would re-pay the download every navigation).
 *   2. Serve `/data/wcdraft/*` cache-first — the bundles are
 *      hash-pinned by the manifest; if a new manifest ships, it lands in
 *      a new cache name (see below) and the old cache is evicted.
 *   3. Network-first for navigations + everything else, with a tolerant
 *      cache fallback so a flaky network does not break a partially
 *      cached run.
 *   4. On activation, evict EVERY cache whose name does not match the
 *      currently bundled CACHE_NAMES values — so a redeploy that bumps
 *      schema or dataset version atomically drops the old runtime data.
 *
 * The two `CACHE_NAME_*` strings below are the cache-key version anchors;
 * bumping them is the kill-switch for invalidating runtime data + app
 * shell separately. The dataset cache key encodes BOTH the schema version
 * and the dataset version so the cache changes shape whenever either
 * anchor moves.
 *
 * INTENTIONAL LIMITS: this worker does NOT cache the full `/_next/static`
 * tree (a separate I2/I3 concern); navigations stay network-first. The
 * scope here is the runtime data plus a network-first navigation fallback
 * that prevents a total offline blank.
 */

const SCHEMA_VERSION = "runtime-data-1.0.0";
const DATASET_VERSION = "2026-06-04";
const CACHE_NAME_DATA = `wcdraft-data-${SCHEMA_VERSION}-${DATASET_VERSION}`;
const CACHE_NAME_SHELL = `wcdraft-shell-v1`;

const DATA_PREFIX = "/data/wcdraft/";
const PRECACHE_DATA_URLS = [
  `${DATA_PREFIX}manifest.json`,
  `${DATA_PREFIX}draft-pool.compact.json`,
  `${DATA_PREFIX}scenario-2026.compact.json`,
];

// The full set of cache names this build expects to own. The activation
// handler evicts anything outside this set.
const KNOWN_CACHE_NAMES = new Set([CACHE_NAME_DATA, CACHE_NAME_SHELL]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME_DATA);
      // Pre-cache the compact bundles. We tolerate individual failures —
      // a missing file should not block install (the page still works
      // online); cache-first serving will fall through to network for
      // any URL not in the cache.
      await Promise.all(
        PRECACHE_DATA_URLS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: "no-cache" });
            if (res.ok) await cache.put(url, res.clone());
          } catch {
            /* swallow — handler will fall back to network on demand */
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
          // Match the wcdraft prefix to avoid stomping other origins' caches
          // when scoped same-origin (defensive — a stray cache is rare).
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

  // Cache-first for the compact data — hash-pinned by the manifest and
  // version-keyed by the cache name. If a new dataset ships, the cache
  // name changes and the activation handler evicts the old one.
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
          // No cache hit AND network failed — surface a clean 504 so the
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

  // Network-first for HTML navigations with a tolerant cache fallback —
  // keeps the app shell installable while not stomping freshness.
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
  // Cache-Control headers) and other same-origin assets.
});
