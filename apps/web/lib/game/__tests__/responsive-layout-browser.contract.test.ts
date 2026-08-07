/**
 * Browser-backed responsive layout probes (require Playwright browser binaries).
 * Kept out of `test:unit` so the unit suite is hermetic without ms-playwright installs.
 * Invoked via `test:browser` / the aggregate `test` script.
 */
import { describe, expect, it } from "vitest";
import { chromium, webkit } from "playwright-core";

import { scanNarrowCollisions } from "../../../scripts/narrow-collision-scan";

describe("responsive layout browser probes", () => {
  it("detects aria-hidden Class B paint and records native label names", async () => {
    const playwrightChannel = process.env.WCDRAFT_PLAYWRIGHT_CHANNEL;
    const browser = await chromium.launch({
      ...(playwrightChannel ? { channel: playwrightChannel } : {}),
      headless: true,
    });
    try {
      const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
      await page.setContent(`
        <style>
          body { margin: 0; }
          #target { position: fixed; left: 20px; top: 20px; width: 100px; height: 50px; }
          #paint { position: fixed; left: 40px; top: 20px; width: 50px; height: 50px;
            pointer-events: none; z-index: 3; }
          #name-occluder { position: fixed; left: 20px; top: 100px; width: 100px; height: 50px;
            z-index: 3; }
          #team-name { position: fixed; left: 20px; top: 100px; width: 100px; height: 50px; }
        </style>
        <button id="target" aria-label="Target">Target</button>
        <span id="paint" aria-hidden="true">01</span>
        <label for="team-name">Team name</label>
        <input id="team-name" />
        <div id="name-occluder" aria-label="Occluder"></div>
      `);
      const findings = await scanNarrowCollisions(page);
      expect(
        findings.some(
          (finding) =>
            finding.class === "B" &&
            finding.targetSelector === "#target" &&
            finding.occluderSelector === "#paint",
        ),
      ).toBe(true);
      expect(
        findings.some(
          (finding) =>
            finding.class === "A" &&
            finding.targetSelector === "#team-name" &&
            finding.targetName === "Team name",
        ),
      ).toBe(true);
    } finally {
      await browser.close();
    }
  });

  it("ignores foreign-document stale hits without masking current-page collisions", async () => {
    const browserEngine = process.env.WCDRAFT_PLAYWRIGHT_BROWSER === "chromium" ? chromium : webkit;
    const browser = await browserEngine.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
      await page.setContent(`
        <style>
          body { margin: 0; }
          #target { position: fixed; left: 20px; top: 20px; width: 100px; height: 50px; }
          #product-occluder { position: fixed; left: 20px; top: 20px; width: 100px; height: 50px;
            display: none; z-index: 4; }
        </style>
        <button id="target" aria-label="Product target">Product target</button>
        <div id="product-occluder">Current product blocker</div>
      `);
      await page.evaluate(() => {
        const target = document.querySelector<HTMLElement>("#target")!;
        const productOccluder = document.querySelector<HTMLElement>("#product-occluder")!;
        const foreignDocument = document.implementation.createHTMLDocument("stale page");
        const staleDot = foreignDocument.createElement("div");
        staleDot.textContent = "·";
        staleDot.getBoundingClientRect = () => new DOMRect(20, 20, 100, 50);
        const pageGlobal = globalThis as typeof globalThis & {
          __wcdraftForeignDocument?: Document;
        };
        pageGlobal.__wcdraftForeignDocument = foreignDocument;
        document.elementFromPoint = () => staleDot;
        document.elementsFromPoint = () => [
          staleDot,
          ...(productOccluder.style.display === "block" ? [productOccluder] : []),
          target,
          document.body,
          document.documentElement,
        ];
      });

      expect(await scanNarrowCollisions(page)).toEqual([]);

      await page.locator("#product-occluder").evaluate((occluder) => {
        occluder.style.display = "block";
      });
      expect(await scanNarrowCollisions(page)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            class: "A",
            targetSelector: "#target",
            occluderSelector: "#product-occluder",
          }),
        ]),
      );
    } finally {
      await browser.close();
    }
  });
});
