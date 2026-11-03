import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "../components/Toast";
import { Icon } from "../components/Icon";
import { isRemote } from "../platform/backend";
import { useI18n } from "../i18n";
import {
  createWarehouseClient,
  errorParts,
  type Unit,
  type WarehouseClient,
} from "../warehouse/client";
import { createScanRelay, type ScanRelay } from "../warehouse/relay";
import { ScanBox } from "../warehouse/ScanBox";
import { addScan } from "../warehouse/stats";
import { createSkuImageClient, type SkuImageClient } from "../warehouse/images";
import { SkuThumb } from "../warehouse/SkuPhoto";
import { getPrintService, type PrintService } from "../print/service";
import { isConfigured, loadPrinter } from "../print/settings";
import {
  createPosClient,
  PAYMENT_METHODS,
  type PaymentMethod,
  type PosClient,
  type PosSale,
} from "../pos/client";
import { nextReceiptNo } from "../pos/settings";
import { posReceipt } from "../pos/receipt";

// Standalone "Thanh Toán" (in-person checkout): a register screen on the computer, and a
// big scan-and-send screen on a phone opened from the sharing link — both talk through the same
// scan relay the warehouse tabs use. The sale ships through `wh_ship`, exactly like "Xuất kho",
// which is why its revenue already reaches the dashboard with nothing extra to wire (see
// ../warehouse/sales.ts); this page only owns how it was paid and the optional receipt number.

const money = (n: number) => `NT$ ${Math.round(n).toLocaleString("en-US")}`;
const newId = () => `pos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const whenOf = (iso: string, locale: string) =>
  new Date(iso).toLocaleString(locale === "vi" ? "vi-VN" : "zh-TW", {
    dateStyle: "short",
    timeStyle: "short",
  });

type Group = { sku: string; price: number; qty: number; codes: string[] };

function groupBySku(units: Unit[]): Group[] {
  const map = new Map<string, Group>();
  for (const u of units) {
    const g = map.get(u.sku);
    if (g) {
      g.qty += 1;
      g.codes.push(u.code);
    } else {
      map.set(u.sku, { sku: u.sku, price: u.price, qty: 1, codes: [u.code] });
    }
  }
  return [...map.values()];
}

export function PosPage({
  client,
  posClient,
  imagesClient,
  receipts,
  relay,
  camera,
}: {
  client?: WarehouseClient;
  posClient?: PosClient;
  imagesClient?: SkuImageClient;
  receipts?: PrintService;
  relay?: ScanRelay;
  camera?: (onScan: (code: string) => void) => React.ReactNode;
}) {
  const remote = isRemote();
  const [api] = useState(() => client ?? createWarehouseClient());
  const [posApi] = useState(() => posClient ?? createPosClient());
  const [imagesApi] = useState(() => imagesClient ?? createSkuImageClient());
  const [receiptSvc] = useState(() => receipts ?? getPrintService());
  const [relayApi] = useState(() => relay ?? createScanRelay());

  return (
    <div className="page page--no-inspector posui">
      {remote ? (
        <PosPhone relay={relayApi} posApi={posApi} camera={camera} />
      ) : (
        <PosDesktop
          api={api}
          posApi={posApi}
          imagesApi={imagesApi}
          receiptSvc={receiptSvc}
          relayApi={relayApi}
          camera={camera}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ desktop: the register

function PosDesktop({
  api,
  posApi,
  imagesApi,
  receiptSvc,
  relayApi,
  camera,
}: {
  api: WarehouseClient;
  posApi: PosClient;
  imagesApi: SkuImageClient;
  receiptSvc: PrintService;
  relayApi: ScanRelay;
  camera?: (onScan: (code: string) => void) => React.ReactNode;
}) {
  const { t, locale } = useI18n();
  const w = t.warehouse;
  const [saleId, setSaleId] = useState(newId);
  const [units, setUnits] = useState<Unit[]>([]);
  const [payment, setPayment] = useState<PaymentMethod>("CASH");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean }>();
  const [history, setHistory] = useState<PosSale[]>([]);
  const printerReady = receiptSvc.available && isConfigured(loadPrinter());
  const groups = useMemo(() => groupBySku(units), [units]);
  const total = units.reduce((n, u) => n + u.price, 0);

  // "Done" news goes to a toast; errors stay here, next to the scan box.
  const say = (text: string, error = false) => {
    if (!error && toast(text)) return setNote(undefined);
    setNote({ text, error });
  };
  const explain = useCallback(
    (e: unknown): string => {
      const [code, arg] = errorParts(e);
      const msg = w.errors[code as keyof typeof w.errors];
      return msg ? (arg ? `${msg} (${arg})` : msg) : w.errors.GENERIC;
    },
    [w],
  );

  const loadHistory = useCallback(() => {
    if (!posApi.available) return;
    posApi
      .list(12)
      .then(setHistory)
      .catch(() => undefined);
  }, [posApi]);
  useEffect(loadHistory, [loadHistory]);

  // Codes in the cart, kept in a ref as well: the phone relay listener below is subscribed once,
  // so reading `units` there would see the empty cart from the first render and let the same
  // label in twice. Codes are claimed here before the lookup so two quick scans cannot race.
  const inCart = useRef<string[]>([]);
  const scan = useCallback(
    async (raw: string) => {
      const a = addScan(inCart.current, raw);
      if (!a.added) return say(w.alreadyScanned.replace("{code}", a.code), true);
      inCart.current = [...inCart.current, a.code];
      const drop = () => (inCart.current = inCart.current.filter((c) => c !== a.code));
      try {
        const u = await api.unit(a.code);
        if (!u || u.status !== "IN_STOCK") {
          drop();
          const why = u ? w.errors.NOT_IN_STOCK : w.errors.UNKNOWN;
          return say(`${why} (${a.code})`, true);
        }
        setUnits((prev) => [...prev, u]);
      } catch (e) {
        drop();
        say(explain(e), true);
      }
    },
    [api, w, explain],
  );
  const scanRef = useRef(scan);
  scanRef.current = scan;

  // A phone on "Thanh Toán → Quét mã" pushes codes here over the local network.
  useEffect(() => {
    let off = () => {};
    let alive = true;
    void relayApi
      .listen((code) => void scanRef.current(code))
      .then((u) => (alive ? (off = u) : u()));
    return () => {
      alive = false;
      off();
    };
  }, [relayApi]);

  const removeGroup = (sku: string) =>
    setUnits((prev) => {
      const left = prev.filter((u) => u.sku !== sku);
      inCart.current = left.map((u) => u.code);
      return left;
    });
  const clear = () => {
    inCart.current = [];
    setUnits([]);
    setSaleId(newId());
  };

  const print = async () => {
    if (units.length === 0 || !printerReady) return;
    const receiptNo = nextReceiptNo();
    await receiptSvc.print(
      posReceipt(units, payment, receiptNo, {
        title: w.pos.receiptTitle,
        total: w.receipt.total,
        items: w.receipt.items,
        currency: "NT$",
        receiptNo: w.pos.receiptNo,
        payment: w.pos.payment,
        methods: w.pos.methods,
      }),
    );
  };

  const finish = useCallback(async () => {
    if (units.length === 0 || busy) return;
    setBusy(true);
    try {
      const r = await api.ship(
        units.map((u) => u.code),
        saleId,
        false,
      );
      const receiptNo = nextReceiptNo();
      try {
        await posApi.save({
          id: saleId,
          createdAt: new Date().toISOString(),
          total: r.total,
          paymentMethod: payment,
          receiptNo,
          note: "",
        });
      } catch {
        // the goods already shipped — that is what matters for stock and revenue.
      }
      if (printerReady)
        await receiptSvc.print(
          posReceipt(r.units, payment, receiptNo, {
            title: w.pos.receiptTitle,
            total: w.receipt.total,
            items: w.receipt.items,
            currency: "NT$",
            receiptNo: w.pos.receiptNo,
            payment: w.pos.payment,
            methods: w.pos.methods,
          }),
        );
      say(w.shipped.replace("{n}", String(r.units.length)).replace("{total}", money(r.total)));
      clear();
      loadHistory();
    } catch (e) {
      say(explain(e), true);
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, posApi, units, saleId, payment, printerReady, receiptSvc, w, explain, loadHistory]);

  // F8 confirms, F9 prints — the same shortcuts a register app trains a cashier to use blind.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F8") {
        e.preventDefault();
        void finish();
      } else if (e.key === "F9") {
        e.preventDefault();
        void print();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finish]);

  return (
    <>
      <div className="posui__panel">
        <header className="posui__head">
          <div>
            <h1 className="posui__title">{t.pages.pos.title}</h1>
            <p className="posui__subtitle">{w.pos.help}</p>
          </div>
          <span className={`posui__badge${units.length > 0 ? " posui__badge--ok" : ""}`}>
            {units.length > 0 ? (
              <>
                <Icon name="check" size={13} /> {w.pos.scanned}
              </>
            ) : (
              w.pos.idle
            )}
          </span>
        </header>

        <div className="posui__scanrow">
          <ScanBox
            onScan={(c) => void scan(c)}
            placeholder={w.scanHere}
            label={w.scanHere}
            extra={camera?.((c) => void scan(c))}
          />
        </div>

        {!api.available && <p className="posui__hint">{w.desktopOnly}</p>}
        {note && (
          <p
            className={`posui__hint${note.error ? " posui__hint--error" : ""}`}
            role={note.error ? "alert" : "status"}
          >
            {note.text}
          </p>
        )}

        {groups.length === 0 ? (
          <p className="posui__empty">{w.listEmpty}</p>
        ) : (
          <>
            <div className="posui__orderline">
              <span className="posui__orderid">#{saleId}</span>
              <span className="posui__status">{w.pos.pending}</span>
            </div>
            <ul className="posui__cart">
              {groups.map((g) => (
                <li key={g.sku} className="posui__item">
                  <SkuThumb sku={g.sku} images={imagesApi} size={48} />
                  <div className="posui__item-info">
                    <strong>{g.sku}</strong>
                    <span className="posui__item-qty">x{g.qty}</span>
                  </div>
                  <span className="posui__item-price">{money(g.price * g.qty)}</span>
                  <button
                    type="button"
                    className="posui__remove"
                    aria-label={`${w.remove} ${g.sku}`}
                    onClick={() => removeGroup(g.sku)}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </li>
              ))}
            </ul>

            <div className="posui__totals">
              <span>{w.receipt.items}</span>
              <span>{units.length}</span>
            </div>
            <div className="posui__grandtotal">
              <span>{w.pos.total}</span>
              <strong>{money(total)}</strong>
            </div>

            <div className="posui__segmented" role="group" aria-label={w.pos.payment}>
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={payment === m}
                  onClick={() => setPayment(m)}
                >
                  {w.pos.methods[m]}
                </button>
              ))}
            </div>

            <div className="posui__actions">
              <button
                type="button"
                className="posui__btn posui__btn--primary"
                disabled={busy}
                onClick={() => void finish()}
              >
                <Icon name="check" size={16} /> {busy ? w.working : w.pos.confirm} <kbd>F8</kbd>
              </button>
              <button
                type="button"
                className="posui__btn posui__btn--ghost"
                disabled={!printerReady}
                onClick={() => void print()}
              >
                {w.pos.printReceipt} <kbd>F9</kbd>
              </button>
              <button type="button" className="posui__btn posui__btn--text" onClick={clear}>
                {w.clear}
              </button>
            </div>
          </>
        )}
      </div>

      <aside className="posui__history">
        <h2 className="posui__history-title">{w.pos.tabHistory}</h2>
        {history.length === 0 ? (
          <p className="posui__empty">{w.pos.historyEmpty}</p>
        ) : (
          <ul className="posui__historylist">
            {history.map((s) => (
              <li key={s.id}>
                <span className="posui__history-when">{whenOf(s.createdAt, locale)}</span>
                <span className="posui__history-method">{w.pos.methods[s.paymentMethod]}</span>
                <strong>{money(s.total)}</strong>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </>
  );
}

// ------------------------------------------------------------------ phone: scan and send

function PosPhone({
  relay,
  posApi,
  camera,
}: {
  relay: ScanRelay;
  posApi: PosClient;
  camera?: (onScan: (code: string) => void) => React.ReactNode;
}) {
  const { t, locale } = useI18n();
  const w = t.warehouse;
  const [view, setView] = useState<"scan" | "history">("scan");
  const [sent, setSent] = useState<{ code: string; ok: boolean }[]>([]);
  const [history, setHistory] = useState<PosSale[]>([]);

  useEffect(() => {
    if (view !== "history" || !posApi.available) return;
    posApi
      .list(20)
      .then(setHistory)
      .catch(() => undefined);
  }, [view, posApi]);

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
    <div className="posui posui--phone">
      <header className="posui__phonehead">
        <h1>{t.pages.pos.title}</h1>
      </header>
      <div
        className="posui__segmented posui__segmented--wide"
        role="group"
        aria-label={t.pages.pos.title}
      >
        <button type="button" aria-pressed={view === "scan"} onClick={() => setView("scan")}>
          {w.pos.tabScan}
        </button>
        <button type="button" aria-pressed={view === "history"} onClick={() => setView("history")}>
          {w.pos.tabHistory}
        </button>
      </div>

      {view === "scan" ? (
        <>
          <p className="posui__hint">{w.pos.phoneHelp}</p>
          <div className="posui__bigscan">{camera?.((c) => void send(c))}</div>
          <ScanBox onScan={(c) => void send(c)} placeholder={w.scanHere} label={w.scanHere} />
          {sent.length > 0 && (
            <ul className="posui__sentlist" aria-live="polite">
              {sent.map((x, i) => (
                <li key={`${x.code}-${i}`}>
                  <span>{x.code}</span>
                  <span>{x.ok ? w.relay.sent : w.relay.failed}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : history.length === 0 ? (
        <p className="posui__empty">{w.pos.historyEmpty}</p>
      ) : (
        <ul className="posui__historylist">
          {history.map((s) => (
            <li key={s.id}>
              <span className="posui__history-when">{whenOf(s.createdAt, locale)}</span>
              <span className="posui__history-method">{w.pos.methods[s.paymentMethod]}</span>
              <strong>{money(s.total)}</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
