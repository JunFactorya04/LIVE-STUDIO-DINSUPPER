// Appearance: follow the system (default) or force light or dark. Forced values are applied
// as data-theme on <html>, which tokens.css already understands; "auto" removes it.

export const THEMES = ["auto", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

const KEY = "live-studio.theme";

export function loadTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.includes(v as Theme) ? (v as Theme) : "auto";
  } catch {
    return "auto";
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* applies until the app closes */
  }
  applyTheme(theme);
}
