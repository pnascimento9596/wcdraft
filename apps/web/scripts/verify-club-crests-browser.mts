import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type Page } from "playwright-core";
import { format } from "prettier";

import {
  buildDraftCatalog,
  createDraft,
  type DraftDataset,
  type DraftState,
} from "../../../packages/core/src/index.js";
import {
  DRAFT_POOL_BUNDLE,
  RUNTIME_DATA_MANIFEST,
  type RuntimeDataManifest,
} from "../../../packages/data/src/index.js";
import { composeVersions, type RunRecordVersions } from "../lib/game/versions.js";

const RUN_RECORD_SCHEMA_VERSION = 1;
const RUN_RECORD_PREFIX = "wcdraft:run-record:v1:";
const RUN_INDEX_KEY = "wcdraft:run-index:v1";
const RUN_COUNTER_KEY = "wcdraft:run-counter:v1";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(WEB_DIR, "..", "..");
const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3025";
const outDir = path.join(REPO_ROOT, "docs", "reports", "real-club-crests");
const axeCdn = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js";

interface BrowserProofRunRecord {
  record_version: typeof RUN_RECORD_SCHEMA_VERSION;
  run_id: string;
  parent_seed: string;
  created_seq: number;
  updated_seq: number;
  versions: RunRecordVersions;
  draft: DraftState;
}

const axeSource = await fetch(axeCdn).then((res) => {
  if (!res.ok) throw new Error(`failed to fetch axe-core: HTTP ${res.status}`);
  return res.text();
});

function buildDataset(): DraftDataset {
  const ratingByCardId = new Map(
    DRAFT_POOL_BUNDLE.ratings.map((rating) => [rating.card_id, rating.overall]),
  );
  return {
    players: DRAFT_POOL_BUNDLE.player_cards.map((card) => ({
      player_id: card.player_id,
      tournament_id: card.tournament_id,
      nation_id: card.nation_id,
      eligible_positions: card.eligible_positions,
      choice_overall: ratingByCardId.get(card.card_id) ?? null,
    })),
    managers: DRAFT_POOL_BUNDLE.manager_cards.map((manager) => ({
      manager_id: manager.manager_id,
      tournament_id: manager.tournament_id,
      nation_id: manager.nation_id,
    })),
    tournaments: Object.entries(DRAFT_POOL_BUNDLE.tournaments).map(([tid, tournament]) => ({
      tournament_id: Number(tid),
      year: tournament.year,
    })),
  };
}

const catalog = buildDraftCatalog(buildDataset());
const versions = composeVersions(RUNTIME_DATA_MANIFEST as RuntimeDataManifest);

function cardIdFor(club: string, tournamentId?: number): string {
  const card = DRAFT_POOL_BUNDLE.player_cards.find(
    (row) =>
      (tournamentId === undefined || row.tournament_id === tournamentId) &&
      (row.club_at_tournament ?? row.club) === club,
  );
  if (!card) throw new Error(`missing sample card for ${club} ${tournamentId ?? ""}`);
  return card.card_id;
}

function seededRunRecord(): BrowserProofRunRecord {
  const run_id = "crest-proof-run";
  const parent_seed = "wcdraft:crest-proof";
  const draft = createDraft(catalog, {
    run_id,
    parent_seed,
    formation_id: "4-3-3",
    mode: "classic",
    team_name: "Crest Proof XI",
    dataset_version: versions.dataset_version,
    rating_version: versions.rating_version,
    engine_version: versions.engine_version,
    era_preset: "all_time",
    draft_flow: "squad_first",
    rating_basis: "career",
  });

  const sampleCardIds = [
    cardIdFor("Bayern Munich", 2026),
    cardIdFor("Arsenal", 2026),
    cardIdFor("Nacional", 2026),
  ];
  const firstSpin = draft.spins[0];
  if (!firstSpin) throw new Error("draft has no first spin");

  return {
    record_version: RUN_RECORD_SCHEMA_VERSION,
    run_id,
    parent_seed,
    created_seq: 1,
    updated_seq: 1,
    versions,
    draft: {
      ...draft,
      spins: [
        {
          ...firstSpin,
          tournament_id: 2026,
          nation_id: "T-30",
          rolled_card_ids: sampleCardIds,
          rolled_manager_card_id: null,
          status: "pending",
        },
        ...draft.spins.slice(1),
      ],
    },
  };
}

async function seedRun(page: Page, record: BrowserProofRunRecord) {
  await page.addInitScript(
    ({ runRecord, recordPrefix, indexKey, counterKey, schemaVersion }) => {
      window.localStorage.setItem(`${recordPrefix}${runRecord.run_id}`, JSON.stringify(runRecord));
      window.localStorage.setItem(
        indexKey,
        JSON.stringify({
          record_version: schemaVersion,
          entries: [
            {
              run_id: runRecord.run_id,
              created_seq: runRecord.created_seq,
              updated_seq: runRecord.updated_seq,
              versions: runRecord.versions,
            },
          ],
        }),
      );
      window.localStorage.setItem(counterKey, String(runRecord.updated_seq));
    },
    {
      runRecord: record,
      recordPrefix: RUN_RECORD_PREFIX,
      indexKey: RUN_INDEX_KEY,
      counterKey: RUN_COUNTER_KEY,
      schemaVersion: RUN_RECORD_SCHEMA_VERSION,
    },
  );
}

async function visibleText(page: Page, selector: string): Promise<string[]> {
  return await page
    .locator(selector)
    .evaluateAll((els) => els.map((el) => el.textContent?.trim() ?? ""));
}

async function verifyCase(
  browser: Browser,
  viewport: { width: number; height: number },
  theme: "light" | "dark",
) {
  const context = await browser.newContext({
    viewport,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    colorScheme: theme,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await seedRun(page, seededRunRecord());

  const consoleErrors: string[] = [];
  const httpErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().startsWith("Failed to load resource:")) {
      consoleErrors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));
  page.on("response", (response) => {
    if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(`${baseUrl}/play/draft?run=crest-proof-run`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Spin" }).click();
  await page.getByRole("button", { name: /Reveal choices/ }).click();
  await page.locator('section[aria-label="Candidates"]').waitFor();
  await page.locator('[data-club-crest-kind="crest"]').waitFor();
  await page.locator('[data-club-crest-kind="monogram"]').first().waitFor();
  await page.addScriptTag({ content: axeSource });

  const crestSrc = await page.locator('[data-club-crest-kind="crest"]').first().getAttribute("src");
  const crestAlt = await page.locator('[data-club-crest-kind="crest"]').first().getAttribute("alt");
  const monogramReasons = await page
    .locator('[data-club-crest-kind="monogram"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-club-crest-reason")));
  const markBoxes = await page.locator("[data-club-crest-kind]").evaluateAll((els) =>
    els.map((el) => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }),
  );
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
  }));
  const cls = await page.evaluate(() =>
    performance
      .getEntriesByType("layout-shift")
      .reduce(
        (sum, entry) => sum + ((entry as PerformanceEntry & { value?: number }).value ?? 0),
        0,
      ),
  );
  const axe = await page.evaluate(async () => {
    const runner = (
      window as typeof window & {
        axe?: {
          run: (node?: Element | Document, options?: unknown) => Promise<{ violations: unknown[] }>;
        };
      }
    ).axe;
    if (!runner) throw new Error("axe not loaded");
    return await runner.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      },
    });
  });

  if (crestSrc !== "/clubs/bayern-munich.svg") {
    throw new Error(`expected Bayern crest, got ${crestSrc}`);
  }
  if (crestAlt !== "Bayern Munich club crest") {
    throw new Error(`unexpected crest alt: ${crestAlt}`);
  }
  if (!monogramReasons.includes("unmapped")) throw new Error("missing unmapped monogram");
  if (!monogramReasons.includes("ambiguous")) throw new Error("missing ambiguous monogram");
  if (markBoxes.some((box) => Math.round(box.width) !== 16 || Math.round(box.height) !== 16)) {
    throw new Error(`crest mark box drift: ${JSON.stringify(markBoxes)}`);
  }
  if (overflow.scrollWidth > overflow.clientWidth + 1) {
    throw new Error(`horizontal overflow: ${overflow.scrollWidth} > ${overflow.clientWidth}`);
  }
  if (axe.violations.length !== 0) {
    throw new Error(`axe violations: ${JSON.stringify(axe.violations)}`);
  }
  if (consoleErrors.length || httpErrors.length) {
    throw new Error(`browser errors: ${JSON.stringify({ consoleErrors, httpErrors })}`);
  }

  const clubTexts = await visibleText(page, '[class*="candClub__"]');
  for (const expected of ["Bayern Munich", "Arsenal", "Nacional"]) {
    if (!clubTexts.includes(expected)) {
      throw new Error(`missing rendered club text ${expected}: ${JSON.stringify(clubTexts)}`);
    }
  }

  const name = `${viewport.width}x${viewport.height}-${theme}`;
  const screenshot = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  const proof = {
    name,
    viewport,
    theme,
    screenshot: path.relative(REPO_ROOT, screenshot),
    crestSrc,
    crestAlt,
    monogramReasons,
    markBoxes,
    overflow,
    cls,
    axeViolations: axe.violations.length,
    clubTexts,
  };
  await context.close();
  return proof;
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.WCDRAFT_PLAYWRIGHT_CHANNEL ?? "chrome",
  headless: true,
});

try {
  const cases = [];
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 360, height: 800 },
  ]) {
    for (const theme of ["light", "dark"] as const) {
      cases.push(await verifyCase(browser, viewport, theme));
    }
  }
  const proofPath = path.join(outDir, "browser-proof.json");
  const proofJson = await format(JSON.stringify({ axeSource: axeCdn, cases }, null, 2), {
    parser: "json",
  });
  await writeFile(proofPath, proofJson);
  console.log(`club-crest-browser-proof: ok ${path.relative(REPO_ROOT, proofPath)}`);
} finally {
  await browser.close();
}
