/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * Belt-and-suspenders for the service-worker cache-bust contract:
   * the SW + its imported version script must never be served from
   * HTTP cache. `sw-register.tsx` already passes `updateViaCache: "none"`
   * to `register()`, but explicit `no-store` ensures direct fetches and
   * intermediate caches behave consistently across browsers / CDNs.
   */
  async headers() {
    return [
      // Global security response headers. HSTS is intentionally omitted — the
      // Vercel platform already sets `Strict-Transport-Security: max-age=63072000`
      // on every response, and emitting a second value here would duplicate it.
      // A full Content-Security-Policy is deferred (it needs careful allowances
      // for next/font, the next/og Satori path, and the theme inline script);
      // `X-Frame-Options: DENY` covers the clickjacking case the CSRF design
      // (lib/auth/csrf.ts) explicitly assumes until a scoped CSP lands.
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/sw-version.js",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
    ];
  },
  // Disable webpack's persistent build cache for production builds.
  //
  // Why: Next.js 16.2.7's RealContentHashPlugin aborts the build when a
  // restored `.next/cache/webpack/` references a chunk asset the new module
  // graph no longer emits. The engine-v2 line reshapes the web module graph
  // enough to trigger this against Vercel's prior Preview cache (see
  // docs/investigations/vercel-preview-engine-v2-2026-06-07.md). Disabling
  // the prod cache makes every prod build a clean compile and eliminates
  // the entire failure class. Dev still benefits from caching.
  webpack: (config, { dev }) => {
    if (!dev) {
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;
