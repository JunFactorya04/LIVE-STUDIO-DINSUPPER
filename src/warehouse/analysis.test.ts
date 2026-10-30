import { describe, expect, it } from "vitest";
import type { StockItem } from "../biz/client";
import type { ShipOrder } from "../ship/client";
import type { Unit } from "./client";
import { aging, analyse, matrix, shelves, summarise, xyzOf } from "./analysis";

const NOW = new Date("2026-10-30T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const order = (sku: string, qty: number, amount: number, ago: number): ShipOrder =>
  ({
    id: `${sku}${ago}${amount}`,
    tiktokId: "",
    recipientName: "A",
    phone: "",
    temperature: "NORMAL",
    storeCode: "",
    storeName: "",
    product: "",
    note: "",
    amount,
    shippingFee: 0,
    cod: amount,
    exported: false,
    createdAt: daysAgo(ago),
    sku,
    qty,
    unitCost: 10,
  }) as ShipOrder;

const item = (sku: string, stock: number, cost = 10): StockItem => ({
  sku,
  cost,
  stock,
  minStock: 0,
});

const unit = (sku: string, ago: number, location = "A1"): Unit => ({
  code: `${sku}-${ago}`,
  sku,
  price: 20,
  cost: 10,
  location,
  status: "IN_STOCK",
  receivedAt: daysAgo(ago),
  shippedAt: "",
  orderId: "",
});

describe("ABC / XYZ", () => {
  it("ranks by revenue and cuts at 80% and 95%", () => {
    // revenue: A 800, B 150, C 40, D 10 -> shares .80 .15 .04 .01
    const orders = [
      order("A", 8, 800, 5),
      order("B", 3, 150, 5),
      order("C", 2, 40, 5),
      order("D", 1, 10, 5),
    ];
    const rows = analyse(
      orders,
      [item("A", 5), item("B", 5), item("C", 5), item("D", 5), item("E", 4)],
      [],
      NOW,
    );
    const abc = Object.fromEntries(rows.map((r) => [r.sku, r.abc]));
    // an item belongs to A while the cumulative share BEFORE it is under 80%
    expect(abc).toEqual({ A: "A", B: "B", C: "C", D: "C", E: "N" });
    expect(rows[0].share).toBeCloseTo(0.8);
    expect(rows[1].cumulative).toBeCloseTo(0.95);
  });

  it("calls steady weekly demand X and bursty demand Z", () => {
    const steady = Array.from({ length: 12 }, (_, w) => order("S", 2, 100, w * 7 + 1));
    const bursty = [order("Z", 24, 1200, 3)];
    const rows = analyse([...steady, ...bursty], [item("S", 10), item("Z", 10)], [], NOW);
    expect(rows.find((r) => r.sku === "S")!.xyz).toBe("X");
    expect(rows.find((r) => r.sku === "Z")!.xyz).toBe("Z");
    expect(xyzOf(0.5)).toBe("X");
    expect(xyzOf(0.51)).toBe("Y");
    expect(xyzOf(1.01)).toBe("Z");
    expect(xyzOf(undefined)).toBe("-");
  });

  it("puts every classified item in exactly one matrix cell", () => {
    const orders = [order("A", 9, 900, 2), order("B", 1, 100, 40)];
    const rows = analyse(orders, [item("A", 1), item("B", 1)], [], NOW);
    const cells = matrix(rows);
    expect(cells).toHaveLength(9);
    expect(cells.reduce((n, c) => n + c.skus.length, 0)).toBe(
      rows.filter((r) => r.xyz !== "-").length,
    );
  });
});

describe("cover, reorder and health", () => {
  it("computes cover days and a reorder point from the lead time", () => {
    // 90 units in 90 days = 1 a day, perfectly steady apart from week buckets
    const orders = Array.from({ length: 12 }, (_, w) => order("A", 7, 700, w * 7 + 1));
    const [r] = analyse(orders, [item("A", 5)], [], NOW, {
      windowDays: 84,
      leadDays: 7,
      reviewDays: 14,
    });
    expect(r.dailyDemand).toBeCloseTo(1);
    expect(r.cover).toBeCloseTo(5);
    expect(r.reorderPoint).toBe(7); // 7 days x 1 + no spread
    expect(r.health).toBe("low");
    expect(r.suggestOrder).toBe(16); // 7 + 14 - 5
  });

  it("flags out of stock, dead stock and healthy stock", () => {
    const orders = [order("OUT", 3, 300, 5), order("OK", 1, 100, 5)];
    const rows = analyse(
      orders,
      [item("OUT", 0), item("OK", 500), item("OLD", 4), item("NEW", 4)],
      [unit("OLD", 200), unit("NEW", 10)],
      NOW,
    );
    const h = Object.fromEntries(rows.map((r) => [r.sku, r.health]));
    expect(h).toEqual({ OUT: "out", OK: "slow", OLD: "dead", NEW: "new" });
  });

  it("summarises value, turnover and dead stock", () => {
    const rows = analyse(
      [order("A", 9, 900, 2)],
      [item("A", 10, 10), item("OLD", 4, 25)],
      [unit("OLD", 200)],
      NOW,
    );
    const s = summarise(rows, [item("A", 10, 10), item("OLD", 4, 25)]);
    expect(s.stockValue).toBe(200);
    expect(s.deadUnits).toBe(4);
    expect(s.deadValue).toBe(100);
    expect(s.turnover).toBeGreaterThan(0);
  });
});

describe("aging and shelves", () => {
  it("buckets units by days on the shelf", () => {
    const b = aging(
      [unit("A", 5), unit("A", 45), unit("A", 80), unit("A", 120), unit("A", 400)],
      NOW,
    );
    expect(b.map((x) => x.units)).toEqual([1, 1, 1, 2]);
  });
  it("counts units per shelf, fullest first", () => {
    const s = shelves([
      unit("A", 1, "B2"),
      unit("A", 2, "A1"),
      unit("A", 3, "A1"),
      unit("A", 4, ""),
    ]);
    expect(s.map((x) => [x.location, x.units])).toEqual([
      ["A1", 2],
      ["", 1],
      ["B2", 1],
    ]);
  });
});
