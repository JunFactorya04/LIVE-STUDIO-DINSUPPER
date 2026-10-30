import { describe, expect, it } from "vitest";
import type { OrderDraft } from "../orders/types";
import type { FlowRecord, ShipCustomer, ShipOrder } from "./client";
import { buildFlow, workReport } from "./flow";

const draft = (id: string, user: string, over: Partial<OrderDraft> = {}): OrderDraft => ({
  id,
  sessionId: "s",
  username: user,
  confidence: 1,
  status: "CONFIRMED",
  reasons: [],
  evidence: [],
  createdAt: "2026-10-30T01:00:00Z",
  updatedAt: "2026-10-30T01:00:00Z",
  ...over,
});
const cust = (id: string, over: Partial<ShipCustomer> = {}): ShipCustomer => ({
  tiktokId: id,
  name: "",
  phone: "",
  storeCode: "",
  storeName: "",
  updatedAt: "2026-10-30T02:00:00Z",
  ...over,
});
const order = (id: string, user: string, over: Partial<ShipOrder> = {}): ShipOrder => ({
  id,
  tiktokId: user,
  recipientName: "Mai",
  phone: "0912345678",
  temperature: "NORMAL",
  storeCode: "131386",
  storeName: "x",
  product: "p",
  note: "",
  amount: 100,
  shippingFee: 38,
  cod: 138,
  exported: false,
  createdAt: "2026-10-30T03:00:00Z",
  sku: "",
  qty: 0,
  unitCost: 0,
  ...over,
});
const rec = (id: string, over: Partial<FlowRecord> = {}): FlowRecord => ({
  tiktokId: id,
  slipPrintedAt: null,
  askCopiedAt: null,
  ...over,
});

describe("buildFlow", () => {
  it("walks a buyer through the steps in order", () => {
    const base = { drafts: [draft("d1", "Mai")], customers: [cust("mai")], orders: [], flow: [] };
    expect(buildFlow(base)[0]).toMatchObject({ tiktokId: "mai", next: "slip", draftId: "d1" });
    const printed = { ...base, flow: [rec("mai", { slipPrintedAt: "t" })] };
    expect(buildFlow(printed)[0]?.next).toBe("ask");
    const asked = { ...base, flow: [rec("mai", { slipPrintedAt: "t", askCopiedAt: "t" })] };
    expect(buildFlow(asked)[0]?.next).toBe("info");
    const info = {
      ...asked,
      customers: [cust("mai", { name: "Mai", phone: "0912345678", storeCode: "131386" })],
    };
    expect(buildFlow(info)[0]?.next).toBe("ship");
    const shipped = { ...info, orders: [order("o1", "mai")] };
    const done = buildFlow(shipped)[0];
    expect(done?.next).toBeUndefined();
    expect(done?.ship).toBe("pending");
    expect(
      buildFlow({ ...shipped, orders: [order("o1", "mai", { exported: true })] })[0]?.ship,
    ).toBe("exported");
  });

  it("does not wait for the slip when there is no printer", () => {
    const i = { drafts: [draft("d1", "mai")], customers: [cust("mai")], orders: [], flow: [] };
    expect(buildFlow({ ...i, printerReady: false })[0]?.next).toBe("ask");
  });

  it("lists unfinished buyers before finished ones, and ignores unconfirmed drafts", () => {
    const list = buildFlow({
      drafts: [draft("d1", "a"), draft("d2", "b", { status: "DRAFT" })],
      customers: [cust("a"), cust("done", { name: "n", phone: "0911111111", storeCode: "111111" })],
      orders: [order("o1", "done")],
      flow: [rec("done", { slipPrintedAt: "t", askCopiedAt: "t" })],
    });
    expect(list.map((b) => b.tiktokId)).toEqual(["a", "done"]);
  });
});

describe("workReport", () => {
  it("counts the session and today's follow-up work", () => {
    const now = new Date("2026-10-30T12:00:00");
    const r = workReport({
      now,
      comments: [{ eventId: "1" } as never, { eventId: "2" } as never],
      drafts: [draft("d1", "a"), draft("d2", "b", { status: "CANCELLED" })],
      customers: [cust("a", { name: "n", phone: "0911111111", storeCode: "111111" })],
      orders: [
        order("o1", "a", { createdAt: "2026-10-30T05:00:00" }),
        order("o2", "a", { createdAt: "2026-10-29T05:00:00", exported: true }),
      ],
      flow: [
        rec("a", { slipPrintedAt: "2026-10-30T04:00:00", askCopiedAt: "2026-10-28T04:00:00" }),
      ],
    });
    expect(r).toMatchObject({
      comments: 2,
      drafts: 1,
      confirmed: 1,
      slips: 1,
      asks: 0,
      infos: 1,
      shipOrders: 1,
      exported: 0,
      pending: 1,
      codPending: 138,
    });
  });
});
