/*
 * Rasterises the committed wcdraft brand SVGs into the favicon/PWA icon files
 * the app and manifest reference. Idempotent — same inputs produce
 * byte-identical images, so the script is safe to run repeatedly in
 * `predev` / `prebuild`.
 *
 * Inputs (committed SVGs — single source of truth for the brand):
 *   - public/brand/logo-mark.svg         → full A mark for 512px contexts
 *   - public/brand/logo-mark-compact.svg → A-small mark for <48px and safe-zone contexts
 *
 * Outputs (all under public/icons/, committed PNGs):
 *   - icon-192.png            (192x192, purpose "any", compact)
 *   - icon-512.png            (512x512, purpose "any", full)
 *   - apple-touch-icon.png    (180x180, Apple touch metadata)
 *   - icon-maskable-512.png   (512x512, purpose "maskable")
 *
 * Also overwrites the Next.js app-router file-convention icons so the favicon
 * and the iOS touch icon match the brand mark:
 *   - app/favicon.ico  (16/32/48, compact)
 *   - app/icon.png       (any size — Next normalises)
 *   - app/apple-icon.png (180x180)
 *
 * Run from anywhere: `node apps/web/scripts/generate-icons.mjs`
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

const fullMarkSvg = readFileSync(join(brandDir, "logo-mark.svg"));
const compactMarkSvg = readFileSync(join(brandDir, "logo-mark-compact.svg"));

const BRAND_BG = "#0a0e13";
const BRAND_LINE = "#eef2f6";

function tileSvg(size, radius) {
  const inset = Math.max(1, Math.round(size * 0.009));
  const strokeWidth = Math.max(1, Math.round(size * 0.006));
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" fill="${BRAND_BG}"/>
  <rect x="${inset}" y="${inset}" width="${size - inset * 2}" height="${size - inset * 2}" rx="${Math.max(0, radius - inset)}" fill="none" stroke="${BRAND_LINE}" stroke-opacity=".08" stroke-width="${strokeWidth}"/>
</svg>`);
}

async function markPng(svg, size) {
  return sharp(svg, { density: 512 })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 })
    .resize(size, size, { fit: "contain" })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function iconBuffer(svg, size, { markScale, radius }) {
  const markSize = Math.round(size * markScale);
  const mark = await markPng(svg, markSize);
  const offset = Math.round((size - markSize) / 2);
  return sharp(tileSvg(size, radius))
    .composite([{ input: mark, left: offset, top: offset }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function writeIcon(svg, outPath, size, opts) {
  const buffer = await iconBuffer(svg, size, opts);
  writeFileSync(outPath, buffer);
  console.log("wrote", outPath.replace(webRoot + "/", ""));
}

function icoBuffer(images) {
  const headerSize = 6;
  const dirSize = 16 * images.length;
  let offset = headerSize + dirSize;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const dirs = images.map(({ size, buffer }) => {
    const dir = Buffer.alloc(16);
    dir.writeUInt8(size === 256 ? 0 : size, 0);
    dir.writeUInt8(size === 256 ? 0 : size, 1);
    dir.writeUInt8(0, 2);
    dir.writeUInt8(0, 3);
    dir.writeUInt16LE(1, 4);
    dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(buffer.byteLength, 8);
    dir.writeUInt32LE(offset, 12);
    offset += buffer.byteLength;
    return dir;
  });

  return Buffer.concat([header, ...dirs, ...images.map((image) => image.buffer)]);
}

// ── public/icons/* — referenced by app/manifest.ts ─────────────────────────
await writeIcon(compactMarkSvg, join(iconsOutDir, "icon-192.png"), 192, {
  markScale: 0.68,
  radius: 42,
});
await writeIcon(fullMarkSvg, join(iconsOutDir, "icon-512.png"), 512, {
  markScale: 0.78,
  radius: 112,
});
await writeIcon(compactMarkSvg, join(iconsOutDir, "apple-touch-icon.png"), 180, {
  markScale: 0.68,
  radius: 40,
});
await writeIcon(compactMarkSvg, join(iconsOutDir, "icon-maskable-512.png"), 512, {
  markScale: 0.58,
  radius: 0,
});

// ── app/* — Next.js file-convention favicons (used by the document head) ───
await writeIcon(compactMarkSvg, join(appDir, "icon.png"), 512, {
  markScale: 0.68,
  radius: 112,
});
await writeIcon(compactMarkSvg, join(appDir, "apple-icon.png"), 180, {
  markScale: 0.68,
  radius: 40,
});

const faviconImages = await Promise.all(
  [16, 32, 48].map(async (size) => ({
    size,
    buffer: await iconBuffer(compactMarkSvg, size, {
      markScale: 0.82,
      radius: Math.round(size * 0.22),
    }),
  })),
);
const faviconPath = join(appDir, "favicon.ico");
writeFileSync(faviconPath, icoBuffer(faviconImages));
console.log("wrote", faviconPath.replace(webRoot + "/", ""));
