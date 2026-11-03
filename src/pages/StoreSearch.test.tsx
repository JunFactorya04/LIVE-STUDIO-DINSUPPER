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

describe("suggestions while typing", () => {
  it("finds stores by part of the name and by an address, and suggests the district's roads", async () => {
    const findStores = vi.fn(async (q: { name?: string; road?: string }) =>
      q.name ? [hit({ code: "260035", name: "鈺星", address: "台南市新化區全興里" })] : [],
    );
    const roadsInArea = vi.fn(async () => ["中正路", "中山路", "忠孝路"]);
    const onPick = vi.fn();
    render(
      <I18nProvider initial="zh-TW">
        <StoreSearch
          api={{ searchStores: vi.fn(async () => []), findStores, roadsInArea }}
          onPick={onPick}
        />
      </I18nProvider>,
    );
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "鈺星" } });
    await waitFor(() => expect(findStores).toHaveBeenCalledWith({ name: "鈺星" }));
    fireEvent.click(await screen.findByText("260035"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ code: "260035" }));

    fireEvent.change(input, { target: { value: "台南市新化區中" } });
    await waitFor(() =>
      expect(findStores).toHaveBeenCalledWith({ city: "台南市", town: "新化區", road: "中" }),
    );
    expect(await screen.findByRole("button", { name: "台南市新化區 ›" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "中正路" }));
    expect((input as HTMLInputElement).value).toBe("台南市新化區中正路");
    await waitFor(() =>
      expect(findStores).toHaveBeenCalledWith({ city: "台南市", town: "新化區", road: "中正路" }),
    );
  });

  it("looks up a partial store number among the stores this computer knows", async () => {
    const storesByPrefix = vi.fn(async () => [hit({ code: "260035", name: "鈺星" })]);
    const searchStores = vi.fn(async () => []);
    render(
      <I18nProvider initial="zh-TW">
        <StoreSearch api={{ searchStores, storesByPrefix }} onPick={vi.fn()} />
      </I18nProvider>,
    );
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2600" } });
    expect(await screen.findByText("鈺星")).toBeTruthy();
    expect(storesByPrefix).toHaveBeenCalledWith("2600");
    expect(searchStores).not.toHaveBeenCalled();
  });
});
