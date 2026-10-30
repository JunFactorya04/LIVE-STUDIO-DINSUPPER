import { describe, expect, it } from "vitest";
import type { ShipOrder } from "../ship/client";
import type { Expense, Purchase } from "./client";
import { bestSellers, buildPnl, fixedPerDay, marginPct, stockSummary } from "./ledger";

const NOW = new Date(2026, 9, 30, 12);
const order = (day: number, amount: number, sku = "", qty = 0, unitCost = 0): ShipOrder => ({
  id: `o${day}${amount}${sku}`,
  tiktokId: "mai",
  recipientName: "Mai",
  phone: "0912345678",
  temperature: "NORMAL",
  storeCode: "131386",
  storeName: "x",
  product: "p",
  note: "",
  amount,
  shippingFee: 38,
  cod: amount + 38,
  exported: false,
  createdAt: new Date(2026, 9, day, 9).toISOString(),
  sku,
  qty,
  unitCost,
});
const fixed = (amount: number, at = "2026-01-01", active = true): Expense => ({
  id: "f" + amount,
  name: "Thuê kho",
  amount,
  kind: "FIXED",
  category: "RENT",
  at,
  active,
});

describe("buildPnl", () => {
  it("subtracts cost of goods, one-off costs and the day's share of monthly costs", () => {
    const orders = [order(30, 1000, "A", 2, 200), order(30, 500)];
    const once: Expense = {
      id: "x",
      name: "Quảng cáo",
      amount: 100,
      kind: "ONCE",
      category: "ADS",
      at: "2026-10-30",
      active: true,
    };
    const p = buildPnl(orders, [], [fixed(3100), once], "day", NOW);
    expect(p.current.revenue).toBe(1500);
    expect(p.current.cogs).toBe(400);
    expect(p.current.grossProfit).toBe(1100);
    expect(p.current.fixedCosts).toBe(100); // 3100 / 31 days
    expect(p.current.oneOffCosts).toBe(100);
    expect(p.current.netIncome).toBe(900);
    expect(p.current.tracked).toBe(1);
  });

  it("a month carries the whole monthly cost and purchases count as cash out only", () => {
    const purchases: Purchase[] = [
      { id: "p", sku: "A", qty: 10, unitCost: 50, supplier: "", note: "", at: "2026-10-05" },
    ];
    const p = buildPnl([order(2, 1000, "A", 1, 300)], purchases, [fixed(3000)], "month", NOW);
    expect(p.current.fixedCosts).toBe(3000);
    expect(p.current.purchases).toBe(500);
    expect(p.current.netIncome).toBe(1000 - 300 - 3000);
    expect(p.current.cashFlow).toBe(1000 - 500 - 3000);
  });

  it("monthly costs start in their first month and stop when switched off", () => {
    expect(fixedPerDay([fixed(3100, "2026-11-01")], new Date(2026, 9, 30))).toBe(0);
    expect(fixedPerDay([fixed(3100, "2026-10-15")], new Date(2026, 9, 1))).toBe(100);
    expect(fixedPerDay([fixed(3100, "2026-01-01", false)], new Date(2026, 9, 1))).toBe(0);
  });
});

describe("stock and sellers", () => {
  it("ranks best sellers by units and works out profit", () => {
    const b = bestSellers([
      order(30, 600, "A", 2, 100),
      order(29, 300, "B", 1, 100),
      order(28, 100),
    ]);
    expect(b.map((x) => x.sku)).toEqual(["A", "B"]);
    expect(b[0].profit).toBe(400);
  });
  it("values stock and flags low, oversold and idle items", () => {
    const s = stockSummary(
      [
        { sku: "A", cost: 100, stock: 3, minStock: 5 },
        { sku: "B", cost: 50, stock: -2, minStock: 0 },
        { sku: "C", cost: 10, stock: 40, minStock: 0 },
      ],
      new Set(["A"]),
    );
    expect(s.value).toBe(3 * 100 + 40 * 10);
    expect(s.low.map((x) => x.sku)).toEqual(["A"]);
    expect(s.oversold.map((x) => x.sku)).toEqual(["B"]);
    expect(s.idle.map((x) => x.sku)).toEqual(["C"]);
  });
  it("margin", () => {
    expect(marginPct(200, 150)).toBe(25);
    expect(marginPct(undefined, 10)).toBeUndefined();
  });

  it("takes a share of each order for percent costs and groups every cost", () => {
    const pct: Expense = {
      id: "p",
      name: "Phí sàn",
      amount: 250, // 2.50%
      kind: "PERCENT",
      category: "PLATFORM",
      at: "2026-01-01",
      active: true,
    };
    const orders = [order(30, 1000, "A", 1, 200)];
    const p = buildPnl(orders, [], [pct, fixed(3100)], "day", NOW);
    expect(p.current.shareCosts).toBe(25);
    expect(p.current.byCategory).toMatchObject({ PLATFORM: 25, RENT: 100 });
    // gross 800, minus 100 monthly share and 25 percent cost
    expect(p.current.netIncome).toBe(800 - 100 - 25);
    // a paused item and one that starts later cost nothing
    const none = buildPnl(
      orders,
      [],
      [
        { ...pct, active: false },
        { ...pct, id: "q", at: "2027-01-01" },
      ],
      "day",
      NOW,
    );
    expect(none.current.shareCosts).toBe(0);
  });
});
