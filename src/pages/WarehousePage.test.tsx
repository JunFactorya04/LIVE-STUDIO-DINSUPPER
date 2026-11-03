// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { zhTW } from "../i18n/zh-TW";
import { LiveSessionStore } from "../live/sessionStore";
import { LiveSessionProvider } from "../live/useLiveSession";
import type { PrintService } from "../print/service";
import type { ScanRelay } from "../warehouse/relay";
import type { Unit, WarehouseClient } from "../warehouse/client";
import { WarehousePage } from "./WarehousePage";

afterEach(cleanup);

const unit: Unit = {
  code: "A12-000001",
  sku: "A12",
  price: 350,
  cost: 120,
  location: "A1",
  status: "IN_STOCK",
  receivedAt: "2026-10-01T00:00:00.000Z",
  shippedAt: "",
  orderId: "",
  color: "",
  size: "",
};

function fakeClient(shelf: Unit[] = [unit]): WarehouseClient {
  const no = async () => {
    throw new Error("unused");
  };
  return {
    available: true,
    units: async () => shelf,
    unit: async (c: string) => (c === unit.code ? unit : undefined),
    receive: no,
    ship: no,
    move: no,
    void: no,
    restock: no,
    countApply: no,
    moves: async () => [],
  } as unknown as WarehouseClient;
}

const labels = { available: false, print: vi.fn(async () => true) } as unknown as PrintService;

describe("WarehousePage realtime relay", () => {
  it("a code a phone sends reaches the open scan-out screen on the computer", async () => {
    let push: (c: string) => void = () => {};
    const relay: ScanRelay = {
      push: async () => {},
      listen: async (h) => {
        push = h;
        return () => {};
      },
    };
    render(
      <I18nProvider initial="zh-TW">
        <LiveSessionProvider store={new LiveSessionStore()}>
          <WarehousePage client={fakeClient()} labels={labels} receipts={labels} relay={relay} />
        </LiveSessionProvider>
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: zhTW.warehouse.tabs.ship }));
    await waitFor(() => expect(push).not.toBe(undefined));
    await act(async () => {
      push("A12-000001");
    });
    expect((await screen.findAllByText(/A12/)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/NT\$ 350/)).length).toBeGreaterThan(0);
  });
});

describe("WarehousePage stock overview", () => {
  it("shows how many of each colour and size are left, and finds them by the customer's words", async () => {
    const mk = (n: number, color: string, size: string): Unit => ({
      ...unit,
      code: `A12-00000${n}`,
      color,
      size,
    });
    const shelf = [mk(1, "黑色", "M"), mk(2, "黑色", "M"), mk(3, "白色", "L")];
    const store = new LiveSessionStore();
    store.saveCatalogItem({
      sku: "A12",
      name: "連帽衫",
      colors: ["黑色|黑", "白色"],
      sizes: ["M", "L"],
      aliases: [],
    });
    render(
      <I18nProvider initial="zh-TW">
        <LiveSessionProvider store={store}>
          <WarehousePage client={fakeClient(shelf)} labels={labels} receipts={labels} />
        </LiveSessionProvider>
      </I18nProvider>,
    );
    const card = (await screen.findByRole("heading", { name: "連帽衫" })).closest("article")!;
    expect(within(card as HTMLElement).getByLabelText("黑色 M：剩 2")).toHaveTextContent("2");
    expect(within(card as HTMLElement).getByLabelText("白色 M：剩 0")).toHaveTextContent("–");
    fireEvent.change(screen.getByLabelText(zhTW.warehouse.overview.search), {
      target: { value: "連帽衫 黑 M" },
    });
    expect(await screen.findByText("符合的有 2 件")).toBeInTheDocument();
  });
});
