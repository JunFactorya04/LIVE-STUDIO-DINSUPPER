// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { zhTW } from "../i18n/zh-TW";
import type { PosClient, PosSale } from "../pos/client";
import type { PrintService } from "../print/service";
import type { ShipResult, Unit, WarehouseClient } from "../warehouse/client";
import type { ScanRelay } from "../warehouse/relay";
import { PosPage } from "./PosPage";

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
  return { available: true, save, list: async () => [] as PosSale[] };
}

describe("Thanh Toán (standalone POS page)", () => {
  it("scans a unit, ships it under a new sale id, and saves the sale's payment method", async () => {
    const shipResult: ShipResult = { units: [unit], total: unit.price };
    const ship = vi.fn().mockResolvedValue(shipResult);
    const save = vi.fn().mockResolvedValue(undefined);

    render(
      <I18nProvider initial="zh-TW">
        <PosPage client={fakeClient(ship)} posClient={fakePosClient(save)} receipts={printer} />
      </I18nProvider>,
    );

    const input = screen.getByPlaceholderText(zhTW.warehouse.scanHere);
    fireEvent.change(input, { target: { value: unit.code } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    expect(await screen.findAllByText(/A12/)).not.toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: zhTW.warehouse.pos.methods.TRANSFER }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(zhTW.warehouse.pos.confirm) }));

    await waitFor(() => expect(ship).toHaveBeenCalledTimes(1));
    expect(ship.mock.calls[0][0]).toEqual([unit.code]);
    const saleId = ship.mock.calls[0][1];
    expect(ship.mock.calls[0][2]).toBe(false);

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const saved = save.mock.calls[0][0] as PosSale;
    expect(saved.id).toBe(saleId);
    expect(saved.total).toBe(unit.price);
    expect(saved.paymentMethod).toBe("TRANSFER");
  });

  it("a label the phone sends twice is in the cart once", async () => {
    const ship = vi.fn().mockResolvedValue({ units: [unit], total: unit.price });
    let push: ((code: string) => void) | undefined;
    const relay: ScanRelay = {
      push: async () => {},
      listen: async (h) => {
        push = h;
        return () => {};
      },
    };
    render(
      <I18nProvider initial="zh-TW">
        <PosPage
          client={fakeClient(ship)}
          posClient={fakePosClient(vi.fn().mockResolvedValue(undefined))}
          receipts={printer}
          relay={relay}
        />
      </I18nProvider>,
    );
    await waitFor(() => expect(push).toBeDefined());
    await act(async () => {
      push!(unit.code);
    });
    await act(async () => {
      push!(unit.code);
    });
    expect(
      await screen.findByText(zhTW.warehouse.alreadyScanned.replace("{code}", unit.code)),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(zhTW.warehouse.pos.confirm) }));
    await waitFor(() => expect(ship).toHaveBeenCalledTimes(1));
    expect(ship.mock.calls[0][0]).toEqual([unit.code]);
  });

  it("does not stop the sale when saving the till-history row fails", async () => {
    const shipResult: ShipResult = { units: [unit], total: unit.price };
    const ship = vi.fn(async () => shipResult);
    const save = vi.fn(async () => {
      throw new Error("db busy");
    });

    render(
      <I18nProvider initial="zh-TW">
        <PosPage client={fakeClient(ship)} posClient={fakePosClient(save)} receipts={printer} />
      </I18nProvider>,
    );

    const input = screen.getByPlaceholderText(zhTW.warehouse.scanHere);
    fireEvent.change(input, { target: { value: unit.code } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findAllByText(/A12/);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(zhTW.warehouse.pos.confirm) }));

    await waitFor(() => expect(ship).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(await screen.findAllByText(/尚未掃描商品/)).not.toHaveLength(0);
  });
});
