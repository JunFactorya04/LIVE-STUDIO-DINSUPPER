import type { CatalogItem } from "./types";

// Deterministic comment -> order fields. No AI, no guessing: anything unclear is left empty
// and reported so the engine can ask the seller to review.

export interface ParsedOrder {
  /** Canonical catalog SKU. */
  sku?: string;
  skuByName: boolean;
  /** A SKU-looking token that is not in the catalog. */
  unknownSku?: string;
  multipleSku: boolean;
  color?: string;
  size?: string;
  quantity?: number;
  /** A bare number, e.g. "2". Only trusted next to an open order. */
  qtyLow: boolean;
  qtyTooLarge: boolean;
  /** Two different values for one field in the same comment. */
  conflicts: ("color" | "size")[];
  evidence: { field: string; text: string }[];
}

export interface ParseOptions {
  /** Item of the customer's open draft, used when the comment itself names no product. */
  contextItem?: CatalogItem;
  maxQuantity?: number;
}

export const DEFAULT_MAX_QUANTITY = 20;

export function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

const skuKey = (s: string): string => normalize(s).replace(/[-_\s]/g, "");

export function variantAliases(entry: string): string[] {
  return entry
    .split("|")
    .map((a) => normalize(a))
    .filter(Boolean);
}

const canonical = (entry: string): string => entry.split("|")[0]?.trim() ?? entry.trim();

function blank(s: string, i: number, len: number): string {
  return s.slice(0, i) + " ".repeat(len) + s.slice(i + len);
}

/** Index of `alias` in `hay`; latin aliases must stand alone ("m" is not inside "name"). */
function findAlias(hay: string, alias: string): number {
  if (!alias) return -1;
  const ascii = /^[a-z0-9]+$/.test(alias);
  let from = 0;
  for (;;) {
    const i = hay.indexOf(alias, from);
    if (i < 0) return -1;
    if (!ascii) return i;
    const before = hay[i - 1];
    const after = hay[i + alias.length];
    const clash =
      (before !== undefined && /[a-z0-9]/.test(before)) ||
      (after !== undefined && /[a-z0-9]/.test(after));
    if (!clash) return i;
    from = i + 1;
  }
}

const DIGIT: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  兩: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** "3", "三", "兩", "十", "十五", "二十三" -> number. Anything else -> undefined. */
export function toInt(s: string): number | undefined {
  if (/^\d+$/.test(s)) return Number(s);
  if (!s.includes("十")) return s.length === 1 ? DIGIT[s] : undefined;
  const parts = s.split("十");
  if (parts.length !== 2) return undefined;
  const [a = "", b = ""] = parts;
  if (a.length > 1 || b.length > 1) return undefined;
  const tens = a === "" ? 1 : DIGIT[a];
  const ones = b === "" ? 0 : DIGIT[b];
  return tens === undefined || ones === undefined ? undefined : tens * 10 + ones;
}

const NUM = "(\\d{1,4}|[零一二兩两三四五六七八九十]{1,3})";
const UNIT = "(?:件|個|个|張|张|套|只|條|条|雙|双|pcs|pc|cái|chiếc|bộ)";
const VERB = "(?:要|來|来|拿|取|訂|订|買|买|lấy|mua|order)";
// group 1 = what precedes (so numbers glued to letters are not read), group 2 = the number.
const QTY_PATTERNS: RegExp[] = [
  new RegExp(`(^|[^a-z0-9])${VERB}\\s*${NUM}(?:\\s*${UNIT})?`),
  new RegExp(`(^|[^a-z0-9])[x×*]\\s*${NUM}(?![a-z0-9])`),
  new RegExp(`(^|[^a-z0-9])${NUM}\\s*${UNIT}`),
  new RegExp(`(^|[^a-z0-9])${NUM}\\s*[x×*](?![a-z0-9])`),
];
const BARE_QTY = /(^|[^a-z0-9])(\d{1,3})(?![a-z0-9])/;
const TOKEN = /[a-z0-9]+(?:[-_][a-z0-9]+)*/g;
const SKU_LIKE = /^[a-z]{1,3}[-_]?\d{1,4}$/;

export function parseOrderComment(
  text: string,
  catalog: readonly CatalogItem[],
  opts: ParseOptions = {},
): ParsedOrder {
  const maxQty = opts.maxQuantity ?? DEFAULT_MAX_QUANTITY;
  const out: ParsedOrder = {
    skuByName: false,
    multipleSku: false,
    qtyLow: false,
    qtyTooLarge: false,
    conflicts: [],
    evidence: [],
  };
  let rest = normalize(text);
  if (!rest) return out;

  // 1. SKU, exact token match (A12 never matches A123).
  const bySku = new Map(catalog.map((c) => [skuKey(c.sku), c]));
  const found = new Map<string, CatalogItem>();
  for (const m of rest.matchAll(TOKEN)) {
    const item = bySku.get(skuKey(m[0]));
    if (item) {
      found.set(item.sku, item);
      out.evidence.push({ field: "sku", text: m[0] });
    }
  }
  for (const item of found.values()) {
    for (const m of [...rest.matchAll(TOKEN)]) {
      if (skuKey(m[0]) === skuKey(item.sku)) rest = blank(rest, m.index, m[0].length);
    }
  }

  // 2. Product name / alias (weaker). Only when no SKU was written.
  let nameHit = false;
  if (found.size === 0) {
    const byName = new Map<string, CatalogItem>();
    for (const item of catalog) {
      for (const n of [item.name, ...item.aliases].map(normalize)) {
        if (n.length < 2) continue;
        const i = findAlias(rest, n);
        if (i >= 0) {
          byName.set(item.sku, item);
          out.evidence.push({ field: "sku_name", text: n });
          rest = blank(rest, i, n.length);
          break;
        }
      }
    }
    for (const [k, v] of byName) found.set(k, v);
    nameHit = found.size > 0;
  }

  let item: CatalogItem | undefined;
  if (found.size === 1) {
    item = [...found.values()][0];
    out.sku = item?.sku;
    out.skuByName = nameHit;
  } else if (found.size > 1) {
    out.multipleSku = true;
  } else {
    item = opts.contextItem;
  }

  // 3. Color and size of that item.
  if (item && !out.multipleSku) {
    for (const field of ["color", "size"] as const) {
      const options = field === "color" ? item.colors : item.sizes;
      const hits: { value: string; i: number; len: number }[] = [];
      for (const entry of options) {
        for (const alias of variantAliases(entry)) {
          const i = findAlias(rest, alias);
          if (i >= 0) {
            hits.push({ value: canonical(entry), i, len: alias.length });
            break;
          }
        }
      }
      if (hits.length === 1 && hits[0]) {
        out[field] = hits[0].value;
        out.evidence.push({ field, text: rest.slice(hits[0].i, hits[0].i + hits[0].len) });
      } else if (hits.length > 1) {
        out.conflicts.push(field);
      }
      for (const h of hits) rest = blank(rest, h.i, h.len);
    }
  }

  // 4. Quantity.
  let qtyFound = false;
  for (const re of QTY_PATTERNS) {
    const m = re.exec(rest);
    if (!m || m[2] === undefined) continue;
    const n = toInt(m[2]);
    if (n === undefined || n < 1) continue;
    qtyFound = true;
    out.evidence.push({ field: "quantity", text: m[0].trim() });
    if (n > maxQty) out.qtyTooLarge = true;
    else out.quantity = n;
    rest = blank(rest, m.index, m[0].length);
    break;
  }
  if (!qtyFound) {
    const m = BARE_QTY.exec(rest);
    const n = m?.[2] === undefined ? undefined : Number(m[2]);
    if (m && n !== undefined && n >= 1) {
      out.qtyLow = true;
      out.evidence.push({ field: "quantity_low", text: m[2] ?? "" });
      if (n > maxQty) out.qtyTooLarge = true;
      else out.quantity = n;
      rest = blank(rest, m.index, m[0].length);
    }
  }

  // 5. Something that looks like a SKU but is not in the catalog.
  const unknown = new Set<string>();
  for (const m of rest.matchAll(TOKEN)) {
    if (SKU_LIKE.test(m[0]) && !bySku.has(skuKey(m[0]))) unknown.add(m[0]);
  }
  if (unknown.size > 0) {
    const distinct = unknown.size + (out.sku ? 1 : 0) + (out.multipleSku ? 2 : 0);
    if (distinct > 1) {
      out.multipleSku = true;
      out.sku = undefined;
      out.skuByName = false;
    } else {
      out.unknownSku = [...unknown][0];
      out.evidence.push({ field: "unknown_sku", text: out.unknownSku ?? "" });
    }
  }
  return out;
}

/** Enough to open a new draft: a product (known or not) or an explicit quantity. */
export function isOrderLike(p: ParsedOrder): boolean {
  return Boolean(
    p.sku ||
    p.unknownSku ||
    p.multipleSku ||
    (p.quantity !== undefined && !p.qtyLow) ||
    (p.qtyTooLarge && !p.qtyLow),
  );
}
