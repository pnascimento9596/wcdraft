/**
 * Shared browser-side service-worker registration and first-load handoff.
 *
 * A genuinely cold page is not controlled while the new worker installs, so
 * its direct fetches cannot participate in the worker's in-flight map or Web
 * Lock. Runtime-data loading therefore waits for `controllerchange` before it
 * starts the large draft-pool request. The worker has already atomically
 * cached every required entry before it calls `clients.claim()`, so that first
 * page request is intercepted and served from CacheStorage instead of issuing
 * a second 2.2 MiB transfer.
 *
 * This is an optimization gate, not an availability gate: unsupported
 * browsers, registration errors, failed installs, and a bounded timeout all
 * fall through to the direct network loader.
 */

export const RUNTIME_DATA_SW_HANDOFF_TIMEOUT_MS = 15_000;

export type RuntimeDataServiceWorkerHandoff =
  | "controlled"
  | "bypassed"
  | "registration-failed"
  | "timed-out";

export interface ServiceWorkerRegistrationLike {
  readonly active?: unknown | null;
  readonly installing?: unknown | null;
  readonly waiting?: unknown | null;
}

export interface ServiceWorkerContainerLike {
  readonly controller: unknown | null;
  readonly ready: Promise<ServiceWorkerRegistrationLike>;
  register(
    scriptURL: string,
    options: { updateViaCache: "none" },
  ): Promise<ServiceWorkerRegistrationLike>;
  addEventListener(type: "controllerchange", listener: () => void): void;
  removeEventListener(type: "controllerchange", listener: () => void): void;
}

function resolveBrowserServiceWorker(): ServiceWorkerContainerLike | null {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker as unknown as ServiceWorkerContainerLike;
}

let sharedRegistrationPromise: Promise<ServiceWorkerRegistrationLike | null> | null = null;

/** Register once per page; failed registration remains retryable. */
export function registerWcdraftServiceWorker({
  nodeEnv = process.env.NODE_ENV,
  serviceWorker = resolveBrowserServiceWorker(),
}: {
  nodeEnv?: string;
  serviceWorker?: ServiceWorkerContainerLike | null;
} = {}): Promise<ServiceWorkerRegistrationLike | null> {
  if (nodeEnv !== "production" || !serviceWorker) return Promise.resolve(null);
  if (sharedRegistrationPromise) return sharedRegistrationPromise;

  const registration = serviceWorker
    .register("/sw.js", { updateViaCache: "none" })
    .catch(() => null);
  sharedRegistrationPromise = registration;
  void registration.then((result) => {
    if (result === null && sharedRegistrationPromise === registration) {
      sharedRegistrationPromise = null;
    }
  });
  return registration;
}

/**
 * Wait until an initially uncontrolled production page is claimed. If an
 * already-controlled page discovers an installing/waiting update, it waits
 * for that controller swap too; this remains correct in browsers without Web
 * Locks. A controlled page with no pending update returns after registration.
 */
export function waitForRuntimeDataServiceWorkerHandoff({
  nodeEnv = process.env.NODE_ENV,
  serviceWorker = resolveBrowserServiceWorker(),
  timeoutMs = RUNTIME_DATA_SW_HANDOFF_TIMEOUT_MS,
  register = () => registerWcdraftServiceWorker({ nodeEnv, serviceWorker }),
}: {
  nodeEnv?: string;
  serviceWorker?: ServiceWorkerContainerLike | null;
  timeoutMs?: number;
  register?: () => Promise<ServiceWorkerRegistrationLike | null>;
} = {}): Promise<RuntimeDataServiceWorkerHandoff> {
  if (nodeEnv !== "production" || !serviceWorker) return Promise.resolve("bypassed");
  const initialController = serviceWorker.controller;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: RuntimeDataServiceWorkerHandoff) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      serviceWorker.removeEventListener("controllerchange", onControllerChange);
      resolve(result);
    };
    const onControllerChange = () => {
      const currentController = serviceWorker.controller;
      if (currentController && (!initialController || currentController !== initialController)) {
        finish("controlled");
      }
    };
    const timeout = setTimeout(() => finish("timed-out"), Math.max(0, timeoutMs));

    // Subscribe before registration so an unusually fast install/claim cannot
    // race past the listener. `ready` is advisory; controller presence is the
    // decisive proof that this page's next fetch will enter the worker.
    serviceWorker.addEventListener("controllerchange", onControllerChange);
    void serviceWorker.ready.then(onControllerChange, () => undefined);
    void Promise.resolve()
      .then(register)
      .then(
        (registration) => {
          if (!registration) {
            // A registration-update failure does not invalidate an already
            // controlling worker; a cold page has no such fallback.
            finish(initialController ? "controlled" : "registration-failed");
            return;
          }
          onControllerChange();
          if (initialController && !registration.installing && !registration.waiting) {
            finish("controlled");
          }
        },
        () => finish(initialController ? "controlled" : "registration-failed"),
      );
  });
}

/** Test-only reset for the module-level browser registration memo. */
export function clearServiceWorkerRegistrationForTests(): void {
  sharedRegistrationPromise = null;
}
