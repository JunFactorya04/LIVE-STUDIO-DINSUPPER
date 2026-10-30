import { bucketStart, buildFinance, step, type Bucket, type Period } from "../dashboard/finance";
import type { ShipOrder } from "../ship/client";
import type { Expense, Purchase, StockItem } from "./client";

// Profit and loss from the books. Revenue is the goods amount of ship orders; cost of goods is
// units x the unit cost saved with each order; a monthly expense is spread over the days of its
// month, so a day, a week and a month all add up to the same thing.
//   gross profit = revenue - cost of goods
//   net income   = gross profit - expenses          (what the business really earned)
//   cash flow    = revenue - purchases - expenses   (money in minus money out)

export interface PnlBucket extends Bucket {
  cogs: number;
  grossProfit: number;
  fixedCosts: number;
  oneOffCosts: number;
  purchases: number;
  netIncome: number;
  cashFlow: number;
  /** Orders that carry a sku, so their cost of goods is known. */
  tracked: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysInMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

/** Monthly expenses that apply on day `d`, per day. */
export function fixedPerDay(expenses: readonly Expense[], d: Date): number {
  const k = dayKey(d);
  const dim = daysInMonth(d);
  return expenses
    .filter((e) => e.kind === "FIXED" && e.active && e.at.slice(0, 7) <= k.slice(0, 7))
    .reduce((n, e) => n + e.amount / dim, 0);
}

export function buildPnl(
  orders: readonly ShipOrder[],
  purchases: readonly Purchase[],
  expenses: readonly Expense[],
  period: Period,
  now: Date,
): { buckets: PnlBucket[]; current: PnlBucket; previous: PnlBucket; total: PnlBucket } {
  const base = buildFinance(orders, period, now);
  const buckets: PnlBucket[] = base.buckets.map((b) => {
    const end = step(b.start, period, 1);
    const from = dayKey(b.start);
    const to = dayKey(end);
    const inRange = (key: string) => key >= from && key < to;
    const inBucket = orders.filter((o) => {
      const t = new Date(o.createdAt);
      return !Number.isNaN(t.getTime()) && inRange(dayKey(t));
    });
    const cogs = inBucket.reduce((n, o) => n + o.qty * o.unitCost, 0);
    let fixed = 0;
    for (let d = new Date(b.start); d < end; d.setDate(d.getDate() + 1)) {
      fixed += fixedPerDay(expenses, d);
    }
    const once = expenses
      .filter((e) => e.kind === "ONCE" && e.active && inRange(e.at.slice(0, 10)))
      .reduce((n, e) => n + e.amount, 0);
    const bought = purchases
      .filter((p) => inRange(p.at))
      .reduce((n, p) => n + p.qty * p.unitCost, 0);
    const fixedCosts = Math.round(fixed);
    const grossProfit = b.revenue - cogs;
    return {
      ...b,
      cogs,
      grossProfit,
      fixedCosts,
      oneOffCosts: once,
      purchases: bought,
      netIncome: grossProfit - fixedCosts - once,
      cashFlow: b.revenue - bought - fixedCosts - once,
      tracked: inBucket.filter((o) => o.sku).length,
    };
  });
  const sum = (pick: (b: PnlBucket) => number) => buckets.reduce((n, b) => n + pick(b), 0);
  const total: PnlBucket = {
    ...base.total,
    cogs: sum((b) => b.cogs),
    grossProfit: sum((b) => b.grossProfit),
    fixedCosts: sum((b) => b.fixedCosts),
    oneOffCosts: sum((b) => b.oneOffCosts),
    purchases: sum((b) => b.purchases),
    netIncome: sum((b) => b.netIncome),
    cashFlow: sum((b) => b.cashFlow),
    tracked: sum((b) => b.tracked),
  };
  const n = buckets.length;
  return { buckets, current: buckets[n - 1], previous: buckets[n - 2], total };
}

export interface BestSeller {
  sku: string;
  qty: number;
  revenue: number;
  profit: number;
}

/** Units sold per sku over the given orders, best first. */
export function bestSellers(orders: readonly ShipOrder[], limit = 5): BestSeller[] {
  const m = new Map<string, BestSeller>();
  for (const o of orders) {
    if (!o.sku) continue;
    const x = m.get(o.sku) ?? { sku: o.sku, qty: 0, revenue: 0, profit: 0 };
    x.qty += o.qty;
    x.revenue += o.amount;
    x.profit += o.amount - o.qty * o.unitCost;
    m.set(o.sku, x);
  }
  return [...m.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, limit);
}

export interface StockSummary {
  /** What the stock on the shelves cost (units x average cost, only positive stock). */
  value: number;
  units: number;
  low: StockItem[];
  oversold: StockItem[];
  /** In stock but nothing sold in the shown orders. */
  idle: StockItem[];
}

export function stockSummary(stock: readonly StockItem[], sold: ReadonlySet<string>): StockSummary {
  const have = stock.filter((s) => s.stock > 0);
  return {
    value: have.reduce((n, s) => n + s.stock * s.cost, 0),
    units: have.reduce((n, s) => n + s.stock, 0),
    low: stock.filter((s) => s.stock >= 0 && s.minStock > 0 && s.stock <= s.minStock),
    oversold: stock.filter((s) => s.stock < 0),
    idle: have.filter((s) => !sold.has(s.sku)),
  };
}

/** Gross margin in percent of the sale price; undefined without a price. */
export function marginPct(price: number | undefined, cost: number): number | undefined {
  if (!price || price <= 0) return undefined;
  return Math.round(((price - cost) / price) * 100);
}

export { bucketStart };
