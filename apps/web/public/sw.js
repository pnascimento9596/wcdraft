/*
 * wcdraft service worker — atomic runtime-data promotion.
 *
 * `/sw-version.js` is generated for every build. Its shell cache identity is
 * deploy-specific, while its data cache identity is derived only from the
 * complete manifest fingerprint set. The registration keeps
 * `updateViaCache: "none"`, so browsers re-evaluate this worker graph on each
 * update check without forcing an unchanged 2.2 MiB data bundle to download.
 *
 * Installation is fail-closed: all required runtime responses must be OK,
 * manifest-bound, durably present in CacheStorage, and re-verifiable before
 * `skipWaiting()`. A failed candidate never promotes. Activation repeats the
 * complete-cache proof before deleting any prior wcdraft cache or claiming
 * clients. Required install and controlled-page fetches share an origin-wide
 * Web Lock (plus an in-worker promise), so either side can populate the cache
 * while the other waits and rechecks; neither depends on page participation.
 */

importScripts("/sw-version.js");

const SW_CONFIG = self.__WCDRAFT_SW_CONFIG__;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const REVISION_RE = /^[0-9a-f]{16}$/u;
const SAFE_SEGMENT_RE = /^[a-z0-9][a-z0-9._-]*$/u;
const SAFE_BUNDLE_KEY_RE = /^[a-z0-9][a-z0-9_]*$/u;
const DATA_PREFIX = "/data/wcdraft/";
const REQUIRED_FILL_TIMEOUT_MS = 25_000;
const REQUIRED_RUNTIME_BUNDLE_PATHS = Object.freeze({
  daily_seed_salt_map: "daily-seed-salt-map.compact.json",
  draft_pool: "draft-pool.compact.json",
  scenario_2026: "scenario-2026.compact.json",
  score_distribution: "score-distribution.compact.json",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function configError(detail) {
  throw new Error(`wcdraft sw: malformed /sw-version.js config: ${detail}`);
}

function validateConfig(config) {
  if (!isRecord(config)) configError("self.__WCDRAFT_SW_CONFIG__ missing");
  if (!REVISION_RE.test(config.deploy_revision)) configError("deploy_revision invalid");
  if (!REVISION_RE.test(config.data_revision)) configError("data_revision invalid");
  if (typeof config.schema_version !== "string" || !SAFE_SEGMENT_RE.test(config.schema_version)) {
    configError("schema_version invalid");
  }
  if (typeof config.dataset_version !== "string" || config.dataset_version.length === 0) {
    configError("dataset_version invalid");
  }

  const basePath = `/data/wcdraft/${config.schema_version}`;
  if (config.runtime_data_base_path !== basePath) {
    configError("runtime_data_base_path does not match schema_version");
  }
  if (!isRecord(config.cache_names)) configError("cache_names missing");
  const expectedDataCache = `wcdraft-data-b:${config.data_revision}`;
  const expectedShellCache = `wcdraft-shell-d:${config.deploy_revision}`;
  if (config.cache_names.data !== expectedDataCache) {
    configError("data cache must depend only on data_revision");
  }
  if (config.cache_names.shell !== expectedShellCache) {
    configError("shell cache must depend on deploy_revision");
  }

  if (
    !Array.isArray(config.required_bundle_keys) ||
    config.required_bundle_keys.length === 0 ||
    !config.required_bundle_keys.every(
      (key) => typeof key === "string" && SAFE_BUNDLE_KEY_RE.test(key),
    )
  ) {
    configError("required_bundle_keys invalid");
  }
  const requiredKeys = [...config.required_bundle_keys];
  if (
    new Set(requiredKeys).size !== requiredKeys.length ||
    requiredKeys.join("\0") !== [...requiredKeys].sort().join("\0")
  ) {
    configError("required_bundle_keys must be unique and sorted");
  }
  for (const key of Object.keys(REQUIRED_RUNTIME_BUNDLE_PATHS)) {
    if (!requiredKeys.includes(key)) configError(`required bundle ${key} missing`);
  }

  if (!isRecord(config.bundle_hashes)) configError("bundle_hashes missing");
  for (const key of requiredKeys) {
    const hashes = config.bundle_hashes[key];
    if (
      !isRecord(hashes) ||
      !SHA256_RE.test(hashes.raw_sha256) ||
      !Number.isSafeInteger(hashes.raw_bytes) ||
      hashes.raw_bytes <= 0 ||
      !SHA256_RE.test(hashes.compressed_sha256) ||
      !Number.isSafeInteger(hashes.compressed_bytes) ||
      hashes.compressed_bytes <= 0
    ) {
      configError(`bundle_hashes.${key} invalid`);
    }
  }
  if (Object.keys(config.bundle_hashes).sort().join("\0") !== requiredKeys.join("\0")) {
    configError("bundle_hashes must exactly cover required_bundle_keys");
  }

  if (
    !Array.isArray(config.precache_data_entries) ||
    config.precache_data_entries.length !== requiredKeys.length + 1
  ) {
    configError("precache_data_entries must cover manifest plus every required bundle");
  }

  const seenKeys = new Set();
  const seenUrls = new Set();
  const entries = config.precache_data_entries.map((entry) => {
    if (!isRecord(entry)) configError("precache entry must be an object");
    if (
      typeof entry.key !== "string" ||
      (entry.key !== "manifest" && !SAFE_BUNDLE_KEY_RE.test(entry.key)) ||
      seenKeys.has(entry.key)
    ) {
      configError("precache entry key invalid or duplicated");
    }
    if (
      typeof entry.url !== "string" ||
      !entry.url.startsWith(`${basePath}/`) ||
      entry.url.includes("..") ||
      entry.url.includes("\\") ||
      entry.url.includes("?") ||
      entry.url.includes("#") ||
      seenUrls.has(entry.url)
    ) {
      configError(`precache entry ${entry.key} URL invalid or duplicated`);
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(entry.url, self.location.origin);
    } catch {
      configError(`precache entry ${entry.key} URL cannot be parsed`);
    }
    if (parsedUrl.origin !== self.location.origin || parsedUrl.pathname !== entry.url) {
      configError(`precache entry ${entry.key} must be a same-origin path`);
    }
    if (!Number.isSafeInteger(entry.expected_bytes) || entry.expected_bytes <= 0) {
      configError(`precache entry ${entry.key} expected_bytes invalid`);
    }
    if (typeof entry.expected_sha256 !== "string" || !SHA256_RE.test(entry.expected_sha256)) {
      configError(`precache entry ${entry.key} expected_sha256 invalid`);
    }
    if (!Number.isSafeInteger(entry.transport_bytes) || entry.transport_bytes <= 0) {
      configError(`precache entry ${entry.key} transport_bytes invalid`);
    }
    if (typeof entry.transport_sha256 !== "string" || !SHA256_RE.test(entry.transport_sha256)) {
      configError(`precache entry ${entry.key} transport_sha256 invalid`);
    }
    if (entry.encoding !== "identity" && entry.encoding !== "brotli") {
      configError(`precache entry ${entry.key} encoding invalid`);
    }

    if (entry.key === "manifest") {
      if (
        entry.kind !== "manifest" ||
        entry.url !== `${basePath}/manifest.json` ||
        entry.encoding !== "identity" ||
        entry.transport_bytes !== entry.expected_bytes ||
        entry.transport_sha256 !== entry.expected_sha256
      ) {
        configError("manifest precache entry invalid");
      }
    } else {
      if (entry.kind !== "bundle" || !requiredKeys.includes(entry.key)) {
        configError(`bundle precache entry ${entry.key} is not required`);
      }
      const requiredPath = REQUIRED_RUNTIME_BUNDLE_PATHS[entry.key];
      if (requiredPath !== undefined) {
        const compressed = entry.key === "draft_pool";
        const expectedUrl = `${basePath}/${requiredPath}${compressed ? ".br" : ""}`;
        if (entry.url !== expectedUrl || entry.encoding !== (compressed ? "brotli" : "identity")) {
          configError(`required bundle ${entry.key} delivery path/encoding invalid`);
        }
      }
      const fingerprint = config.bundle_hashes[entry.key];
      const usesBrotli = entry.encoding === "brotli";
      if (
        entry.expected_bytes !== fingerprint.raw_bytes ||
        entry.expected_sha256 !== fingerprint.raw_sha256 ||
        entry.transport_bytes !==
          (usesBrotli ? fingerprint.compressed_bytes : fingerprint.raw_bytes) ||
        entry.transport_sha256 !==
          (usesBrotli ? fingerprint.compressed_sha256 : fingerprint.raw_sha256)
      ) {
        configError(`bundle ${entry.key} precache fingerprint does not match manifest metadata`);
      }
      if (
        entry.encoding === "identity" &&
        (entry.transport_bytes !== entry.expected_bytes ||
          entry.transport_sha256 !== entry.expected_sha256)
      ) {
        configError(`identity bundle ${entry.key} transport fingerprint mismatch`);
      }
    }

    seenKeys.add(entry.key);
    seenUrls.add(entry.url);
    return Object.freeze({ ...entry });
  });

  if (!seenKeys.has("manifest")) configError("manifest precache entry missing");
  for (const key of requiredKeys) {
    if (!seenKeys.has(key)) configError(`precache entry for ${key} missing`);
  }
  if (seenKeys.size !== requiredKeys.length + 1) configError("unexpected precache entry present");

  if (!self.crypto || !self.crypto.subtle || typeof self.crypto.subtle.digest !== "function") {
    configError("Web Crypto SHA-256 unavailable");
  }

  return Object.freeze({
    dataCacheName: expectedDataCache,
    shellCacheName: expectedShellCache,
    entries: Object.freeze(entries),
  });
}

const VALIDATED_CONFIG = validateConfig(SW_CONFIG);
const CACHE_NAME_DATA = VALIDATED_CONFIG.dataCacheName;
const CACHE_NAME_SHELL = VALIDATED_CONFIG.shellCacheName;
const PRECACHE_DATA_ENTRIES = VALIDATED_CONFIG.entries;
const INSTALL_DATA_ENTRY_GROUPS = Object.freeze([
  Object.freeze(PRECACHE_DATA_ENTRIES.filter((entry) => entry.key !== "draft_pool")),
  Object.freeze(PRECACHE_DATA_ENTRIES.filter((entry) => entry.key === "draft_pool")),
]);
const REQUIRED_ENTRY_BY_PATH = new Map(PRECACHE_DATA_ENTRIES.map((entry) => [entry.url, entry]));
const KNOWN_CACHE_NAMES = new Set([CACHE_NAME_DATA, CACHE_NAME_SHELL]);
const IN_FLIGHT_REQUIRED_FILLS = new Map();

function toHex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyResponse(entry, response, source) {
  if (!response) throw new Error(`wcdraft sw: ${source} missing ${entry.url}`);
  if (!response.ok) {
    throw new Error(`wcdraft sw: ${source} ${entry.url} returned HTTP ${response.status}`);
  }
  if (entry.encoding === "brotli" && response.headers.get("content-encoding") !== "br") {
    throw new Error(`wcdraft sw: ${source} ${entry.url} missing Content-Encoding: br`);
  }
  if (entry.encoding === "brotli") {
    // Fetch exposes Content-Encoding responses as decoded streams. The wire
    // length remains a useful transport check, but it is not an integrity
    // proof: the bytes consumed by JSON.parse must also match the manifest's
    // raw fingerprint below.
    const contentLength = response.headers.get("content-length");
    if (contentLength !== String(entry.transport_bytes)) {
      throw new Error(
        `wcdraft sw: ${source} ${entry.url} Content-Length ${contentLength} != ${entry.transport_bytes}`,
      );
    }
  }
  const bytes = await response.clone().arrayBuffer();
  if (bytes.byteLength !== entry.expected_bytes) {
    throw new Error(
      `wcdraft sw: ${source} ${entry.url} byte length ${bytes.byteLength} != ${entry.expected_bytes}`,
    );
  }
  const digest = toHex(await self.crypto.subtle.digest("SHA-256", bytes));
  if (digest !== entry.expected_sha256) {
    throw new Error(`wcdraft sw: ${source} ${entry.url} SHA-256 mismatch`);
  }
  return response;
}

function attachVerifiedNetworkResponse(error, response, verified) {
  const wrapped = error instanceof Error ? error : new Error(String(error));
  // A response may be handed to a controlled page only after its actual body
  // passed the manifest-bound byte and SHA-256 proof. Storage failures after
  // verification remain network-usable; integrity failures never do.
  if (verified && response) wrapped.verifiedNetworkResponse = response.clone();
  return wrapped;
}

async function fillRequiredEntry(entry, signal) {
  const cache = await caches.open(CACHE_NAME_DATA);
  const cached = await cache.match(entry.url);
  if (cached) {
    try {
      await verifyResponse(entry, cached, "cache");
      return cached;
    } catch {
      // Keep the prior bytes in place until a complete replacement has
      // been fetched and verified. This matters when an active UI-only
      // deployment shares the same manifest-derived data cache.
    }
  }

  let response;
  let responseVerified = false;
  try {
    response = await fetch(entry.url, { cache: "no-cache", signal });
    if (!response.ok) {
      throw new Error(`wcdraft sw: network ${entry.url} returned HTTP ${response.status}`);
    }
    await verifyResponse(entry, response, "network");
    responseVerified = true;
    await cache.put(entry.url, response.clone());
    const stored = await cache.match(entry.url);
    if (!stored) throw new Error(`wcdraft sw: cache.put did not retain ${entry.url}`);
    await verifyResponse(entry, stored, "cache after put");
    return response;
  } catch (error) {
    throw attachVerifiedNetworkResponse(error, response, responseVerified);
  }
}

async function runBoundedRequiredFill(entry) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`wcdraft sw: required fill timed out for ${entry.url}`));
  }, REQUIRED_FILL_TIMEOUT_MS);
  try {
    const lockManager = self.navigator?.locks;
    if (lockManager && typeof lockManager.request === "function") {
      const lockName = `wcdraft-required-fill:${CACHE_NAME_DATA}:${entry.key}`;
      return await lockManager.request(lockName, { signal: controller.signal }, () =>
        fillRequiredEntry(entry, controller.signal),
      );
    }
    return await fillRequiredEntry(entry, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * The origin-wide lock coordinates separate active/installing worker globals;
 * the in-memory map handles calls within one global. The lock callback always
 * rechecks CacheStorage, so only its winner fetches. No page acknowledgement
 * is required: installation always makes independent forward progress.
 */
function getRequiredResponse(entry) {
  const inFlightKey = `${CACHE_NAME_DATA}\n${entry.url}`;
  let operation = IN_FLIGHT_REQUIRED_FILLS.get(inFlightKey);
  if (!operation) {
    operation = (async () => {
      return runBoundedRequiredFill(entry);
    })();
    IN_FLIGHT_REQUIRED_FILLS.set(inFlightKey, operation);
    const clear = () => {
      if (IN_FLIGHT_REQUIRED_FILLS.get(inFlightKey) === operation) {
        IN_FLIGHT_REQUIRED_FILLS.delete(inFlightKey);
      }
    };
    operation.then(clear, clear);
  }
  return operation.then((response) => response.clone());
}

async function verifyRequiredCache() {
  const cache = await caches.open(CACHE_NAME_DATA);
  for (const entry of PRECACHE_DATA_ENTRIES) {
    const stored = await cache.match(entry.url);
    await verifyResponse(entry, stored, "required cache proof");
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const existingNames = await caches.keys();
      const dataCacheAlreadyExisted = existingNames.includes(CACHE_NAME_DATA);
      try {
        for (const entries of INSTALL_DATA_ENTRY_GROUPS) {
          const results = await Promise.allSettled(
            entries.map((entry) => getRequiredResponse(entry)),
          );
          const failures = results
            .filter((result) => result.status === "rejected")
            .map((result) => result.reason);
          if (failures.length > 0) {
            throw new AggregateError(failures, "wcdraft sw: required data precache failed");
          }
        }
        await verifyRequiredCache();
      } catch (error) {
        // A newly named data cache cannot be in use by the prior worker. Every
        // fill has settled before this path, so deletion cannot race a late put.
        // Never delete a same-revision cache that an active UI-only deploy may
        // still be using.
        if (!dataCacheAlreadyExisted) await caches.delete(CACHE_NAME_DATA);
        throw error;
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // This proof must finish before even enumerating deletion candidates.
      await verifyRequiredCache();
      const names = await caches.keys();
      await Promise.all(
        names.map((name) => {
          if (KNOWN_CACHE_NAMES.has(name) || !name.startsWith("wcdraft-")) return undefined;
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

function offlineDataResponse(request, error) {
  return new Response(
    JSON.stringify({
      error: "offline-and-uncached",
      detail: String(error),
      url: request.url,
    }),
    { status: 504, headers: { "content-type": "application/json" } },
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (isCompactDataRequest(url)) {
    event.respondWith(
      (async () => {
        const requiredEntry = REQUIRED_ENTRY_BY_PATH.get(url.pathname);
        if (requiredEntry) {
          try {
            return await getRequiredResponse(requiredEntry);
          } catch (error) {
            // A verified response remains safe if only CacheStorage failed.
            // An integrity-failed response must never reach the page.
            if (error && error.verifiedNetworkResponse) return error.verifiedNetworkResponse;
            return offlineDataResponse(request, error);
          }
        }

        const cache = await caches.open(CACHE_NAME_DATA);
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response.ok) {
            try {
              await cache.put(request, response.clone());
            } catch {
              // Non-required retained/compatibility data stays network-usable
              // even when a best-effort cache write fails.
            }
          }
          return response;
        } catch (error) {
          return offlineDataResponse(request, error);
        }
      })(),
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME_SHELL);
            cache.put(request, response.clone()).catch(() => undefined);
          }
          return response;
        } catch {
          const cache = await caches.open(CACHE_NAME_SHELL);
          const cached = await cache.match(request);
          if (cached) return cached;
          return new Response("offline", { status: 503 });
        }
      })(),
    );
  }
});
