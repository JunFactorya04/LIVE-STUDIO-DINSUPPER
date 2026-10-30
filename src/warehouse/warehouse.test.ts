import { describe, expect, it } from "vitest";
import { addScan, bySku, expectedMissing } from "./stats";
import { errorParts, type Unit } from "./client";
import { shipReceipt } from "./receipt";
import { unitLabel } from "../print/label";
import { canEncode } from "../barcode/code128";

const u = (code: string, sku: string, price: number, location = "A1"): Unit => ({
  code,
  sku,
  price,
  cost: Math.round(price / 2),
  location,
  status: "IN_STOCK",
  receivedAt: "t",
  shippedAt: "",
  orderId: "",
});

describe("warehouse helpers", () => {
  it("groups units by sku with price range, value and shelves", () => {
    const rows = bySku([u("A-1", "A", 100), u("A-2", "A", 120, "B2"), u("B-1", "B", 50)]);
    expect(rows).toEqual([
      { sku: "A", units: 2, minPrice: 100, maxPrice: 120, value: 110, locations: ["A1", "B2"] },
      { sku: "B", units: 1, minPrice: 50, maxPrice: 50, value: 25, locations: ["A1"] },
    ]);
  });

  it("finds what a count did not see, within one shelf or everywhere", () => {
    const shelf = [u("A-1", "A", 1), u("A-2", "A", 1), u("B-1", "B", 1, "B2")];
    const seen = new Set(["A-1"]);
    expect(expectedMissing(shelf, seen, "A1").map((x) => x.code)).toEqual(["A-2"]);
    expect(expectedMissing(shelf, seen, "").map((x) => x.code)).toEqual(["A-2", "B-1"]);
  });

  it("ignores blanks and repeated scans", () => {
    expect(addScan([], "  ").added).toBe(false);
    const a = addScan([], " A-1 ");
    expect(a).toEqual({ list: ["A-1"], added: true, code: "A-1" });
    expect(addScan(a.list, "A-1").added).toBe(false);
  });

  it("splits backend error codes", () => {
    expect(errorParts("NOT_IN_STOCK:A-1")).toEqual(["NOT_IN_STOCK", "A-1"]);
    expect(errorParts(new Error("BAD_QTY"))).toEqual(["BAD_QTY", ""]);
    expect(errorParts(undefined)).toEqual(["", ""]);
  });

  it("totals the prices on the ship receipt", () => {
    const slip = shipReceipt([u("A-1", "A", 100), u("B-1", "B", 250)], {
      title: "XUẤT",
      total: "Tổng",
      items: "Số món",
      currency: "NT$",
    });
    const text = slip.lines.map((l) => l.text).join("\n");
    expect(text).toContain("Số món: 2");
    expect(text).toContain("Tổng: NT$ 350");
  });

  it("puts the price and a Code 128 barcode of the unit code on the label", () => {
    const slip = unitLabel({ code: "A12-000001", sku: "A12", price: 1350, location: "A1" });
    expect(slip.lines.some((l) => l.text.includes("1,350"))).toBe(true);
    const bars = slip.lines.find((l) => l.barcode);
    expect(bars?.barcode).toBe("A12-000001");
    expect(canEncode(bars!.barcode!)).toBe(true);
  });
});

describe("label options", () => {
  const u = { code: "A12-000001", sku: "A12", price: 350, location: "A1" };
  it("prints the selling price only, never the cost", async () => {
    const { unitLabel } = await import("../print/label");
    const text = JSON.stringify(unitLabel({ ...u, cost: 120 } as typeof u));
    expect(text).toContain("350");
    expect(text).not.toContain("120");
  });
  it("applies copies, alignment and the chosen lines", async () => {
    const { unitLabel, labelRun } = await import("../print/label");
    const { DEFAULT_LABEL_OPTIONS, clampCopies, normalise } = await import("../print/labelOptions");
    const o = {
      ...DEFAULT_LABEL_OPTIONS,
      copies: 3,
      align: "left" as const,
      showSku: false,
      showLocation: true,
    };
    expect(labelRun([u, u], o)).toHaveLength(6);
    const lines = unitLabel(u, o).lines;
    expect(lines.every((l) => l.align === "left")).toBe(true);
    expect(lines.some((l) => l.text === "A12")).toBe(false);
    expect(lines[lines.length - 1]?.text).toContain("A1");
    expect(clampCopies(0)).toBe(1);
    expect(clampCopies(500)).toBe(99);
    expect(normalise({ copies: 7, barHeight: 999 as 48 }).barHeight).toBe(64);
  });
});
