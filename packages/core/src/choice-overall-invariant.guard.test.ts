// ENG-08 guard — `choice_overall` is a display/offer-tiering input only.
//
// MUTATE-AND-FAIL contract: add a `choice_overall` read to scoring, sim,
// best-XI, or team-strength code and this static guard must fail. The only
// production read is in draft.ts, where it tiers choose-from-3 offers.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_SOURCE_FILES = new Set([
  path.join(__dirname, "draft.ts"),
  path.join(__dirname, "draft.fixture.ts"),
]);

function stripComments(src: string): string {
  const withoutBlock = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlock.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function listTsFilesRecursive(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".ts")) continue;
      if (entry.endsWith(".test.ts")) continue;
      if (entry.endsWith(".d.ts")) continue;
      out.push(full);
    }
  }
  walk(root);
  return out;
}

describe("ENG-08 guard — choice_overall remains offer-tier-only", () => {
  it("no source outside draft offer generation reads choice_overall", () => {
    const offenders: { file: string; line: number; text: string }[] = [];
    for (const file of listTsFilesRecursive(__dirname)) {
      if (ALLOWED_SOURCE_FILES.has(file)) continue;
      const lines = stripComments(readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, i) => {
        if (/\bchoice_overall\b/u.test(line)) {
          offenders.push({ file, line: i + 1, text: line.trim() });
        }
      });
    }

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `ENG-08 breached - choice_overall is display/offer-tiering only:\n${offenders
            .map((o) => `  ${path.relative(__dirname, o.file)}:${o.line}  ${o.text}`)
            .join(
              "\n",
            )}\n\nIf a future scoring/sim/best-XI path needs a quality input, use sim-legal rating channels instead.`,
    ).toEqual([]);
  });
});
