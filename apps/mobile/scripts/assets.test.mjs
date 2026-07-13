import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(here, "..");
const iconPath = join(
  mobileRoot,
  "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png",
);
const contentsPath = join(
  mobileRoot,
  "ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json",
);
const vectorPath = join(mobileRoot, "..", "web", "assets", "brand", "medallion-badge.svg");

describe("iOS assets from medallion", () => {
  it("ships an opaque 1024 PNG app icon", async () => {
    assert.equal(existsSync(iconPath), true);
    const require = createRequire(import.meta.url);
    let sharp;
    try {
      sharp = (await import("sharp")).default;
    } catch {
      // resolve from monorepo pnpm store when not hoisted
      const { pathToFileURL } = await import("node:url");
      const root = join(mobileRoot, "..", "..", "node_modules", ".pnpm");
      const { readdirSync } = await import("node:fs");
      const entries = readdirSync(root).filter((e) => e.startsWith("sharp@"));
      assert.ok(entries.length, "sharp should be installed");
      sharp = (
        await import(pathToFileURL(join(root, entries[0], "node_modules/sharp/lib/index.js")).href)
      ).default;
    }
    const meta = await sharp(readFileSync(iconPath)).metadata();
    assert.equal(meta.width, 1024);
    assert.equal(meta.height, 1024);
    assert.equal(meta.format, "png");
    assert.equal(meta.hasAlpha, false);
  });

  it("Contents.json points at AppIcon-1024.png", () => {
    const json = JSON.parse(readFileSync(contentsPath, "utf8"));
    assert.equal(json.images[0].filename, "AppIcon-1024.png");
    assert.equal(json.images[0].size, "1024x1024");
  });

  it("generator script is committed", () => {
    assert.equal(existsSync(join(mobileRoot, "scripts/generate-ios-assets.mjs")), true);
  });

  it("uses the resolution-independent medallion source", () => {
    assert.equal(existsSync(vectorPath), true);
    const vector = readFileSync(vectorPath, "utf8");
    assert.match(vector, /viewBox="0 0 1024 1024"/u);
    assert.match(vector, /Space Grotesk 700 outlines/u);
  });
});
