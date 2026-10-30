import type { CatalogItem } from "./types";

// Paste from Excel (tab separated) or a CSV (comma). Columns: sku, name, price, colors, sizes,
// aliases. Inside a cell, separate values with ; / 、 and aliases of one value with |.
// Quoted cells are not supported.

export interface CatalogImport {
  items: CatalogItem[];
  /** 1-based line numbers that could not be read. */
  errors: number[];
}

export const splitList = (cell: string | undefined): string[] =>
  (cell ?? "")
    .split(/[;；/、]/)
    .map((s) => s.trim())
    .filter(Boolean);

export function parseCatalogCsv(text: string): CatalogImport {
  const items = new Map<string, CatalogItem>();
  const errors: number[] = [];
  text.split(/\r?\n/).forEach((line, idx) => {
    if (!line.trim()) return;
    const cells = (line.includes("\t") ? line.split("\t") : line.split(/[,，]/)).map((c) =>
      c.trim(),
    );
    if (idx === 0 && cells[0]?.toLowerCase() === "sku") return;
    const [sku, name, price, colors, sizes, aliases] = cells;
    const priceNum = price ? Number(price.replace(/[^\d.]/g, "")) : undefined;
    if (!sku || !name || (price && (priceNum === undefined || !Number.isFinite(priceNum)))) {
      errors.push(idx + 1);
      return;
    }
    items.set(sku, {
      sku,
      name,
      price: priceNum,
      colors: splitList(colors),
      sizes: splitList(sizes),
      aliases: splitList(aliases),
    });
  });
  return { items: [...items.values()], errors };
}
