import { describe, expect, it } from "vitest";
import type { ShipOrder } from "../ship/client";
import { buildFinance, delta, niceMax } from "./finance";

const o = (createdAt: string, amount: number, over: Partial<ShipOrder> = {}): ShipOrder => ({
  id: createdAt + amount,
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
  createdAt,
  ...over,
});

// Friday 30 Oct 2026, local time.
const NOW = new Date(2026, 9, 30, 12, 0, 0);

describe("buildFinance", () => {
  it("groups by day and compares with the day before", () => {
    const f = buildFinance(
      [
        o(new Date(2026, 9, 30, 9).toISOString(), 300),
        o(new Date(2026, 9, 30, 10).toISOString(), 200, { exported: true }),
        o(new Date(2026, 9, 29, 10).toISOString(), 100),
      ],
      "day",
      NOW,
    );
    expect(f.buckets).toHaveLength(14);
    expect(f.current.orders).toBe(2);
    expect(f.current.revenue).toBe(500);
    expect(f.current.fees).toBe(76);
    expect(f.current.cod).toBe(576);
    expect(f.previous.revenue).toBe(100);
    expect(f.exported).toBe(1);
    expect(f.pending).toBe(2);
  });

  it("starts weeks on Monday", () => {
    const f = buildFinance(
      [
        o(new Date(2026, 9, 26, 8).toISOString(), 100), // Monday
        o(new Date(2026, 9, 25, 8).toISOString(), 50), // Sunday before
      ],
      "week",
      NOW,
    );
    expect(f.current.revenue).toBe(100);
    expect(f.previous.revenue).toBe(50);
  });

  it("groups by month and ignores orders outside the window or with bad dates", () => {
    const f = buildFinance(
      [
        o(new Date(2026, 9, 2).toISOString(), 400),
        o(new Date(2026, 8, 20).toISOString(), 100),
        o(new Date(2020, 0, 1).toISOString(), 999),
        o("not a date", 5),
      ],
      "month",
      NOW,
    );
    expect(f.current.revenue).toBe(400);
    expect(f.previous.revenue).toBe(100);
    expect(f.total.revenue).toBe(500);
  });

  it("ranks buyers by revenue", () => {
    const f = buildFinance(
      [
        o(new Date(2026, 9, 30, 9).toISOString(), 100, { tiktokId: "a" }),
        o(new Date(2026, 9, 30, 9).toISOString(), 900, { tiktokId: "b" }),
      ],
      "day",
      NOW,
    );
    expect(f.topBuyers.map((b) => b.tiktokId)).toEqual(["b", "a"]);
  });
});

describe("helpers", () => {
  it("delta", () => {
    expect(delta(150, 100)).toBe(50);
    expect(delta(50, 100)).toBe(-50);
    expect(delta(5, 0)).toBeUndefined();
  });
  it("niceMax", () => {
    expect(niceMax(0)).toBe(10);
    expect(niceMax(730)).toBe(1000);
    expect(niceMax(1800)).toBe(2000);
    expect(niceMax(3200)).toBe(5000);
  });
});
