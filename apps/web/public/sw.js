/*
 * wcdraft service worker — minimal, storage-free.
 *
 * Its only job is to exist with a `fetch` handler so the app meets PWA
 * installability criteria. It deliberately does NOT use the Cache Storage API
 * (or any browser storage): every request is passed straight through to the
 * network. Offline support can be layered on in a later milestone.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // No-op: let the browser handle the request normally (no caching).
});
