#!/usr/bin/env node
/**
 * Evidence-only: AST sweep for Rating.components reads across apps/web + packages/core.
 * Not a product change.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ROOTS = ["apps/web", "packages/core"].map((p) => path.join(ROOT, p));
const EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
const IGNORE_DIR = new Set([
  "node_modules",
  "dist",
  ".next",
  "coverage",
  "generated",
  "public",
]);

type HitClass = "runtime" | "offline-etl-build" | "test-only" | "schema-type-only" | "unrelated-name";

interface Hit {
  file: string;
  line: number;
  col: number;
  kind: string;
  text: string;
  classification: HitClass;
  notes: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".") && ent.name !== ".ts") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (IGNORE_DIR.has(ent.name)) continue;
      walk(full, out);
    } else if (EXT.has(path.extname(ent.name))) {
      out.push(full);
    }
  }
  return out;
}

function classify(file: string, text: string, kind: string): { classification: HitClass; notes: string } {
  const rel = path.relative(ROOT, file);
  const isTest =
    /\.(test|spec)\./.test(rel) ||
    rel.includes("__tests__") ||
    rel.includes("/test/") ||
    rel.endsWith(".guard.test.ts");
  // Unrelated: React import paths, CSS modules, ScoreComponent local vars, synergy shape docs
  if (
    /from\s+["']@?\/?.*components\//.test(text) ||
    /import\s+.*from\s+["'].*components\//.test(text) ||
    /components\/game/.test(text) ||
    /components\/home/.test(text) ||
    /components\/leaderboard/.test(text) ||
    /components\/auth/.test(text) ||
    /components\/site-/.test(text) ||
    /components\/theme/.test(text) ||
    /components\/legal/.test(text) ||
    /components\/sw-/.test(text) ||
    /components\/account/.test(text) ||
    /game\.module\.css/.test(text) ||
    /LICENSE-OFL/.test(rel)
  ) {
    return { classification: "unrelated-name", notes: "path/import to UI components directory" };
  }
  if (/ScoreComponent|score breakdown|Synergy components|three components/.test(text) && !/\.components\b/.test(text)) {
    return { classification: "unrelated-name", notes: "local ScoreComponent or synergy narrative, not Rating.components" };
  }
  if (rel.includes("schemas/") || rel.includes("types/")) {
    return {
      classification: isTest ? "test-only" : "schema-type-only",
      notes: "type/schema declaration for Rating.components field",
    };
  }
  if (isTest) {
    return { classification: "test-only", notes: "fixture or assertion constructing Rating-like objects" };
  }
  if (rel.includes("scripts/") || rel.includes("build-compact") || rel.includes("etl")) {
    return { classification: "offline-etl-build", notes: "build/offline path" };
  }
  return { classification: "runtime", notes: "candidate runtime read — inspect" };
}

function lineOf(sf: ts.SourceFile, pos: number): { line: number; col: number } {
  const lc = sf.getLineAndCharacterOfPosition(pos);
  return { line: lc.line + 1, col: lc.character + 1 };
}

function record(
  hits: Hit[],
  sf: ts.SourceFile,
  node: ts.Node,
  kind: string,
  text: string,
): void {
  const { line, col } = lineOf(sf, node.getStart(sf));
  const { classification, notes } = classify(sf.fileName, text, kind);
  hits.push({
    file: path.relative(ROOT, sf.fileName),
    line,
    col,
    kind,
    text: text.replace(/\s+/g, " ").slice(0, 160),
    classification,
    notes,
  });
}

function analyzeFile(file: string, hits: Hit[]): void {
  const source = fs.readFileSync(file, "utf8");
  // Fast path skip pure UI import noise files without "components" property patterns
  if (!source.includes("components")) return;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  function visit(node: ts.Node): void {
    // property access: x.components
    if (ts.isPropertyAccessExpression(node) && node.name.text === "components") {
      record(hits, sf, node, "property_access", node.getText(sf));
    }
    // element access: x["components"] / x['components']
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteral(node.argumentExpression) &&
      node.argumentExpression.text === "components"
    ) {
      record(hits, sf, node, "element_access", node.getText(sf));
    }
    // destructuring: const { components } = x  or  { components: c }
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name) && node.name.text === "components") {
      record(hits, sf, node, "destructure_binding", node.getText(sf));
    }
    if (
      ts.isBindingElement(node) &&
      node.propertyName &&
      ts.isIdentifier(node.propertyName) &&
      node.propertyName.text === "components"
    ) {
      record(hits, sf, node, "destructure_rename", node.getText(sf));
    }
    // object literal property: components: ...
    if (
      ts.isPropertyAssignment(node) &&
      ((ts.isIdentifier(node.name) && node.name.text === "components") ||
        (ts.isStringLiteral(node.name) && node.name.text === "components"))
    ) {
      record(hits, sf, node, "object_literal_property", node.getText(sf));
    }
    // shorthand: { components }
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === "components") {
      record(hits, sf, node, "object_shorthand", node.getText(sf));
    }
    // spread of object that might carry components — only when parent is clearly rating-related
    if (ts.isSpreadAssignment(node)) {
      const t = node.getText(sf);
      if (/\brating\b|\bbasisRating\b|\bruntimeRating\b/i.test(t)) {
        record(hits, sf, node, "spread_assignment_ratingish", t);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}

function main(): void {
  const files = ROOTS.flatMap((r) => walk(r));
  const hits: Hit[] = [];
  for (const f of files) analyzeFile(f, hits);

  const byClass: Record<string, number> = {};
  for (const h of hits) byClass[h.classification] = (byClass[h.classification] ?? 0) + 1;

  // Filter to Rating.components-relevant (exclude unrelated-name)
  const relevant = hits.filter((h) => h.classification !== "unrelated-name");
  const runtime = relevant.filter((h) => h.classification === "runtime");

  const out = {
    schema_version: "components-reachability-1.0.0",
    measurement_date: new Date().toISOString().slice(0, 10),
    roots: ROOTS.map((r) => path.relative(ROOT, r)),
    files_scanned: files.length,
    total_hits_including_unrelated: hits.length,
    by_classification: byClass,
    relevant_hits: relevant,
    runtime_hits: runtime,
    verdict_static:
      runtime.length === 0
        ? "NO_RUNTIME_READS_OF_RATING_COMPONENTS_IN_WEB_OR_CORE_SOURCE"
        : "RUNTIME_CANDIDATES_PRESENT",
  };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

main();
