/*
 * Verifies committed marketing/social raster assets.
 *
 * The medallion logo replacement intentionally does not change the OG render
 * pipeline or committed OG fallback images. This script remains wired into
 * `predev` / `prebuild`, so it validates that those assets are present instead
 * of regenerating them from the retired logo sources.
 *
 * Checked assets:
 *   - public/brand/marketing/banner.png
 *   - public/brand/marketing/og-default.png
 *   - public/brand/marketing/og-square.png
 *
 * Run from anywhere: `node apps/web/scripts/generate-marketing-assets.mjs`
 */
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const marketingDir = join(webRoot, "public", "brand", "marketing");

for (const filename of ["banner.png", "og-default.png", "og-square.png"]) {
  const path = join(marketingDir, filename);
  if (!existsSync(path)) {
    throw new Error(`marketing asset is missing: ${path}`);
  }
  const { size } = statSync(path);
  if (size <= 0) {
    throw new Error(`marketing asset is empty: ${path}`);
  }
  console.log(`verified ${path.replace(webRoot + "/", "")} (${size} bytes)`);
}
