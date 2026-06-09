#!/usr/bin/env node
// Memory (hidden) mode screenshot harness — both mobile viewports
// (390x844 iPhone-class, 360x800 small Android-class), one server.
//
// Surfaces captured per viewport:
//   00-mode-select          /play with BOTH live mode cards
//   01-classic-lineup       classic draft lineup (regression: unchanged)
//   02-classic-candidates   classic candidate list (OVR/hue visible)
//   10-hidden-spin-stage    hidden-mode spin stage (Synergy chip masked)
//   11-hidden-lineup        hidden lineup — SynergyBar + pitch blinded
//   12-hidden-candidates    hidden candidate list — no OVR/channels/hue
//   13-hidden-review        full 17-pick draft → review screen blinded
//   14-hidden-results-reveal post-Simulate results with the MemoryReveal
//
// The hidden flow drives a REAL 17-spin draft (manager picked at first
// offer, first player candidate otherwise) and a REAL simulation — no
// fixtures. reducedMotion makes the drum + reveal deterministic.
//
// Usage:
//   node scripts/screenshot-memory-mode.mjs [out-dir] [base-url]
//
// Playwright is loaded from PW_DIR (default /tmp/pw-screenshots).

const PW_DIR = process.env.PW_DIR ?? "/tmp/pw-screenshots/node_modules/playwright";
const { chromium } = await import(`${PW_DIR}/index.mjs`).catch(() => import(`${PW_DIR}/index.js`));
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "360x800", width: 360, height: 800 },
];

const BASE = process.argv[3] ?? process.env.BASE_URL ?? "http://localhost:3010";

async function waitForReady(page) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 });
  await page.waitForTimeout(600);
}

async function clearAllRuns(page) {
  await page.evaluate(() => {
    try {
      localStorage.clear();
    } catch {
      /* private mode */
    }
  });
}

async function shot(page, dir, name, fullPage = true) {
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage });
}

/** Lock 4-3-3 on the formation gate, then spin → reveal into the lineup. */
async function lockAndFirstReveal(page) {
  const lock433 = page.locator("button", { hasText: /^4-3-3/ }).first();
  await lock433.click();
  await waitForReady(page);
  await spinAndReveal(page);
}

async function spinAndReveal(page) {
  const spinBtn = page.getByRole("button", { name: /^spin$/i }).first();
  await spinBtn.click();
  await page.waitForTimeout(250);
  const revealBtn = page.getByRole("button", { name: /reveal squad/i }).first();
  await revealBtn.click();
  await waitForReady(page);
}

/**
 * Complete the remaining spins of an in-progress draft: pick the manager at
 * first offer, otherwise the first player candidate, then Lock. Stops when
 * the "Review XI" CTA appears.
 */
async function completeDraft(page) {
  for (let i = 0; i < 30; i += 1) {
    if ((await page.getByRole("button", { name: /review xi/i }).count()) > 0) return;

    // On the spin stage? Spin + reveal first.
    if ((await page.getByRole("button", { name: /^spin$/i }).count()) > 0) {
      await spinAndReveal(page);
    }

    const candidates = page.locator('[aria-label="Candidates"]');
    if ((await candidates.count()) === 0) {
      await page.waitForTimeout(400);
      continue;
    }

    // Manager-first when offered and not yet drafted (enabled row). Player
    // rows are the only candidates rendering the "OVR" cell (masked to "—"
    // in hidden mode, the label remains) — this skips the position-filter
    // segmented buttons, which also carry aria-pressed.
    const managerRow = candidates
      .locator("button:not([disabled])", { hasText: /Manager · / })
      .first();
    const playerRow = candidates.locator("button", { hasText: /OVR/ }).first();
    const target = (await managerRow.count()) > 0 ? managerRow : playerRow;
    await target.scrollIntoViewIfNeeded();
    await target.click();
    await page.waitForTimeout(300);

    const lockBtn = page.getByRole("button", { name: /lock pick/i }).first();
    await lockBtn.click();
    await page.waitForTimeout(400);
  }
  if ((await page.getByRole("button", { name: /review xi/i }).count()) === 0) {
    throw new Error("completeDraft: Review CTA did not appear within 30 iterations");
  }
}

async function captureViewport(viewport, outRoot) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: true,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  const dir = join(outRoot, viewport.name);
  await mkdir(dir, { recursive: true });

  // ── Mode select ─────────────────────────────────────────────────────────
  await page.goto(`${BASE}/play`);
  await waitForReady(page);
  await clearAllRuns(page);
  await shot(page, dir, "00-mode-select");

  // ── Classic (regression — unchanged) ────────────────────────────────────
  await page.goto(`${BASE}/play/draft`);
  await waitForReady(page);
  await lockAndFirstReveal(page);
  await shot(page, dir, "01-classic-lineup");
  const classicCands = page.locator('[aria-label="Candidates"]').first();
  await classicCands.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot(page, dir, "02-classic-candidates");

  // ── Hidden (Memory) — pre-sim blind ─────────────────────────────────────
  await clearAllRuns(page);
  await page.goto(`${BASE}/play/draft?mode=hidden`);
  await waitForReady(page);
  const lock433 = page.locator("button", { hasText: /^4-3-3/ }).first();
  await lock433.click();
  await waitForReady(page);
  await shot(page, dir, "10-hidden-spin-stage");
  await spinAndReveal(page);
  await shot(page, dir, "11-hidden-lineup");
  const hiddenCands = page.locator('[aria-label="Candidates"]').first();
  await hiddenCands.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot(page, dir, "12-hidden-candidates");

  // ── Hidden — complete the draft → blinded review ────────────────────────
  await completeDraft(page);
  await page.getByRole("button", { name: /review xi/i }).first().click();
  await waitForReady(page);
  await shot(page, dir, "13-hidden-review");

  // ── Hidden — Simulate → results with the MemoryReveal ───────────────────
  await page.getByRole("button", { name: /simulate the run/i }).first().click();
  await page.waitForURL(/\/play\/results/, { timeout: 120_000 });
  await waitForReady(page);
  await shot(page, dir, "14-hidden-results-reveal");

  await browser.close();
  return dir;
}

async function main() {
  const outRoot = process.argv[2] ?? join(process.cwd(), "docs/screenshots/memory-hidden-mode");
  await mkdir(outRoot, { recursive: true });
  for (const viewport of VIEWPORTS) {
    console.log(`▶ memory-mode @ ${viewport.name}`);
    const dir = await captureViewport(viewport, outRoot);
    console.log(`  ✓ ${dir}`);
  }
  console.log(`done → ${outRoot}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
