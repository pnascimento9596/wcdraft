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
  webpack: (config, { dev }) => {
    if (!dev) {
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;
