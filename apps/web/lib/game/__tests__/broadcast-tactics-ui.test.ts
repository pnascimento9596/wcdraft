import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("broadcast tactics UI source contract", () => {
  it("uses local Archivo font assets and no external font loader", () => {
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
    expect(combined).not.toContain("Space " + "Grotesk");
    expect(combined).not.toContain("space-" + "grotesk");

    expect(globals).toContain('font-family: "Archivo"');
    expect(globals).toContain('--font-family: "Archivo", system-ui, sans-serif;');
    expect(globals).toContain("/fonts/archivo/archivo-latin-400-normal.woff2");
    expect(globals).toContain("/fonts/archivo/archivo-latin-ext-700-normal.woff2");
    expect(combined).not.toContain("Space " + "Mono");
    expect(combined).not.toContain("space-" + "mono");
  });

  it("ships the requested font asset matrix", () => {
    const archivoFiles = readdirSync(
      new URL("../../../public/fonts/archivo", import.meta.url),
    ).sort();
    expect(archivoFiles).toEqual(
      expect.arrayContaining([
        "LICENSE-OFL.txt",
        "archivo-latin-400-normal.woff2",
        "archivo-latin-500-normal.woff2",
        "archivo-latin-600-normal.woff2",
        "archivo-latin-700-normal.woff2",
        "archivo-latin-800-normal.woff2",
        "archivo-latin-900-normal.woff2",
        "archivo-latin-ext-400-normal.woff2",
        "archivo-latin-ext-500-normal.woff2",
        "archivo-latin-ext-600-normal.woff2",
        "archivo-latin-ext-700-normal.woff2",
        "archivo-latin-ext-800-normal.woff2",
        "archivo-latin-ext-900-normal.woff2",
        "archivo-latin-800-normal.woff",
        "archivo-latin-900-normal.woff",
        "archivo-latin-ext-800-normal.woff",
        "archivo-latin-ext-900-normal.woff",
      ]),
    );
    expect(archivoFiles).not.toEqual(
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
