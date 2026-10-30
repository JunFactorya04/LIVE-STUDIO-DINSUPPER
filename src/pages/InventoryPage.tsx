import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  createBizClient,
  type BizClient,
  type Expense,
  type ExpenseKind,
  type Purchase,
  type StockItem,
} from "../biz/client";
import { marginPct, stockSummary } from "../biz/ledger";
import { useI18n } from "../i18n";
import { useLiveSession } from "../live/useLiveSession";

// Stock, purchases and expenses: the numbers the profit report is built from. Everything is typed
// by the seller and kept on this computer; nothing is estimated or filled in for them.

type Tab = "stock" | "purchases" | "expenses";
const TABS: Tab[] = ["stock", "purchases", "expenses"];
const money = (n: number) => `NT$ ${Math.round(n).toLocaleString("en-US")}`;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const newId = (p: string) =>
  `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const num = (s: string) => (/^-?\d{1,8}$/.test(s.trim()) ? Number(s) : NaN);

export function InventoryPage({ client }: { client?: BizClient }) {
  const { t } = useI18n();
  const v = t.inventory;
  const [api] = useState(() => client ?? createBizClient());
  const { catalog } = useLiveSession();
  const [tab, setTab] = useState<Tab>("stock");
  const [stock, setStock] = useState<StockItem[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    if (!api.available) return;
    try {
      const [s, p, e] = await Promise.all([api.stock(), api.purchases(), api.expenses()]);
      setStock(s);
      setPurchases(p);
      setExpenses(e);
    } catch {
      setError(v.errors.load);
    }
  }, [api, v.errors.load]);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (job: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await job();
      await load();
    } catch {
      setError(v.errors.save);
    }
  };

  const skus = useMemo(() => {
    const all = new Map<string, string>(catalog.map((c) => [c.sku, c.name]));
    for (const s of stock) if (!all.has(s.sku)) all.set(s.sku, "");
    return [...all.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [catalog, stock]);

  const summary = stockSummary(stock, new Set());

  if (!api.available) {
    return (
      <div className="page page--no-inspector">
        <section className="box">
          <div className="empty">
            <strong>{v.desktopOnly}</strong>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page page--no-inspector inv">
      <div className="segmented" role="tablist" aria-label={t.nav.inventory}>
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {v.tabs[id]}
          </button>
        ))}
      </div>
      {error && (
        <p className="note note--error" role="alert">
          {error}
        </p>
      )}

      {tab === "stock" && (
        <>
          <div className="fin__tiles">
            <Tile tone="tone-blue" label={v.valueTitle} value={money(summary.value)} />
            <Tile tone="tone-green" label={v.unitsTitle} value={String(summary.units)} />
            <Tile tone="tone-orange" label={v.lowTitle} value={String(summary.low.length)} />
            <Tile tone="tone-red" label={v.oversoldTitle} value={String(summary.oversold.length)} />
          </div>
          <StockEditor skus={skus} stock={stock} onSave={(i) => run(() => api.saveStock(i))} />
          <section className="box">
            <h2 className="section-title">{v.stockTitle}</h2>
            {skus.length === 0 ? (
              <div className="empty">
                <strong>{v.stockEmpty}</strong>
                <span className="caption">{v.stockEmptyHint}</span>
              </div>
            ) : (
              <div className="fin-table-wrap">
                <table className="fin-table">
                  <thead>
                    <tr>
                      <th scope="col">{v.sku}</th>
                      <th scope="col">{v.price}</th>
                      <th scope="col">{v.cost}</th>
                      <th scope="col">{v.margin}</th>
                      <th scope="col">{v.onHand}</th>
                      <th scope="col">{v.status}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {skus.map(([sku, name]) => {
                      const s = stock.find((x) => x.sku === sku);
                      const price = catalog.find((c) => c.sku === sku)?.price;
                      const m = s ? marginPct(price, s.cost) : undefined;
                      const low = s && s.stock >= 0 && s.minStock > 0 && s.stock <= s.minStock;
                      return (
                        <tr key={sku}>
                          <th scope="row">
                            {sku}
                            {name && <span className="muted"> {name}</span>}
                          </th>
                          <td>{price ? money(price) : "—"}</td>
                          <td>{s ? money(s.cost) : "—"}</td>
                          <td>{m === undefined ? "—" : `${m}%`}</td>
                          <td>{s ? s.stock : "—"}</td>
                          <td>
                            {!s ? (
                              <span className="chip tone-gray">{v.notTracked}</span>
                            ) : s.stock < 0 ? (
                              <span className="chip tone-red">{v.oversold}</span>
                            ) : low ? (
                              <span className="chip tone-orange">{v.low}</span>
                            ) : (
                              <span className="chip tone-green">{v.ok}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {tab === "purchases" && (
        <>
          <PurchaseForm skus={skus} stock={stock} onAdd={(p) => run(() => api.addPurchase(p))} />
          <section className="box">
            <h2 className="section-title">{v.purchaseList}</h2>
            {purchases.length === 0 ? (
              <p className="caption">{v.purchaseNone}</p>
            ) : (
              <div className="fin-table-wrap">
                <table className="fin-table">
                  <thead>
                    <tr>
                      <th scope="col">{v.date}</th>
                      <th scope="col">{v.sku}</th>
                      <th scope="col">{v.qty}</th>
                      <th scope="col">{v.unitCost}</th>
                      <th scope="col">{v.total}</th>
                      <th scope="col">{v.supplier}</th>
                      <th scope="col" />
                    </tr>
                  </thead>
                  <tbody>
                    {purchases.map((p) => (
                      <tr key={p.id}>
                        <th scope="row">{p.at}</th>
                        <td>{p.sku}</td>
                        <td>{p.qty}</td>
                        <td>{money(p.unitCost)}</td>
                        <td>{money(p.qty * p.unitCost)}</td>
                        <td>{p.supplier || "—"}</td>
                        <td>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => void run(() => api.deletePurchase(p.id))}
                          >
                            {v.remove}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="caption">{v.purchaseHelp}</p>
          </section>
        </>
      )}

      {tab === "expenses" && (
        <>
          <ExpenseForm onSave={(e) => run(() => api.saveExpense(e))} />
          <section className="box">
            <h2 className="section-title">{v.expenseList}</h2>
            {expenses.length === 0 ? (
              <p className="caption">{v.expenseNone}</p>
            ) : (
              <div className="fin-table-wrap">
                <table className="fin-table">
                  <thead>
                    <tr>
                      <th scope="col">{v.name}</th>
                      <th scope="col">{v.kind}</th>
                      <th scope="col">{v.amount}</th>
                      <th scope="col">{v.date}</th>
                      <th scope="col" />
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map((e) => (
                      <tr key={e.id} className={e.active ? "" : "is-off"}>
                        <th scope="row">{e.name}</th>
                        <td>{e.kind === "FIXED" ? v.kinds.FIXED : v.kinds.ONCE}</td>
                        <td>{money(e.amount)}</td>
                        <td>{e.at}</td>
                        <td>
                          {e.kind === "FIXED" && (
                            <button
                              type="button"
                              className="btn"
                              onClick={() =>
                                void run(() => api.saveExpense({ ...e, active: !e.active }))
                              }
                            >
                              {e.active ? v.pause : v.resume}
                            </button>
                          )}{" "}
                          <button
                            type="button"
                            className="btn"
                            onClick={() => void run(() => api.deleteExpense(e.id))}
                          >
                            {v.remove}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="caption">{v.expenseHelp}</p>
          </section>
        </>
      )}
    </div>
  );
}

function Tile({ tone, label, value }: { tone: string; label: string; value: string }) {
  return (
    <div className="fin-tile">
      <span className={`fin-tile__dot ${tone}`} aria-hidden="true" />
      <span className="fin-tile__label">{label}</span>
      <strong className="fin-tile__value">{value}</strong>
    </div>
  );
}

function StockEditor({
  skus,
  stock,
  onSave,
}: {
  skus: [string, string][];
  stock: StockItem[];
  onSave: (i: StockItem) => Promise<void>;
}) {
  const { t } = useI18n();
  const v = t.inventory;
  const [sku, setSku] = useState("");
  const [cost, setCost] = useState("");
  const [qty, setQty] = useState("");
  const [min, setMin] = useState("");
  const [err, setErr] = useState(false);

  const choose = (next: string) => {
    setSku(next);
    const s = stock.find((x) => x.sku === next);
    setCost(s ? String(s.cost) : "");
    setQty(s ? String(s.stock) : "");
    setMin(s ? String(s.minStock) : "");
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const c = num(cost);
    const q = num(qty);
    const m = min.trim() === "" ? 0 : num(min);
    if (!sku || [c, q, m].some(Number.isNaN) || c < 0 || m < 0) return setErr(true);
    setErr(false);
    await onSave({ sku, cost: c, stock: q, minStock: m });
  };
  return (
    <form className="box inv__form" onSubmit={(e) => void submit(e)} noValidate>
      <h2 className="section-title">{v.editStock}</h2>
      <p className="caption">{v.editStockHelp}</p>
      <div className="inv__grid">
        <label className="field">
          {v.sku}
          <select className="input" value={sku} onChange={(e) => choose(e.target.value)}>
            <option value="">{v.pick}</option>
            {skus.map(([s, n]) => (
              <option key={s} value={s}>
                {s} {n}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {v.cost}
          <input
            className="input"
            inputMode="numeric"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
        </label>
        <label className="field">
          {v.onHand}
          <input
            className="input"
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </label>
        <label className="field">
          {v.minStock}
          <input
            className="input"
            inputMode="numeric"
            value={min}
            onChange={(e) => setMin(e.target.value)}
          />
        </label>
      </div>
      {err && (
        <p className="note note--error" role="alert">
          {v.errors.number}
        </p>
      )}
      <button type="submit" className="btn btn--primary">
        {v.save}
      </button>
    </form>
  );
}

function PurchaseForm({
  skus,
  stock,
  onAdd,
}: {
  skus: [string, string][];
  stock: StockItem[];
  onAdd: (p: Purchase) => Promise<void>;
}) {
  const { t } = useI18n();
  const v = t.inventory;
  const [sku, setSku] = useState("");
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [at, setAt] = useState(today);
  const [err, setErr] = useState(false);
  const have = stock.find((s) => s.sku === sku);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const q = num(qty);
    const c = num(cost);
    if (
      !sku ||
      Number.isNaN(q) ||
      Number.isNaN(c) ||
      q < 1 ||
      c < 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(at)
    ) {
      return setErr(true);
    }
    setErr(false);
    await onAdd({
      id: newId("pu"),
      sku,
      qty: q,
      unitCost: c,
      supplier: supplier.trim(),
      note: "",
      at,
    });
    setQty("");
    setCost("");
  };
  return (
    <form className="box inv__form" onSubmit={(e) => void submit(e)} noValidate>
      <h2 className="section-title">{v.addPurchase}</h2>
      <div className="inv__grid">
        <label className="field">
          {v.sku}
          <select className="input" value={sku} onChange={(e) => setSku(e.target.value)}>
            <option value="">{v.pick}</option>
            {skus.map(([s, n]) => (
              <option key={s} value={s}>
                {s} {n}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {v.qty}
          <input
            className="input"
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </label>
        <label className="field">
          {v.unitCost}
          <input
            className="input"
            inputMode="numeric"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
        </label>
        <label className="field">
          {v.supplier}
          <input className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </label>
        <label className="field">
          {v.date}
          <input className="input" type="date" value={at} onChange={(e) => setAt(e.target.value)} />
        </label>
      </div>
      {have && (
        <p className="caption">
          {v.currentStock.replace("{n}", String(have.stock)).replace("{c}", money(have.cost))}
        </p>
      )}
      {err && (
        <p className="note note--error" role="alert">
          {v.errors.number}
        </p>
      )}
      <button type="submit" className="btn btn--primary">
        {v.addPurchase}
      </button>
    </form>
  );
}

function ExpenseForm({ onSave }: { onSave: (e: Expense) => Promise<void> }) {
  const { t } = useI18n();
  const v = t.inventory;
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<ExpenseKind>("FIXED");
  const [at, setAt] = useState(today);
  const [err, setErr] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const a = num(amount);
    if (!name.trim() || Number.isNaN(a) || a < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(at))
      return setErr(true);
    setErr(false);
    await onSave({ id: newId("ex"), name: name.trim(), amount: a, kind, at, active: true });
    setName("");
    setAmount("");
  };
  return (
    <form className="box inv__form" onSubmit={(e) => void submit(e)} noValidate>
      <h2 className="section-title">{v.addExpense}</h2>
      <div className="inv__grid">
        <label className="field">
          {v.name}
          <input
            className="input"
            value={name}
            placeholder={v.namePlaceholder}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          {v.amount}
          <input
            className="input"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="field">
          {v.kind}
          <select
            className="input"
            value={kind}
            onChange={(e) => setKind(e.target.value as ExpenseKind)}
          >
            <option value="FIXED">{v.kinds.FIXED}</option>
            <option value="ONCE">{v.kinds.ONCE}</option>
          </select>
        </label>
        <label className="field">
          {kind === "FIXED" ? v.startFrom : v.date}
          <input className="input" type="date" value={at} onChange={(e) => setAt(e.target.value)} />
        </label>
      </div>
      {err && (
        <p className="note note--error" role="alert">
          {v.errors.number}
        </p>
      )}
      <button type="submit" className="btn btn--primary">
        {v.addExpense}
      </button>
    </form>
  );
}
