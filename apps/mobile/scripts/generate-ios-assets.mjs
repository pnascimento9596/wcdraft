#!/usr/bin/env node
/**
 * Deterministic iOS App Icon + Splash generator from the shipped vector medallion.
 *
 * Source:
 *   apps/web/assets/brand/medallion-badge.svg (resolution-independent)
 *
 * Outputs (written under apps/mobile/ios/...):
 *   - AppIcon.appiconset/AppIcon-1024.png  (opaque RGB, no alpha — store-safe)
 *   - Splash.imageset/splash-*.png          (dark shell #0a0e13 + centered mark)
 *
 * Re-run: `pnpm --filter @wcdraft/mobile generate:assets`
 *
 * The SVG is the single source for web/PWA and iOS assets; no raster is upscaled.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(here, "..");
const repoRoot = join(mobileRoot, "..", "..");
const masterPath = join(repoRoot, "apps/web/assets/brand/medallion-badge.svg");

const BG = { r: 10, g: 14, b: 19 }; // #0a0e13 — PWA manifest background_color
const ACCENT_RING = { r: 46, g: 207, b: 146 }; // unused — mark already gold-bordered

const iconDir = join(mobileRoot, "ios/App/App/Assets.xcassets/AppIcon.appiconset");
const splashDir = join(mobileRoot, "ios/App/App/Assets.xcassets/Splash.imageset");

const require = createRequire(import.meta.url);

async function loadSharp() {
  try {
    return (await import("sharp")).default;
  } catch {
    const { globSync } = await import("node:fs");
    const root = join(repoRoot, "node_modules", ".pnpm");
    const matches = globSync("sharp@*/node_modules/sharp/lib/index.js", {
      cwd: root,
    });
    if (!matches.length) {
      throw new Error("sharp not found; run `pnpm install` from the monorepo root first.");
    }
    return (await import(pathToFileURL(join(root, matches[0])).href)).default;
  }
}

if (!existsSync(masterPath)) {
  throw new Error(`medallion master missing: ${masterPath}`);
}

const sharp = await loadSharp();
mkdirSync(iconDir, { recursive: true });
mkdirSync(splashDir, { recursive: true });

/** Opaque 1024×1024 app icon — alpha stripped for App Store validation. */
async function writeAppIcon() {
  const size = 1024;
  // Pad mark slightly so gold border isn't clipped at the mask edge.
  const markSize = Math.round(size * 0.92);
  const mark = await sharp(masterPath)
    .resize(markSize, markSize, { fit: "contain" })
    .png()
    .toBuffer();

  const composed = await sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: BG,
    },
  })
    .composite([
      {
        input: mark,
        gravity: "centre",
      },
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  // Force no alpha (store: "must not include alpha channel")
  const opaque = await sharp(composed).removeAlpha().png().toBuffer();
  const outPath = join(iconDir, "AppIcon-1024.png");
  writeFileSync(outPath, opaque);

  // Validate: PNG, 1024, no alpha
  const meta = await sharp(opaque).metadata();
  if (meta.width !== 1024 || meta.height !== 1024) {
    throw new Error(`icon size ${meta.width}x${meta.height}, expected 1024x1024`);
  }
  if (meta.hasAlpha) {
    throw new Error("icon still has alpha channel after removeAlpha()");
  }
  if (meta.format !== "png") {
    throw new Error(`icon format ${meta.format}, expected png`);
  }

  writeFileSync(
    join(iconDir, "Contents.json"),
    JSON.stringify(
      {
        images: [
          {
            filename: "AppIcon-1024.png",
            idiom: "universal",
            platform: "ios",
            size: "1024x1024",
          },
        ],
        info: { author: "wcdraft-m1a", version: 1 },
      },
      null,
      2,
    ) + "\n",
  );

  // Remove legacy Capacitor default if present
  const legacy = join(iconDir, "AppIcon-512@2x.png");
  if (existsSync(legacy)) {
    const { unlinkSync } = await import("node:fs");
    unlinkSync(legacy);
  }

  console.log("wrote", outPath.replace(repoRoot + "/", ""));
  console.log(
    "icon meta:",
    JSON.stringify({
      width: meta.width,
      height: meta.height,
      format: meta.format,
      hasAlpha: meta.hasAlpha,
      space: meta.space,
    }),
  );
}

/** Splash images: solid dark shell + centered medallion. */
async function writeSplash() {
  // Capacitor template uses three identical 2732 slots; keep that layout.
  const canvas = 2732;
  const markSize = Math.round(canvas * 0.28);
  const mark = await sharp(masterPath)
    .resize(markSize, markSize, { fit: "contain" })
    .png()
    .toBuffer();

  const splash = await sharp({
    create: {
      width: canvas,
      height: canvas,
      channels: 3,
      background: BG,
    },
  })
    .composite([{ input: mark, gravity: "centre" }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  const names = ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"];
  for (const name of names) {
    const out = join(splashDir, name);
    writeFileSync(out, splash);
    console.log("wrote", out.replace(repoRoot + "/", ""));
  }

  writeFileSync(
    join(splashDir, "Contents.json"),
    JSON.stringify(
      {
        images: [
          {
            idiom: "universal",
            filename: "splash-2732x2732.png",
            scale: "1x",
          },
          {
            idiom: "universal",
            filename: "splash-2732x2732-1.png",
            scale: "2x",
          },
          {
            idiom: "universal",
            filename: "splash-2732x2732-2.png",
            scale: "3x",
          },
        ],
        info: { author: "wcdraft-m1a", version: 1 },
      },
      null,
      2,
    ) + "\n",
  );
}

// Silence unused lint for reserved accent (documented for future variants)
void ACCENT_RING;

await writeAppIcon();
await writeSplash();

// Fingerprint source for determinism notes
const masterBytes = readFileSync(masterPath);
console.log(
  "source master bytes:",
  masterBytes.length,
  "path: apps/web/assets/brand/medallion-badge.svg",
);
console.log("generate-ios-assets: ok");
