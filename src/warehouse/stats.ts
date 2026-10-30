import type { Unit } from "./client";

// What is on the shelves, by sku: how many units, at which prices and where.

export interface SkuRow {
  sku: string;
  units: number;
  /** Lowest and highest selling price on the labels. */
  minPrice: number;
  maxPrice: number;
  /** Cost value of these units. */
  value: number;
  locations: string[];
}

export function bySku(units: readonly Unit[]): SkuRow[] {
  const m = new Map<string, SkuRow>();
  for (const u of units) {
    const r = m.get(u.sku) ?? {
      sku: u.sku,
      units: 0,
      minPrice: u.price,
      maxPrice: u.price,
      value: 0,
      locations: [],
    };
    r.units += 1;
    r.minPrice = Math.min(r.minPrice, u.price);
    r.maxPrice = Math.max(r.maxPrice, u.price);
    r.value += u.cost;
    if (u.location && !r.locations.includes(u.location)) r.locations.push(u.location);
    m.set(u.sku, r);
  }
  return [...m.values()]
    .map((r) => ({ ...r, locations: r.locations.sort() }))
    .sort((a, b) => a.sku.localeCompare(b.sku));
}

/** Units the books say are on the shelf (in scope) that were not scanned in a count. */
export function expectedMissing(
  onShelf: readonly Unit[],
  scanned: ReadonlySet<string>,
  location: string,
): Unit[] {
  return onShelf.filter((u) => (!location || u.location === location) && !scanned.has(u.code));
}

/** Add a scan to a session: ignores blanks, tells a repeat from a new code. */
export function addScan(
  list: readonly string[],
  raw: string,
): { list: string[]; added: boolean; code: string } {
  const code = raw.trim();
  if (!code) return { list: [...list], added: false, code };
  if (list.includes(code)) return { list: [...list], added: false, code };
  return { list: [...list, code], added: true, code };
}

/** A code this app prints on a label: `<SKU>-<6 digits>`. Other barcodes in view are ignored. */
export const isUnitCode = (code: string): boolean => /^[A-Za-z0-9._-]{1,30}-\d{6}$/.test(code);

/**
 * The next free product code: `SP0001`, `SP0002`, ... after the highest number already used with
 * this prefix (any case). Codes that do not follow the pattern are left alone.
 */
export function nextSku(existing: Iterable<string>, prefix = "SP"): string {
  const re = new RegExp(`^${prefix}(\\d+)$`, "i");
  let max = 0;
  for (const s of existing) {
    const m = re.exec(s.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}
