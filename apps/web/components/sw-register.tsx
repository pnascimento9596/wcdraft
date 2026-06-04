"use client";

import { useEffect } from "react";

/**
 * Registers the PWA service worker so the app is installable. The worker itself
 * (public/sw.js) is intentionally a no-op network pass-through — it provides the
 * fetch handler browsers require for installability WITHOUT using the Cache
 * Storage API or any other browser storage, per the shell's no-storage rule.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* installability is best-effort; ignore registration failures */
      });
    };

    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
