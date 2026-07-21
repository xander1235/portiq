import { useCallback, useEffect, useState } from "react";
import {
  Theme,
  ThemePreference,
  THEME_KEY,
  resolvePreference,
  themeForPreference,
  applyTheme,
} from "./theme";

const LIGHT_QUERY = "(prefers-color-scheme: light)";
const CYCLE: ThemePreference[] = ["system", "light", "dark"];

function systemPrefersLight(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia(LIGHT_QUERY).matches;
}

function initialPreference(): ThemePreference {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem(THEME_KEY) : null;
  return resolvePreference(stored);
}

export function useTheme(): {
  theme: Theme;
  preference: ThemePreference;
  cycle: () => void;
  setPreference: (preference: ThemePreference) => void;
} {
  const [preference, setPreference] = useState<ThemePreference>(initialPreference);
  const [prefersLight, setPrefersLight] = useState<boolean>(systemPrefersLight);

  // Track the OS colour scheme so "system" updates live when it changes.
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const query = matchMedia(LIGHT_QUERY);
    const handler = (event: MediaQueryListEvent) => setPrefersLight(event.matches);
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }, []);

  const theme = themeForPreference(preference, prefersLight);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, preference);
    } catch {
      /* ignore */
    }
  }, [theme, preference]);

  const cycle = useCallback(() => {
    setPreference((current) => CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length]);
  }, []);

  return { theme, preference, cycle, setPreference };
}
