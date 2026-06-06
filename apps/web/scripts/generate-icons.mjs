/*
 * Rasterises the committed wcdraft brand SVGs into the PWA icon PNGs the
 * manifest references. Idempotent — same inputs produce byte-identical PNGs,
 * so the script is safe to run repeatedly in `predev` / `prebuild`.
 *
 * Inputs (committed SVGs — single source of truth for the brand):
 *   - public/brand/wcdraft-icon.svg     → any-purpose square icon
 *   - public/brand/wcdraft-maskable.svg → safe-zone maskable icon
 *
 * Outputs (all under public/icons/, committed PNGs):
 *   - icon-192.png            (192x192, purpose "any")
 *   - icon-512.png            (512x512, purpose "any")
 *   - apple-touch-icon.png    (180x180, Apple touch metadata)
 *   - icon-maskable-512.png   (512x512, purpose "maskable")
 *
 * Also overwrites the Next.js app-router file-convention icons so the favicon
 * and the iOS touch icon match the brand mark:
 *   - app/icon.png       (any size — Next normalises)
 *   - app/apple-icon.png (180x180)
 *
 * Run from anywhere: `node apps/web/scripts/generate-icons.mjs`
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const publicDir = join(webRoot, "public");
const iconsOutDir = join(publicDir, "icons");
const brandDir = join(publicDir, "brand");
const appDir = join(webRoot, "app");

mkdirSync(iconsOutDir, { recursive: true });

// sharp ships as a transitive dep of Next.js; pnpm does not hoist it to a
// top-level node_modules, so resolve it explicitly from the workspace root if
// the bare import fails.
const require = createRequire(import.meta.url);
async function loadSharp() {
  try {
    return (await import("sharp")).default;
  } catch {
    const { globSync } = require("node:fs");
    const root = join(webRoot, "..", "..", "node_modules", ".pnpm");
    const matches = globSync("sharp@*/node_modules/sharp/lib/index.js", { cwd: root });
    if (!matches.length) {
      throw new Error(
        "sharp not found; install dev deps (`pnpm install`) before running the icon generator.",
      );
    }
    return (await import(pathToFileURL(join(root, matches[0])).href)).default;
  }
}

const sharp = await loadSharp();

const anySvg = readFileSync(join(brandDir, "wcdraft-icon.svg"));
const maskableSvg = readFileSync(join(brandDir, "wcdraft-maskable.svg"));

async function rasterize(svg, outPath, size) {
  // Deterministic rasterisation: square output at the requested size, opaque
  // PNG (Apple touch icons must be opaque), default compression for stable
  // bytes. sharp's PNG encoder is deterministic given identical input.
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(outPath);
  console.log("wrote", outPath.replace(webRoot + "/", ""));
}

async function rasterizeOpaque(svg, outPath, size, bg) {
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: "contain", background: bg })
    .flatten({ background: bg })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(outPath);
  console.log("wrote", outPath.replace(webRoot + "/", ""));
}

// Brand background — matches the dark ink used in the maskable SVG so a flat
// composition stays on-brand.
const BRAND_BG = { r: 0x0a, g: 0x0e, b: 0x13, alpha: 1 };

// ── public/icons/* — referenced by app/manifest.ts ─────────────────────────
await rasterize(anySvg, join(iconsOutDir, "icon-192.png"), 192);
await rasterize(anySvg, join(iconsOutDir, "icon-512.png"), 512);
// Apple touch icons should be opaque; flatten over the brand background.
await rasterizeOpaque(anySvg, join(iconsOutDir, "apple-touch-icon.png"), 180, BRAND_BG);
await rasterize(maskableSvg, join(iconsOutDir, "icon-maskable-512.png"), 512);

// ── app/* — Next.js file-convention favicons (used by the document head) ───
await rasterize(anySvg, join(appDir, "icon.png"), 512);
await rasterizeOpaque(anySvg, join(appDir, "apple-icon.png"), 180, BRAND_BG);
