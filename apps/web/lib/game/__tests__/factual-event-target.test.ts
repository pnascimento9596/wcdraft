// @vitest-environment happy-dom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import {
  FactualEventTarget,
  factualEventHref,
  factualEventTargetId,
  focusFactualEventTarget,
} from "@/components/game/factual-event-target";

describe("factual event target focus", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("renders an encoded, programmatically focusable exact-hash target", () => {
    const matchId = "group/m2";
    const eventId = "availability:m2:0";
    document.body.innerHTML = renderToStaticMarkup(
      createElement(FactualEventTarget, { matchId, eventId, children: "Event detail" }),
    );

    const targetId = factualEventTargetId(matchId, eventId);
    const target = document.getElementById(targetId);
    expect(factualEventHref(matchId, eventId)).toBe(`#${targetId}`);
    expect(target?.tabIndex).toBe(-1);
    expect(focusFactualEventTarget(targetId)).toBe(true);
    expect(document.activeElement).toBe(target);
  });

  it("refuses to focus a target until its owning panel is revealed", () => {
    const panel = document.createElement("div");
    panel.hidden = true;
    panel.innerHTML = '<span id="event-hidden" tabindex="-1">Hidden event</span>';
    document.body.append(panel);

    expect(focusFactualEventTarget("event-hidden")).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });
});
