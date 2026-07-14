import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SettingsPage from "@/app/settings/page";
import { ThemeProvider } from "@/components/theme-provider";

describe("trust copy", () => {
  it("Settings explains the five data boundaries and links to Privacy and Account", () => {
    const html = renderToStaticMarkup(
      createElement(ThemeProvider, null, createElement(SettingsPage)),
    );
    expect(html).toContain("Your data");
    expect(html).toContain("saved locally on this device");
    expect(html).toContain("mirrored to the server");
    expect(html).toContain("Account history follows your account");
    expect(html).toContain("Leaderboard posts are public season standings");
    expect(html).toContain("does not delete server history or leaderboard posts");
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/account"');
  });

  it("Current rating basis exposes the exact score consequence", () => {
    const setup = readFileSync(
      new URL("../../../components/game/draft-screen/setup.tsx", import.meta.url),
      "utf8",
    );
    expect(setup).toContain("Current ratings play as a tougher board; expect lower scores");
  });
});
