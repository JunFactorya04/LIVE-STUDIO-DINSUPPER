// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { zhTW } from "../i18n/zh-TW";
import { CameraButton } from "./CameraScanner";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CameraButton", () => {
  it("is an icon button, and opens the camera over the whole screen, not inside the page", () => {
    vi.stubGlobal("isSecureContext", true);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: () => new Promise(() => {}) },
    });
    render(
      <I18nProvider initial="zh-TW">
        <div style={{ transform: "translateY(6px)" }} data-testid="page">
          <CameraButton onScan={() => {}} />
        </div>
      </I18nProvider>,
    );
    const button = screen.getByRole("button", { name: zhTW.camera.open });
    expect(button.textContent).toBe("");
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog", { name: zhTW.camera.title });
    expect(dialog.parentElement).toBe(document.body);
    expect(screen.getByTestId("page").contains(dialog)).toBe(false);
  });
});
