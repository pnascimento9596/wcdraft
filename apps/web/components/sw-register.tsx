"use client";

import { useEffect } from "react";

export type ServiceWorkerRegistrationPlan = "disabled" | "register-now" | "register-on-load";

export function serviceWorkerRegistrationPlan({
  nodeEnv,
  hasServiceWorker,
  documentReadyState,
}: {
  nodeEnv: string | undefined;
  hasServiceWorker: boolean;
  documentReadyState: Document["readyState"];
}): ServiceWorkerRegistrationPlan {
  if (nodeEnv !== "production") return "disabled";
  if (!hasServiceWorker) return "disabled";
  return documentReadyState === "loading" ? "register-on-load" : "register-now";
}

/**
 * Registers the wcdraft service worker in production builds.
 *
 * The worker (public/sw.js) loads its cache-name anchors from
 * `/sw-version.js`, a build-generated artifact written by
 * `apps/web/scripts/generate-sw-version.mjs`. Every deploy regenerates
 * `/sw-version.js`, the imported-script byte hash changes, the browser
 * installs a new worker, and the old data + shell caches are evicted
 * on activation - so UI-only deploys reach installed PWAs without a
 * manual cache bump.
 *
 * `updateViaCache: "none"` forces the browser to bypass the HTTP cache
 * when fetching `/sw.js` and the scripts it imports during the SW
 * update check - critical, because `/sw-version.js` is the actual
 * carrier of the per-deploy revision.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    const plan = serviceWorkerRegistrationPlan({
      nodeEnv: process.env.NODE_ENV,
      hasServiceWorker: "serviceWorker" in navigator,
      documentReadyState: document.readyState,
    });
    if (plan === "disabled") return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {
        /* installability is best-effort; ignore registration failures */
      });
    };

    if (plan === "register-now") {
      register();
      return;
    }

    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
