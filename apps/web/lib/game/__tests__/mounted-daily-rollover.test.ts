// @vitest-environment happy-dom

import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DAILY_DATE_CHECK_INTERVAL_MS, ModeSelect } from "@/components/game/mode-select";
import { advanceTime, mountReact } from "@/lib/test/dom-harness";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
const daily = vi.hoisted(() => ({ load: vi.fn<(date: string) => Promise<boolean>>() }));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/lib/game/data", () => ({ loadDailyAvailability: daily.load }));
vi.mock("@/components/game/local-progress-band", () => ({
  LocalProgressBandFromStorage: () => null,
}));

let visibility = "visible";
let visibilityDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-11T23:59:30.000Z"));
  visibility = "visible";
  visibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  navigation.push.mockReset();
  daily.load.mockReset();
});

afterEach(() => {
  if (visibilityDescriptor)
    Object.defineProperty(document, "visibilityState", visibilityDescriptor);
  else delete (document as unknown as Record<string, unknown>).visibilityState;
  vi.useRealTimers();
  vi.clearAllMocks();
  document.body.replaceChildren();
});

describe("ModeSelect UTC Daily availability rollover", () => {
  it("rechecks on the bounded interval and never renders the prior date's available card", async () => {
    let resolveNext: ((available: boolean) => void) | undefined;
    daily.load.mockResolvedValueOnce(true).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveNext = resolve;
        }),
    );

    const view = await mountReact(createElement(ModeSelect));
    try {
      await advanceTime(0);
      expect(daily.load).toHaveBeenLastCalledWith("2026-07-11");
      expect(view.container.textContent).toContain("Play daily");

      await advanceTime(DAILY_DATE_CHECK_INTERVAL_MS);
      expect(daily.load).toHaveBeenLastCalledWith("2026-07-12");
      expect(view.container.textContent).toContain("Checking today's Daily");
      expect(view.container.textContent).not.toContain("Play daily →");

      await act(async () => {
        resolveNext?.(false);
        await Promise.resolve();
      });
      expect(view.container.textContent).toContain("Today's Daily is temporarily unavailable");
    } finally {
      await view.unmount();
    }
  });

  it("rechecks a new UTC date on focus and only on visible visibility changes", async () => {
    daily.load.mockResolvedValue(true);
    const view = await mountReact(createElement(ModeSelect));
    try {
      await advanceTime(0);
      expect(daily.load).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date("2026-07-12T00:00:01.000Z"));
      visibility = "hidden";
      await act(async () => document.dispatchEvent(new Event("visibilitychange")));
      expect(daily.load).toHaveBeenCalledTimes(1);

      visibility = "visible";
      await act(async () => document.dispatchEvent(new Event("visibilitychange")));
      expect(daily.load).toHaveBeenLastCalledWith("2026-07-12");

      vi.setSystemTime(new Date("2026-07-13T00:00:01.000Z"));
      await act(async () => window.dispatchEvent(new Event("focus")));
      expect(daily.load).toHaveBeenLastCalledWith("2026-07-13");
    } finally {
      await view.unmount();
    }
  });

  it("ignores a late prior-day availability response after rollover", async () => {
    let resolveOld: ((available: boolean) => void) | undefined;
    daily.load
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce(false);

    const view = await mountReact(createElement(ModeSelect));
    try {
      expect(daily.load).toHaveBeenLastCalledWith("2026-07-11");
      await advanceTime(DAILY_DATE_CHECK_INTERVAL_MS);
      expect(daily.load).toHaveBeenLastCalledWith("2026-07-12");
      expect(view.container.textContent).toContain("Today's Daily is temporarily unavailable");

      await act(async () => {
        resolveOld?.(true);
        await Promise.resolve();
      });
      expect(view.container.textContent).toContain("Today's Daily is temporarily unavailable");
      expect(view.container.textContent).not.toContain("Play daily →");
    } finally {
      await view.unmount();
    }
  });

  it("removes focus/visibility listeners and clears its interval on unmount", async () => {
    daily.load.mockResolvedValue(true);
    const removeWindow = vi.spyOn(window, "removeEventListener");
    const removeDocument = vi.spyOn(document, "removeEventListener");
    const view = await mountReact(createElement(ModeSelect));
    expect(vi.getTimerCount()).toBe(1);

    await view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(removeWindow).toHaveBeenCalledWith("focus", expect.any(Function));
    expect(removeDocument).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });
});
