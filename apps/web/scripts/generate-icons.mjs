/*
 * Resizes the committed transparent medallion master into the favicon, PWA,
 * app-router icon, and header badge assets the app references.
 *
 * Input:
 *   - assets/brand/medallion-badge-master.webp
 *
 * Outputs:
 *   - public/brand/logo-header.png
 *   - public/icons/icon-32.png
 *   - public/icons/icon-64.png
 *   - public/icons/icon-120.png
 *   - public/icons/icon-152.png
 *   - public/icons/apple-touch-icon.png
 *   - public/icons/icon-192.png
 *   - public/icons/icon-512.png
 *   - public/favicon.ico
 *   - app/favicon.ico
 *   - app/icon.png
 *   - app/apple-icon.png
 *
 * Run from anywhere: `node apps/web/scripts/generate-icons.mjs`
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const publicDir = join(webRoot, "public");
const iconsOutDir = join(publicDir, "icons");
const brandDir = join(publicDir, "brand");
const appDir = join(webRoot, "app");
const masterPath = join(webRoot, "assets", "brand", "medallion-badge-master.webp");

mkdirSync(iconsOutDir, { recursive: true });
mkdirSync(brandDir, { recursive: true });

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

if (!existsSync(masterPath)) {
  throw new Error(`medallion source asset not found: ${masterPath}`);
}

const sharp = await loadSharp();

async function badgePng(size) {
  return sharp(masterPath)
    .resize(size, size, { fit: "contain", kernel: "lanczos3" })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function writePng(outPath, size) {
  const buffer = await badgePng(size);
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

async function writeIco(outPath) {
  const images = await Promise.all(
    [16, 32, 48].map(async (size) => ({
      size,
      buffer: await badgePng(size),
    })),
  );
  writeFileSync(outPath, icoBuffer(images));
  console.log("wrote", outPath.replace(webRoot + "/", ""));
}

await writePng(join(brandDir, "logo-header.png"), 48);

await writePng(join(iconsOutDir, "icon-32.png"), 32);
await writePng(join(iconsOutDir, "icon-64.png"), 64);
await writePng(join(iconsOutDir, "icon-120.png"), 120);
await writePng(join(iconsOutDir, "icon-152.png"), 152);
await writePng(join(iconsOutDir, "apple-touch-icon.png"), 180);
await writePng(join(iconsOutDir, "icon-192.png"), 192);
await writePng(join(iconsOutDir, "icon-512.png"), 512);

await writePng(join(appDir, "icon.png"), 512);
await writePng(join(appDir, "apple-icon.png"), 180);
await writeIco(join(publicDir, "favicon.ico"));
await writeIco(join(appDir, "favicon.ico"));
