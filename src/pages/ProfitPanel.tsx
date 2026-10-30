import { useMemo, useState } from "react";
import type { Expense, Purchase, StockItem } from "../biz/client";
import { bestSellers, buildPnl, stockSummary } from "../biz/ledger";
import { delta, niceMax, type Period } from "../dashboard/finance";
import { useI18n } from "../i18n";
import type { ShipOrder } from "../ship/client";

// Profit and loss and stock health, from the books (see biz/ledger.ts). Shown under the sales
// report; without books entered it explains what to fill in instead of showing made-up zeros.

const PERIODS: Period[] = ["day", "week", "month"];
const money = (n: number) =>
  `${n < 0 ? "−" : ""}NT$ ${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

export function ProfitPanel({
  orders,
  purchases,
  expenses,
  stock,
  now,
}: {
  orders: readonly ShipOrder[];
  purchases: readonly Purchase[];
  expenses: readonly Expense[];
  stock: readonly StockItem[];
  now?: Date;
}) {
  const { t, locale } = useI18n();
  const p = t.profit;
  const [period, setPeriod] = useState<Period>("month");
  const pnl = useMemo(
    () => buildPnl(orders, purchases, expenses, period, now ?? new Date()),
    [orders, purchases, expenses, period, now],
  );
  const loc = locale === "vi" ? "vi-VN" : "zh-TW";
  const label = (d: Date) =>
    period === "month"
      ? d.toLocaleDateString(loc, { year: "2-digit", month: "numeric" })
      : d.toLocaleDateString(loc, { month: "numeric", day: "numeric" });

  const c = pnl.current;
  const prev = pnl.previous;
  const costs = c.fixedCosts + c.oneOffCosts + c.shareCosts;
  const vs = t.finance.vsPrevious[period];
  const hasBooks = purchases.length > 0 || expenses.length > 0 || stock.length > 0;

  const maxAbs = niceMax(Math.max(1, ...pnl.buckets.map((b) => Math.abs(b.netIncome))));
  const hasNeg = pnl.buckets.some((b) => b.netIncome < 0);

  // How today's revenue splits: what the goods cost, what the business spent, what is left.
  const rev = Math.max(c.revenue, 1);
  const cogsPct = Math.min(100, (c.cogs / rev) * 100);
  const costPct = Math.min(100 - cogsPct, (costs / rev) * 100);
  const keepPct = Math.max(0, 100 - cogsPct - costPct);

  const sold = useMemo(() => new Set(orders.filter((o) => o.sku).map((o) => o.sku)), [orders]);
  const summary = stockSummary(stock, sold);
  const best = bestSellers(orders, 5);
  const bestMax = Math.max(1, ...best.map((b) => b.qty));

  const tiles = [
    { id: "revenue", title: p.revenue, v: c.revenue, before: prev.revenue, tone: "tone-blue" },
    { id: "cogs", title: p.cogs, v: c.cogs, before: prev.cogs, tone: "tone-orange" },
    { id: "gross", title: p.gross, v: c.grossProfit, before: prev.grossProfit, tone: "tone-teal" },
    {
      id: "costs",
      title: p.costs,
      v: costs,
      before: prev.fixedCosts + prev.oneOffCosts + prev.shareCosts,
      tone: "tone-red",
    },
    { id: "net", title: p.net, v: c.netIncome, before: prev.netIncome, tone: "tone-green" },
    { id: "cash", title: p.cash, v: c.cashFlow, before: prev.cashFlow, tone: "tone-purple" },
  ];

  return (
    <section className="box fin" aria-label={p.title}>
      <div className="fin__head">
        <div>
          <h2 className="section-title">{p.title}</h2>
          <p className="caption">{p.help}</p>
        </div>
        <div className="segmented" role="group" aria-label={p.title}>
          {PERIODS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={period === id}
              onClick={() => setPeriod(id)}
            >
              {t.finance.periods[id]}
            </button>
          ))}
        </div>
      </div>

      {!hasBooks && (
        <div className="empty">
          <strong>{p.emptyTitle}</strong>
          <span className="caption">{p.emptyHint}</span>
        </div>
      )}

      <div className="fin__tiles fin__tiles--3">
        {tiles.map((x) => {
          const d = delta(x.v, x.before);
          const good = x.id === "costs" || x.id === "cogs" ? (d ?? 0) <= 0 : (d ?? 0) >= 0;
          return (
            <div key={x.id} className="fin-tile">
              <span className={`fin-tile__dot ${x.tone}`} aria-hidden="true" />
              <span className="fin-tile__label">{x.title}</span>
              <strong className={`fin-tile__value${x.v < 0 ? " is-neg" : ""}`}>{money(x.v)}</strong>
              <span className="fin-tile__foot">
                {d === undefined ? (
                  <span className="fin-delta tone-gray">—</span>
                ) : (
                  <span
                    className={`fin-delta ${d === 0 ? "tone-gray" : good ? "tone-green" : "tone-red"}`}
                  >
                    {d > 0 ? "▲" : d < 0 ? "▼" : "•"} {Math.abs(d)}%
                  </span>
                )}
                <span className="caption">{vs}</span>
              </span>
            </div>
          );
        })}
      </div>

      <figure className="fin-chart">
        <figcaption>{p.split}</figcaption>
        <div
          className="split"
          role="img"
          aria-label={`${p.cogs} ${Math.round(cogsPct)}%, ${p.costs} ${Math.round(costPct)}%, ${p.net} ${Math.round(keepPct)}%`}
        >
          <span className="split__seg split__seg--cogs" style={{ width: `${cogsPct}%` }} />
          <span className="split__seg split__seg--cost" style={{ width: `${costPct}%` }} />
          <span className="split__seg split__seg--keep" style={{ width: `${keepPct}%` }} />
        </div>
        <ul className="fin-legend fin-legend--row">
          <li>
            <i style={{ background: "var(--sys-orange)" }} /> {p.cogs}:{" "}
            <strong>{money(c.cogs)}</strong>
          </li>
          <li>
            <i style={{ background: "var(--sys-red)" }} /> {p.costs}:{" "}
            <strong>{money(costs)}</strong>
          </li>
          <li>
            <i style={{ background: "var(--sys-green)" }} /> {p.net}:{" "}
            <strong>{money(c.netIncome)}</strong>
          </li>
        </ul>
        <h3 className="subhead">{p.byGroup}</h3>
        {Object.keys(c.byCategory).length === 0 ? (
          <p className="caption">{p.byGroupNone}</p>
        ) : (
          <ul className="fin-legend">
            {Object.entries(c.byCategory)
              .sort((a, b) => b[1] - a[1])
              .map(([k, val]) => (
                <li key={k}>
                  {t.inventory.categories[k as keyof typeof t.inventory.categories] ?? k}:{" "}
                  <strong>{money(val)}</strong>
                </li>
              ))}
          </ul>
        )}
        {c.orders > 0 && c.tracked < c.orders && (
          <p className="caption">
            {p.untracked
              .replace("{a}", String(c.orders - c.tracked))
              .replace("{b}", String(c.orders))}
          </p>
        )}
      </figure>

      <div className="fin__charts">
        <figure className="fin-chart">
          <figcaption>{p.chartNet}</figcaption>
          <div className="fin-bars" role="img" aria-label={p.chartNet}>
            <div className="fin-bars__axis">
              <span>{maxAbs >= 1000 ? `${maxAbs / 1000}k` : maxAbs}</span>
              <span>0</span>
              {hasNeg && <span>{`−${maxAbs >= 1000 ? `${maxAbs / 1000}k` : maxAbs}`}</span>}
            </div>
            <div className={`fin-bars__plot${hasNeg ? " fin-bars__plot--signed" : ""}`}>
              {pnl.buckets.map((b, i) => {
                const h = (Math.abs(b.netIncome) / maxAbs) * (hasNeg ? 50 : 100);
                return (
                  <div
                    key={b.key}
                    className={`fin-bar${i === pnl.buckets.length - 1 ? " is-current" : ""}`}
                    title={`${label(b.start)}: ${money(b.netIncome)}`}
                  >
                    <span
                      className={`fin-bar__fill fin-bar__fill--${b.netIncome < 0 ? "neg" : "pos"}`}
                      style={{
                        height: `${h}%`,
                        [b.netIncome < 0 ? "top" : "bottom"]: hasNeg ? "50%" : undefined,
                      }}
                    />
                    <span className="fin-bar__x">{label(b.start)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </figure>
        <figure className="fin-chart fin-chart--side">
          <figcaption>{p.bestTitle}</figcaption>
          {best.length === 0 ? (
            <p className="caption">{p.bestNone}</p>
          ) : (
            <ol className="rank-bars">
              {best.map((b) => (
                <li key={b.sku}>
                  <span className="rank-bars__top">
                    <strong>{b.sku}</strong>
                    <span className="muted">
                      {b.qty} · {money(b.profit)}
                    </span>
                  </span>
                  <span className="rank-bars__track">
                    <span style={{ width: `${(b.qty / bestMax) * 100}%` }} />
                  </span>
                </li>
              ))}
            </ol>
          )}
        </figure>
      </div>

      <div className="fin__charts">
        <figure className="fin-chart">
          <figcaption>{p.stockTitle}</figcaption>
          <div className="stock-kpis">
            <div>
              <span className="caption">{p.stockValue}</span>
              <strong>{money(summary.value)}</strong>
            </div>
            <div>
              <span className="caption">{p.stockUnits}</span>
              <strong>{summary.units}</strong>
            </div>
          </div>
          {summary.low.length === 0 && summary.oversold.length === 0 ? (
            <p className="caption">{p.stockHealthy}</p>
          ) : (
            <ul className="todo-list">
              {summary.oversold.map((s) => (
                <li key={s.sku}>
                  <span>
                    <strong>{s.sku}</strong> <span className="chip tone-red">{p.oversold}</span>
                  </span>
                  <span className="muted">{s.stock}</span>
                </li>
              ))}
              {summary.low.map((s) => (
                <li key={s.sku}>
                  <span>
                    <strong>{s.sku}</strong> <span className="chip tone-orange">{p.low}</span>
                  </span>
                  <span className="muted">
                    {s.stock} / {s.minStock}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </figure>
        <figure className="fin-chart fin-chart--side">
          <figcaption>{p.idleTitle}</figcaption>
          {summary.idle.length === 0 ? (
            <p className="caption">{p.idleNone}</p>
          ) : (
            <ul className="todo-list">
              {summary.idle.slice(0, 6).map((s) => (
                <li key={s.sku}>
                  <strong>{s.sku}</strong>
                  <span className="muted">
                    {s.stock} · {money(s.stock * s.cost)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </figure>
      </div>
    </section>
  );
}
