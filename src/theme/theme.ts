/** The concrete theme applied to the document. */
export type Theme = "light" | "dark";
/** The user's stored preference; "system" follows the OS setting live. */
export type ThemePreference = "system" | "light" | "dark";
export const THEME_KEY = "theme";

export function resolveTheme(stored: string | null, prefersLight: boolean): Theme {
  if (stored === "light" || stored === "dark") return stored;
  return prefersLight ? "light" : "dark";
}

/** Interprets a stored value as a preference, defaulting to "system". */
export function resolvePreference(stored: string | null): ThemePreference {
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "system";
}

/** Resolves a preference plus the current OS setting into the applied theme. */
export function themeForPreference(preference: ThemePreference, prefersLight: boolean): Theme {
  return resolveTheme(preference === "system" ? null : preference, prefersLight);
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
