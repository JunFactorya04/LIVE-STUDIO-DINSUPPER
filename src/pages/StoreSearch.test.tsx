// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { zhTW } from "../i18n/zh-TW";
import type { ShipClient, StoreHit } from "../ship/client";
import { StoreSearch } from "./StoreSearch";

afterEach(cleanup);

const hit = (over: Partial<StoreHit> = {}): StoreHit => ({
  code: "131386",
  name: "建盛",
  address: "台北市大安區仁愛路四段1號",
  disabled: false,
  ...over,
});

const mount = (searchStores: ShipClient["searchStores"], onPick = vi.fn()) => {
  render(
    <I18nProvider initial="zh-TW">
      <StoreSearch api={{ searchStores }} onPick={onPick} />
    </I18nProvider>,
  );
  return onPick;
};

describe("browse by region", () => {
  it("lists every store of the district from 7-ELEVEN's area list, with a street filter", async () => {
    const storesInArea = vi.fn(async () => [
      hit({ code: "160247", name: "大永", address: "台北市中山區明水路581巷15號" }),
      hit({ code: "196660", name: "大吉", address: "台北市中山區吉林路97號" }),
    ]);
    const onPick = vi.fn();
    render(
      <I18nProvider initial="zh-TW">
        <StoreSearch api={{ searchStores: vi.fn(async () => []), storesInArea }} onPick={onPick} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: zhTW.ship.form.storeBrowse }));
    fireEvent.click(screen.getByText("Đài Bắc"));
    fireEvent.click(screen.getByRole("button", { name: "中山區" }));
    await waitFor(() => expect(storesInArea).toHaveBeenCalledWith("台北市", "中山區"));
    expect(await screen.findByText("台北市中山區共 2 間 7-ELEVEN")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(zhTW.ship.form.storeAreaFilter), {
      target: { value: "吉林" },
    });
    expect(screen.queryByText("大永")).toBeNull();
    fireEvent.click(screen.getByText("大吉"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ code: "196660" }));
  });

  it("lists cities bilingually, then that city's districts, then searches for city+district", async () => {
    const searchStores = vi.fn(async () => [hit()]);
    const onPick = mount(searchStores);

    fireEvent.click(screen.getByRole("button", { name: zhTW.ship.form.storeBrowse }));
    expect(screen.getByText("台北市")).toBeTruthy();
    expect(screen.getByText("Đài Bắc")).toBeTruthy();

    fireEvent.click(screen.getByText("Đài Bắc"));
    const district = screen.getByRole("button", { name: "大安區" });
    fireEvent.click(district);

    await waitFor(() => expect(searchStores).toHaveBeenCalledWith("台北市大安區"));
    expect(await screen.findByText("131386")).toBeTruthy();

    fireEvent.click(screen.getByText("建盛"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ code: "131386" }));
  });

  it("goes back to the city list without losing the toggle state", async () => {
    const searchStores = vi.fn(async () => []);
    mount(searchStores);

    fireEvent.click(screen.getByRole("button", { name: zhTW.ship.form.storeBrowse }));
    fireEvent.click(screen.getByText("Đài Bắc"));
    expect(screen.getByRole("button", { name: "大安區" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: zhTW.ship.form.storeBrowseBack }));
    expect(screen.getByText("台北市")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "大安區" })).toBeNull();
  });

  it("closes the picker when the toggle is clicked again", () => {
    mount(vi.fn(async () => []));
    const toggle = screen.getByRole("button", { name: zhTW.ship.form.storeBrowse });
    fireEvent.click(toggle);
    expect(screen.getByText("台北市")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: zhTW.ship.form.storeBrowseClose }));
    expect(screen.queryByText("台北市")).toBeNull();
  });
});
