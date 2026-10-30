import { describe, expect, it } from "vitest";
import type { ShipOrder } from "../ship/client";
import { buildPnl } from "../biz/ledger";
import type { Unit } from "./client";
import { unitSales } from "./sales";

const unit = (code: string, orderId = "", status: Unit["status"] = "SHIPPED"): Unit => ({
  code,
  sku: "A",
  price: 350,
  cost: 120,
  location: "",
  status,
  receivedAt: "2026-10-01T00:00:00.000Z",
  shippedAt: status === "SHIPPED" ? "2026-10-30T02:00:00.000Z" : "",
  orderId,
});

describe("unitSales", () => {
  it("turns scanned-out units into sales with the label price and cost", () => {
    const [s] = unitSales([unit("A-1")], []);
    expect([s.amount, s.qty, s.unitCost, s.sku]).toEqual([350, 1, 120, "A"]);
    expect(s.createdAt).toBe("2026-10-30T02:00:00.000Z");
  });

  it("skips units still on the shelf and units already carried by a ship order", () => {
    const order = { id: "o1" } as ShipOrder;
    const sales = unitSales(
      [unit("A-1", "o1"), unit("A-2", "", "IN_STOCK"), unit("A-3", "zz")],
      [order],
    );
    expect(sales.map((s) => s.id)).toEqual(["unit:A-3"]);
  });

  it("flows into the profit report: revenue - cost of goods - expenses", () => {
    const sales = unitSales([unit("A-1"), unit("A-2")], []);
    const p = buildPnl(
      sales,
      [],
      [
        {
          id: "e",
          name: "Thuê",
          amount: 3100,
          kind: "FIXED",
          category: "RENT",
          at: "2026-01-01",
          active: true,
        },
      ],
      "day",
      new Date("2026-10-30T10:00:00"),
    );
    expect(p.current.revenue).toBe(700);
    expect(p.current.cogs).toBe(240);
    expect(p.current.grossProfit).toBe(460);
    expect(p.current.netIncome).toBe(460 - 100); // 3100 / 31 days
  });
});
