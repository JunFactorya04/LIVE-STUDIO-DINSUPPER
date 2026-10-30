import { StoreSearch } from "./StoreSearch";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { useI18n } from "../i18n";
import { getPrintService } from "../print/service";
import { isConfigured, loadPrinter } from "../print/settings";
import { usePrintStatus } from "../print/usePrint";
import {
  createShipClient,
  type ShipClient,
  type ShipCustomer,
  type ShipOrder,
  type Store,
  type StoreHit,
} from "../ship/client";
import { takeShipPrefill } from "../ship/prefill";
import { shipSlip } from "../ship/slip";
import {
  EMPTY_SHIP_FORM,
  cleanPhone,
  cleanStoreCode,
  cleanTikTokId,
  firstError,
  total,
  type ShipForm,
} from "../ship/validate";

type Tab = "orders" | "customers" | "stores";
type Filter = "pending" | "exported" | "all";
type Note = { text: string; error: boolean } | undefined;

const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const fromOrder = (o: ShipOrder): ShipForm => ({
  tiktokId: o.tiktokId,
  phone: o.phone,
  name: o.recipientName,
  temperature: o.temperature,
  storeCode: o.storeCode,
  storeName: o.storeName,
  product: o.product,
  note: o.note,
  amount: String(o.amount),
  fee: String(o.shippingFee),
});

const fromCustomer = (c: ShipCustomer): ShipForm => ({
  ...EMPTY_SHIP_FORM,
  tiktokId: c.tiktokId,
  phone: c.phone,
  name: c.name,
  storeCode: c.storeCode,
  storeName: c.storeName,
});

// Shipping orders for 7-ELEVEN pickup, modelled on how sellers already work with
// taodonnhanh.com: a customer list, one form, and a pending / exported status. Everything the
// recipient needs is typed by the seller; nothing is generated or sent anywhere.
export function ShipPage({ client }: { client?: ShipClient }) {
  const { t } = useI18n();
  const [api] = useState(() => client ?? createShipClient());
  const [tab, setTab] = useState<Tab>("orders");
  const [orders, setOrders] = useState<ShipOrder[]>();
  const [customers, setCustomers] = useState<ShipCustomer[]>([]);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState<Note>();
  // The form is open when `draft` is set; `editingId` is set when it edits an existing order.
  const [draft, setDraft] = useState<ShipForm>();
  const [editingId, setEditingId] = useState<string>();

  const load = useCallback(async () => {
    if (!api.available) return;
    setFailed(false);
    try {
      const [o, c] = await Promise.all([api.orders(), api.customers()]);
      setOrders(o);
      setCustomers(c);
    } catch {
      setFailed(true);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  // Coming from the A-Z routine: open the form for that buyer once their data is loaded.
  const [prefill] = useState(takeShipPrefill);
  useEffect(() => {
    if (!prefill || !orders) return;
    const c = customers.find((x) => x.tiktokId === prefill);
    setTab("orders");
    setDraft(c ? fromCustomer(c) : { ...EMPTY_SHIP_FORM, tiktokId: prefill });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, orders === undefined]);

  const openForm = (form: ShipForm, id?: string) => {
    setTab("orders");
    setNote(undefined);
    setDraft(form);
    setEditingId(id);
  };

  return (
    <div className="page page--no-inspector ship">
      <section className="box">
        <p className="banner banner--info" role="note">
          {t.ship.notice}
        </p>
        {!api.available ? (
          <EmptyState title={t.ship.errors.desktopOnly} hint="" />
        ) : failed ? (
          <ErrorState onRetry={() => void load()} />
        ) : !orders ? (
          <LoadingState />
        ) : (
          <>
            <div className="segmented" role="group" aria-label={t.pages.ship.title}>
              {(["orders", "customers", "stores"] as const).map((k) => (
                <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>
                  {t.ship.tabs[k]}
                </button>
              ))}
            </div>
            {note && (
              <p
                className={`banner ${note.error ? "banner--error" : "banner--info"}`}
                role="status"
              >
                {note.text}
              </p>
            )}
            {tab === "orders" && (
              <OrdersTab
                api={api}
                orders={orders}
                customers={customers}
                draft={draft}
                editingId={editingId}
                onOpen={openForm}
                onClose={() => {
                  setDraft(undefined);
                  setEditingId(undefined);
                }}
                onChanged={load}
                onNote={setNote}
              />
            )}
            {tab === "customers" && (
              <CustomersTab
                api={api}
                customers={customers}
                onCreate={(c) => openForm(fromCustomer(c))}
                onChanged={load}
                onNote={setNote}
              />
            )}
            {tab === "stores" && <StoresTab api={api} onNote={setNote} />}
          </>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- orders

function OrdersTab({
  api,
  orders,
  customers,
  draft,
  editingId,
  onOpen,
  onClose,
  onChanged,
  onNote,
}: {
  api: ShipClient;
  orders: ShipOrder[];
  customers: ShipCustomer[];
  draft: ShipForm | undefined;
  editingId: string | undefined;
  onOpen: (form: ShipForm, id?: string) => void;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onNote: (n: Note) => void;
}) {
  const { t, fmt, locale } = useI18n();
  const [filter, setFilter] = useState<Filter>("pending");
  const [confirmDelete, setConfirmDelete] = useState<string>();
  const [markAfter, setMarkAfter] = useState(true);
  const printer = getPrintService();
  const printStatus = usePrintStatus(printer);
  const printerReady = printer.available && isConfigured(loadPrinter());

  const pending = orders.filter((o) => !o.exported);
  const codPending = pending.reduce((n, o) => n + o.cod, 0);
  const rows = orders.filter(
    (o) => filter === "all" || (filter === "pending" ? !o.exported : o.exported),
  );
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale === "vi" ? "vi-VN" : "zh-TW", {
      dateStyle: "short",
      timeStyle: "short",
    });

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
      await onChanged();
    } catch {
      onNote({ text: t.ship.errors.save, error: true });
    }
  };

  // The pending orders (up to 500, the sheet's limit) go into the 7-ELEVEN import workbook.
  const exportXlsx = async () => {
    try {
      const path = await api.exportXlsx([], markAfter);
      onNote({ text: fmt(t.ship.export.done, { path }), error: false });
      await onChanged();
    } catch (e) {
      const empty = e === "EMPTY";
      onNote({ text: empty ? t.ship.export.empty : t.ship.export.failed, error: true });
    }
  };

  const print = async (o: ShipOrder) => {
    const ok = await printer.print(shipSlip(o, t.ship.slip));
    if (ok) onNote({ text: t.ship.printed, error: false });
  };

  return (
    <>
      <div className="ship__stats">
        <div className="ship__stat">
          <span className="muted">{t.ship.stats.pending}</span>
          <strong>{fmt(t.ship.orders, { n: pending.length })}</strong>
        </div>
        <div className="ship__stat">
          <span className="muted">{t.ship.stats.codPending}</span>
          <strong>NT$ {codPending}</strong>
        </div>
      </div>
      <div className="ship__bar">
        <div className="segmented" role="group" aria-label={t.ship.tabs.orders}>
          {(["pending", "exported", "all"] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {t.ship.filters[f]}
            </button>
          ))}
        </div>
        {!draft && (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => onOpen(EMPTY_SHIP_FORM)}
          >
            + {t.ship.create}
          </button>
        )}
        <button
          type="button"
          className="btn"
          disabled={pending.length === 0}
          onClick={() => void exportXlsx()}
        >
          {t.ship.export.button}
        </button>
        <label className="check ship__mark">
          <input
            type="checkbox"
            checked={markAfter}
            onChange={(e) => setMarkAfter(e.target.checked)}
          />
          <span>{t.ship.export.mark}</span>
        </label>
      </div>
      {printStatus.error && (
        <p className="banner banner--error" role="alert">
          {t.print.errors[printStatus.error]}
        </p>
      )}
      {draft && (
        <ShipFormView
          key={editingId ?? "new"}
          api={api}
          customers={customers}
          initial={draft}
          editingId={editingId}
          onDone={async (next) => {
            await onChanged();
            if (next) onOpen(EMPTY_SHIP_FORM);
            else onClose();
          }}
          onCancel={onClose}
        />
      )}
      {orders.length === 0 ? (
        <EmptyState title={t.ship.emptyTitle} hint={t.ship.emptyHint} />
      ) : (
        <div className="feed-scroll">
          <table className="table orders-table" aria-label={t.ship.tabs.orders}>
            <thead>
              <tr>
                <th scope="col">{t.ship.columns.time}</th>
                <th scope="col">{t.ship.columns.recipient}</th>
                <th scope="col">{t.ship.columns.store}</th>
                <th scope="col">{t.ship.columns.product}</th>
                <th scope="col">{t.ship.columns.cod}</th>
                <th scope="col">{t.ship.columns.status}</th>
                <th scope="col">{t.ship.columns.actions}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td className="nowrap" data-label={t.ship.columns.time}>
                    {when(o.createdAt)}
                  </td>
                  <td className="wrap" data-label={t.ship.columns.recipient}>
                    <strong>{o.recipientName}</strong>
                    <br />
                    <span className="muted">
                      {o.phone}
                      {o.tiktokId && ` · @${o.tiktokId}`}
                    </span>
                  </td>
                  <td className="wrap" data-label={t.ship.columns.store}>
                    {o.storeCode} <span className="muted">{o.storeName}</span>
                  </td>
                  <td className="wrap" data-label={t.ship.columns.product}>
                    {o.product}
                    {o.temperature === "FROZEN" && (
                      <span className="chip tone-blue"> {t.ship.form.frozen}</span>
                    )}
                  </td>
                  <td className="num" data-label={t.ship.columns.cod}>
                    NT$ {o.cod}
                  </td>
                  <td data-label={t.ship.columns.status}>
                    <span className={`chip ${o.exported ? "tone-green" : "tone-orange"}`}>
                      {o.exported ? t.ship.status.exported : t.ship.status.pending}
                    </span>
                  </td>
                  <td className="cell-actions nowrap">
                    {printerReady && (
                      <>
                        <button
                          type="button"
                          className="btn"
                          disabled={printStatus.printing}
                          onClick={() => void print(o)}
                        >
                          {t.ship.actions.print}
                        </button>{" "}
                      </>
                    )}
                    <button
                      type="button"
                      className="btn"
                      onClick={() => onOpen(fromOrder(o), o.id)}
                    >
                      {t.ship.actions.edit}
                    </button>{" "}
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void run(() => api.setExported([o.id], !o.exported))}
                    >
                      {o.exported ? t.ship.actions.markPending : t.ship.actions.markExported}
                    </button>{" "}
                    {confirmDelete === o.id ? (
                      <button
                        type="button"
                        className="btn btn--danger"
                        onClick={() => {
                          setConfirmDelete(undefined);
                          void run(() => api.deleteOrder(o.id));
                        }}
                      >
                        {t.ship.actions.confirmDelete}
                      </button>
                    ) : (
                      <button type="button" className="btn" onClick={() => setConfirmDelete(o.id)}>
                        {t.ship.actions.delete}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- form

function ShipFormView({
  api,
  customers,
  initial,
  editingId,
  onDone,
  onCancel,
}: {
  api: ShipClient;
  customers: ShipCustomer[];
  initial: ShipForm;
  editingId: string | undefined;
  onDone: (next: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const { t, fmt } = useI18n();
  const f = t.ship.form;
  const [form, setForm] = useState<ShipForm>(initial);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string>();
  const [store, setStore] = useState<Store | "unknown">();
  const [busy, setBusy] = useState(false);
  const ids = {
    customer: useId(),
    phone: useId(),
    name: useId(),
    code: useId(),
    storeName: useId(),
    product: useId(),
    note: useId(),
    amount: useId(),
    fee: useId(),
    tiktok: useId(),
  };
  const set = <K extends keyof ShipForm>(k: K, v: ShipForm[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));
  const sum = total(form);

  // Look the store number up in the imported list; fill the name only when it is still empty.
  useEffect(() => {
    const code = cleanStoreCode(form.storeCode);
    if (!code) {
      setStore(undefined);
      return;
    }
    let live = true;
    const fill = (s: Store | undefined) => {
      if (!live) return;
      setStore(s ?? "unknown");
      if (s) setForm((prev) => (prev.storeName.trim() ? prev : { ...prev, storeName: s.name }));
    };
    // Local list first (works offline); otherwise ask 7-ELEVEN's map for exactly this number.
    api
      .lookupStore(code)
      .then(async (local) => {
        if (local) return fill(local);
        const online = await api.searchStores(code).catch(() => []);
        const exact = online.find((h) => h.code === code && !h.disabled);
        fill(exact);
      })
      .catch(() => live && setStore(undefined));
    return () => {
      live = false;
    };
  }, [api, form.storeCode]);

  const pickStore = (h: StoreHit) => {
    setForm((prev) => ({ ...prev, storeCode: h.code, storeName: h.name }));
  };

  const pickCustomer = (tiktokId: string) => {
    const c = customers.find((x) => x.tiktokId === tiktokId);
    if (c) setForm((prev) => ({ ...prev, ...fromCustomer(c), product: prev.product }));
  };

  const submit = async (e: FormEvent | undefined, next: boolean) => {
    e?.preventDefault();
    const problem = firstError(form);
    if (problem) return setError(t.ship.errors[problem]);
    setError(undefined);
    setBusy(true);
    try {
      await api.saveOrder(
        {
          id: editingId ?? newId(),
          tiktokId: cleanTikTokId(form.tiktokId) ?? "",
          recipientName: form.name.trim(),
          phone: cleanPhone(form.phone) ?? form.phone,
          temperature: form.temperature,
          storeCode: form.storeCode.trim(),
          storeName: form.storeName.trim(),
          product: form.product.trim(),
          note: form.note.trim(),
          amount: Number(form.amount),
          shippingFee: Number(form.fee),
          cod: 0,
          exported: false,
          createdAt: "",
        },
        remember,
      );
      await onDone(next);
    } catch {
      setError(t.ship.errors.save);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="ship__form" onSubmit={(e) => void submit(e, false)} noValidate>
      <h3>{editingId ? t.ship.editTitle : t.ship.create}</h3>
      {customers.length > 0 && (
        <div className="field">
          <label htmlFor={ids.customer}>{f.customer}</label>
          <select
            id={ids.customer}
            className="input"
            value=""
            onChange={(e) => pickCustomer(e.target.value)}
          >
            <option value="">{f.customerNone}</option>
            {customers.map((c) => (
              <option key={c.tiktokId} value={c.tiktokId}>
                {c.name ? `${c.name} (@${c.tiktokId})` : `@${c.tiktokId}`}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor={ids.phone}>{f.phone} *</label>
        <input
          id={ids.phone}
          className="input"
          inputMode="tel"
          placeholder={f.phonePlaceholder}
          value={form.phone}
          onChange={(e) => set("phone", e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={ids.name}>{f.name} *</label>
        <input
          id={ids.name}
          className="input"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </div>
      <fieldset className="field field--group">
        <legend>{f.temperature} *</legend>
        <div className="segmented" role="group" aria-label={f.temperature}>
          {(["NORMAL", "FROZEN"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={form.temperature === k}
              onClick={() => set("temperature", k)}
            >
              {k === "NORMAL" ? f.normal : f.frozen}
            </button>
          ))}
        </div>
      </fieldset>
      <StoreSearch api={api} onPick={pickStore} />
      <div className="field">
        <label htmlFor={ids.code}>{f.storeCode} *</label>
        <input
          id={ids.code}
          className="input"
          inputMode="numeric"
          value={form.storeCode}
          onChange={(e) => set("storeCode", e.target.value)}
        />
        <span className="muted">{f.storeCodeHint}</span>
        {store && store !== "unknown" && (
          <span className="muted">{fmt(f.storeFound, { name: store.name })}</span>
        )}
        {store === "unknown" && <span className="muted">{f.storeUnknown}</span>}
      </div>
      <div className="field">
        <label htmlFor={ids.storeName}>{f.storeName}</label>
        <input
          id={ids.storeName}
          className="input"
          value={form.storeName}
          onChange={(e) => set("storeName", e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={ids.product}>{f.product} *</label>
        <input
          id={ids.product}
          className="input"
          value={form.product}
          onChange={(e) => set("product", e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={ids.note}>{f.note}</label>
        <input
          id={ids.note}
          className="input"
          placeholder={f.notePlaceholder}
          value={form.note}
          onChange={(e) => set("note", e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={ids.amount}>{f.amount} *</label>
        <input
          id={ids.amount}
          className="input"
          inputMode="numeric"
          value={form.amount}
          onChange={(e) => set("amount", e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={ids.fee}>{f.fee} *</label>
        <input
          id={ids.fee}
          className="input"
          inputMode="numeric"
          value={form.fee}
          onChange={(e) => set("fee", e.target.value)}
        />
      </div>
      <div className="ship__cod">
        <span>{f.cod}</span>
        <strong>NT$ {sum}</strong>
        <span className={sum < 58 || sum > 20000 ? "ship__rule ship__rule--bad" : "muted"}>
          {f.codRule}
        </span>
      </div>
      <div className="field">
        <label htmlFor={ids.tiktok}>{f.tiktok}</label>
        <input
          id={ids.tiktok}
          className="input"
          placeholder={f.tiktokPlaceholder}
          value={form.tiktokId}
          onChange={(e) => set("tiktokId", e.target.value)}
        />
      </div>
      <label className="check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>{f.remember}</span>
      </label>
      {error && (
        <p className="banner banner--error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {f.save}
        </button>
        {!editingId && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void submit(undefined, true)}
          >
            {f.saveNext}
          </button>
        )}
        <button type="button" className="btn" onClick={onCancel}>
          {f.cancel}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- customers

function CustomersTab({
  api,
  customers,
  onCreate,
  onChanged,
  onNote,
}: {
  api: ShipClient;
  customers: ShipCustomer[];
  onCreate: (c: ShipCustomer) => void;
  onChanged: () => Promise<void>;
  onNote: (n: Note) => void;
}) {
  const { t, fmt } = useI18n();
  const c = t.ship.customers;

  const copyAsk = async (id: string) => {
    try {
      await navigator.clipboard.writeText(fmt(t.ship.askMessage, { id: `@${id}` }));
      void api.markFlow(id, "ASK_COPIED").catch(() => undefined);
      onNote({ text: c.copied, error: false });
    } catch {
      onNote({ text: c.copyFailed, error: true });
    }
  };

  if (customers.length === 0) return <EmptyState title={c.emptyTitle} hint={c.emptyHint} />;
  return (
    <div className="feed-scroll">
      <table className="table orders-table" aria-label={t.ship.tabs.customers}>
        <thead>
          <tr>
            <th scope="col">{c.id}</th>
            <th scope="col">{c.name}</th>
            <th scope="col">{c.phone}</th>
            <th scope="col">{c.store}</th>
            <th scope="col">{t.ship.columns.actions}</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((x) => {
            const incomplete = !x.name || !x.phone || !x.storeCode;
            return (
              <tr key={x.tiktokId}>
                <td className="nowrap" data-label={c.id}>
                  @{x.tiktokId}
                </td>
                <td data-label={c.name}>
                  {x.name ||
                    (incomplete ? <span className="chip tone-orange">{c.incomplete}</span> : "")}
                </td>
                <td className="nowrap" data-label={c.phone}>
                  {x.phone || t.common.none}
                </td>
                <td className="wrap" data-label={c.store}>
                  {x.storeCode ? `${x.storeCode} ${x.storeName}` : t.common.none}
                </td>
                <td className="cell-actions nowrap">
                  <button type="button" className="btn btn--primary" onClick={() => onCreate(x)}>
                    {c.createOrder}
                  </button>{" "}
                  <button type="button" className="btn" onClick={() => void copyAsk(x.tiktokId)}>
                    {c.copyAsk}
                  </button>{" "}
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      void api
                        .deleteCustomer(x.tiktokId)
                        .then(onChanged, () => onNote({ text: t.ship.errors.save, error: true }));
                    }}
                  >
                    {c.delete}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- stores

function StoresTab({ api, onNote }: { api: ShipClient; onNote: (n: Note) => void }) {
  const { t, fmt } = useI18n();
  const s = t.ship.stores;
  const [count, setCount] = useState<number>();
  const [body, setBody] = useState("");
  const pasteId = useId();
  const fileId = useId();

  const refresh = useCallback(() => {
    api.storesCount().then(setCount, () => setCount(undefined));
  }, [api]);
  useEffect(refresh, [refresh]);

  const importText = async (text: string) => {
    try {
      const r = await api.importStores(text);
      onNote({ text: fmt(s.result, r), error: false });
      setBody("");
      refresh();
    } catch {
      onNote({ text: s.failed, error: true });
    }
  };

  return (
    <div className="ship__stores">
      <p>{fmt(s.count, { n: count ?? 0 })}</p>
      <p className="muted">{s.help}</p>
      <div className="field">
        <label htmlFor={fileId}>{s.file}</label>
        <input
          id={fileId}
          className="input"
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void file.text().then(importText);
            e.target.value = "";
          }}
        />
      </div>
      <div className="field">
        <label htmlFor={pasteId}>{s.paste}</label>
        <textarea
          id={pasteId}
          className="input input--area"
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      <div className="actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!body.trim()}
          onClick={() => void importText(body)}
        >
          {s.import}
        </button>
      </div>
    </div>
  );
}
