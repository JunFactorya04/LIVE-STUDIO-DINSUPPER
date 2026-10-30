// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
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
};

function fakeClient(): WarehouseClient {
  const no = async () => {
    throw new Error("unused");
  };
  return {
    available: true,
    units: async () => [unit],
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
        <WarehousePage client={fakeClient()} labels={labels} receipts={labels} relay={relay} />
      </I18nProvider>,
    );
    await waitFor(() => expect(push).not.toBe(undefined));
    await act(async () => {
      push("A12-000001");
    });
    expect((await screen.findAllByText(/A12/)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/NT\$ 350/)).length).toBeGreaterThan(0);
  });
});
