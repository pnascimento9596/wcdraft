import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("broadcast tactics UI source contract", () => {
  it("uses local Space font assets and no external font loader", () => {
    const layout = source("../../../app/layout.tsx");
    const globals = source("../../../app/globals.css");
    const rootCss = source("../../../app/ds/tokens.css");
    const ogRoute = source("../../../app/api/og/run/route.tsx");
    const ogImage = source("../run-og-image.tsx");

    const combined = [layout, globals, rootCss, ogRoute, ogImage].join("\n");
    const legacyFamilies = [
      "Sai" + "ra",
      "So" + "ra",
      "Jet" + "Brains",
      "News" + "reader",
      "An" + "ton",
    ];

    expect(layout).not.toContain("next/font" + "/google");
    for (const family of legacyFamilies) {
      expect(combined).not.toContain(family);
    }
    expect(combined).not.toContain("fonts/" + "og");
    expect(combined).not.toContain("fonts.google" + "apis");
    expect(combined).not.toContain("g" + "static");

    expect(globals).toContain('font-family: "Space Grotesk"');
    expect(globals).toContain('--font-family: "Space Grotesk", system-ui, sans-serif;');
    expect(globals).toContain("/fonts/space-grotesk/space-grotesk-latin-400-normal.woff2");
    expect(globals).toContain("/fonts/space-grotesk/space-grotesk-latin-ext-700-normal.woff2");
    expect(combined).not.toContain("Space " + "Mono");
    expect(combined).not.toContain("space-" + "mono");
  });

  it("ships the requested font asset matrix", () => {
    const groteskFiles = readdirSync(
      new URL("../../../public/fonts/space-grotesk", import.meta.url),
    ).sort();
    expect(groteskFiles).toEqual(
      expect.arrayContaining([
        "LICENSE-OFL.txt",
        "space-grotesk-latin-400-normal.woff2",
        "space-grotesk-latin-500-normal.woff2",
        "space-grotesk-latin-600-normal.woff2",
        "space-grotesk-latin-700-normal.woff2",
        "space-grotesk-latin-ext-400-normal.woff2",
        "space-grotesk-latin-ext-500-normal.woff2",
        "space-grotesk-latin-ext-600-normal.woff2",
        "space-grotesk-latin-ext-700-normal.woff2",
        "space-grotesk-latin-600-normal.woff",
        "space-grotesk-latin-700-normal.woff",
        "space-grotesk-latin-ext-600-normal.woff",
        "space-grotesk-latin-ext-700-normal.woff",
      ]),
    );
    expect(groteskFiles).not.toEqual(
      expect.arrayContaining(["space-" + "mono" + "-latin-400-normal.woff2"]),
    );
  });

  it("keeps setup axes open and routes formation locking through the selected card", () => {
    const playPage = source("../../../app/play/page.tsx");
    const modeSelect = source("../../../components/game/mode-select.tsx");
    const setup = source("../../../components/game/draft-screen/setup.tsx");
    const pitch = source("../../../components/game/pitch.tsx");

    expect(playPage).toContain("<ModeSelect />");
    expect(modeSelect).toContain('role="radiogroup"');
    expect(modeSelect).toContain("router.push(selected.href)");
    expect(modeSelect).toContain('tag: "Ranked · casual default"');
    expect(modeSelect).toContain("RANKED · CASUAL DEFAULT");
    expect(modeSelect).toContain('"Ranked-capable"');

    expect(setup).toContain("const [open, setOpen] = useState(true)");
    expect(setup).toContain('aria-label="Play type"');
    expect(setup).toContain('"casual", "ranked"');
    expect(setup).toContain("requestRankedAttempt(");
    expect(setup).toContain("{ signal: controller?.signal }");
    expect(setup).toContain("if (!isCurrentRequest()) return");
    expect(setup).toContain("const [selected, setSelected] = useState<SupportedFormationId>");
    expect(setup).toContain("onClick={() => setSelected(fid)}");
    expect(setup).toContain("onClick={() => lockIn(selected)}");
    expect(setup).toContain("formationCardSelected");
    expect(setup).toContain("formationDock");

    expect(pitch).toContain("previewCompat != null");
    expect(pitch).not.toContain(': "Empty"');
  });
});
