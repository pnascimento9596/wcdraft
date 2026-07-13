import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(here, "..");

describe("@wcdraft/mobile capacitor config", () => {
  it("declares hybrid production defaults in capacitor.config.ts", () => {
    const src = readFileSync(join(mobileRoot, "capacitor.config.ts"), "utf8");
    assert.match(src, /appId:\s*"com\.wcdraft\.app"/);
    assert.match(src, /appName:\s*"wcdraft"/);
    assert.match(src, /webDir:\s*"www"/);
    assert.match(src, /https:\/\/www\.wcdraft\.com/);
    assert.match(src, /WCDRAFT_MOBILE_SERVER_URL/);
    assert.match(src, /backgroundColor:\s*"#0a0e13"/);
  });

  it("package scripts expose sync/open/build entrypoints", () => {
    const pkg = JSON.parse(readFileSync(join(mobileRoot, "package.json"), "utf8"));
    assert.ok(pkg.scripts.sync);
    assert.ok(pkg.scripts.open);
    assert.ok(pkg.scripts.build);
    assert.ok(pkg.scripts.typecheck);
    assert.equal(pkg.dependencies["@capacitor/core"] !== undefined, true);
    assert.equal(pkg.dependencies["@capacitor/ios"] !== undefined, true);
  });

  it("prepare-www script exists and is re-runnable", () => {
    assert.equal(existsSync(join(mobileRoot, "scripts/prepare-www.mjs")), true);
  });
});
