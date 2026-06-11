/*
 * Generates the marketing/social raster assets from committed source artwork.
 * This is intentionally separate from generate-icons.mjs: the in-app SVG mark,
 * header lockup, and PWA icon sources stay canonical and unchanged.
 *
 * Inputs (committed originals):
 *   - public/brand/marketing/banner.png
 *   - public/brand/marketing/logo-medallion.png
 *   - public/brand/wcdraft-lockup.svg (overlay only; source is not modified)
 *
 * Outputs (committed, deterministic PNGs):
 *   - public/brand/marketing/og-default.png (1200x630)
 *   - public/brand/marketing/og-square.png  (1200x1200)
 *
 * Run from anywhere: `node apps/web/scripts/generate-marketing-assets.mjs`
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const publicDir = join(webRoot, "public");
const brandDir = join(publicDir, "brand");
const marketingDir = join(brandDir, "marketing");

mkdirSync(marketingDir, { recursive: true });

// Match generate-icons.mjs: sharp is usually present through Next's transitive
// dependency, but pnpm may keep it under the workspace .pnpm directory.
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
        "sharp not found; install dev deps (`pnpm install`) before running the marketing asset generator.",
      );
    }
    return (await import(pathToFileURL(join(root, matches[0])).href)).default;
  }
}

const sharp = await loadSharp();

const OG_MAX_BYTES = 300 * 1024;
const bannerPath = join(marketingDir, "banner.png");
const medallionPath = join(marketingDir, "logo-medallion.png");
const lockupSvg = readFileSync(join(brandDir, "wcdraft-lockup.svg"));

const lockupOverlay = await sharp(lockupSvg, { density: 384 })
  .resize({ width: 390 })
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toBuffer();

const lockupPlate = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="plate" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#020604" stop-opacity="0.78"/>
      <stop offset="1" stop-color="#07140f" stop-opacity="0.50"/>
    </linearGradient>
  </defs>
  <rect x="34" y="36" width="442" height="116" rx="18" fill="url(#plate)"/>
  <rect x="35" y="37" width="440" height="114" rx="17" fill="none" stroke="#f5b62a" stroke-opacity="0.28" stroke-width="1.5"/>
</svg>`);

function defaultOgPipeline() {
  return sharp(bannerPath)
    .resize(1200, 630, {
      fit: "cover",
      position: "centre",
      kernel: "lanczos3",
    })
    .composite([
      { input: lockupPlate, left: 0, top: 0 },
      { input: lockupOverlay, left: 58, top: 48 },
    ])
    .flatten({ background: "#020604" });
}

function squareOgPipeline() {
  return sharp(medallionPath)
    .resize(1200, 1200, {
      fit: "cover",
      position: "centre",
      kernel: "lanczos3",
    })
    .flatten({ background: "#f7f5f0" });
}

async function writeOptimizedPng(name, outPath, pipelineFactory) {
  let best = null;
  for (const colors of [256, 224, 192, 160, 128, 96, 64]) {
    const buffer = await pipelineFactory()
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

  if (!best) {
    throw new Error(`generate-marketing-assets: failed to render ${name}`);
  }
  if (best.buffer.byteLength > OG_MAX_BYTES) {
    throw new Error(
      `${name} is ${(best.buffer.byteLength / 1024).toFixed(1)}KB; expected <= 300KB`,
    );
  }

  writeFileSync(outPath, best.buffer);
  console.log(
    `wrote ${outPath.replace(webRoot + "/", "")} (${best.colors} colors, ${(
      best.buffer.byteLength / 1024
    ).toFixed(1)}KB)`,
  );
}

await writeOptimizedPng("og-default.png", join(marketingDir, "og-default.png"), defaultOgPipeline);
await writeOptimizedPng("og-square.png", join(marketingDir, "og-square.png"), squareOgPipeline);
