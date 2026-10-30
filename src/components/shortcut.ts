// Keyboard hint for the search shortcut: Command on Mac, Ctrl elsewhere.
export function isMac(): boolean {
  return typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || "");
}

export const searchShortcut = (): string => (isMac() ? "\u2318F" : "Ctrl+F");

/** True for Cmd+F (Mac) or Ctrl+F (others). */
export function isSearchKey(e: { key: string; metaKey: boolean; ctrlKey: boolean }): boolean {
  return (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f";
}
