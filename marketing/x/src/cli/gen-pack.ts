// CLI: generate this week's content pack and write it to
// marketing/x/packs/pack-YYYY-WW.md. Deterministic for the ISO week.
//
//   pnpm gen:pack            # current week
//   pnpm gen:pack 2026-06-15 # the week containing that date

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { PACKAGE_ROOT } from "../paths.ts";
import { generateWeekPack } from "../pack/generate.ts";
import { renderWeekPackMarkdown } from "../pack/render.ts";

const arg = process.argv[2];
const refDate = arg ? new Date(`${arg}T12:00:00Z`) : new Date();
if (Number.isNaN(refDate.getTime())) {
  console.error(`unparseable date: ${arg}`);
  process.exit(1);
}

const pack = generateWeekPack(refDate);
const md = renderWeekPackMarkdown(pack);

const dir = join(PACKAGE_ROOT, "packs");
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
const path = join(dir, `pack-${pack.iso_label}.md`);
writeFileSync(path, md, "utf8");
console.log(`wrote ${pack.total} posts → ${path}`);
