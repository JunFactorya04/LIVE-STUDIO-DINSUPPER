import { useMemo, useState } from "react";
import {
  buildFinance,
  delta,
  financeTsv,
  niceMax,
  type Bucket,
  type Period,
} from "../dashboard/finance";
import { useI18n } from "../i18n";
import type { ShipOrder } from "../ship/client";

// Business report: revenue, orders, shipping fees and cash on delivery per day, week or month,
// from the saved ship orders. Everything is computed from real orders; no orders, no numbers.

const PERIODS: Period[] = ["day", "week", "month"];
const money = (n: number) => `NT$ ${n.toLocaleString("en-US")}`;

function Delta({ now, before, label }: { now: number; before: number; label: string }) {
  const d = delta(now, before);
  if (d === undefined) return <span className="fin-delta tone-gray">—</span>;
  const tone = d > 0 ? "tone-green" : d < 0 ? "tone-red" : "tone-gray";
  return (
    <span className={`fin-delta ${tone}`} title={label}>
      {d > 0 ? "▲" : d < 0 ? "▼" : "•"} {Math.abs(d)}%
    </span>
  );
}

export function FinancePanel({ orders, now }: { orders: readonly ShipOrder[]; now?: Date }) {
  const { t, locale } = useI18n();
  const f = t.finance;
  const [period, setPeriod] = useState<Period>("day");
  const [copied, setCopied] = useState(false);
  const data = useMemo(
    () => buildFinance(orders, period, now ?? new Date()),
    [orders, period, now],
  );
  const loc = locale === "vi" ? "vi-VN" : "zh-TW";

  const label = (b: Bucket): string =>
    period === "month"
      ? b.start.toLocaleDateString(loc, { year: "2-digit", month: "numeric" })
      : b.start.toLocaleDateString(loc, { month: "numeric", day: "numeric" });

  const max = niceMax(Math.max(0, ...data.buckets.map((b) => b.revenue)));
  const ticks = [max, max / 2, 0];
  const donePct =
    data.exported + data.pending === 0 ? 0 : (data.exported / (data.exported + data.pending)) * 100;
  const c = data.current;
  const p = data.previous;
  const avg = c.orders ? Math.round(c.revenue / c.orders) : 0;
  const avgPrev = p.orders ? Math.round(p.revenue / p.orders) : 0;
  const vs = f.vsPrevious[period];

  const tiles: {
    id: string;
    title: string;
    value: string;
    now: number;
    before: number;
    tone: string;
  }[] = [
    {
      id: "revenue",
      title: f.revenue,
      value: money(c.revenue),
      now: c.revenue,
      before: p.revenue,
      tone: "tone-blue",
    },
    {
      id: "orders",
      title: f.orders,
      value: String(c.orders),
      now: c.orders,
      before: p.orders,
      tone: "tone-green",
    },
    {
      id: "cod",
      title: f.cod,
      value: money(c.cod),
      now: c.cod,
      before: p.cod,
      tone: "tone-orange",
    },
    {
      id: "avg",
      title: f.average,
      value: money(avg),
      now: avg,
      before: avgPrev,
      tone: "tone-purple",
    },
  ];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        financeTsv(data, [f.period, f.orders, f.revenue, f.fees, f.cod, f.exported], label),
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="box fin" aria-label={f.title}>
      <div className="fin__head">
        <div>
          <h2 className="section-title">{f.title}</h2>
          <p className="caption">{f.help}</p>
        </div>
        <div className="fin__tools">
          <div className="segmented" role="group" aria-label={f.title}>
            {PERIODS.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={period === id}
                onClick={() => setPeriod(id)}
              >
                {f.periods[id]}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => void copy()}
            disabled={orders.length === 0}
          >
            {copied ? f.copied : f.copy}
          </button>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="empty">
          <strong>{f.emptyTitle}</strong>
          <span className="caption">{f.emptyHint}</span>
        </div>
      ) : (
        <>
          <div className="fin__tiles">
            {tiles.map((x) => (
              <div key={x.id} className="fin-tile">
                <span className={`fin-tile__dot ${x.tone}`} aria-hidden="true" />
                <span className="fin-tile__label">{x.title}</span>
                <strong className="fin-tile__value">{x.value}</strong>
                <span className="fin-tile__foot">
                  <Delta now={x.now} before={x.before} label={vs} />
                  <span className="caption">{vs}</span>
                </span>
              </div>
            ))}
          </div>

          <div className="fin__charts">
            <figure className="fin-chart">
              <figcaption>{f.chartRevenue}</figcaption>
              <div className="fin-bars" role="img" aria-label={f.chartRevenue}>
                <div className="fin-bars__axis">
                  {ticks.map((v) => (
                    <span key={v}>{v >= 1000 ? `${v / 1000}k` : v}</span>
                  ))}
                </div>
                <div className="fin-bars__plot">
                  {data.buckets.map((b, i) => (
                    <div
                      key={b.key}
                      className={`fin-bar${i === data.buckets.length - 1 ? " is-current" : ""}`}
                      title={`${label(b)}: ${money(b.revenue)} · ${b.orders} ${f.ordersUnit}`}
                    >
                      <span
                        className="fin-bar__fill"
                        style={{ height: `${(b.revenue / max) * 100}%` }}
                      />
                      <span className="fin-bar__x">{label(b)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </figure>

            <figure className="fin-chart fin-chart--side">
              <figcaption>{f.chartStatus}</figcaption>
              <div className="fin-donut">
                <div
                  className="fin-donut__ring"
                  style={{
                    background: `conic-gradient(var(--sys-green) ${donePct}%, var(--sys-orange) 0)`,
                  }}
                  role="img"
                  aria-label={`${f.exported}: ${data.exported}, ${f.pending}: ${data.pending}`}
                >
                  <span className="fin-donut__hole">
                    <strong>{Math.round(donePct)}%</strong>
                    <span className="caption">{f.exported}</span>
                  </span>
                </div>
                <ul className="fin-legend">
                  <li>
                    <i style={{ background: "var(--sys-green)" }} /> {f.exported}:{" "}
                    <strong>{data.exported}</strong>
                  </li>
                  <li>
                    <i style={{ background: "var(--sys-orange)" }} /> {f.pending}:{" "}
                    <strong>{data.pending}</strong>
                  </li>
                </ul>
              </div>
            </figure>
          </div>

          <div className="fin__charts">
            <div className="fin-table-wrap">
              <table className="fin-table">
                <caption className="sr-only">{f.title}</caption>
                <thead>
                  <tr>
                    <th scope="col">{f.period}</th>
                    <th scope="col">{f.orders}</th>
                    <th scope="col">{f.revenue}</th>
                    <th scope="col">{f.fees}</th>
                    <th scope="col">{f.cod}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.buckets].reverse().map((b) => (
                    <tr key={b.key}>
                      <th scope="row">{label(b)}</th>
                      <td>{b.orders}</td>
                      <td>{money(b.revenue)}</td>
                      <td>{money(b.fees)}</td>
                      <td>{money(b.cod)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">{f.total}</th>
                    <td>{data.total.orders}</td>
                    <td>{money(data.total.revenue)}</td>
                    <td>{money(data.total.fees)}</td>
                    <td>{money(data.total.cod)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <figure className="fin-chart fin-chart--side">
              <figcaption>{f.topBuyers}</figcaption>
              <ol className="fin-rank">
                {data.topBuyers.map((b, i) => (
                  <li key={b.tiktokId}>
                    <span className="fin-rank__n">{i + 1}</span>
                    <span className="fin-rank__name">@{b.tiktokId}</span>
                    <span className="muted">
                      {b.orders} {f.ordersUnit}
                    </span>
                    <strong>{money(b.revenue)}</strong>
                  </li>
                ))}
              </ol>
            </figure>
          </div>
        </>
      )}
    </section>
  );
}
