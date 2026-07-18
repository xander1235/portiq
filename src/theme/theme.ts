export type Theme = "light" | "dark";
export const THEME_KEY = "theme";

export function resolveTheme(stored: string | null, prefersLight: boolean): Theme {
  if (stored === "light" || stored === "dark") return stored;
  return prefersLight ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
