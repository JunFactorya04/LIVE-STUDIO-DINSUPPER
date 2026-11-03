// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../platform/backend", () => ({
  isRemote: () => true,
  hasTauri: () => false,
  hasBackend: () => true,
  invoke: async () => {
    throw "UNREACHABLE";
  },
}));
import { I18nProvider } from "../i18n";
import { zhTW } from "../i18n/zh-TW";
import { visibleNav } from "../navigation";
import { SettingsPage } from "./SettingsPage";

afterEach(cleanup);

describe("Settings on a phone", () => {
  it("is reachable and offers only the phone's own language and light/dark", () => {
    expect(visibleNav(true).some((i) => i.id === "settings")).toBe(true);
    render(
      <I18nProvider initial="zh-TW">
        <SettingsPage />
      </I18nProvider>,
    );
    expect(screen.queryByRole("tab", { name: zhTW.settingsTabs.printing })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: zhTW.settings.themes.dark }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(screen.getByText(zhTW.settings.phoneOnly)).toBeTruthy();
  });
});
