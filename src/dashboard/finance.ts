import type { ShipOrder } from "../ship/client";

// Money report from the saved ship orders: per day, week (Monday start) or month, with the
// previous period for comparison. Pure functions; `now` is passed in so tests are exact.

export type Period = "day" | "week" | "month";

export interface Bucket {
  /** Sortable key: yyyy-mm-dd of the first day of the bucket (yyyy-mm-01 for months). */
  key: string;
  start: Date;
  orders: number;
  /** Goods amount (NT$). */
  revenue: number;
  /** Shipping fees (NT$). */
  fees: number;
  /** What is collected on delivery: revenue + fees. */
  cod: number;
  exported: number;
}

export interface Finance {
  buckets: Bucket[];
  current: Bucket;
  previous: Bucket;
  /** Sum over all shown buckets. */
  total: Bucket;
  exported: number;
  pending: number;
  topBuyers: { tiktokId: string; orders: number; revenue: number }[];
}

export const SPAN: Record<Period, number> = { day: 14, week: 12, month: 12 };

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function bucketStart(d: Date, period: Period): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (period === "week") x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  if (period === "month") x.setDate(1);
  return x;
}

export function step(d: Date, period: Period, n: number): Date {
  const x = new Date(d);
  if (period === "day") x.setDate(x.getDate() + n);
  else if (period === "week") x.setDate(x.getDate() + 7 * n);
  else x.setMonth(x.getMonth() + n);
  return x;
}

const empty = (start: Date): Bucket => ({
  key: keyOf(start),
  start,
  orders: 0,
  revenue: 0,
  fees: 0,
  cod: 0,
  exported: 0,
});

export function buildFinance(orders: readonly ShipOrder[], period: Period, now: Date): Finance {
  const last = bucketStart(now, period);
  const buckets: Bucket[] = [];
  for (let i = SPAN[period] - 1; i >= 0; i--) buckets.push(empty(step(last, period, -i)));
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  // One bucket before the window, only so the first bar can be compared.
  const before = empty(step(last, period, -SPAN[period]));
  byKey.set(before.key, before);

  const buyers = new Map<string, { orders: number; revenue: number }>();
  let exported = 0;
  let pending = 0;
  for (const o of orders) {
    const at = new Date(o.createdAt);
    if (Number.isNaN(at.getTime())) continue;
    const b = byKey.get(keyOf(bucketStart(at, period)));
    if (!b) continue;
    b.orders += 1;
    b.revenue += o.amount;
    b.fees += o.shippingFee;
    b.cod += o.cod;
    if (o.exported) {
      b.exported += 1;
      exported += 1;
    } else pending += 1;
    const w = buyers.get(o.tiktokId) ?? { orders: 0, revenue: 0 };
    w.orders += 1;
    w.revenue += o.amount;
    buyers.set(o.tiktokId, w);
  }
  const total = empty(buckets[0].start);
  for (const b of buckets) {
    total.orders += b.orders;
    total.revenue += b.revenue;
    total.fees += b.fees;
    total.cod += b.cod;
    total.exported += b.exported;
  }
  const n = buckets.length;
  return {
    buckets,
    current: buckets[n - 1],
    previous: n > 1 ? buckets[n - 2] : before,
    total,
    exported,
    pending,
    topBuyers: [...buyers.entries()]
      .map(([tiktokId, v]) => ({ tiktokId, ...v }))
      .sort((a, b) => b.revenue - a.revenue || b.orders - a.orders)
      .slice(0, 5),
  };
}

/** Change against the previous period in percent; undefined when there is nothing to compare. */
export function delta(now: number, before: number): number | undefined {
  if (before === 0) return undefined;
  return Math.round(((now - before) / before) * 100);
}

/** A round axis maximum (1, 2, 5 x 10^n) so the ticks read cleanly. */
export function niceMax(v: number): number {
  if (v <= 0) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

/** Tab-separated table, ready to paste into Excel or Sheets. */
export function financeTsv(f: Finance, header: string[], label: (b: Bucket) => string): string {
  const rows = f.buckets.map((b) =>
    [label(b), b.orders, b.revenue, b.fees, b.cod, b.exported].join("\t"),
  );
  return [header.join("\t"), ...rows].join("\n");
}
