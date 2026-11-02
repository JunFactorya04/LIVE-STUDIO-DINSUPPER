import { describe, expect, it, vi } from "vitest";
import { printTempSlip } from "./tempPrint";
import type { PrintService } from "./service";
import type { ShipClient } from "../ship/client";
import type { OrderRepository } from "../orders/repository";
import type { OrderDraft } from "../orders/types";
import type { TempSlipLabels } from "./slip";

const labels: TempSlipLabels = {
  title: "PHIẾU TẠM",
  note: "CHƯA XÁC NHẬN",
  user: "TikTok",
  time: "Giờ",
  comment: "Bình luận",
  product: "Sản phẩm",
  auto: "(tự đọc)",
  unknown: "Chưa rõ",
};

const draft = (over: Partial<OrderDraft> = {}): OrderDraft => ({
  id: "d1",
  sessionId: "s1",
  username: "amy_shop",
  sku: "A12",
  color: "黑色",
  size: "M",
  quantity: 2,
  confidence: 0.9,
  status: "DRAFT",
  reasons: [],
  evidence: [],
  createdAt: "2026-10-30T02:00:00.000Z",
  updatedAt: "2026-10-30T02:00:00.000Z",
  ...over,
});

function fakeShip(over: Partial<ShipClient> = {}): ShipClient {
  return {
    available: true,
    orders: vi.fn(async () => []),
    saveOrder: vi.fn(),
    deleteOrder: vi.fn(),
    setExported: vi.fn(),
    createWaybill: vi.fn(),
    customers: vi.fn(async () => []),
    saveCustomer: vi.fn(),
    deleteCustomer: vi.fn(),
    importStores: vi.fn(),
    lookupStore: vi.fn(),
    storesCount: vi.fn(),
    flow: vi.fn(),
    markFlow: vi.fn(async () => undefined),
    searchStores: vi.fn(),
    exportXlsx: vi.fn(),
    ...over,
  } as ShipClient;
}

function fakeOrders(over: Partial<OrderRepository> = {}): OrderRepository {
  return {
    listCatalog: vi.fn(),
    upsertCatalogItem: vi.fn(),
    deleteCatalogItem: vi.fn(),
    saveDraft: vi.fn(),
    listDrafts: vi.fn(),
    setStatus: vi.fn(),
    stockOverview: vi.fn(),
    saveSlipImage: vi.fn(async () => undefined),
    printedSlipIds: vi.fn(),
    slipImage: vi.fn(),
    ...over,
  } as OrderRepository;
}

const servicePrinting = (ok: boolean): PrintService =>
  ({ print: vi.fn(async () => ok) }) as unknown as PrintService;

describe("printTempSlip", () => {
  it("saves a PNG of the exact slip against the draft id once the print succeeds", async () => {
    const orders = fakeOrders();
    const ok = await printTempSlip(draft(), [], labels, {
      service: servicePrinting(true),
      ship: fakeShip(),
      orders,
      renderPng: () => "data:image/png;base64,FAKE",
    });
    expect(ok).toBe(true);
    expect(orders.saveSlipImage).toHaveBeenCalledWith("d1", "data:image/png;base64,FAKE");
  });

  it("never saves an image when the print itself failed", async () => {
    const orders = fakeOrders();
    const ok = await printTempSlip(draft(), [], labels, {
      service: servicePrinting(false),
      ship: fakeShip(),
      orders,
      renderPng: () => "data:image/png;base64,FAKE",
    });
    expect(ok).toBe(false);
    expect(orders.saveSlipImage).not.toHaveBeenCalled();
  });

  it("a renderer that cannot produce an image (no canvas) is a harmless no-op", async () => {
    const orders = fakeOrders();
    const ok = await printTempSlip(draft(), [], labels, {
      service: servicePrinting(true),
      ship: fakeShip(),
      orders,
      renderPng: () => undefined,
    });
    expect(ok).toBe(true);
    expect(orders.saveSlipImage).not.toHaveBeenCalled();
  });

  it("a failing save never turns a successful print into a reported failure", async () => {
    const orders = fakeOrders({
      saveSlipImage: vi.fn(async () => {
        throw new Error("disk full");
      }),
    });
    const ok = await printTempSlip(draft(), [], labels, {
      service: servicePrinting(true),
      ship: fakeShip(),
      orders,
      renderPng: () => "data:image/png;base64,FAKE",
    });
    expect(ok).toBe(true);
  });
});
