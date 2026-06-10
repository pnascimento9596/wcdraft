#!/usr/bin/env node
// Screenshot + DOM-probe harness for ws-ux/seam-and-quota.
//
// Captures, per viewport (390x844, 360x800):
//   a-blind-review                hidden-mode review screen post my fix —
//                                 rating-by-line list renders unconditionally
//                                 with masked values from the seam; no real
//                                 per-line numerics in DOM or React state.
//   b-spin-stage-quota-warn       formation-lock under simulated quota
//                                 exhaustion → standalone spin stage renders
//                                 the volatile-storage warning inline.
//
// Probes:
//   - DOM probe on the blind-review surface: digit scan over the rating
//     selectors that lineStrengthViews feeds (the `lineVal` cells) and the
//     squad-avg, plus a JSON dump of the React fiber state for the
//     line-strength rows confirming `value: null` per row.

const PW_DIR = process.env.PW_DIR ?? "/tmp/pw-screenshots/node_modules/playwright";
const { chromium } = await import(`${PW_DIR}/index.mjs`).catch(() =>
  import(`${PW_DIR}/index.js`),
);
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "360x800", width: 360, height: 800 },
];

const BASE = process.argv[3] ?? process.env.BASE_URL ?? "http://localhost:3401";

async function waitForReady(page) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 });
  await page.waitForTimeout(500);
}

async function clearAllRuns(page) {
  await page.evaluate(() => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });
}

async function shot(page, dir, name, fullPage = true) {
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage });
}

async function spinAndReveal(page) {
  const spinBtn = page.getByRole("button", { name: /^spin$/i }).first();
  await spinBtn.click();
  await page.waitForTimeout(250);
  const revealBtn = page.getByRole("button", { name: /reveal squad/i }).first();
  await revealBtn.click();
  await waitForReady(page);
}

async function completeDraft(page) {
  for (let i = 0; i < 30; i += 1) {
    if ((await page.getByRole("button", { name: /review xi/i }).count()) > 0) return;
    if ((await page.getByRole("button", { name: /^spin$/i }).count()) > 0) {
      await spinAndReveal(page);
    }
    const candidates = page.locator('[aria-label="Candidates"]');
    if ((await candidates.count()) === 0) {
      await page.waitForTimeout(400);
      continue;
    }
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
  throw new Error("completeDraft: Review CTA did not appear within 30 iterations");
}

const BLIND_DIGIT_SELECTORS = [
  '[class*="lineVal"]',
  '[class*="squadAvg"]',
];

async function blindDigitProbe(page, surface) {
  const offenders = await page.evaluate((selectors) => {
    const bad = [];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const text = (el.textContent ?? "").trim();
        if (/\d/.test(text)) bad.push(`${sel} → "${text}"`);
      }
    }
    return bad;
  }, BLIND_DIGIT_SELECTORS);
  if (offenders.length > 0) {
    throw new Error(`blind digit probe FAILED on ${surface}:\n  ${offenders.join("\n  ")}`);
  }
  console.log(`  ✓ blind digit probe clean: ${surface}`);
}

// Read line-strength view-model from React fibers — proves the per-line
// `value` is null in React state, not just hidden by markup.
async function probeReactState(page) {
  const result = await page.evaluate(() => {
    function findFiber(node) {
      if (!node) return null;
      const key = Object.keys(node).find(
        (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"),
      );
      return key ? node[key] : null;
    }
    function isLineStrengthRow(x) {
      return (
        x &&
        typeof x === "object" &&
        !Array.isArray(x) &&
        "line" in x &&
        "label" in x &&
        "count" in x &&
        "value" in x
      );
    }
    function isLineStrengthArray(v) {
      return Array.isArray(v) && v.length > 0 && v.every(isLineStrengthRow);
    }
    function harvestHooks(fiber, hits) {
      let n = fiber.memoizedState;
      let guard = 0;
      while (n && guard++ < 64) {
        const v = n.memoizedState;
        if (isLineStrengthArray(v)) hits.push(v);
        // useMemo stores [value, deps] in memoizedState too.
        if (Array.isArray(v) && v.length === 2 && isLineStrengthArray(v[0])) {
          hits.push(v[0]);
        }
        n = n.next;
      }
    }
    function walkUp(fiber, hits, seen) {
      while (fiber && !seen.has(fiber)) {
        seen.add(fiber);
        if (fiber.memoizedState) harvestHooks(fiber, hits);
        fiber = fiber.return;
      }
    }
    function walkDown(fiber, hits, seen, depth = 0) {
      if (!fiber || seen.has(fiber) || depth > 400) return;
      seen.add(fiber);
      if (fiber.memoizedState) harvestHooks(fiber, hits);
      walkDown(fiber.child, hits, seen, depth + 1);
      walkDown(fiber.sibling, hits, seen, depth);
    }
    const hits = [];
    const seen = new WeakSet();
    // Seed from rendered DOM nodes that carry fibers in React 19.
    const seeds = new Set();
    for (const sel of [
      "body",
      "main",
      '[class*="lineRatings"]',
      '[class*="lineRow"]',
      '[class*="reviewShell"]',
      '[class*="panel"]',
    ]) {
      for (const el of document.querySelectorAll(sel)) seeds.add(el);
    }
    for (const el of seeds) {
      const f = findFiber(el);
      if (!f) continue;
      walkUp(f, hits, seen);
      walkDown(f, hits, seen);
    }
    return hits;
  });
  return result;
}

async function captureBlindReview(page, dir, viewport) {
  await clearAllRuns(page);
  await page.goto(`${BASE}/play/draft?mode=hidden`);
  await waitForReady(page);
  const lock433 = page.locator("button", { hasText: /^4-3-3/ }).first();
  await lock433.click();
  await waitForReady(page);
  await completeDraft(page);
  await page.getByRole("button", { name: /review xi/i }).first().click();
  await waitForReady(page);
  // Scroll the Rating-by-line panel into view so the screenshot frames it.
  const lineRatings = page.locator('[class*="lineRatings"]').first();
  if ((await lineRatings.count()) > 0) {
    await lineRatings.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
  }
  await shot(page, dir, "a-blind-review");
  await blindDigitProbe(page, `blind review @ ${viewport.name}`);
  const state = await probeReactState(page);
  if (state.length === 0) {
    throw new Error(`React-state probe found no lineStrengthViews snapshot @ ${viewport.name}`);
  }
  for (const arr of state) {
    for (const row of arr) {
      if (row.value !== null) {
        throw new Error(
          `React state leak @ ${viewport.name}: row ${JSON.stringify(row)} has non-null value`,
        );
      }
    }
  }
  console.log(`  ✓ React-state probe: ${state.length} memo(s), all per-line value === null`);
  return state;
}

async function captureSpinQuotaWarn(page, dir, viewport) {
  // Force volatile-storage path: replace setItem with a thrower BEFORE the
  // run-record store probes localStorage on first save.
  await page.addInitScript(() => {
    const proto = window.Storage && window.Storage.prototype;
    if (!proto) return;
    proto.setItem = function () {
      const err = new Error("Quota exceeded (synthetic for QA)");
      err.name = "QuotaExceededError";
      throw err;
    };
  });
  await page.goto(`${BASE}/play/draft?mode=classic`);
  await waitForReady(page);
  const lock433 = page.locator("button", { hasText: /^4-3-3/ }).first();
  await lock433.click();
  // We should land on the standalone spin stage; the warning should be
  // visible above the SpinStage.
  await waitForReady(page);
  // Make sure we're on the spin stage — look for the SPIN button.
  const spinBtn = page.getByRole("button", { name: /^spin$/i }).first();
  await spinBtn.waitFor({ state: "visible", timeout: 10_000 });
  await shot(page, dir, "b-spin-stage-quota-warn");
  // Assert the warning text is actually present.
  const warnText = await page
    .locator('p[role="status"]', { hasText: /saved in this tab only/i })
    .first()
    .textContent({ timeout: 5_000 });
  if (!warnText || !/saved in this tab only/i.test(warnText)) {
    throw new Error(`spin-stage quota warning NOT visible @ ${viewport.name}`);
  }
  console.log(`  ✓ spin-stage quota warning visible: "${warnText.trim()}"`);
}

async function captureViewport(viewport, outRoot, ctxNote) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: true,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const dir = join(outRoot, viewport.name);
  await mkdir(dir, { recursive: true });

  // (a) Blind review.
  const page1 = await ctx.newPage();
  const reactState = await captureBlindReview(page1, dir, viewport);
  await writeFile(
    join(dir, "react-state-line-ratings.json"),
    JSON.stringify({ viewport: viewport.name, hits: reactState }, null, 2),
  );
  await page1.close();

  // (b) Spin stage with quota warning (separate context — needs init script).
  const ctx2 = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: true,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page2 = await ctx2.newPage();
  await captureSpinQuotaWarn(page2, dir, viewport);
  await page2.close();
  await ctx2.close();

  await browser.close();
  ctxNote.dirs.push(dir);
  return dir;
}

async function main() {
  const outRoot =
    process.argv[2] ?? join(process.cwd(), "docs/screenshots/seam-and-quota");
  await mkdir(outRoot, { recursive: true });
  const ctxNote = { dirs: [] };
  for (const viewport of VIEWPORTS) {
    console.log(`▶ seam-and-quota @ ${viewport.name}`);
    const dir = await captureViewport(viewport, outRoot, ctxNote);
    console.log(`  ✓ ${dir}`);
  }
  console.log(`done → ${outRoot}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
