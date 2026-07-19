// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SimulationCeremony } from "../../../components/game/simulation-ceremony";
import type { MatchResult } from "@wcdraft/core";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.body.removeAttribute("style");
});

describe("simulation ceremony modal isolation", () => {
  it("portals outside Review, makes Review inert, and restores exact prior attributes/styles", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    document.body.style.setProperty("overflow", "clip", "important");
    const review = document.createElement("main");
    review.setAttribute("data-review-desktop-shell", "");
    review.setAttribute("inert", "prior-inert");
    review.setAttribute("aria-hidden", "false");
    const mount = document.createElement("div");
    review.append(mount);
    document.body.append(review);
    const root = createRoot(mount);

    await act(async () => {
      root.render(createElement(SimulationCeremony, {
        matches: [], simulation: null, onSkip: () => undefined,
      }));
    });

    const ceremony = document.querySelector("[data-simulation-ceremony='true']");
    expect(ceremony?.parentElement).toBe(document.body);
    expect(review.getAttribute("inert")).toBe("");
    expect(review.getAttribute("aria-hidden")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");

    await act(async () => root.unmount());
    expect(review.getAttribute("inert")).toBe("prior-inert");
    expect(review.getAttribute("aria-hidden")).toBe("false");
    expect(document.body.style.getPropertyValue("overflow")).toBe("clip");
    expect(document.body.style.getPropertyPriority("overflow")).toBe("important");
  });

  it("reveals an arrived real score at max(beat, arrival) before terminal persistence", async () => {
    let now = 0;
    let frame: FrameRequestCallback | null = null;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const mount = document.createElement("div");
    document.body.append(mount);
    const root = createRoot(mount);
    const firstKnockout = {
      phase: "knockout", round: "R32", advanced: true,
      user_goals: 2, user_goals_et: null, opp_goals: 1, opp_goals_et: null, shootout: null,
    } as unknown as MatchResult;

    await act(async () => root.render(createElement(SimulationCeremony, {
      matches: [], simulation: null, onSkip: () => undefined,
    })));
    now = 650;
    await act(async () => { frame?.(now); });
    expect(document.body.textContent).not.toContain("2–1");

    now = 700;
    await act(async () => root.render(createElement(SimulationCeremony, {
      matches: [firstKnockout], simulation: null, onSkip: () => undefined,
    })));
    expect(document.body.textContent).not.toContain("2–1");
    now = 701;
    await act(async () => { frame?.(now); });
    expect(document.body.textContent).toContain("2–1");
    expect(document.body.textContent).not.toContain("Champions");

    await act(async () => root.unmount());
  });

  it("wins the real global button cascade with the approved computed tracking", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const mount = document.createElement("div");
    document.body.append(mount);
    const root = createRoot(mount);
    await act(async () => root.render(createElement(SimulationCeremony, {
      matches: [], simulation: null, showHarness: true, onSkip: () => undefined,
    })));

    const skip = [...document.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Skip"));
    const tabs = [...document.querySelectorAll("button[role='tab']")];
    const tab = tabs[0];
    const motionSwitch = document.querySelector("button[role='switch']");
    const replay = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Replay"));
    expect(tabs).toHaveLength(3);
    expect(skip && tab && motionSwitch && replay).toBeTruthy();

    const globals = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    const moduleCss = readFileSync(path.join(process.cwd(), "components/game/simulation-ceremony.module.css"), "utf8");
    const declaration = (name: string) => {
      const match = moduleCss.match(new RegExp(`\\.${name}\\s*\\{(?<body>[^}]*)\\}`, "u"));
      if (!match?.groups?.body) throw new Error(`missing .${name} ceremony rule`);
      return match.groups.body;
    };
    const actualRule = (element: Element, name: string) =>
      `.${element.classList.item(0)} { ${declaration(name)} }`;
    const tracking = globals.match(/--tracking-button:\s*[^;]+;/u)?.[0];
    const weight = globals.match(/--font-weight-button:\s*[^;]+;/u)?.[0];
    const button = globals.match(/button\s*\{(?<body>[^}]*)\}/u)?.groups?.body;
    if (!tracking || !weight || !button || !skip || !tab || !motionSwitch || !replay) {
      throw new Error("could not materialize the ceremony/global cascade fixture");
    }
    const style = document.createElement("style");
    style.textContent = `:root { ${tracking} ${weight} } button { ${button} } ${actualRule(skip, "skip")} ${actualRule(tab, "tab")} ${actualRule(motionSwitch, "switch")} ${actualRule(replay, "replay")}`;
    document.head.append(style);

    // happy-dom resolves authored em tracking against its 16px style context;
    // these computed values distinguish the approved .08em/-.01em from the
    // global button role's .02em (0.32px).
    expect(getComputedStyle(skip).letterSpacing).toBe("1.28px");
    for (const control of [...tabs, motionSwitch, replay]) {
      expect(getComputedStyle(control).letterSpacing).toBe("-0.16px");
      expect(getComputedStyle(control).fontWeight).toBe("800");
    }
    expect(getComputedStyle(skip).fontWeight).toBe("800");

    style.remove();
    await act(async () => root.unmount());
  });
});
