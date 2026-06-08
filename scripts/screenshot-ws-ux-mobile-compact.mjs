#!/usr/bin/env node
// Capture before/after screenshots for ws-ux/mobile-compact-v3 at both mobile
// viewports (390x844 iPhone-class, 360x800 small Android-class).
//
// Surfaces visited in order on EACH viewport, against BEFORE (port 3001) and
// AFTER (port 3002) servers:
//   1. /play/draft → formation-lock (the LOCK gate; "Lock a formation")
//   2. /play/draft → click 4-3-3 → SpinStage idle (spin-reveal)
//   3. /play/draft → spin → reveal squad → lineup (draft/synergy)
//   4. /play/draft → lineup → search/scroll → player-list
//   5. /play/draft → lineup → click candidate → assign-flow scroll + sticky CTA
//   6. /play/draft → lineup → cycle each of the 6 formations to capture
//      pitch chip layout (overlap test)
//
// All screenshots: full-page PNG, prefers-color-scheme dark (default brand),
// emulate=mobile=false (we use exact viewport without devicePixelRatio
// scaling so chip widths match the CSS px we compact for).
//
// Usage:
//   node scripts/screenshot-ws-ux-mobile-compact.mjs <out-dir>
//
// Requires playwright 1.60+ available on PATH (or via global npm).

// Playwright is loaded from an external install dir set by PW_DIR so we
// don't add it to the repo's lockfile. Defaults to /tmp/pw-screenshots
// which the runner provisions ahead of time.
const PW_DIR = process.env.PW_DIR ?? "/tmp/pw-screenshots/node_modules/playwright";
const { chromium } = await import(`${PW_DIR}/index.mjs`).catch(() => import(`${PW_DIR}/index.js`));
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "360x800", width: 360, height: 800 },
];

const VARIANTS = [
  { label: "before", base: "http://localhost:3001" },
  { label: "after", base: "http://localhost:3002" },
];

const FORMATION_IDS = ["4-3-3", "4-2-3-1", "4-4-2", "3-5-2", "3-4-3", "5-3-2"];

async function waitForReady(page) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 });
  // Wait an additional 800ms so layout shifts settle (icons, fonts).
  await page.waitForTimeout(800);
}

async function clearAllRuns(page) {
  // Wipe localStorage so /play/draft always starts on the formation-lock gate.
  await page.evaluate(() => {
    try {
      localStorage.clear();
    } catch {
      /* private mode */
    }
  });
}

async function shotFullPage(page, dir, name) {
  const path = join(dir, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function captureForVariantViewport(variant, viewport, outRoot) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: true,
    colorScheme: "dark",
    reducedMotion: "reduce", // makes the spin reveal deterministic
  });
  const page = await ctx.newPage();
  const dir = join(outRoot, variant.label, viewport.name);
  await mkdir(dir, { recursive: true });

  // 0) Land on /play and clear storage on the SAME origin.
  await page.goto(`${variant.base}/play`);
  await waitForReady(page);
  await clearAllRuns(page);
  await shotFullPage(page, dir, "00-mode-select");

  // 1) Formation-lock gate.
  await page.goto(`${variant.base}/play/draft`);
  await waitForReady(page);
  await shotFullPage(page, dir, "01-formation-lock");

  // 2) Click 4-3-3 → SpinStage idle (Press spin).
  // The formation cards are <button>; click the one whose text starts with
  // "4-3-3".
  const lock433 = page.locator("button", { hasText: /^4-3-3/ }).first();
  await lock433.click();
  await waitForReady(page);
  await shotFullPage(page, dir, "02-spin-stage-idle");

  // 3) Spin → reveal → lineup. Reduced-motion makes anim snap to settled.
  const spinBtn = page.getByRole("button", { name: /^spin$/i }).first();
  await spinBtn.click();
  await page.waitForTimeout(300);
  const revealBtn = page.getByRole("button", { name: /reveal squad/i }).first();
  await revealBtn.click();
  await waitForReady(page);
  await shotFullPage(page, dir, "03-lineup-initial");

  // 4) Player list (scroll to the candidates panel).
  const candidatesSection = page.locator('[aria-label="Candidates"]').first();
  if ((await candidatesSection.count()) > 0) {
    await candidatesSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shotFullPage(page, dir, "04-player-list");

    // ws-ux/mobile-compact-v3: count collapsed candidate rows whose
    // bounding box intersects the viewport. Logged (not asserted) so
    // the harness keeps capturing even if the target slips - the
    // density target is 8-9 rows at 390x844, >= 7 at 360x800.
    const visibleRows = await page.evaluate(({ vw, vh }) => {
      const rows = Array.from(
        document.querySelectorAll(
          '[aria-label="Candidates"] button[aria-pressed]',
        ),
      );
      return rows.filter((row) => {
        const r = row.getBoundingClientRect();
        return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
      }).length;
    }, { vw: viewport.width, vh: viewport.height });
    console.log(
      `  · ${variant.label}/${viewport.name} candidate rows visible: ${visibleRows}`,
    );
  }

  // 5) Assign-flow: click the first candidate row → should auto-scroll up
  //    to the formation panel. We capture the post-click state from the top.
  const firstCand = page.locator("button[aria-pressed]", { hasText: /OVR$/ }).first();
  if ((await firstCand.count()) === 0) {
    // Fall back to any candidate-row button under the candidates panel.
    const fallback = page.locator('[aria-label="Candidates"] button').first();
    if ((await fallback.count()) > 0) {
      await fallback.scrollIntoViewIfNeeded();
      await fallback.click();
    }
  } else {
    await firstCand.scrollIntoViewIfNeeded();
    await firstCand.click();
  }
  // Give the smooth scroll a beat to land.
  await page.waitForTimeout(500);
  await shotFullPage(page, dir, "05-assign-flow-scrolled");

  // Also capture a viewport-only shot to show what the user sees at the top
  // right after assign-flow auto-scroll (and the sticky lock CTA).
  await page.screenshot({
    path: join(dir, "05-assign-flow-viewport.png"),
    fullPage: false,
  });

  // 6) Pitch chip overlap per formation. For each formation: clear, go to
  //    /play/draft, click that formation card, advance to lineup (spin →
  //    reveal), and shot the formation panel. We snap the FORMATION PANEL
  //    region only to highlight chip layout.
  for (const fid of FORMATION_IDS) {
    await clearAllRuns(page);
    await page.goto(`${variant.base}/play/draft`);
    await waitForReady(page);

    const lockFid = page.locator("button", { hasText: new RegExp(`^${fid}`) }).first();
    if ((await lockFid.count()) === 0) continue;
    await lockFid.click();
    await waitForReady(page);

    const spin = page.getByRole("button", { name: /^spin$/i }).first();
    await spin.click();
    await page.waitForTimeout(300);
    const reveal = page.getByRole("button", { name: /reveal squad/i }).first();
    await reveal.click();
    await waitForReady(page);

    const panel = page.locator('[aria-label="Your formation"]').first();
    if ((await panel.count()) > 0) {
      await panel.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await panel.screenshot({
        path: join(dir, `06-pitch-${fid}.png`),
      });
    }
  }

  await browser.close();
  return dir;
}

async function main() {
  const outRoot =
    process.argv[2] ?? join(process.cwd(), "docs/screenshots/ws-ux+mobile-compact-v3");
  await mkdir(outRoot, { recursive: true });

  for (const variant of VARIANTS) {
    for (const viewport of VIEWPORTS) {
      console.log(`▶ ${variant.label} @ ${viewport.name}`);
      const dir = await captureForVariantViewport(variant, viewport, outRoot);
      console.log(`  ✓ ${dir}`);
    }
  }
  console.log(`done → ${outRoot}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
