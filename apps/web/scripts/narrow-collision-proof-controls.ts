import { chromium, webkit, type Browser, type Page } from "playwright-core";

import { scanNarrowCollisions } from "./narrow-collision-scan";
import {
  adjudicateNarrowCollision,
  parseNarrowCollisionEngines,
  type NarrowCollisionFinding,
  type NarrowCollisionRawFinding,
} from "./responsive-layout-contract";

const CONTROL_IDS = [
  "class-b-fires",
  "class-b-transparent-clear",
  "class-a-fires",
  "class-a-separated-clear",
  "same-interactive-blocker",
  "scrolling-shell-pinned-blocker",
] as const;
type ControlId = (typeof CONTROL_IDS)[number];

type FixtureKind =
  | "class-b-positive"
  | "class-b-transparent"
  | "class-a-positive"
  | "class-a-separated"
  | "same-interactive"
  | "scrolling-shell";

type ControlResult = {
  readonly id: ControlId;
  readonly observed: number;
  readonly expected: "present" | "absent";
  readonly passed: boolean;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function installFixture(page: Page, kind: FixtureKind): Promise<void> {
  await page.evaluate((fixtureKind) => {
    document.querySelector("#proof-fixture")?.remove();
    document.querySelector("#proof-fixture-style")?.remove();

    const fixture = document.createElement("section");
    fixture.id = "proof-fixture";
    if (fixtureKind === "same-interactive") {
      fixture.innerHTML =
        '<button id="proof-control"><span id="proof-target">Proof target</span><span id="proof-occluder" aria-hidden="true"></span></button>';
    } else if (fixtureKind === "scrolling-shell") {
      fixture.innerHTML =
        '<button id="proof-target" aria-label="Proof target">Proof target</button><div id="proof-scroll-spacer"><header id="proof-occluder" role="banner" aria-label="Proof shell"></header></div>';
    } else {
      fixture.innerHTML =
        '<button id="proof-target" aria-label="Proof target">Proof target</button><div id="proof-occluder" aria-hidden="true"></div>';
    }
    document.body.append(fixture);

    const style = document.createElement("style");
    style.id = "proof-fixture-style";
    const pointerEvents = fixtureKind.startsWith("class-b") ? "none" : "auto";
    const transparent = fixtureKind === "class-b-transparent";
    const separated = fixtureKind === "class-a-separated";
    style.textContent = `
      #proof-fixture { display: block !important; }
      #proof-target {
        position: fixed !important;
        left: 20px !important;
        top: 20px !important;
        width: 160px !important;
        height: 60px !important;
        margin: 0 !important;
        z-index: 2147482000 !important;
      }
      #proof-occluder {
        position: fixed !important;
        left: ${separated ? "220px" : "20px"} !important;
        top: 20px !important;
        width: 160px !important;
        height: 60px !important;
        z-index: 2147483000 !important;
        pointer-events: ${pointerEvents} !important;
        background: ${transparent ? "transparent" : "rgb(180, 20, 20)"} !important;
        border: 0 !important;
        box-shadow: none !important;
      }
      #proof-control {
        position: fixed !important;
        left: 20px !important;
        top: 20px !important;
        width: 160px !important;
        height: 60px !important;
        margin: 0 !important;
        z-index: 2147482000 !important;
      }
      #proof-control #proof-target,
      #proof-control #proof-occluder {
        position: absolute !important;
        inset: 0 !important;
        width: auto !important;
        height: auto !important;
      }
      #proof-scroll-spacer {
        display: block !important;
        min-height: 1800px !important;
        padding-top: 900px !important;
      }
      #proof-scroll-spacer #proof-occluder {
        position: sticky !important;
        top: 20px !important;
      }
    `;
    document.head.append(style);
    window.scrollTo(0, 0);
  }, kind);
}

function matching(findings: readonly NarrowCollisionRawFinding[], collisionClass: "A" | "B") {
  return findings.filter(
    (finding) =>
      finding.class === collisionClass &&
      finding.targetSelector === "#proof-target" &&
      finding.occluderSelector === "#proof-occluder",
  );
}

function adjudicate(
  findings: readonly NarrowCollisionRawFinding[],
  engine: "chromium" | "webkit",
): NarrowCollisionFinding[] {
  return findings.map((finding) =>
    adjudicateNarrowCollision({
      surface: "proof-control",
      viewport: "390x844",
      theme: "light",
      engine,
      finding,
    }),
  );
}

async function rawFor(browser: Browser, baseUrl: string, fixture: FixtureKind) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
    await installFixture(page, fixture);
    return await scanNarrowCollisions(page);
  } finally {
    await page.close();
  }
}

async function runForEngine(
  engine: "chromium" | "webkit",
  baseUrl: string,
): Promise<readonly ControlResult[]> {
  const browser = await (engine === "chromium" ? chromium : webkit).launch(
    engine === "chromium"
      ? { channel: process.env.WCDRAFT_PLAYWRIGHT_CHANNEL ?? "chrome", headless: true }
      : { headless: true },
  );
  try {
    const classBPositive = matching(await rawFor(browser, baseUrl, "class-b-positive"), "B");
    const classBNegative = matching(await rawFor(browser, baseUrl, "class-b-transparent"), "B");
    const classAPositive = matching(await rawFor(browser, baseUrl, "class-a-positive"), "A");
    const classANegative = matching(await rawFor(browser, baseUrl, "class-a-separated"), "A");
    const sameInteractive = matching(await rawFor(browser, baseUrl, "same-interactive"), "A");
    const scrollingShell = matching(await rawFor(browser, baseUrl, "scrolling-shell"), "A");

    assert(
      sameInteractive.some(
        (finding) => finding.sharedInteractiveAncestor && finding.occluderOpaqueBoxPaint,
      ),
      `${engine}: same-interactive control did not exercise the allowlist predicate boundary`,
    );
    assert(
      scrollingShell.some(
        (finding) =>
          finding.intentionalScrollShell &&
          finding.targetPosition === "fixed" &&
          finding.occluderPosition === "sticky",
      ),
      `${engine}: scrolling-shell control did not exercise the allowlist predicate boundary`,
    );

    const observed: Record<ControlId, readonly NarrowCollisionRawFinding[]> = {
      "class-b-fires": classBPositive,
      "class-b-transparent-clear": classBNegative,
      "class-a-fires": classAPositive,
      "class-a-separated-clear": classANegative,
      "same-interactive-blocker": sameInteractive,
      "scrolling-shell-pinned-blocker": scrollingShell,
    };
    const expectations: Record<ControlId, "present" | "absent"> = {
      "class-b-fires": "present",
      "class-b-transparent-clear": "absent",
      "class-a-fires": "present",
      "class-a-separated-clear": "absent",
      "same-interactive-blocker": "present",
      "scrolling-shell-pinned-blocker": "present",
    };
    return CONTROL_IDS.map((id) => {
      const unexpected = adjudicate(observed[id], engine).filter(
        (finding) => finding.disposition === "unexpected",
      );
      const expected = expectations[id];
      return {
        id,
        observed: unexpected.length,
        expected,
        passed: expected === "present" ? unexpected.length > 0 : unexpected.length === 0,
      };
    });
  } finally {
    await browser.close();
  }
}

const baseUrl = process.env.BASE_URL;
assert(baseUrl, "BASE_URL is required for collision proof controls");
const engines = parseNarrowCollisionEngines(process.env.WCDRAFT_COLLISION_ENGINES);
const results = (
  await Promise.all(engines.map(async (engine) => await runForEngine(engine, baseUrl)))
).flat();
for (const result of results) {
  console.log(
    `collision-control: engine-result id=${result.id} expected=${result.expected} unexpected=${result.observed.toString()} status=${result.passed ? "pass" : "fail"}`,
  );
}
const failures = results.filter((result) => !result.passed);
assert(
  failures.length === 0,
  `collision proof controls failed: ${failures.map(({ id }) => id).join(", ")}`,
);
console.log(
  `collision-controls: ok engines=${engines.length.toString()} controls=${CONTROL_IDS.length.toString()}`,
);
