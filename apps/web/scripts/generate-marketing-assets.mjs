/*
 * Deterministically renders the default social card from committed artwork.
 * The banner and square card are protected inputs: this lane only updates the
 * default card's Archivo wordmark.
 *
 * Inputs:
 *   - public/brand/marketing/banner.png
 *   - public/brand/logo-mark.svg
 *   - public/fonts/archivo/archivo-latin-800-normal.woff2
 *
 * Output:
 *   - public/brand/marketing/og-default.png (1200x630, <=300KB)
 *
 * Run from anywhere: `node apps/web/scripts/generate-marketing-assets.mjs`
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const publicDir = join(webRoot, "public");
const brandDir = join(publicDir, "brand");
const marketingDir = join(brandDir, "marketing");

const OG_MAX_BYTES = 300 * 1024;
const bannerPath = join(marketingDir, "banner.png");
const defaultOgPath = join(marketingDir, "og-default.png");
const squareOgPath = join(marketingDir, "og-square.png");
const protectedAssets = new Map([
  [bannerPath, "809a8dfe09b8396fc65083fee5981a128e6407cfd66513988d1f0df678936331"],
  [squareOgPath, "17b4d9f12d3d7dbe4ad275cd2c0a6d109ea8386b3f9117100e5c4352dfb44282"],
]);

for (const path of [bannerPath, defaultOgPath, squareOgPath]) {
  if (!existsSync(path)) throw new Error(`marketing asset is missing: ${path}`);
  if (statSync(path).size <= 0) throw new Error(`marketing asset is empty: ${path}`);
}
for (const [path, expected] of protectedAssets) verifyHash(path, expected);

// Match generate-icons.mjs: Sharp is normally present through Next's
// dependency graph, while pnpm may keep it below the workspace .pnpm store.
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
        "sharp not found; install dev deps (`pnpm install`) before rendering marketing assets.",
      );
    }
    return (await import(pathToFileURL(join(root, matches[0])).href)).default;
  }
}

const sharp = await loadSharp();
const archivoFont = readFileSync(
  join(publicDir, "fonts", "archivo", "archivo-latin-800-normal.woff2"),
).toString("base64");
const markSvg = readFileSync(join(brandDir, "logo-mark.svg"));

const lockupPlate = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="plate" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0f100e" stop-opacity=".90"/>
      <stop offset="1" stop-color="#171a16" stop-opacity=".74"/>
    </linearGradient>
  </defs>
  <rect x="34" y="36" width="442" height="116" rx="18" fill="url(#plate)"/>
  <rect x="35" y="37" width="440" height="114" rx="17" fill="none" stroke="#d4a94e" stroke-opacity=".38" stroke-width="1.5"/>
</svg>`);

const wordmarkSvg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="306" height="90" viewBox="0 0 306 90">
  <style>
    @font-face{font-family:"Archivo";font-style:normal;font-weight:800;src:url("data:font/woff2;base64,${archivoFont}") format("woff2")}
  </style>
  <text x="0" y="63" font-family="Archivo" font-weight="800" font-size="55" letter-spacing="-1.1">
    <tspan fill="#ebe6da">WC</tspan><tspan fill="#3fa268">DRAFT</tspan>
  </text>
</svg>`);

const [markOverlay, wordmarkOverlay] = await Promise.all([
  sharp(markSvg, { density: 384 })
    .resize({ width: 82, height: 82, fit: "contain" })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer(),
  sharp(wordmarkSvg, { density: 192 })
    .resize({ width: 306, height: 90, fit: "fill" })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer(),
]);

function defaultOgPipeline() {
  return sharp(bannerPath)
    .resize(1200, 630, {
      fit: "cover",
      position: "centre",
      kernel: "lanczos3",
    })
    .composite([
      { input: lockupPlate, left: 0, top: 0 },
      { input: markOverlay, left: 54, top: 53 },
      { input: wordmarkOverlay, left: 154, top: 50 },
    ])
    .flatten({ background: "#0f100e" });
}

let best = null;
for (const colors of [256, 224, 192, 160, 128, 96, 64]) {
  const buffer = await defaultOgPipeline()
    .png({
      palette: true,
      colors,
      compressionLevel: 9,
      effort: 10,
      dither: 0.78,
    })
    .toBuffer();
  best = { buffer, colors };
  if (buffer.byteLength <= OG_MAX_BYTES) break;
}
if (!best || best.buffer.byteLength > OG_MAX_BYTES) {
  throw new Error(
    `og-default.png is ${best ? (best.buffer.byteLength / 1024).toFixed(1) : "unknown"}KB; expected <=300KB`,
  );
}

writeFileSync(defaultOgPath, best.buffer);
for (const [path, expected] of protectedAssets) verifyHash(path, expected);
console.log(
  `wrote ${defaultOgPath.replace(webRoot + "/", "")} (${best.colors} colors, ${(best.buffer.byteLength / 1024).toFixed(1)}KB, sha256 ${hash(best.buffer)})`,
);

function verifyHash(path, expected) {
  const actual = hash(readFileSync(path));
  if (actual !== expected) {
    throw new Error(`protected marketing asset changed: ${path} (${actual}, expected ${expected})`);
  }
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
