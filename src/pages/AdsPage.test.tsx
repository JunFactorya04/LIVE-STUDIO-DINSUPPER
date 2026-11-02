// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { AdsPage } from "./AdsPage";

afterEach(cleanup);

describe("AdsPage", () => {
  it("lists all three ad platforms and stays desktop-only in a plain browser", async () => {
    render(
      <I18nProvider initial="zh-TW">
        <AdsPage />
      </I18nProvider>,
    );
    expect(await screen.findByText("TT")).toBeTruthy();
    expect(screen.getByText("M")).toBeTruthy();
    expect(screen.getByText("G")).toBeTruthy();
    // No Tauri backend in this test environment: credentials can't be saved here.
    expect(screen.getByText("只能在電腦版程式中儲存連結資訊。")).toBeTruthy();
  });
});
