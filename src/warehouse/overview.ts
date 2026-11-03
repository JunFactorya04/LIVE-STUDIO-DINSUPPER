import type { CatalogItem } from "../orders/types";
import type { Unit } from "./client";

// The stock overview: one entry per product (sku), with how many are on the shelf in each
// colour and size, so a glance answers "is there still a black M?". Built from the barcode
// units on the shelf (the truth) plus the product list (name, aliases, and products that are
// sold out but still known).

export type StockState = "OUT" | "LOW" | "OK";

/** At or under this many units a product (or one colour/size of it) counts as running low. */
export const LOW_AT = 2;

export interface Product {
  sku: string;
  name: string;
  aliases: string[];
  inStock: number;
  minPrice: number;
  maxPrice: number;
  locations: string[];
  /** Grid axes, in display order. A single "" entry means the units carry no colour (or size). */
  colors: string[];
  sizes: string[];
  /** count by variantKey(color, size); missing = 0. */
  counts: ReadonlyMap<string, number>;
  state: StockState;
}

export const variantKey = (color: string, size: string) => `${color}\u0000${size}`;

/** Lower-case, no accents, đ→d: "Đen" and "den" match, "黑色" stays as it is. */
export const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().trim();

const SIZE_ORDER = ["xxs", "xs", "s", "m", "l", "xl", "xxl", "2xl", "xxxl", "3xl", "4xl", "5xl"];

/** Clothing sizes in their natural order, then numbers ascending, then anything else as found. */
export function sortSizes(sizes: Iterable<string>): string[] {
  const rank = (s: string): [number, number] => {
    const i = SIZE_ORDER.indexOf(fold(s));
    if (i >= 0) return [0, i];
    const n = Number(s.replace(",", "."));
    if (s.trim() !== "" && Number.isFinite(n)) return [1, n];
    return [s === "" ? 3 : 2, 0];
  };
  return [...new Set(sizes)].sort((a, b) => {
    const [ga, va] = rank(a);
    const [gb, vb] = rank(b);
    return ga - gb || va - vb || a.localeCompare(b);
  });
}

/** First name of each "|"-separated catalog colour/size entry ("黑色|黑|black" -> "黑色"). */
const canonical = (entry: string) => entry.split("|")[0].trim();

/**
 * The catalog's own spelling for a colour or size the seller typed, if one of its aliases
 * matches ("den" -> "Đen" when the catalog lists "Đen|den|black"); otherwise the text as typed.
 */
export function canonicalVariant(typed: string, entries: readonly string[]): string {
  const t = fold(typed);
  if (!t) return "";
  for (const e of entries) if (e.split("|").some((a) => fold(a) === t)) return canonical(e);
  return typed.trim();
}

const stateOf = (n: number): StockState => (n <= 0 ? "OUT" : n <= LOW_AT ? "LOW" : "OK");

export function stockOverview(shelf: readonly Unit[], catalog: readonly CatalogItem[]): Product[] {
  const bySku = new Map<string, Unit[]>();
  for (const u of shelf) {
    if (u.status !== "IN_STOCK") continue;
    const list = bySku.get(u.sku);
    if (list) list.push(u);
    else bySku.set(u.sku, [u]);
  }
  const skus = new Set([...catalog.map((c) => c.sku), ...bySku.keys()]);
  const out: Product[] = [];
  for (const sku of skus) {
    const item = catalog.find((c) => c.sku === sku);
    const units = bySku.get(sku) ?? [];
    const counts = new Map<string, number>();
    for (const u of units) {
      const k = variantKey(u.color ?? "", u.size ?? "");
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const seenColors = units.map((u) => u.color ?? "");
    const catalogColors = (item?.colors ?? []).map(canonical).filter(Boolean);
    // Catalog order first, then colours only the shelf knows; "" (no colour) last.
    const colors = [...new Set([...catalogColors, ...seenColors.filter(Boolean)])];
    if (seenColors.includes("") || colors.length === 0) colors.push("");
    const sizes = sortSizes([
      ...(item?.sizes ?? []).map(canonical).filter(Boolean),
      ...units.map((u) => u.size ?? ""),
    ]);
    if (sizes.length === 0) sizes.push("");
    const prices = units.map((u) => u.price);
    const fallback = item?.price ?? 0;
    out.push({
      sku,
      name: item?.name ?? "",
      aliases: item?.aliases ?? [],
      inStock: units.length,
      minPrice: prices.length ? Math.min(...prices) : fallback,
      maxPrice: prices.length ? Math.max(...prices) : fallback,
      locations: [...new Set(units.map((u) => u.location).filter(Boolean))].sort(),
      colors,
      sizes,
      counts,
      state: stateOf(units.length),
    });
  }
  // What is on the shelf first, sold-out products after; by name (or code) inside each.
  return out.sort(
    (a, b) =>
      Number(a.inStock === 0) - Number(b.inStock === 0) ||
      (a.name || a.sku).localeCompare(b.name || b.sku),
  );
}

export interface Hit {
  product: Product;
  /** Variants the query names by colour and/or size; empty when it names none. */
  variants: ReadonlySet<string>;
}

/**
 * Search the overview the way a customer asks: "áo hoodie đen M", "A12 L", "黑 M". Every word
 * has to match the product (name, code, alias) or one of its colours or sizes. A size matches
 * only exactly ("M" is not "XL"); a colour matches by part ("xanh" finds "Xanh lá").
 */
export function searchStock(products: readonly Product[], query: string): Hit[] {
  const words = query.split(/\s+/).map(fold).filter(Boolean);
  if (words.length === 0) return products.map((product) => ({ product, variants: new Set() }));
  const hits: Hit[] = [];
  for (const p of products) {
    const text = [p.sku, p.name, ...p.aliases].map(fold);
    const colorWords: string[] = [];
    const sizeWords: string[] = [];
    let ok = true;
    for (const w of words) {
      const isSize = p.sizes.some((s) => s && fold(s) === w);
      const isColor = p.colors.some((c) => c && fold(c).includes(w));
      const inText = text.some((x) => x.includes(w));
      if (isSize) sizeWords.push(w);
      else if (isColor) colorWords.push(w);
      else if (!inText) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const variants = new Set<string>();
    if (colorWords.length || sizeWords.length) {
      for (const c of p.colors)
        for (const s of p.sizes) {
          const colorOk = colorWords.every((w) => fold(c).includes(w));
          const sizeOk = sizeWords.every((w) => fold(s) === w);
          if (colorOk && sizeOk) variants.add(variantKey(c, s));
        }
    }
    hits.push({ product: p, variants });
  }
  return hits;
}

// The real colour a colour name stands for, to paint a small swatch next to the name. These are
// product colours (data), not interface colours, so they are not theme tokens. Longer names first
// so "xanh lá" wins over "xanh". Unknown names get no swatch colour; the name is always shown.
const SWATCHES: readonly [string, string][] = [
  ["xanh la", "#34c759"],
  ["xanh reu", "#5b6b3a"],
  ["xanh duong", "#007aff"],
  ["xanh bien", "#007aff"],
  ["xanh navy", "#1f2a55"],
  ["xanh den", "#1f2a55"],
  ["xanh ngoc", "#30b0c7"],
  ["navy", "#1f2a55"],
  ["深藍", "#1f2a55"],
  ["丈青", "#1f2a55"],
  ["淺藍", "#8ec5ff"],
  ["den", "#1c1c1e"],
  ["black", "#1c1c1e"],
  ["黑", "#1c1c1e"],
  ["trang", "#ffffff"],
  ["white", "#ffffff"],
  ["白", "#ffffff"],
  ["xam", "#8e8e93"],
  ["ghi", "#8e8e93"],
  ["gray", "#8e8e93"],
  ["grey", "#8e8e93"],
  ["灰", "#8e8e93"],
  ["do", "#ff3b30"],
  ["red", "#ff3b30"],
  ["紅", "#ff3b30"],
  ["红", "#ff3b30"],
  ["hong", "#ff8fab"],
  ["pink", "#ff8fab"],
  ["粉", "#ff8fab"],
  ["cam", "#ff9500"],
  ["orange", "#ff9500"],
  ["橘", "#ff9500"],
  ["橙", "#ff9500"],
  ["vang", "#ffcc00"],
  ["yellow", "#ffcc00"],
  ["黃", "#ffcc00"],
  ["黄", "#ffcc00"],
  ["green", "#34c759"],
  ["綠", "#34c759"],
  ["绿", "#34c759"],
  ["xanh", "#007aff"],
  ["blue", "#007aff"],
  ["藍", "#007aff"],
  ["蓝", "#007aff"],
  ["tim", "#af52de"],
  ["purple", "#af52de"],
  ["紫", "#af52de"],
  ["nau", "#8b5a2b"],
  ["brown", "#8b5a2b"],
  ["咖啡", "#8b5a2b"],
  ["棕", "#8b5a2b"],
  ["kaki", "#c3b091"],
  ["khaki", "#c3b091"],
  ["卡其", "#c3b091"],
  ["kem", "#efe6d2"],
  ["be", "#e8dcc4"],
  ["beige", "#e8dcc4"],
  ["cream", "#efe6d2"],
  ["米", "#e8dcc4"],
  ["bac", "#c7c7cc"],
  ["silver", "#c7c7cc"],
  ["銀", "#c7c7cc"],
];

export function swatchOf(color: string): string | undefined {
  const f = fold(color);
  if (!f) return undefined;
  const words = f.split(/[\s/-]+/);
  for (const [name, hex] of SWATCHES) {
    // Latin names match whole words ("do" is red, but not inside "dong"); CJK by part.
    const latin = /^[a-z ]+$/.test(name);
    if (latin ? ` ${words.join(" ")} `.includes(` ${name} `) : f.includes(name)) return hex;
  }
  return undefined;
}
