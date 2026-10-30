import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { isRemote } from "../platform/backend";
import { useI18n } from "../i18n";
import { useLiveSession } from "../live/useLiveSession";
import { labelRun } from "../print/label";
import { loadLabelOptions, saveLabelOptions, type LabelOptions } from "../print/labelOptions";
import { LabelOptionsPanel } from "./LabelOptionsPanel";
import { WarehouseAnalysis } from "./WarehouseAnalysis";
import { getLabelService, getPrintService, type PrintService } from "../print/service";
import { isConfigured, loadLabelPrinter, loadPrinter } from "../print/settings";
import { canEncode } from "../barcode/code128";
import {
  createWarehouseClient,
  errorParts,
  type Move,
  type Unit,
  type UnitStatus,
  type WarehouseClient,
} from "../warehouse/client";
import { shipReceipt } from "../warehouse/receipt";
import { createScanRelay, type ScanRelay } from "../warehouse/relay";
import { ScanBox } from "../warehouse/ScanBox";
import { addScan, bySku, expectedMissing } from "../warehouse/stats";

// Warehouse with a barcode on every unit: see what is on the shelf, receive stock and print the
// labels, scan units out to ship (the total comes from their prices), and count the shelves.

type Tab = "stock" | "receive" | "ship" | "count" | "history" | "analysis" | "guide" | "send";
const money = (n: number) => `NT$ ${Math.round(n).toLocaleString("en-US")}`;
const today = () => new Date().toISOString().slice(0, 10);
const newId = () => `wh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const whenOf = (iso: string, locale: string) =>
  new Date(iso).toLocaleString(locale === "vi" ? "vi-VN" : "zh-TW", {
    dateStyle: "short",
    timeStyle: "short",
  });

export function WarehousePage({
  client,
  labels,
  receipts,
  camera,
  relay,
}: {
  relay?: ScanRelay;
  client?: WarehouseClient;
  labels?: PrintService;
  receipts?: PrintService;
  /** Camera scanner (phone); given the scan handler, returns the button that opens it. */
  camera?: (onScan: (code: string) => void) => React.ReactNode;
}) {
  const { t, locale } = useI18n();
  const w = t.warehouse;
  const remote = isRemote();
  const [api] = useState(() => client ?? createWarehouseClient());
  const [labelSvc] = useState(() => labels ?? getLabelService());
  const [receiptSvc] = useState(() => receipts ?? getPrintService());
  const [relayApi] = useState(() => relay ?? createScanRelay());
  const [tab, setTab] = useState<Tab>(remote ? "send" : "ship");
  const target = useRef<((code: string) => void) | undefined>(undefined);
  const register = useCallback((h: ((code: string) => void) | undefined) => {
    target.current = h;
  }, []);
  const [note, setNote] = useState<{ text: string; error: boolean }>();

  const tabs: Tab[] = remote
    ? ["send", "ship", "count", "stock", "analysis", "history", "guide"]
    : ["stock", "receive", "ship", "count", "analysis", "history", "guide"];

  const explain = useCallback(
    (e: unknown): string => {
      const [code, arg] = errorParts(e);
      const msg = w.errors[code as keyof typeof w.errors];
      return msg ? (arg ? `${msg} (${arg})` : msg) : w.errors.GENERIC;
    },
    [w],
  );
  const say = (text: string, error = false) => setNote({ text, error });

  // Computer: codes scanned on a phone arrive here and go to the open scan screen.
  useEffect(() => {
    if (remote) return;
    let off = () => {};
    let alive = true;
    void relayApi
      .listen((code) => {
        if (target.current) target.current(code);
        else setNote({ text: w.relay.noTarget.replace("{code}", code), error: true });
      })
      .then((u) => (alive ? (off = u) : u()));
    return () => {
      alive = false;
      off();
    };
  }, [relayApi, remote, w]);

  return (
    <div className="page page--no-inspector wh">
      <div className="segmented" role="group" aria-label={w.title}>
        {tabs.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => {
              setTab(id);
              setNote(undefined);
            }}
          >
            {w.tabs[id]}
          </button>
        ))}
      </div>
      {!api.available && <p className="note">{w.desktopOnly}</p>}
      {note && (
        <p
          className={`note${note.error ? " note--error" : ""}`}
          role={note.error ? "alert" : "status"}
        >
          {note.text}
        </p>
      )}
      {tab === "stock" && (
        <StockTab
          api={api}
          labelSvc={labelSvc}
          remote={remote}
          say={say}
          explain={explain}
          locale={locale}
        />
      )}
      {tab === "receive" && !remote && (
        <ReceiveTab api={api} labelSvc={labelSvc} say={say} explain={explain} />
      )}
      {tab === "ship" && (
        <ShipTab
          api={api}
          receiptSvc={receiptSvc}
          say={say}
          explain={explain}
          camera={camera}
          register={register}
        />
      )}
      {tab === "count" && (
        <CountTab api={api} say={say} explain={explain} camera={camera} register={register} />
      )}
      {tab === "history" && <HistoryTab api={api} explain={explain} say={say} locale={locale} />}
      {tab === "send" && remote && <SendTab relay={relayApi} camera={camera} />}
      {tab === "analysis" && <WarehouseAnalysis api={api} />}
      {tab === "guide" && <Guide />}
    </div>
  );
}

type Common = {
  api: WarehouseClient;
  say: (text: string, error?: boolean) => void;
  explain: (e: unknown) => string;
};

// ------------------------------------------------------------------ stock

function useLabelOptions(): [LabelOptions, (o: LabelOptions) => void] {
  const [o, set] = useState(loadLabelOptions);
  return [
    o,
    (next) => {
      set(next);
      saveLabelOptions(next);
    },
  ];
}

function StockTab({
  api,
  labelSvc,
  remote,
  say,
  explain,
  locale,
}: Common & { labelSvc: PrintService; remote: boolean; locale: string }) {
  const { t } = useI18n();
  const w = t.warehouse;
  const [status, setStatus] = useState<UnitStatus>("IN_STOCK");
  const [units, setUnits] = useState<Unit[]>([]);
  const [shelf, setShelf] = useState<Unit[]>([]);
  const [q, setQ] = useState("");
  const [where, setWhere] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!api.available) return;
    try {
      const [rows, onShelf] = await Promise.all([api.units(status), api.units("IN_STOCK")]);
      setUnits(rows);
      setShelf(onShelf);
    } catch (e) {
      say(explain(e), true);
    }
  }, [api, status, say, explain]);
  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => bySku(shelf), [shelf]);
  const costValue = shelf.reduce((n, u) => n + u.cost, 0);
  const priceValue = shelf.reduce((n, u) => n + u.price, 0);
  const needle = q.trim().toLowerCase();
  const shown = units
    .filter(
      (u) =>
        !needle ||
        u.code.toLowerCase().includes(needle) ||
        u.sku.toLowerCase().includes(needle) ||
        u.location.toLowerCase().includes(needle),
    )
    .slice(0, 200);

  const act = async (job: () => Promise<unknown>, ok?: string) => {
    try {
      await job();
      if (ok) say(ok);
      await load();
    } catch (e) {
      say(explain(e), true);
    }
  };
  const [labelOpts] = useLabelOptions();
  const printOne = async (u: Unit) => {
    let ok = true;
    for (const slip of labelRun([u], labelOpts)) {
      if (!(await labelSvc.print(slip))) {
        ok = false;
        break;
      }
    }
    say(ok ? w.printed : w.printFail, !ok);
  };

  return (
    <>
      <section className="box">
        <div className="fin__tiles">
          <div className="fin-tile">
            <span className="fin-tile__label">{w.stats.units}</span>
            <strong className="fin-tile__value">{shelf.length}</strong>
          </div>
          <div className="fin-tile">
            <span className="fin-tile__label">{w.stats.costValue}</span>
            <strong className="fin-tile__value">{money(costValue)}</strong>
          </div>
          <div className="fin-tile">
            <span className="fin-tile__label">{w.stats.priceValue}</span>
            <strong className="fin-tile__value">{money(priceValue)}</strong>
          </div>
        </div>
        {rows.length > 0 && (
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th scope="col">SKU</th>
                  <th scope="col">{w.cols.units}</th>
                  <th scope="col">{w.cols.price}</th>
                  <th scope="col">{w.cols.location}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.sku}>
                    <th scope="row">{r.sku}</th>
                    <td>{r.units}</td>
                    <td>
                      {r.minPrice === r.maxPrice
                        ? money(r.minPrice)
                        : `${money(r.minPrice)} – ${money(r.maxPrice)}`}
                    </td>
                    <td>{r.locations.join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="box">
        <div className="segmented" role="group" aria-label={w.cols.status}>
          {(["IN_STOCK", "SHIPPED", "VOID"] as const).map((s) => (
            <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>
              {w.status[s]}
            </button>
          ))}
        </div>
        <label className="field">
          {w.search}
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {shown.length === 0 ? (
          <p className="caption">{w.none}</p>
        ) : (
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th scope="col">{w.cols.code}</th>
                  <th scope="col">{w.cols.price}</th>
                  <th scope="col">{w.cols.location}</th>
                  <th scope="col">{status === "SHIPPED" ? w.cols.shipped : w.cols.received}</th>
                  {!remote && <th scope="col" />}
                </tr>
              </thead>
              <tbody>
                {shown.map((u) => (
                  <tr key={u.code}>
                    <th scope="row">{u.code}</th>
                    <td>{money(u.price)}</td>
                    <td>{u.location || "—"}</td>
                    <td>{whenOf(status === "SHIPPED" ? u.shippedAt : u.receivedAt, locale)}</td>
                    {!remote && (
                      <td className="nowrap">
                        {u.status === "IN_STOCK" ? (
                          <>
                            <input
                              className="input input--tiny"
                              aria-label={w.cols.location}
                              placeholder={w.cols.location}
                              value={where[u.code] ?? ""}
                              onChange={(e) =>
                                setWhere((p) => ({ ...p, [u.code]: e.target.value }))
                              }
                            />{" "}
                            <button
                              type="button"
                              className="btn"
                              onClick={() =>
                                void act(
                                  () => api.move(u.code, (where[u.code] ?? "").trim()),
                                  w.moved,
                                )
                              }
                            >
                              {w.move}
                            </button>{" "}
                            <button type="button" className="btn" onClick={() => void printOne(u)}>
                              {w.printLabel}
                            </button>{" "}
                            <button
                              type="button"
                              className="btn"
                              onClick={() => void act(() => api.void(u.code, "DAMAGED"), w.voided)}
                            >
                              {w.void}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn"
                            onClick={() => void act(() => api.restock(u.code, ""), w.restocked)}
                          >
                            {w.restock}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {units.length > 200 && <p className="caption">{w.truncated}</p>}
      </section>
    </>
  );
}

// ------------------------------------------------------------------ receive

function ReceiveTab({ api, labelSvc, say, explain }: Common & { labelSvc: PrintService }) {
  const { t } = useI18n();
  const w = t.warehouse;
  const { catalog } = useLiveSession();
  const [sku, setSku] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [location, setLocation] = useState("");
  const [supplier, setSupplier] = useState("");
  const [made, setMade] = useState<Unit[]>([]);
  const [busy, setBusy] = useState(false);
  const labelReady = labelSvc.available && isConfigured(loadLabelPrinter());
  const [labelOpts, setLabelOpts] = useLabelOptions();

  const pickSku = (value: string) => {
    setSku(value);
    const c = catalog.find((x) => x.sku === value);
    if (c?.price && !price) setPrice(String(c.price));
  };

  const printAll = async (units: readonly Unit[]) => {
    let failed = false;
    const slips = labelRun(units, labelOpts);
    for (const slip of slips) {
      if (!(await labelSvc.print(slip))) {
        failed = true;
        break;
      }
    }
    say(failed ? w.printFail : w.printedMany.replace("{n}", String(slips.length)), failed);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(qty);
    const p = Number(price);
    const c = Number(cost);
    if (!canEncode(sku) || !/^[A-Za-z0-9._-]{1,30}$/.test(sku)) return say(w.errors.BAD_SKU, true);
    if (!Number.isInteger(n) || n < 1 || n > 500) return say(w.errors.BAD_QTY, true);
    if (!Number.isInteger(p) || p < 0 || !Number.isInteger(c) || c < 0)
      return say(w.errors.BAD_PRICE, true);
    setBusy(true);
    try {
      const units = await api.receive({
        purchaseId: newId(),
        sku,
        qty: n,
        price: p,
        unitCost: c,
        location: location.trim(),
        supplier: supplier.trim(),
        at: today(),
      });
      setMade(units);
      say(w.received.replace("{n}", String(units.length)));
      if (labelReady) await printAll(units);
    } catch (err) {
      say(explain(err), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form className="box inv__form" onSubmit={(e) => void submit(e)} noValidate>
        <h2 className="section-title">{w.receiveTitle}</h2>
        <p className="caption">{w.receiveHelp}</p>
        <div className="inv__grid">
          <label className="field">
            SKU
            <input
              className="input"
              list="wh-skus"
              value={sku}
              onChange={(e) => pickSku(e.target.value.trim())}
              autoCapitalize="off"
            />
            <datalist id="wh-skus">
              {catalog.map((c) => (
                <option key={c.sku} value={c.sku}>
                  {c.name}
                </option>
              ))}
            </datalist>
          </label>
          <label className="field">
            {w.qty}
            <input
              className="input"
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </label>
          <label className="field">
            {w.sellPrice}
            <input
              className="input"
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
          <label className="field">
            {w.unitCost}
            <input
              className="input"
              inputMode="numeric"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </label>
          <label className="field">
            {w.cols.location}
            <input
              className="input"
              placeholder="A1"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </label>
          <label className="field">
            {w.supplier}
            <input
              className="input"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
            />
          </label>
        </div>
        <LabelOptionsPanel value={labelOpts} onChange={setLabelOpts} />
        {!labelReady && <p className="caption">{w.noLabelPrinter}</p>}
        <button type="submit" className="btn btn--primary" disabled={busy || !api.available}>
          {busy ? w.working : w.receiveGo}
        </button>
      </form>
      {made.length > 0 && (
        <section className="box">
          <h2 className="section-title">{w.newCodes}</h2>
          <p className="caption">{made.map((u) => u.code).join(", ")}</p>
          <button
            type="button"
            className="btn"
            disabled={!labelReady}
            onClick={() => void printAll(made)}
          >
            {w.printAgain}
          </button>
        </section>
      )}
    </>
  );
}

// ------------------------------------------------------------------ phone: send scans to the computer

function SendTab({
  relay,
  camera,
}: {
  relay: ScanRelay;
  camera?: (onScan: (code: string) => void) => React.ReactNode;
}) {
  const { t } = useI18n();
  const r = t.warehouse.relay;
  const [sent, setSent] = useState<{ code: string; ok: boolean }[]>([]);
  const send = async (code: string) => {
    let ok = true;
    try {
      await relay.push(code);
    } catch {
      ok = false;
    }
    setSent((prev) => [{ code, ok }, ...prev].slice(0, 20));
  };
  return (
    <section className="box">
      <h2 className="section-title">{r.title}</h2>
      <p className="caption">{r.help}</p>
      <ScanBox
        onScan={(c) => void send(c)}
        placeholder={t.warehouse.scanHere}
        label={t.warehouse.scanHere}
        extra={camera?.((c) => void send(c))}
      />
      {sent.length > 0 && (
        <ul className="wh-list" aria-live="polite">
          {sent.map((x, i) => (
            <li key={`${x.code}-${i}`}>
              <span>{x.code}</span>
              <span>{x.ok ? r.sent : r.failed}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ ship (scan out)

function ShipTab({
  api,
  receiptSvc,
  say,
  explain,
  camera,
  register,
}: Common & {
  receiptSvc: PrintService;
  camera?: (onScan: (code: string) => void) => React.ReactNode;
  register: (h: ((code: string) => void) | undefined) => void;
}) {
  const { t } = useI18n();
  const w = t.warehouse;
  const [units, setUnits] = useState<Unit[]>([]);
  const [orderRef, setOrderRef] = useState("");
  const [printAfter, setPrintAfter] = useState(true);
  const [busy, setBusy] = useState(false);
  const total = units.reduce((n, u) => n + u.price, 0);
  const printerReady = receiptSvc.available && isConfigured(loadPrinter());

  const labelsOf = {
    title: w.receipt.title,
    total: w.receipt.total,
    items: w.receipt.items,
    currency: "NT$",
  };

  const scan = async (raw: string) => {
    const a = addScan(
      units.map((u) => u.code),
      raw,
    );
    if (!a.added) return say(w.alreadyScanned.replace("{code}", a.code), true);
    try {
      const u = await api.unit(a.code);
      if (!u) return say(`${w.errors.UNKNOWN} (${a.code})`, true);
      if (u.status !== "IN_STOCK") return say(`${w.errors.NOT_IN_STOCK} (${a.code})`, true);
      setUnits((prev) => [...prev, u]);
      say(`${u.sku} · ${money(u.price)}`);
    } catch (e) {
      say(explain(e), true);
    }
  };

  useEffect(() => {
    register((c) => void scan(c));
    return () => register(undefined);
  });

  const finish = async () => {
    if (units.length === 0) return;
    setBusy(true);
    try {
      const r = await api.ship(
        units.map((u) => u.code),
        orderRef.trim(),
        false,
      );
      if (printAfter && printerReady) await receiptSvc.print(shipReceipt(r.units, labelsOf));
      say(w.shipped.replace("{n}", String(r.units.length)).replace("{total}", money(r.total)));
      setUnits([]);
      setOrderRef("");
    } catch (e) {
      say(explain(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="box">
        <h2 className="section-title">{w.shipTitle}</h2>
        <p className="caption">{w.shipHelp}</p>
        <ScanBox
          onScan={(c) => void scan(c)}
          placeholder={w.scanHere}
          label={w.scanHere}
          extra={camera?.((c) => void scan(c))}
        />
      </section>
      <section className="box">
        {units.length === 0 ? (
          <p className="caption">{w.listEmpty}</p>
        ) : (
          <>
            <ul className="wh-list">
              {units.map((u) => (
                <li key={u.code}>
                  <span>
                    <strong>{u.sku}</strong> <span className="muted">{u.code}</span>
                  </span>
                  <span>{money(u.price)}</span>
                  <button
                    type="button"
                    className="btn"
                    aria-label={`${w.remove} ${u.code}`}
                    onClick={() => setUnits((p) => p.filter((x) => x.code !== u.code))}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <div className="wh-total">
              <span>
                {w.receipt.items}: {units.length}
              </span>
              <strong>{money(total)}</strong>
            </div>
            <label className="field">
              {w.orderRef}
              <input
                className="input"
                value={orderRef}
                maxLength={60}
                onChange={(e) => setOrderRef(e.target.value)}
              />
            </label>
            {printerReady && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={printAfter}
                  onChange={(e) => setPrintAfter(e.target.checked)}
                />
                {w.printReceipt}
              </label>
            )}
            <div className="actions">
              <button type="button" className="btn" onClick={() => setUnits([])}>
                {w.clear}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={() => void finish()}
              >
                {busy ? w.working : w.shipGo}
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}

// ------------------------------------------------------------------ count

function CountTab({
  api,
  say,
  explain,
  camera,
  register,
}: Common & {
  camera?: (onScan: (code: string) => void) => React.ReactNode;
  register: (h: ((code: string) => void) | undefined) => void;
}) {
  const { t } = useI18n();
  const w = t.warehouse;
  const [location, setLocation] = useState("");
  const [scanned, setScanned] = useState<string[]>([]);
  const [shelf, setShelf] = useState<Unit[]>([]);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!api.available) return;
    api
      .units("IN_STOCK")
      .then(setShelf)
      .catch((e) => say(explain(e), true));
  }, [api, say, explain]);

  const known = useMemo(() => new Map(shelf.map((u) => [u.code, u])), [shelf]);
  const seen = useMemo(() => new Set(scanned), [scanned]);
  const missing = expectedMissing(shelf, seen, location.trim());
  const strangers = scanned.filter((c) => !known.has(c));
  const inScope = shelf.filter((u) => !location.trim() || u.location === location.trim()).length;

  const scan = (raw: string) => {
    const a = addScan(scanned, raw);
    if (!a.added) return say(w.alreadyScanned.replace("{code}", a.code), true);
    setScanned(a.list);
    say(known.has(a.code) ? `✓ ${a.code}` : `${w.errors.UNKNOWN} (${a.code})`, !known.has(a.code));
  };

  useEffect(() => {
    register(scan);
    return () => register(undefined);
  });

  const apply = async () => {
    setConfirm(false);
    try {
      const r = await api.countApply(location.trim(), scanned);
      say(w.counted.replace("{n}", String(r.missing.length)));
      setScanned([]);
      setShelf(await api.units("IN_STOCK"));
    } catch (e) {
      say(explain(e), true);
    }
  };

  return (
    <>
      <section className="box">
        <h2 className="section-title">{w.countTitle}</h2>
        <p className="caption">{w.countHelp}</p>
        <label className="field">
          {w.countShelf}
          <input
            className="input"
            placeholder="A1"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
        <ScanBox onScan={scan} placeholder={w.scanHere} label={w.scanHere} extra={camera?.(scan)} />
      </section>
      <section className="box">
        <div className="fin__tiles">
          <div className="fin-tile">
            <span className="fin-tile__label">{w.countScanned}</span>
            <strong className="fin-tile__value">
              {scanned.length - strangers.length} / {inScope}
            </strong>
          </div>
          <div className="fin-tile">
            <span className="fin-tile__label">{w.countMissing}</span>
            <strong className={`fin-tile__value${missing.length ? " is-neg" : ""}`}>
              {missing.length}
            </strong>
          </div>
          <div className="fin-tile">
            <span className="fin-tile__label">{w.countStrange}</span>
            <strong className="fin-tile__value">{strangers.length}</strong>
          </div>
        </div>
        {strangers.length > 0 && (
          <p className="caption">
            {w.countStrange}: {strangers.join(", ")}
          </p>
        )}
        {missing.length > 0 && scanned.length > 0 && (
          <p className="caption">
            {w.countMissing}:{" "}
            {missing
              .slice(0, 30)
              .map((u) => u.code)
              .join(", ")}
            {missing.length > 30 ? " …" : ""}
          </p>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={() => setScanned([])}>
            {w.clear}
          </button>
          {confirm ? (
            <button type="button" className="btn btn--destructive" onClick={() => void apply()}>
              {w.countConfirm.replace("{n}", String(missing.length))}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              disabled={scanned.length === 0}
              onClick={() => setConfirm(true)}
            >
              {w.countFinish}
            </button>
          )}
        </div>
      </section>
    </>
  );
}

// ------------------------------------------------------------------ history

function HistoryTab({ api, explain, say, locale }: Common & { locale: string }) {
  const { t } = useI18n();
  const w = t.warehouse;
  const [rows, setRows] = useState<Move[]>([]);
  useEffect(() => {
    if (!api.available) return;
    api
      .moves(200)
      .then(setRows)
      .catch((e) => say(explain(e), true));
  }, [api, say, explain]);
  return (
    <section className="box">
      <h2 className="section-title">{w.tabs.history}</h2>
      {rows.length === 0 ? (
        <p className="caption">{w.none}</p>
      ) : (
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th scope="col">{w.cols.when}</th>
                <th scope="col">{w.cols.kind}</th>
                <th scope="col">{w.cols.code}</th>
                <th scope="col">{w.cols.location}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>{whenOf(m.at, locale)}</td>
                  <td>{w.kinds[m.kind]}</td>
                  <th scope="row">{m.code}</th>
                  <td>{m.location || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ guide

function Guide() {
  const { t } = useI18n();
  const g = t.warehouse.guide;
  return (
    <section className="box">
      <h2 className="section-title">{g.title}</h2>
      <ol className="wh-steps">
        {g.steps.map((s) => (
          <li key={s.title}>
            <strong>{s.title}</strong>
            <span className="caption">{s.body}</span>
          </li>
        ))}
      </ol>
      <h3 className="subhead">{g.moreTitle}</h3>
      <ul className="wh-steps">
        {g.more.map((s) => (
          <li key={s.title}>
            <strong>{s.title}</strong>
            <span className="caption">{s.body}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
