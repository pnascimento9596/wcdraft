/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
    if (!dev) config.cache = false;
    return config;
  },
};

export default nextConfig;
