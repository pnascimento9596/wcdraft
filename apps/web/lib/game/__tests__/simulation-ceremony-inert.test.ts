// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SimulationCeremony } from "../../../components/game/simulation-ceremony";

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
});
