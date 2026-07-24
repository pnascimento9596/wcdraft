import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const EM_DASH = "\u2014";
const EM_DASH_ENTITY = /&(?:mdash|#8212|#x2014);/iu;

const CLEANED_PROSE_SURFACES = [
  "../../../app/page.tsx",
  "../../../app/play/page.tsx",
  "../../../app/play/review/page.tsx",
  "../../../app/play/share/page.tsx",
  "../../../app/contact/page.tsx",
  "../../../app/how-to-play/page.tsx",
  "../../../app/manifest.ts",
  "../../../components/game/candidate-card.tsx",
  "../../../components/game/draft-screen/constants.ts",
  "../../../components/game/draft-screen/index.tsx",
  "../../../components/game/draft-screen/setup.tsx",
  "../../../components/game/local-progress-band.tsx",
  "../../../components/game/manager-slot.tsx",
  "../../../components/game/memory-reveal.tsx",
  "../../../components/game/mode-select.tsx",
  "../../../components/game/pitch.tsx",
  "../../../components/game/results-screen.tsx",
  "../../../components/game/review-screen.tsx",
  "../../../components/game/share-screen.tsx",
  "../../../components/game/slot-machine.tsx",
  "../../../components/game/synergy-bar.tsx",
  "../../../components/site-header.tsx",
  "../../../components/leaderboard/submit-panel-views.tsx",
  "../../auth/verify-flow.ts",
  "../config-badges.ts",
  "../errors.ts",
  "../friend-challenge.ts",
  "../local-progress.ts",
  "../reference-standing.ts",
  "../results-adapters.ts",
  "../run-og-image.tsx",
  "../share-adapters.ts",
  "../slot-reveal.ts",
  "../../leaderboard/submit-copy.ts",
  "../../site-metadata.ts",
] as const;

const PROTECTED_EM_DASH_VALUES: Readonly<Record<string, readonly string[]>> = {
  "../../../components/game/candidate-card.tsx": ["—", "—", "—", "—", "—", "—"],
  "../../../components/game/draft-screen/index.tsx": ["—"],
  "../../../components/game/local-progress-band.tsx": ["—"],
  "../../../components/game/pitch.tsx": ["— empty slot"],
  "../../../components/game/results-screen.tsx": ["Daily field: —", "—"],
  "../../../components/game/share-screen.tsx": ["—", "—", "—", "—", "—", "—", "—"],
  "../../../components/game/slot-machine.tsx": ["—", "—", "—", "—"],
  "../../../components/game/synergy-bar.tsx": ["—", "—", "—", "—"],
  "../errors.ts": ["—"],
  "../local-progress.ts": ["—"],
  "../results-adapters.ts": ["—", "—", "—", "—", "—"],
  "../run-og-image.tsx": ["—", "—", "—"],
  "../slot-reveal.ts": ["—"],
};

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly value: string;
}

function userFacingEmDashesInSource(file: string, sourceText: string): Violation[] {
  const source = ts.createSourceFile(
    file,
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

    if (value?.includes(EM_DASH) || (value !== null && EM_DASH_ENTITY.test(value))) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      violations.push({ file, line: line + 1, value: value.trim() });
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return violations;
}

function userFacingEmDashes(file: string): Violation[] {
  const url = new URL(file, import.meta.url);
  return userFacingEmDashesInSource(file, readFileSync(url, "utf8"));
}

describe("cleaned user-facing prose", () => {
  it("contains only explicitly classified placeholders or diagnostics", () => {
    for (const file of CLEANED_PROSE_SURFACES) {
      const actual = userFacingEmDashes(file)
        .map(({ value }) => value)
        .sort();
      const expected = [...(PROTECTED_EM_DASH_VALUES[file] ?? [])].sort();
      expect(actual, file).toEqual(expected);
    }
  });

  it.each([
    ["template expression", "const copy = `${left} — ${right}`;"],
    ["JSX expression", "const copy = <p>{left} — {right}</p>;"],
    ["JSX entity", "const copy = <p>&mdash;</p>;"],
  ])("detects an em dash split across a %s", (_case, sourceText) => {
    expect(userFacingEmDashesInSource("mutation.tsx", sourceText)).toHaveLength(1);
  });
});
