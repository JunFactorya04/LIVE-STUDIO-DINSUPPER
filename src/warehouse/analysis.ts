import type { StockItem } from "../biz/client";
import type { ShipOrder } from "../ship/client";
import type { Unit } from "./client";

// Inventory classification used in professional warehouses, computed from the shop's own data.
//
//  ABC  Pareto on revenue in the window: A = the items that make the first 80% of sales,
//       B = the next 15%, C = the rest; N = nothing sold in the window.
//  XYZ  How steady the demand is: coefficient of variation (stdev / mean) of weekly units.
//       X <= 0.5 steady, Y <= 1.0 variable, Z > 1.0 erratic.
//  Cover      days the stock lasts at the average daily demand.
//  Reorder    point = demand over the lead time + safety stock (service level 95%, z = 1.65:
//             z x daily stdev x sqrt(lead time)); suggested order tops stock up to the point
//             plus the demand of one review period.
//  Turnover   units sold per year / units on hand.
//  Aging      days since a unit was received; "dead" stock is older than the window with no sale.

export type Abc = "A" | "B" | "C" | "N";
export type Xyz = "X" | "Y" | "Z" | "-";
export type Health = "out" | "low" | "healthy" | "slow" | "dead" | "new";

export interface Options {
  windowDays: number;
  leadDays: number;
  reviewDays: number;
}
export const DEFAULTS: Options = { windowDays: 90, leadDays: 7, reviewDays: 14 };

export interface SkuAnalysis {
  sku: string;
  soldQty: number;
  revenue: number;
  profit: number;
  /** Share of all revenue in the window, 0..1. */
  share: number;
  /** Cumulative share up to and including this item, 0..1. */
  cumulative: number;
  abc: Abc;
  xyz: Xyz;
  cv: number | undefined;
  dailyDemand: number;
  onHand: number;
  cover: number | undefined;
  reorderPoint: number;
  suggestOrder: number;
  turnover: number | undefined;
  health: Health;
  /** Value of the stock at cost. */
  value: number;
}

const WEEK = 7;
const Z = 1.65;

function weeklySeries(
  orders: readonly ShipOrder[],
  sku: string,
  now: Date,
  days: number,
): number[] {
  const weeks = Math.max(1, Math.floor(days / WEEK));
  const out = new Array<number>(weeks).fill(0);
  const end = now.getTime();
  for (const o of orders) {
    if (o.sku !== sku) continue;
    const age = (end - new Date(o.createdAt).getTime()) / 86_400_000;
    if (!(age >= 0) || age >= weeks * WEEK) continue;
    out[Math.floor(age / WEEK)] += o.qty;
  }
  return out;
}

const mean = (a: readonly number[]) => a.reduce((n, x) => n + x, 0) / (a.length || 1);
const stdev = (a: readonly number[]) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};

export function xyzOf(cv: number | undefined): Xyz {
  if (cv === undefined) return "-";
  return cv <= 0.5 ? "X" : cv <= 1 ? "Y" : "Z";
}

export function analyse(
  orders: readonly ShipOrder[],
  stock: readonly StockItem[],
  units: readonly Unit[],
  now: Date,
  opt: Options = DEFAULTS,
): SkuAnalysis[] {
  const from = now.getTime() - opt.windowDays * 86_400_000;
  const inWindow = orders.filter((o) => o.sku && new Date(o.createdAt).getTime() >= from);
  const sold = new Map<string, { qty: number; revenue: number; profit: number }>();
  for (const o of inWindow) {
    const x = sold.get(o.sku) ?? { qty: 0, revenue: 0, profit: 0 };
    x.qty += o.qty;
    x.revenue += o.amount;
    x.profit += o.amount - o.qty * o.unitCost;
    sold.set(o.sku, x);
  }
  const skus = new Set<string>([...sold.keys(), ...stock.map((s) => s.sku)]);
  const total = [...sold.values()].reduce((n, x) => n + x.revenue, 0);
  const byRev = [...skus].sort(
    (a, b) => (sold.get(b)?.revenue ?? 0) - (sold.get(a)?.revenue ?? 0) || a.localeCompare(b),
  );

  const ageOf = new Map<string, number>();
  for (const u of units) {
    const age = (now.getTime() - new Date(u.receivedAt).getTime()) / 86_400_000;
    ageOf.set(u.sku, Math.max(ageOf.get(u.sku) ?? 0, age));
  }

  let before = 0;
  return byRev.map((sku): SkuAnalysis => {
    const s = sold.get(sku);
    const book = stock.find((x) => x.sku === sku);
    const revenue = s?.revenue ?? 0;
    const share = total > 0 ? revenue / total : 0;
    const cumulative = before + share;
    const abc: Abc = revenue <= 0 ? "N" : before < 0.8 ? "A" : before < 0.95 ? "B" : "C";
    if (revenue > 0) before = cumulative;

    const weekly = weeklySeries(orders, sku, now, opt.windowDays);
    const m = mean(weekly);
    const cv = m > 0 && weekly.length >= 4 ? stdev(weekly) / m : undefined;
    const soldQty = s?.qty ?? 0;
    const daily = soldQty / opt.windowDays;
    const onHand = Math.max(0, book?.stock ?? 0);
    const sigmaDaily = stdev(weekly) / Math.sqrt(WEEK);
    const safety = Z * sigmaDaily * Math.sqrt(opt.leadDays);
    const reorderPoint = daily > 0 ? Math.ceil(daily * opt.leadDays + safety) : 0;
    const suggest =
      daily > 0 && onHand <= reorderPoint
        ? Math.max(0, Math.ceil(reorderPoint + daily * opt.reviewDays - onHand))
        : 0;
    const cover = daily > 0 ? onHand / daily : undefined;
    const oldest = ageOf.get(sku) ?? 0;

    let health: Health;
    if (daily > 0 && onHand === 0) health = "out";
    else if (daily > 0 && onHand <= reorderPoint) health = "low";
    else if (daily === 0 && onHand > 0) health = oldest >= opt.windowDays ? "dead" : "new";
    else if (cover !== undefined && cover > 180) health = "slow";
    else health = "healthy";

    return {
      sku,
      soldQty,
      revenue,
      profit: s?.profit ?? 0,
      share,
      cumulative: revenue > 0 ? cumulative : 0,
      abc,
      xyz: daily > 0 ? xyzOf(cv) : "-",
      cv,
      dailyDemand: daily,
      onHand,
      cover,
      reorderPoint,
      suggestOrder: suggest,
      turnover: onHand > 0 ? (daily * 365) / onHand : daily > 0 ? Infinity : undefined,
      health,
      value: onHand * (book?.cost ?? 0),
    };
  });
}

export const MATRIX_ABC: readonly Exclude<Abc, "N">[] = ["A", "B", "C"];
export const MATRIX_XYZ: readonly Exclude<Xyz, "-">[] = ["X", "Y", "Z"];

export interface Cell {
  abc: Abc;
  xyz: Xyz;
  skus: string[];
  revenue: number;
}

/** The 3 x 3 ABC-XYZ matrix: which items sit in each cell. */
export function matrix(rows: readonly SkuAnalysis[]): Cell[] {
  return MATRIX_ABC.flatMap((abc) =>
    MATRIX_XYZ.map((xyz) => {
      const hit = rows.filter((r) => r.abc === abc && r.xyz === xyz);
      return {
        abc,
        xyz,
        skus: hit.map((r) => r.sku),
        revenue: hit.reduce((n, r) => n + r.revenue, 0),
      };
    }),
  );
}

export interface Aging {
  label: "d30" | "d60" | "d90" | "d90p";
  units: number;
  value: number;
}

/** Units on the shelf by how long they have been there. */
export function aging(units: readonly Unit[], now: Date): Aging[] {
  const b: Aging[] = [
    { label: "d30", units: 0, value: 0 },
    { label: "d60", units: 0, value: 0 },
    { label: "d90", units: 0, value: 0 },
    { label: "d90p", units: 0, value: 0 },
  ];
  for (const u of units) {
    const days = (now.getTime() - new Date(u.receivedAt).getTime()) / 86_400_000;
    const i = days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3;
    b[i].units += 1;
    b[i].value += u.cost;
  }
  return b;
}

export interface Shelf {
  location: string;
  units: number;
  value: number;
}

/** Units per shelf position, fullest first; units with no position are grouped as "". */
export function shelves(units: readonly Unit[]): Shelf[] {
  const m = new Map<string, Shelf>();
  for (const u of units) {
    const s = m.get(u.location) ?? { location: u.location, units: 0, value: 0 };
    s.units += 1;
    s.value += u.cost;
    m.set(u.location, s);
  }
  return [...m.values()].sort((a, b) => b.units - a.units || a.location.localeCompare(b.location));
}

export interface Summary {
  stockValue: number;
  /** Units sold per year / units on hand, for the whole shop; undefined with no stock. */
  turnover: number | undefined;
  /** Stock value / daily cost of goods sold. */
  coverDays: number | undefined;
  deadUnits: number;
  deadValue: number;
  toOrder: number;
}

export function summarise(rows: readonly SkuAnalysis[], book: readonly StockItem[]): Summary {
  const cost = new Map(book.map((b) => [b.sku, b.cost]));
  const stockValue = rows.reduce((n, r) => n + r.value, 0);
  const cogsDaily = rows.reduce((n, r) => n + r.dailyDemand * (cost.get(r.sku) ?? 0), 0);
  const onHand = rows.reduce((n, r) => n + r.onHand, 0);
  const annual = rows.reduce((n, r) => n + r.dailyDemand * 365, 0);
  const dead = rows.filter((r) => r.health === "dead");
  return {
    stockValue,
    turnover: onHand > 0 ? annual / onHand : undefined,
    coverDays: cogsDaily > 0 ? stockValue / cogsDaily : undefined,
    deadUnits: dead.reduce((n, r) => n + r.onHand, 0),
    deadValue: dead.reduce((n, r) => n + r.value, 0),
    toOrder: rows.filter((r) => r.suggestOrder > 0).length,
  };
}
