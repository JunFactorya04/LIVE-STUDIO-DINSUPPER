// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { zhTW } from "../i18n/zh-TW";
import { LiveSessionStore } from "../live/sessionStore";
import { LiveSessionProvider } from "../live/useLiveSession";
import { visibleNav } from "../navigation";
import type { Unit, WarehouseClient } from "../warehouse/client";
import type { SkuImageClient } from "../warehouse/images";
import { createScanRelay, routeScan, takeQueued, type ScanRelay } from "../warehouse/relay";
import { HomePage } from "./HomePage";
import { ScanPage } from "./ScanPage";

afterEach(cleanup);

const unit: Unit = {
  code: "A12-000001",
  sku: "A12",
  price: 590,
  cost: 200,
  location: "A1",
  status: "IN_STOCK",
  receivedAt: "",
  shippedAt: "",
  orderId: "",
  color: "黑色",
  size: "M",
};
const wh = {
  available: true,
  unit: async (c: string) => (c === unit.code ? unit : undefined),
} as unknown as WarehouseClient;
const images = { available: false } as unknown as SkuImageClient;

function mount(relay: ScanRelay) {
  const store = new LiveSessionStore();
  store.saveCatalogItem({ sku: "A12", name: "連帽衫", colors: [], sizes: [], aliases: [] });
  render(
    <I18nProvider initial="zh-TW">
      <LiveSessionProvider store={store}>
        <ScanPage client={wh} relay={relay} images={images} />
      </LiveSessionProvider>
    </I18nProvider>,
  );
}

const type = (code: string) => {
  fireEvent.change(screen.getByLabelText(zhTW.scan.typeCode), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
};

describe("phone scan screen", () => {
  it("sends a checkout scan to the computer for the Thanh Toán screen, named", async () => {
    const push = vi.fn(async () => {});
    mount({ push, listen: async () => () => {} });
    type(unit.code);
    await waitFor(() => expect(push).toHaveBeenCalledWith(unit.code, "pay"));
    expect(await screen.findByText(zhTW.scan.sent)).toBeInTheDocument();
    expect(screen.getByText("連帽衫")).toBeInTheDocument();
  });

  it("looks a label up right on the phone, and says when it is unknown", async () => {
    const push = vi.fn(async () => {});
    mount({ push, listen: async () => () => {} });
    fireEvent.click(screen.getByRole("button", { name: zhTW.scan.modes.lookup }));
    type(unit.code);
    expect(await screen.findByRole("heading", { name: "連帽衫" })).toBeInTheDocument();
    expect(screen.getAllByText(zhTW.scan.status.IN_STOCK).length).toBeGreaterThan(0);
    expect(screen.getByText("NT$ 590")).toBeInTheDocument();
    type("ZZ-999999");
    expect((await screen.findAllByText(new RegExp(zhTW.scan.unknown))).length).toBeGreaterThan(0);
    expect(push).not.toHaveBeenCalled();
  });
});

describe("routed scans on the computer", () => {
  it("wait for their screen, then go only to it", async () => {
    routeScan("A12-000002", "pay");
    routeScan("A12-000003", "ship");
    const relay = createScanRelay();
    const got: string[] = [];
    const off = await relay.listen((c) => got.push(c), "pay");
    await new Promise((r) => setTimeout(r, 5));
    expect(got).toEqual(["A12-000002"]);
    routeScan("A12-000004", "pay"); // a listener is there: straight to it
    expect(got).toEqual(["A12-000002", "A12-000004"]);
    off();
    expect(takeQueued("ship")).toEqual(["A12-000003"]);
  });

  it("keep the phone's home and scan screens off the computer", () => {
    expect(visibleNav(false).some((i) => i.id === "home" || i.id === "scan")).toBe(false);
    expect(visibleNav(true).map((i) => i.id)).toEqual(expect.arrayContaining(["home", "scan"]));
  });
});

describe("phone home", () => {
  it("counts today's orders and opens scan-to-pay", async () => {
    const store = new LiveSessionStore();
    const onNavigate = vi.fn();
    const ship = { available: true, orders: async () => [{ exported: false }, { exported: true }] };
    render(
      <I18nProvider initial="zh-TW">
        <LiveSessionProvider store={store}>
          <HomePage onNavigate={onNavigate} ship={ship as never} />
        </LiveSessionProvider>
      </I18nProvider>,
    );
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: zhTW.home.scanPay }));
    expect(onNavigate).toHaveBeenCalledWith("scan");
    expect(screen.getByText(zhTW.home.toShip).nextSibling).toHaveTextContent("1");
  });
});
