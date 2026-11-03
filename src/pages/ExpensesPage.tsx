import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  createBizClient,
  type BizClient,
  EXPENSE_CATEGORIES,
  EXPENSE_PRESETS,
  type Expense,
  type ExpenseCategory,
  type ExpenseKind,
} from "../biz/client";
import { useI18n } from "../i18n";

// "Chi phí": the monthly and one-off costs the profit report subtracts (rent, staff, platform
// fee as a share of sales...). Goods bought for stock are not typed here: they come in through
// "Nhập Kho", which books their cost when the labels are made.

const money = (n: number) => `NT$ ${Math.round(n).toLocaleString("en-US")}`;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const newId = (p: string) =>
  `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const num = (s: string) => (/^-?\d{1,8}$/.test(s.trim()) ? Number(s) : NaN);

export function ExpensesPage({ client }: { client?: BizClient }) {
  const { t } = useI18n();
  const v = t.inventory;
  const [api] = useState(() => client ?? createBizClient());
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    if (!api.available) return;
    try {
      setExpenses(await api.expenses());
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
      {error && (
        <p className="note note--error" role="alert">
          {error}
        </p>
      )}
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
                  <th scope="col">{v.category}</th>
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
                    <td data-label={v.category}>{v.categories[e.category] ?? e.category}</td>
                    <td data-label={v.kind}>{v.kinds[e.kind]}</td>
                    <td data-label={v.amount}>
                      {e.kind === "PERCENT" ? `${e.amount / 100}%` : money(e.amount)}
                    </td>
                    <td data-label={v.date}>{e.at}</td>
                    <td className="cell-actions">
                      {e.kind !== "ONCE" && (
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
    </div>
  );
}

function ExpenseForm({ onSave }: { onSave: (e: Expense) => Promise<void> }) {
  const { t } = useI18n();
  const v = t.inventory;
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<ExpenseKind>("FIXED");
  const [category, setCategory] = useState<ExpenseCategory>("OTHER");
  const [at, setAt] = useState(today);
  const [err, setErr] = useState(false);
  const preset = (key: string, cat: ExpenseCategory, k: ExpenseKind) => {
    setName(v.presets[key as keyof typeof v.presets]);
    setCategory(cat);
    setKind(k);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // A share of sales is typed as a percent (2.5) and stored in basis points (250).
    const a =
      kind === "PERCENT"
        ? /^\d{1,3}([.,]\d{1,2})?$/.test(amount.trim())
          ? Math.round(Number(amount.trim().replace(",", ".")) * 100)
          : NaN
        : num(amount);
    const max = kind === "PERCENT" ? 10_000 : Infinity;
    if (!name.trim() || Number.isNaN(a) || a < 0 || a > max || !/^\d{4}-\d{2}-\d{2}$/.test(at))
      return setErr(true);
    setErr(false);
    await onSave({
      id: newId("ex"),
      name: name.trim(),
      amount: a,
      kind,
      category,
      at,
      active: true,
    });
    setName("");
    setAmount("");
  };
  return (
    <form className="box inv__form" onSubmit={(e) => void submit(e)} noValidate>
      <h2 className="section-title">{v.addExpense}</h2>
      <p className="caption">{v.presetsHelp}</p>
      <div className="chips" role="group" aria-label={v.presetsTitle}>
        {EXPENSE_PRESETS.map((x) => (
          <button
            key={x.key}
            type="button"
            className="btn btn--chip"
            onClick={() => preset(x.key, x.category, x.kind)}
          >
            {v.presets[x.key as keyof typeof v.presets]}
          </button>
        ))}
      </div>
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
          {v.category}
          <select
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {v.categories[c]}
              </option>
            ))}
          </select>
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
            <option value="PERCENT">{v.kinds.PERCENT}</option>
          </select>
        </label>
        <label className="field">
          {kind === "PERCENT" ? v.percent : v.amount}
          <input
            className="input"
            inputMode={kind === "PERCENT" ? "decimal" : "numeric"}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="field">
          {kind === "ONCE" ? v.date : v.startFrom}
          <input className="input" type="date" value={at} onChange={(e) => setAt(e.target.value)} />
        </label>
      </div>
      {kind === "PERCENT" && <p className="caption">{v.percentHint}</p>}
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
