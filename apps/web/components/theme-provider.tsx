"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type Theme = "light" | "dark";
export const THEME_STORAGE_KEY = "wcdraft:theme";
export const HYDRATION_THEME: Theme = "light";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function storedTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    return null;
  }
}

function documentTheme(): Theme | null {
  if (typeof document === "undefined") return null;
  const value = document.documentElement.getAttribute("data-theme");
  return value === "dark" || value === "light" ? value : null;
}

function writeDocumentTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

export function resolveInitialTheme(): Theme {
  return storedTheme() ?? systemTheme();
}

export function resolveHydratedTheme(): Theme {
  return documentTheme() ?? resolveInitialTheme();
}

/** The provider drives the `data-theme` attribute on <html>. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(HYDRATION_THEME);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const resolved = resolveHydratedTheme();
    writeDocumentTheme(resolved);
    setThemeState(resolved);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeDocumentTheme(theme);
  }, [hydrated, theme]);

  const persistTheme = useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Non-fatal: private browsing / storage policy can reject writes.
    }
  }, []);

  const setTheme = useCallback(
    (next: Theme) => {
      setHydrated(true);
      setThemeState(next);
      writeDocumentTheme(next);
      persistTheme(next);
    },
    [persistTheme],
  );

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [setTheme, theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
