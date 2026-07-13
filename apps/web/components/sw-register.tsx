"use client";

import { useEffect } from "react";

import { registerWcdraftServiceWorker } from "@/lib/service-worker";

export type ServiceWorkerRegistrationPlan = "disabled" | "register-now" | "register-on-load";

/**
 * M1a Capacitor coexistence policy.
 *
 * The native shell loads the production HTTPS origin (`server.url`), so the
 * Season-1 atomic SW lifecycle remains the single offline owner — same as the
 * installable PWA. We deliberately keep registration enabled in the native
 * WKWebView. A pure local `file://` / bundled-www shell (not used in M1a)
 * would disable the SW to avoid double-managing asset caches with Capacitor.
 */
export type ServiceWorkerNativeShellPolicy = "register-as-pwa" | "disable-local-file";

export function serviceWorkerNativeShellPolicy({
  usesRemoteServerUrl,
}: {
  usesRemoteServerUrl: boolean;
}): ServiceWorkerNativeShellPolicy {
  return usesRemoteServerUrl ? "register-as-pwa" : "disable-local-file";
}

/**
 * True when the document is loaded from an http(s) origin (PWA + Capacitor
 * hybrid `server.url`). False for `file://` (and other non-http schemes)
 * where Capacitor would own local asset serving.
 */
export function usesRemoteDocumentUrl(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:";
}

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
 * installs a new worker, and old caches are evicted only after the new
 * required runtime set verifies. UI-only deploys rotate the shell cache while
 * preserving the unchanged manifest-derived data cache.
 *
 * `updateViaCache: "none"` forces the browser to bypass the HTTP cache
 * when fetching `/sw.js` and the scripts it imports during the SW
 * update check - critical, because `/sw-version.js` is the actual
 * carrier of the per-deploy revision.
 *
 * Native shell: registration is gated by `serviceWorkerNativeShellPolicy`
 * so a future local `file://` load cannot double-manage caches with Capacitor.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    const nativePolicy = serviceWorkerNativeShellPolicy({
      usesRemoteServerUrl: usesRemoteDocumentUrl(window.location.protocol),
    });
    if (nativePolicy === "disable-local-file") return;

    const plan = serviceWorkerRegistrationPlan({
      nodeEnv: process.env.NODE_ENV,
      hasServiceWorker: "serviceWorker" in navigator,
      documentReadyState: document.readyState,
    });
    if (plan === "disabled") return;

    const register = () => {
      void registerWcdraftServiceWorker();
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
