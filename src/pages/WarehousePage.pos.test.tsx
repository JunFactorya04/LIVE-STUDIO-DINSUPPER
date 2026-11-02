// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { zhTW } from "../i18n/zh-TW";
import type { PosClient, PosSale } from "../pos/client";
import type { PrintService } from "../print/service";
import type { ShipResult, Unit, WarehouseClient } from "../warehouse/client";
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

function fakeClient(ship: WarehouseClient["ship"]): WarehouseClient {
  const no = async () => {
    throw new Error("unused");
  };
  return {
    available: true,
    units: async () => [],
    unit: async (c: string) => (c === unit.code ? unit : undefined),
    receive: no,
    ship,
    move: no,
    void: no,
    restock: no,
    countApply: no,
    moves: async () => [],
  } as unknown as WarehouseClient;
}

const printer = { available: true, print: vi.fn(async () => true) } as unknown as PrintService;

function fakePosClient(save: PosClient["save"]): PosClient {
  return { available: true, save, list: async () => [] };
}

describe("Tính tiền (POS checkout)", () => {
  it("scans a unit, ships it under a new sale id, and saves the sale's payment method", async () => {
    const shipResult: ShipResult = { units: [unit], total: unit.price };
    const ship = vi.fn().mockResolvedValue(shipResult);
    const save = vi.fn().mockResolvedValue(undefined);

    render(
      <I18nProvider initial="zh-TW">
        <WarehousePage
          client={fakeClient(ship)}
          posClient={fakePosClient(save)}
          labels={printer}
          receipts={printer}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: zhTW.warehouse.tabs.pos }));

    const input = screen.getByPlaceholderText(zhTW.warehouse.scanHere);
    fireEvent.change(input, { target: { value: unit.code } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    expect(await screen.findAllByText(/A12/)).not.toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: zhTW.warehouse.pos.methods.TRANSFER }));
    fireEvent.click(screen.getByRole("button", { name: zhTW.warehouse.pos.go }));

    await waitFor(() => expect(ship).toHaveBeenCalledTimes(1));
    expect(ship.mock.calls[0][0]).toEqual([unit.code]);
    const saleId = ship.mock.calls[0][1];
    expect(ship.mock.calls[0][2]).toBe(false);

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const saved = save.mock.calls[0][0] as PosSale;
    expect(saved.id).toBe(saleId);
    expect(saved.total).toBe(unit.price);
    expect(saved.paymentMethod).toBe("TRANSFER");
    expect(saved.receiptNo).toBe(""); // numbering off by default
  });

  it("does not stop the sale when saving the till-history row fails", async () => {
    const shipResult: ShipResult = { units: [unit], total: unit.price };
    const ship = vi.fn(async () => shipResult);
    const save = vi.fn(async () => {
      throw new Error("db busy");
    });

    render(
      <I18nProvider initial="zh-TW">
        <WarehousePage
          client={fakeClient(ship)}
          posClient={fakePosClient(save)}
          labels={printer}
          receipts={printer}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: zhTW.warehouse.tabs.pos }));
    const input = screen.getByPlaceholderText(zhTW.warehouse.scanHere);
    fireEvent.change(input, { target: { value: unit.code } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findAllByText(/A12/);
    fireEvent.click(screen.getByRole("button", { name: zhTW.warehouse.pos.go }));

    await waitFor(() => expect(ship).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(await screen.findAllByText(/合計/)).not.toHaveLength(0);
  });
});
