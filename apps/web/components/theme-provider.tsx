"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

/** Resolved document theme (always concrete for `data-theme`). */
export type Theme = "light" | "dark";
/** Explicit user preference — `system` means no override (follow OS). */
export type ThemePreference = Theme | "system";

export const THEME_STORAGE_KEY = "wcdraft:theme";
export const HYDRATION_THEME: Theme = "light";

type ThemeContextValue = {
  theme: Theme;
  /** Explicit override, or `system` when following OS / no stored choice. */
  preference: ThemePreference;
  setTheme: (theme: Theme) => void;
  /** Persist light/dark, or clear override with `system`. */
  setPreference: (preference: ThemePreference) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Stored explicit override only — null/invalid means follow system. */
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

export function resolvePreference(): ThemePreference {
  return storedTheme() ?? "system";
}

/** The provider drives the `data-theme` attribute on <html>. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(HYDRATION_THEME);
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const resolved = resolveHydratedTheme();
    writeDocumentTheme(resolved);
    setThemeState(resolved);
    setPreferenceState(resolvePreference());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeDocumentTheme(theme);
  }, [hydrated, theme]);

  // When preference is system, track OS changes live (no localStorage write).
  useEffect(() => {
    if (!hydrated || preference !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const next = mql.matches ? "dark" : "light";
      setThemeState(next);
      writeDocumentTheme(next);
    };
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [hydrated, preference]);

  const persistTheme = useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Non-fatal: private browsing / storage policy can reject writes.
    }
  }, []);

  const clearPersistedTheme = useCallback(() => {
    try {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } catch {
      // Non-fatal.
    }
  }, []);

  const setTheme = useCallback(
    (next: Theme) => {
      setHydrated(true);
      setPreferenceState(next);
      setThemeState(next);
      writeDocumentTheme(next);
      persistTheme(next);
    },
    [persistTheme],
  );

  const setPreference = useCallback(
    (next: ThemePreference) => {
      setHydrated(true);
      if (next === "system") {
        setPreferenceState("system");
        clearPersistedTheme();
        const resolved = systemTheme();
        setThemeState(resolved);
        writeDocumentTheme(resolved);
        return;
      }
      setPreferenceState(next);
      setThemeState(next);
      writeDocumentTheme(next);
      persistTheme(next);
    },
    [clearPersistedTheme, persistTheme],
  );

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [setTheme, theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, preference, setTheme, setPreference, toggleTheme }),
    [theme, preference, setTheme, setPreference, toggleTheme],
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
