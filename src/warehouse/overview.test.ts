import { describe, expect, it } from "vitest";
import type { CatalogItem } from "../orders/types";
import type { Unit } from "./client";
import {
  canonicalVariant,
  searchStock,
  sortSizes,
  stockOverview,
  swatchOf,
  variantKey,
} from "./overview";

let n = 0;
const unit = (sku: string, color: string, size: string, price = 350): Unit => ({
  code: `${sku}-${String(++n).padStart(6, "0")}`,
  sku,
  price,
  cost: 100,
  location: "A1",
  status: "IN_STOCK",
  receivedAt: "2026-11-01T00:00:00Z",
  shippedAt: "",
  orderId: "",
  color,
  size,
});

const hoodie: CatalogItem = {
  sku: "A12",
  name: "Áo hoodie",
  colors: ["Đen|den|black", "Trắng"],
  sizes: ["S", "M", "L"],
  aliases: ["hoodie"],
};
const cap: CatalogItem = { sku: "B01", name: "Nón", colors: [], sizes: [], aliases: [] };

describe("stockOverview", () => {
  const shelf = [
    unit("A12", "Đen", "M"),
    unit("A12", "Đen", "M"),
    unit("A12", "Trắng", "L", 390),
    unit("A12", "Xanh lá", "M"),
    unit("Z9", "", ""),
  ];
  const list = stockOverview(shelf, [hoodie, cap]);

  it("counts each colour and size of a product", () => {
    const p = list.find((x) => x.sku === "A12")!;
    expect(p.inStock).toBe(4);
    expect(p.counts.get(variantKey("Đen", "M"))).toBe(2);
    expect(p.counts.get(variantKey("Trắng", "L"))).toBe(1);
    expect(p.counts.get(variantKey("Đen", "S"))).toBeUndefined();
    // catalog colours first, then a colour only the shelf knows
    expect(p.colors).toEqual(["Đen", "Trắng", "Xanh lá"]);
    expect(p.sizes).toEqual(["S", "M", "L"]);
    expect([p.minPrice, p.maxPrice]).toEqual([350, 390]);
    expect(p.state).toBe("OK");
  });

  it("keeps sold-out products, last, and products with no variant", () => {
    expect(list.map((p) => p.sku)).toEqual(["A12", "Z9", "B01"]);
    const sold = list.find((p) => p.sku === "B01")!;
    expect([sold.inStock, sold.state]).toEqual([0, "OUT"]);
    const plain = list.find((p) => p.sku === "Z9")!;
    expect([plain.colors, plain.sizes, plain.state]).toEqual([[""], [""], "LOW"]);
  });

  it("answers a customer's question by colour and size", () => {
    const [hit] = searchStock(list, "hoodie den m");
    expect(hit.product.sku).toBe("A12");
    expect([...hit.variants]).toEqual([variantKey("Đen", "M")]);
    // "m" is a size only exactly, never inside "xl"
    expect(searchStock(list, "xanh").map((h) => [...h.variants])).toEqual([
      [variantKey("Xanh lá", "S"), variantKey("Xanh lá", "M"), variantKey("Xanh lá", "L")],
    ]);
    expect(searchStock(list, "hoodie XL")).toEqual([]);
    expect(searchStock(list, "").length).toBe(3);
  });
});

describe("variants", () => {
  it("orders sizes naturally", () => {
    expect(sortSizes(["XL", "S", "40", "M", "38", "Free", ""])).toEqual([
      "S",
      "M",
      "XL",
      "38",
      "40",
      "Free",
      "",
    ]);
  });

  it("uses the catalog's spelling for a typed alias", () => {
    expect(canonicalVariant(" black ", hoodie.colors)).toBe("Đen");
    expect(canonicalVariant("Hồng", hoodie.colors)).toBe("Hồng");
    expect(canonicalVariant("  ", hoodie.colors)).toBe("");
  });

  it("paints a swatch for colours it knows", () => {
    expect(swatchOf("Đen")).toBe("#1c1c1e");
    expect(swatchOf("Xanh lá")).toBe("#34c759");
    expect(swatchOf("xanh dương")).toBe("#007aff");
    expect(swatchOf("黑色")).toBe("#1c1c1e");
    expect(swatchOf("Đỏ đô")).toBe("#ff3b30");
    expect(swatchOf("Đồng")).toBeUndefined();
    expect(swatchOf("Họa tiết")).toBeUndefined();
  });
});
