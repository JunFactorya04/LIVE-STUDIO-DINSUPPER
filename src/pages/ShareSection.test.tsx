// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { zhTW } from "../i18n/zh-TW";
import type { ShareClient, ShareInfo } from "../share/client";
import { isSharing, setSharing } from "../share/sharing";
import { ShareSection } from "./ShareSection";

afterEach(() => {
  cleanup();
  setSharing(false);
});

function fake(available = true): ShareClient & { calls: string[] } {
  let info: ShareInfo = { running: false, port: null, urls: [] };
  const calls: string[] = [];
  return {
    calls,
    available,
    status: async () => info,
    start: async () => {
      calls.push("start");
      info = { running: true, port: 47800, urls: ["http://192.168.1.5:47800/?t=abc"] };
      return info;
    },
    stop: async () => {
      calls.push("stop");
      info = { running: false, port: null, urls: [] };
      return info;
    },
    syncPrinter: async () => undefined,
  };
}

const renderIt = (c: ShareClient) =>
  render(
    <I18nProvider initial="zh-TW">
      <ShareSection client={c} />
    </I18nProvider>,
  );

describe("ShareSection", () => {
  it("is off until switched on, then shows the link and a QR code", async () => {
    const c = fake();
    renderIt(c);
    expect(screen.getByText(zhTW.share.off)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: zhTW.share.start }));
    await waitFor(() => expect(screen.getByText("http://192.168.1.5:47800/?t=abc")).toBeTruthy());
    expect(screen.getByRole("img", { name: zhTW.share.scan })).toBeTruthy();
    expect(isSharing()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: zhTW.share.stop }));
    await waitFor(() => expect(screen.getByText(zhTW.share.off)).toBeTruthy());
    expect(isSharing()).toBe(false);
    expect(c.calls).toEqual(["start", "stop"]);
  });

  it("cannot be started outside the desktop app", () => {
    renderIt(fake(false));
    expect(screen.getByRole("button", { name: zhTW.share.start }).hasAttribute("disabled")).toBe(
      true,
    );
  });
});
