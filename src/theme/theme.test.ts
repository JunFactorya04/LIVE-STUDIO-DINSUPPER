// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { applyTheme, loadTheme, saveTheme } from "./theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("theme", () => {
  it("follows the system by default", () => {
    expect(loadTheme()).toBe("auto");
    applyTheme("auto");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
  it("forces and remembers dark, and goes back to auto", () => {
    saveTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(loadTheme()).toBe("dark");
    saveTheme("auto");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
  it("ignores a bad stored value", () => {
    localStorage.setItem("live-studio.theme", "neon");
    expect(loadTheme()).toBe("auto");
  });
});
