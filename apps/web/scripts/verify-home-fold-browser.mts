import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

type Motion = "full" | "reduced";
type Theme = "light" | "dark";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3032";
const phase = process.env.WCDRAFT_HOME_FOLD_PHASE ?? "capture";
const strict = process.env.WCDRAFT_HOME_FOLD_STRICT === "1";
const outDir =
  process.env.WCDRAFT_HOME_FOLD_OUT_DIR ??
  path.join(repoRoot, "docs/reports/final-polish-u2-fold-2026-07-14", phase);
const viewports = [
  { name: "360x800", width: 360, height: 800 },
  { name: "390x844", width: 390, height: 844 },
] as const;
const themes: readonly Theme[] = ["light", "dark"];
const motions: readonly Motion[] = ["full", "reduced"];
const axeCdn = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js";

async function main(): Promise<void> {
  const screenshotsDir = path.join(outDir, "screenshots");
  await mkdir(screenshotsDir, { recursive: true });
  const axeSource = await fetch(axeCdn).then(async (response) => {
    if (!response.ok)
      throw new Error(`failed to fetch axe-core: HTTP ${response.status.toString()}`);
    return await response.text();
  });
  const browser = await chromium.launch({
    channel: process.env.WCDRAFT_PLAYWRIGHT_CHANNEL ?? "chrome",
    headless: true,
  });
  const measurements: unknown[] = [];

  try {
    for (const viewport of viewports) {
      for (const theme of themes) {
        for (const motion of motions) {
          const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            colorScheme: theme,
            reducedMotion: motion === "reduced" ? "reduce" : "no-preference",
            isMobile: true,
            hasTouch: true,
            deviceScaleFactor: 1,
          });
          await context.addInitScript((selectedTheme: Theme) => {
            window.localStorage.setItem("wcdraft:theme", selectedTheme);
          }, theme);
          const page = await context.newPage();
          const errors: string[] = [];
          page.on("console", (message) => {
            if (
              message.type() === "error" &&
              !message.text().startsWith("Failed to load resource:")
            ) {
              errors.push(message.text());
            }
          });
          page.on("pageerror", (error) => errors.push(error.message));
          await page.goto(baseUrl, { waitUntil: "networkidle" });
          await page.getByRole("heading", { name: /Draft your/u }).waitFor();
          await page
            .locator(
              motion === "reduced"
                ? '[data-hero-spin-poster][data-reduced-motion="true"]'
                : "[data-hero-spin-loop]",
            )
            .waitFor();
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(100);
          await page.addScriptTag({ content: axeSource });
          const axeViolations = (await page.evaluate(`(async () => {
            const result = await window.axe.run(document, {
              runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
            });
            return result.violations.map((violation) =>
              violation.impact ? violation.id + ":" + violation.impact : violation.id
            );
          })()`)) as string[];

          const measured = (await page.evaluate(`(() => {
            const doc = document.documentElement;
            const body = document.body;
            const hero = document.querySelector(".hero");
            const demo = document.querySelector("[data-hero-spin-demo]");
            const animatedDemo = document.querySelector("[data-hero-spin-loop]");
            const poster = document.querySelector("[data-hero-spin-poster]");
            const animatedRows = animatedDemo
              ? [...animatedDemo.children].map((element) => ({
                  className: element.className,
                  top: element.getBoundingClientRect().top,
                  bottom: element.getBoundingClientRect().bottom,
                  height: element.getBoundingClientRect().height,
                }))
              : [];
            const actions = [...document.querySelectorAll(".hero a")];
            const all = [doc, body, ...document.querySelectorAll("body *")];
            const maxScrollWidth = Math.max(...all.map((element) => element.scrollWidth));
            const smallTargets = actions
              .map((element) => {
                const rect = element.getBoundingClientRect();
                return { text: element.textContent?.trim() ?? "", width: rect.width, height: rect.height };
              })
              .filter((target) => target.width < 44 || target.height < 44);
            const rect = (element) => {
              if (!element) return null;
              const value = element.getBoundingClientRect();
              return {
                top: value.top,
                bottom: value.bottom,
                width: value.width,
                height: value.height,
              };
            };
            return {
              scrollHeight: doc.scrollHeight,
              clientHeight: doc.clientHeight,
              verticalOverflow: Math.max(0, doc.scrollHeight - doc.clientHeight),
              scrollWidth: doc.scrollWidth,
              clientWidth: doc.clientWidth,
              maxScrollWidth,
              horizontalOverflow: maxScrollWidth > doc.clientWidth,
              hero: rect(hero),
              demo: rect(demo),
              animatedDemo: rect(animatedDemo),
              animatedRows,
              poster: rect(poster),
              requiredCtaBottom: Math.max(...actions.map((element) => element.getBoundingClientRect().bottom)),
              requiredCtasInViewport: actions.every(
                (element) => element.getBoundingClientRect().bottom <= window.innerHeight,
              ),
              smallTargets,
            };
          })()`)) as {
            scrollHeight: number;
            clientHeight: number;
            verticalOverflow: number;
            scrollWidth: number;
            clientWidth: number;
            maxScrollWidth: number;
            horizontalOverflow: boolean;
            hero: { top: number; bottom: number; width: number; height: number } | null;
            demo: { top: number; bottom: number; width: number; height: number } | null;
            animatedDemo: { top: number; bottom: number; width: number; height: number } | null;
            animatedRows: readonly {
              className: string;
              top: number;
              bottom: number;
              height: number;
            }[];
            poster: { top: number; bottom: number; width: number; height: number } | null;
            requiredCtaBottom: number;
            requiredCtasInViewport: boolean;
            smallTargets: readonly { text: string; width: number; height: number }[];
          };
          const screenshot = path.join(
            screenshotsDir,
            `${phase}-home-${viewport.name}-${theme}-${motion}.png`,
          );
          await page.screenshot({ path: screenshot });
          const row = {
            viewport: viewport.name,
            viewportWidth: viewport.width,
            viewportHeight: viewport.height,
            theme,
            motion,
            screenshot: path.relative(repoRoot, screenshot),
            axeViolations,
            consoleErrors: errors,
            ...measured,
          };
          measurements.push(row);
          console.log(
            `[home-fold:${phase}] ${viewport.name} ${theme} ${motion} overflow=${measured.verticalOverflow.toString()}px horizontal=${measured.horizontalOverflow ? "fail" : "pass"} targets=${measured.smallTargets.length.toString()}`,
          );
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }

  const outputPath = path.join(outDir, `home-fold-${phase}.json`);
  await writeFile(
    outputPath,
    `${JSON.stringify({ phase, baseUrl, measurements }, null, 2)}\n`,
    "utf8",
  );
  if (
    strict &&
    measurements.some((measurement) => {
      const row = measurement as {
        verticalOverflow: number;
        horizontalOverflow: boolean;
        requiredCtasInViewport: boolean;
        smallTargets: readonly unknown[];
        axeViolations: readonly unknown[];
        consoleErrors: readonly unknown[];
      };
      return (
        row.verticalOverflow !== 0 ||
        row.horizontalOverflow ||
        !row.requiredCtasInViewport ||
        row.smallTargets.length > 0 ||
        row.axeViolations.length > 0 ||
        row.consoleErrors.length > 0
      );
    })
  ) {
    throw new Error("home fold verification failed");
  }
}

await main();
