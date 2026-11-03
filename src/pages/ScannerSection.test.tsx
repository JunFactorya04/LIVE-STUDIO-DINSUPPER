// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { zhTW } from "../i18n/zh-TW";
import type { ScanRelay } from "../warehouse/relay";
import { ScannerSection } from "./ScannerSection";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ScannerSection", () => {
  it("tells a scanner from typing, and shows a code a phone sends", async () => {
    let push: ((c: string) => void) | undefined;
    const relay: ScanRelay = {
      push: async () => {},
      listen: async (h) => {
        push = h;
        return () => {};
      },
    };
    render(
      <I18nProvider initial="zh-TW">
        <ScannerSection relay={relay} />
      </I18nProvider>,
    );
    const box = screen.getByLabelText(zhTW.settings.scanner.testLabel);
    const code = "A12-000001";
    fireEvent.change(box, { target: { value: code } });
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const press = (keys: string[], msPerKey: number) =>
      keys.forEach((k) => {
        now += msPerKey;
        fireEvent.keyDown(box, { key: k });
      });
    press([...code], 5);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByRole("status")).toHaveTextContent(`從掃描器收到「${code}」。`);
    expect(screen.getByRole("status")).toHaveTextContent(zhTW.settings.scanner.ours);

    fireEvent.change(box, { target: { value: "abc" } });
    press(["a", "b", "c"], 400);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByRole("status")).toHaveTextContent("看起來是手動輸入");

    await waitFor(() => expect(push).toBeDefined());
    await act(async () => push!("B01-000009"));
    expect(screen.getByRole("status")).toHaveTextContent("從手機收到「B01-000009」。");
  });
});
