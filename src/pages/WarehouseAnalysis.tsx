import { useEffect, useMemo, useState } from "react";
import { createBizClient, type BizClient, type StockItem } from "../biz/client";
import { useI18n } from "../i18n";
import { createShipClient, type ShipClient, type ShipOrder } from "../ship/client";
import {
  MATRIX_ABC,
  MATRIX_XYZ,
  aging,
  analyse,
  matrix,
  shelves,
  summarise,
  type Health,
  type SkuAnalysis,
} from "../warehouse/analysis";
import { unitSales } from "../warehouse/sales";
import type { Unit, WarehouseClient } from "../warehouse/client";

// Classification of the stock the way professional warehouses do it (ABC-XYZ, cover days,
// reorder points, aging, shelf heat map), computed from the shop's own sales and stock.
// The panel is dark in both themes: it is a control-room view, not a form.

const money = (n: number) => `NT$ ${Math.round(n).toLocaleString("en-US")}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const WINDOWS = [30, 90, 180] as const;
const LEADS = [3, 7, 14] as const;
const HEALTH_TONE: Record<Health, string> = {
  out: "bad",
  low: "warn",
  healthy: "ok",
  slow: "dim",
  dead: "bad",
  new: "info",
};

export function WarehouseAnalysis({
  api,
  ship,
  biz,
}: {
  api: WarehouseClient;
  ship?: ShipClient;
  biz?: BizClient;
}) {
  const { t } = useI18n();
  const a = t.warehouse.analysis;
  const [shipApi] = useState(() => ship ?? createShipClient());
  const [bizApi] = useState(() => biz ?? createBizClient());
  const [data, setData] = useState<{ orders: ShipOrder[]; stock: StockItem[]; shelf: Unit[] }>();
  const [failed, setFailed] = useState(false);
  const [windowDays, setWindowDays] = useState<(typeof WINDOWS)[number]>(90);
  const [leadDays, setLeadDays] = useState<(typeof LEADS)[number]>(7);

  useEffect(() => {
    if (!api.available) return;
    let alive = true;
    Promise.all([
      shipApi.available ? shipApi.orders() : Promise.resolve([] as ShipOrder[]),
      bizApi.available ? bizApi.stock() : Promise.resolve([] as StockItem[]),
      api.units("IN_STOCK"),
      api.units("SHIPPED"),
    ])
      .then(([orders, stock, shelf, shipped]) => {
        if (!alive) return;
        // Scanned-out units count as sales, like the dashboard does.
        setData({ orders: [...orders, ...unitSales(shipped, orders)], stock, shelf });
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [api, shipApi, bizApi]);

  const now = useMemo(() => new Date(), []);
  const calc = useMemo(() => {
    if (!data) return undefined;
    const rows = analyse(data.orders, data.stock, data.shelf, now, {
      windowDays,
      leadDays,
      reviewDays: 14,
    });
    return {
      rows,
      sum: summarise(rows, data.stock),
      cells: matrix(rows),
      ages: aging(data.shelf, now),
      shelves: shelves(data.shelf),
    };
  }, [data, now, windowDays, leadDays]);

  if (failed) return <p className="note note--error">{a.failed}</p>;
  if (!calc) return <p className="caption">{a.loading}</p>;

  const { rows, sum, cells, ages, shelves: sh } = calc;
  const sellers = rows.filter((r) => r.revenue > 0);
  const top = sellers.slice(0, 12);
  const topMax = Math.max(1, ...top.map((r) => r.revenue));
  const needOrder = rows.filter((r) => r.suggestOrder > 0 || r.health === "out");
  const ageTotal = Math.max(
    1,
    ages.reduce((n, x) => n + x.units, 0),
  );
  const shMax = Math.max(1, ...sh.map((s) => s.units));
  const line = top
    .map((r, i) => `${((i + 0.5) / top.length) * 100},${100 - r.cumulative * 100}`)
    .join(" ");

  return (
    <section className="wha" aria-label={a.title}>
      <header className="wha__head">
        <div>
          <h2>{a.title}</h2>
          <p>{a.subtitle}</p>
        </div>
        <div className="wha__ctl">
          <div className="wha__seg" role="group" aria-label={a.window}>
            <span>{a.window}</span>
            {WINDOWS.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={windowDays === d}
                onClick={() => setWindowDays(d)}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="wha__seg" role="group" aria-label={a.lead}>
            <span>{a.lead}</span>
            {LEADS.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={leadDays === d}
                onClick={() => setLeadDays(d)}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="wha__kpis">
        <Kpi label={a.kpi.value} value={money(sum.stockValue)} tone="info" />
        <Kpi
          label={a.kpi.turnover}
          value={sum.turnover === undefined ? "—" : `${sum.turnover.toFixed(1)}×`}
          hint={a.kpi.turnoverHint}
          tone="ok"
        />
        <Kpi
          label={a.kpi.cover}
          value={sum.coverDays === undefined ? "—" : `${Math.round(sum.coverDays)} ${a.days}`}
          tone="ok"
        />
        <Kpi
          label={a.kpi.dead}
          value={money(sum.deadValue)}
          hint={`${sum.deadUnits} ${a.units}`}
          tone="bad"
        />
        <Kpi
          label={a.kpi.toOrder}
          value={String(sum.toOrder)}
          hint={a.kpi.toOrderHint}
          tone="warn"
        />
      </div>

      <div className="wha__grid">
        <figure className="wha__card">
          <figcaption>{a.matrixTitle}</figcaption>
          <div className="wha__matrix" role="table" aria-label={a.matrixTitle}>
            <span />
            {MATRIX_XYZ.map((x) => (
              <span key={x} className="wha__axis" role="columnheader">
                {x} <small>{a.xyz[x]}</small>
              </span>
            ))}
            {MATRIX_ABC.map((abc) => (
              <Row
                key={abc}
                abc={abc}
                cells={cells.filter((c) => c.abc === abc)}
                total={sellers.reduce((n, r) => n + r.revenue, 0)}
              />
            ))}
          </div>
          <p className="wha__foot">{a.matrixHelp}</p>
        </figure>

        <figure className="wha__card">
          <figcaption>{a.paretoTitle}</figcaption>
          {top.length === 0 ? (
            <p className="wha__foot">{a.noSales}</p>
          ) : (
            <>
              <div className="wha__pareto" role="img" aria-label={a.paretoTitle}>
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  <line x1="0" x2="100" y1="20" y2="20" className="wha__ref" />
                  <polyline points={line} className="wha__cum" />
                </svg>
                {top.map((r) => (
                  <div
                    key={r.sku}
                    className="wha__col"
                    title={`${r.sku}: ${money(r.revenue)} (${pct(r.share)})`}
                  >
                    <i
                      className={`wha__bar wha__bar--${r.abc}`}
                      style={{ height: `${(r.revenue / topMax) * 100}%` }}
                    />
                    <span>{r.sku}</span>
                  </div>
                ))}
              </div>
              <p className="wha__foot">{a.paretoHelp}</p>
            </>
          )}
        </figure>
      </div>

      <figure className="wha__card">
        <figcaption>{a.reorderTitle}</figcaption>
        {needOrder.length === 0 ? (
          <p className="wha__foot">{a.reorderNone}</p>
        ) : (
          <div className="wha__scroll">
            <table className="wha__table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>{a.cols.class}</th>
                  <th>{a.cols.onHand}</th>
                  <th>{a.cols.cover}</th>
                  <th>{a.cols.point}</th>
                  <th>{a.cols.order}</th>
                  <th>{a.cols.health}</th>
                </tr>
              </thead>
              <tbody>
                {needOrder.map((r) => (
                  <tr key={r.sku}>
                    <th scope="row">{r.sku}</th>
                    <td>
                      <b className={`wha__tag wha__tag--${r.abc}`}>
                        {r.abc}
                        {r.xyz === "-" ? "" : r.xyz}
                      </b>
                    </td>
                    <td>{r.onHand}</td>
                    <td>{r.cover === undefined ? "—" : `${Math.round(r.cover)} ${a.days}`}</td>
                    <td>{r.reorderPoint}</td>
                    <td className="wha__strong">{r.suggestOrder}</td>
                    <td>
                      <Badge r={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="wha__foot">{a.reorderHelp.replace("{lead}", String(leadDays))}</p>
      </figure>

      <div className="wha__grid">
        <figure className="wha__card">
          <figcaption>{a.agingTitle}</figcaption>
          <div className="wha__stack" role="img" aria-label={a.agingTitle}>
            {ages.map((g) => (
              <i
                key={g.label}
                className={`wha__age wha__age--${g.label}`}
                style={{ flexGrow: g.units }}
              />
            ))}
          </div>
          <ul className="wha__legend">
            {ages.map((g) => (
              <li key={g.label}>
                <i className={`wha__dot wha__age--${g.label}`} /> {a.age[g.label]}: <b>{g.units}</b>{" "}
                <span>
                  ({pct(g.units / ageTotal)} · {money(g.value)})
                </span>
              </li>
            ))}
          </ul>
        </figure>

        <figure className="wha__card">
          <figcaption>{a.heatTitle}</figcaption>
          {sh.length === 0 ? (
            <p className="wha__foot">{a.noShelf}</p>
          ) : (
            <div className="wha__heat">
              {sh.slice(0, 48).map((s) => (
                <div
                  key={s.location}
                  className="wha__cell"
                  style={{ ["--heat" as string]: String(0.15 + 0.85 * (s.units / shMax)) }}
                  title={`${s.location || a.noLocation}: ${s.units} · ${money(s.value)}`}
                >
                  <b>{s.location || "—"}</b>
                  <span>{s.units}</span>
                </div>
              ))}
            </div>
          )}
        </figure>
      </div>

      <figure className="wha__card">
        <figcaption>{a.allTitle}</figcaption>
        <div className="wha__scroll">
          <table className="wha__table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>{a.cols.class}</th>
                <th>{a.cols.sold}</th>
                <th>{a.cols.revenue}</th>
                <th>{a.cols.profit}</th>
                <th>{a.cols.onHand}</th>
                <th>{a.cols.cover}</th>
                <th>{a.cols.turnover}</th>
                <th>{a.cols.health}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sku}>
                  <th scope="row">{r.sku}</th>
                  <td>
                    <b className={`wha__tag wha__tag--${r.abc}`}>
                      {r.abc}
                      {r.xyz === "-" ? "" : r.xyz}
                    </b>
                  </td>
                  <td>{r.soldQty}</td>
                  <td>{money(r.revenue)}</td>
                  <td>{money(r.profit)}</td>
                  <td>{r.onHand}</td>
                  <td>{r.cover === undefined ? "—" : `${Math.round(r.cover)}`}</td>
                  <td>
                    {r.turnover === undefined
                      ? "—"
                      : Number.isFinite(r.turnover)
                        ? `${r.turnover.toFixed(1)}×`
                        : "∞"}
                  </td>
                  <td>
                    <Badge r={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="wha__foot">{a.method}</p>
      </figure>
    </section>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: string;
}) {
  return (
    <div className={`wha__kpi wha__kpi--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function Badge({ r }: { r: SkuAnalysis }) {
  const { t } = useI18n();
  return (
    <span className={`wha__badge wha__badge--${HEALTH_TONE[r.health]}`}>
      {t.warehouse.analysis.health[r.health]}
    </span>
  );
}

function Row({
  abc,
  cells,
  total,
}: {
  abc: (typeof MATRIX_ABC)[number];
  cells: ReturnType<typeof matrix>;
  total: number;
}) {
  const { t } = useI18n();
  const a = t.warehouse.analysis;
  return (
    <>
      <span className="wha__axis" role="rowheader">
        {abc} <small>{a.abcName[abc]}</small>
      </span>
      {cells.map((c) => (
        <div
          key={c.xyz}
          className={`wha__mcell wha__mcell--${c.abc}${c.xyz}`}
          role="cell"
          title={c.skus.join(", ")}
        >
          <b>
            {c.abc}
            {c.xyz}
          </b>
          <strong>{c.skus.length}</strong>
          <span>{total > 0 ? pct(c.revenue / total) : "0%"}</span>
          <small>{a.strategy[`${c.abc}${c.xyz}` as keyof typeof a.strategy]}</small>
        </div>
      ))}
    </>
  );
}
