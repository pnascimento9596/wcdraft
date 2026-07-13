import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const EM_DASH = "\u2014";

const CLEANED_PROSE_SURFACES = [
  "../../../app/page.tsx",
  "../../../app/play/page.tsx",
  "../../../app/contact/page.tsx",
  "../../../app/how-to-play/page.tsx",
  "../../../app/manifest.ts",
  "../../../components/game/mode-select.tsx",
  "../../../components/site-header.tsx",
  "../../auth/verify-flow.ts",
  "../../site-metadata.ts",
] as const;

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly value: string;
}

function userFacingEmDashes(file: string): Violation[] {
  const url = new URL(file, import.meta.url);
  const sourceText = readFileSync(url, "utf8");
  const source = ts.createSourceFile(
    url.pathname,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations: Violation[] = [];

  function visit(node: ts.Node): void {
    let value: string | null = null;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      value = node.text;
    }

    if (value?.includes(EM_DASH) && value.trim() !== EM_DASH) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      violations.push({ file, line: line + 1, value: value.trim() });
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return violations;
}

describe("cleaned user-facing prose", () => {
  it("does not reintroduce em dashes while retaining the null-placeholder token", () => {
    const violations = CLEANED_PROSE_SURFACES.flatMap(userFacingEmDashes);
    expect(violations).toEqual([]);
  });
});
