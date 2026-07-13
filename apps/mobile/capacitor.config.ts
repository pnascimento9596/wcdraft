import type { CapacitorConfig } from "@capacitor/cli";

/**
 * M1a native shell for wcdraft.
 *
 * Architect-delegated decision (hybrid load):
 * apps/web is a Next.js SSR app (auth, leaderboard APIs, dynamic CSP).
 * It is NOT a static export, so a pure offline asset bundle cannot host
 * the full product surface. The Capacitor shell therefore loads the
 * production PWA origin by default (`https://www.wcdraft.com`), matching
 * the installable web app. Offline behavior is the existing SW atomic
 * lifecycle on that origin (once the shell has been online once).
 *
 * Override for local smoke against a dev server:
 *   WCDRAFT_MOBILE_SERVER_URL=http://localhost:3000 pnpm mobile:sync
 */
const serverUrl = process.env["WCDRAFT_MOBILE_SERVER_URL"]?.trim() || "https://www.wcdraft.com";

const config: CapacitorConfig = {
  appId: "com.wcdraft.app",
  appName: "wcdraft",
  webDir: "www",
  // Background matches shipped PWA manifest theme/background tokens.
  backgroundColor: "#0a0e13",
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith("http://"),
    allowNavigation: ["wcdraft.com", "*.wcdraft.com", "www.wcdraft.com"],
  },
  ios: {
    // CSS owns safe-area insets (viewport-fit=cover); avoid WKWebView
    // double-padding with automatic contentInset.
    contentInset: "never",
    preferredContentMode: "mobile",
    scheme: "Wcdraft",
    // Portrait matches PWA manifest orientation.
    limitsNavigationsToAppBoundDomains: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: "#0a0e13",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      // Dark content chrome over emerald/dark shell; refined in P2.
      style: "DARK",
      backgroundColor: "#0a0e13",
    },
  },
};

export default config;
