// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as [string, Record<string, unknown> | undefined][]);
vi.mock("../platform/backend", () => ({
  hasTauri: () => true,
  isRemote: () => false,
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    calls.push([cmd, args]);
    return cmd === "browser_open" ? String(args?.url) : null;
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

import { requestBrowser } from "../browser/route";
import { I18nProvider } from "../i18n";
import { zhTW } from "../i18n/zh-TW";
import { BrowserPage } from "./BrowserPage";

afterEach(() => {
  cleanup();
  calls.length = 0;
});

describe("BrowserPage", () => {
  it("opens a page another tab asked for, then offers the way back", async () => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    requestBrowser({ url: "https://www.tiktok.com/@mai", mobile: true, from: "flow" });
    const onNavigate = vi.fn();
    render(
      <I18nProvider initial="zh-TW">
        <BrowserPage onNavigate={onNavigate} />
      </I18nProvider>,
    );
    await waitFor(() =>
      expect(calls.find(([c]) => c === "browser_open")?.[1]).toMatchObject({
        url: "https://www.tiktok.com/@mai",
        mobile: true,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: zhTW.nav.flow }));
    expect(onNavigate).toHaveBeenCalledWith("flow");

    // a carrier page wants the desktop layout: a fresh webview with the other user agent
    await act(async () => {
      requestBrowser({ url: "https://myship.7-11.com.tw/", mobile: false });
    });
    await waitFor(() => expect(calls.some(([c]) => c === "browser_close")).toBe(true));
    expect(calls.filter(([c]) => c === "browser_open").slice(-1)[0]?.[1]).toMatchObject({
      url: "https://myship.7-11.com.tw/",
      mobile: false,
    });

    fireEvent.click(screen.getByRole("button", { name: zhTW.browser.print }));
    fireEvent.click(screen.getByRole("button", { name: zhTW.browser.external }));
    await waitFor(() =>
      expect(calls.map(([c]) => c)).toEqual(
        expect.arrayContaining(["browser_print", "browser_open_external"]),
      ),
    );
  });
});
