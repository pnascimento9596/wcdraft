import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HYDRATION_THEME,
  resolveHydratedTheme,
  resolveInitialTheme,
  resolvePreference,
  THEME_STORAGE_KEY,
  ThemeProvider,
  useTheme,
} from "@/components/theme-provider";

afterEach(() => {
  vi.unstubAllGlobals();
});

function ThemeProbe() {
  const { theme } = useTheme();
  return createElement("span", { "data-theme": theme }, theme);
}

describe("ThemeProvider hydration", () => {
  it("server-renders a deterministic theme even when browser globals would resolve dark", () => {
    vi.stubGlobal("window", {
      localStorage: { getItem: () => "dark" },
      matchMedia: () => ({ matches: true }),
    });
    vi.stubGlobal("document", {
      documentElement: {
        getAttribute: () => "dark",
        setAttribute: () => undefined,
      },
    });

    const html = renderToStaticMarkup(
      createElement(ThemeProvider, null, createElement(ThemeProbe)),
    );

    expect(HYDRATION_THEME).toBe("light");
    expect(html).toContain('data-theme="light"');
  });

  it("hydrates from the document theme resolved by the inline script", () => {
    const getItem = vi.fn(() => "light");
    vi.stubGlobal("window", {
      localStorage: { getItem },
      matchMedia: () => ({ matches: false }),
    });
    vi.stubGlobal("document", {
      documentElement: {
        getAttribute: () => "dark",
        setAttribute: () => undefined,
      },
    });

    expect(resolveHydratedTheme()).toBe("dark");
    expect(getItem).not.toHaveBeenCalled();
  });

  it("falls back to storage/system resolution when no document theme is present", () => {
    vi.stubGlobal("window", {
      localStorage: { getItem: () => null },
      matchMedia: () => ({ matches: true }),
    });
    vi.stubGlobal("document", {
      documentElement: {
        getAttribute: () => null,
        setAttribute: () => undefined,
      },
    });

    expect(resolveHydratedTheme()).toBe("dark");
  });
});

describe("theme preference persistence", () => {
  it("explicit light/dark override survives resolveInitialTheme (reload path)", () => {
    const store = new Map<string, string>([[THEME_STORAGE_KEY, "dark"]]);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
      },
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    });

    expect(resolveInitialTheme()).toBe("dark");
    expect(resolvePreference()).toBe("dark");
  });

  it("unset storage follows system preference", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
      matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    });

    expect(resolveInitialTheme()).toBe("dark");
    expect(resolvePreference()).toBe("system");
  });

  it("invalid storage values are treated as system (no sticky garbage)", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => "purple",
        setItem: () => undefined,
        removeItem: () => undefined,
      },
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    });

    expect(resolveInitialTheme()).toBe("light");
    expect(resolvePreference()).toBe("system");
  });
});
