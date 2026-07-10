import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DAILY_UNAVAILABLE_TITLE,
  DailyUnavailableNotice,
} from "../../../components/game/daily-unavailable-notice";

describe("Daily unavailable product state", () => {
  it("renders terminal honest copy with a Classic route and no loading state", () => {
    const html = renderToStaticMarkup(createElement(DailyUnavailableNotice));

    expect(DAILY_UNAVAILABLE_TITLE).toBe("Today's Daily is temporarily unavailable");
    expect(html).toMatch(/Today(?:'|&#x27;)s Daily is temporarily unavailable/u);
    expect(html).toContain('href="/play/draft"');
    expect(html).toContain("Play Classic instead");
    expect(html).not.toMatch(/spinner|loading|salt|coverage|artifact/iu);
  });
});
