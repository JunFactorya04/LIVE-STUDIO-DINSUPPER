import { useEffect, useId, useMemo, useRef, useState } from "react";
import { isSearchKey, searchShortcut } from "../components/shortcut";
import { EmptyState } from "../components/States";
import { useI18n } from "../i18n";
import { useLiveSession, useLiveStore } from "../live/useLiveSession";
import { parseCatalogCsv, splitList } from "../orders/catalogCsv";
import { canTransition } from "../orders/engine";
import { duplicateDraftIds } from "../orders/insights";
import { getPrintService } from "../print/service";
import { isConfigured, loadPrinter } from "../print/settings";
import { printTempSlip } from "../print/tempPrint";
import { usePrintStatus } from "../print/usePrint";
import type { CatalogItem, OrderStatus } from "../orders/types";

type Tab = "drafts" | "catalog";
type StatusFilter = "all" | OrderStatus;
const FILTERS: readonly StatusFilter[] = ["all", "DRAFT", "NEEDS_REVIEW", "CONFIRMED", "CANCELLED"];

const STATUS_TONE: Record<OrderStatus, string> = {
  DRAFT: "tone-blue",
  NEEDS_REVIEW: "tone-orange",
  CONFIRMED: "tone-green",
  CANCELLED: "tone-gray",
};

export function OrdersPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("drafts");
  return (
    <div className="page page--no-inspector orders">
      <section className="box orders__box">
        <p className="banner banner--info" role="note">
          {t.orders.notice}
        </p>
        <div className="segmented" role="group" aria-label={t.pages.orders.title}>
          {(["drafts", "catalog"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>
              {t.orders.tabs[k]}
            </button>
          ))}
        </div>
        {tab === "drafts" ? <DraftsTab /> : <CatalogTab />}
      </section>
    </div>
  );
}

function DraftsTab() {
  const { t } = useI18n();
  const store = useLiveStore();
  const s = useLiveSession();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const printer = getPrintService();
  const printStatus = usePrintStatus(printer);
  const printerReady = printer.available && isConfigured(loadPrinter());
  const searchRef = useRef<HTMLInputElement>(null);

  // Cmd/Ctrl+F focuses the search box, like on the Live console.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (isSearchKey(e)) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commentText = useMemo(
    () => new Map(s.comments.map((c) => [c.eventId, c.commentText])),
    [s.comments],
  );
  const dupes = useMemo(() => duplicateDraftIds(s.drafts), [s.drafts]);
  const names = useMemo(() => new Map(s.catalog.map((c) => [c.sku, c.name])), [s.catalog]);
  const rows = useMemo(
    () =>
      s.drafts
        .filter((d) => filter === "all" || d.status === filter)
        .filter((d) => {
          const q = query.trim().toLowerCase();
          if (!q) return true;
          return [d.username, d.sku, d.sku ? names.get(d.sku) : undefined, d.color, d.size].some(
            (v) => (v ?? "").toLowerCase().includes(q),
          );
        })
        .slice()
        .reverse(),
    [s.drafts, filter, query, names],
  );

  return (
    <>
      {s.catalog.length === 0 && (
        <p className="banner" role="status">
          {t.orders.noCatalogHint}
        </p>
      )}
      <div className="segmented" role="group" aria-label={t.orders.columns.status}>
        {FILTERS.map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {t.orders.filters[f]}
            {f !== "all" && ` ${s.drafts.filter((d) => d.status === f).length}`}
          </button>
        ))}
      </div>
      <input
        ref={searchRef}
        className="input"
        type="search"
        placeholder={t.orders.searchPlaceholder}
        aria-label={t.orders.searchPlaceholder}
        title={`${t.orders.searchPlaceholder} (${searchShortcut()})`}
        aria-keyshortcuts="Control+F Meta+F"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {printStatus.error && (
        <p className="banner banner--error" role="alert">
          {t.print.errors[printStatus.error]}
        </p>
      )}
      {s.drafts.length === 0 ? (
        <EmptyState title={t.orders.emptyTitle} hint={t.orders.emptyHint} />
      ) : rows.length === 0 ? (
        <EmptyState title={t.orders.noMatch} hint="" />
      ) : (
        <div className="feed-scroll">
          <table className="table orders-table" aria-label={t.orders.tabs.drafts}>
            <thead>
              <tr>
                <th scope="col">{t.orders.columns.user}</th>
                <th scope="col">{t.orders.columns.product}</th>
                <th scope="col">{t.orders.columns.variant}</th>
                <th scope="col">{t.orders.columns.qty}</th>
                <th scope="col">{t.orders.columns.confidence}</th>
                <th scope="col">{t.orders.columns.status}</th>
                <th scope="col">{t.orders.columns.reason}</th>
                <th scope="col">{t.orders.columns.comment}</th>
                <th scope="col">{t.orders.columns.actions}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const unknown = d.evidence.find((e) => e.field === "unknown_sku")?.text;
                const quotes = [...new Set(d.evidence.map((e) => e.eventId))]
                  .map((id) => commentText.get(id))
                  .filter(Boolean)
                  .join(" / ");
                return (
                  <tr key={d.id}>
                    <td className="cell-user nowrap" data-label={t.orders.columns.user}>
                      {d.username ?? t.common.none}
                    </td>
                    <td className="cell-product wrap" data-label={t.orders.columns.product}>
                      <span>
                        {d.sku ? (
                          <>
                            <strong>{d.sku}</strong>{" "}
                            <span className="muted">{names.get(d.sku)}</span>
                          </>
                        ) : (
                          <span className="muted">
                            {unknown ? unknown.toUpperCase() : t.orders.unknownProduct}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="nowrap" data-label={t.orders.columns.variant}>
                      {[d.color, d.size].filter(Boolean).join(" / ") || t.common.none}
                    </td>
                    <td className="num" data-label={t.orders.columns.qty}>
                      {d.quantity ?? t.common.none}
                    </td>
                    <td className="num" data-label={t.orders.columns.confidence}>
                      {Math.round(d.confidence * 100)}%
                    </td>
                    <td data-label={t.orders.columns.status}>
                      <span className={`chip ${STATUS_TONE[d.status]}`}>
                        {t.orders.status[d.status]}
                      </span>
                      {dupes.has(d.id) && (
                        <span className="chip tone-orange" title={t.orders.duplicateHint}>
                          {" "}
                          {t.orders.duplicate}
                        </span>
                      )}
                    </td>
                    <td className="wrap" data-label={t.orders.columns.reason}>
                      {d.reasons.length === 0
                        ? t.common.none
                        : d.reasons.map((r) => t.orders.reasons[r]).join("、")}
                    </td>
                    <td className="wrap muted" data-label={t.orders.columns.comment}>
                      {quotes || t.common.none}
                    </td>
                    <td className="cell-actions nowrap">
                      <button
                        type="button"
                        className="btn btn--primary"
                        disabled={!canTransition(d.status, "CONFIRMED")}
                        title={d.status === "NEEDS_REVIEW" ? t.orders.confirmBlocked : undefined}
                        onClick={() => store.setDraftStatus(d.id, "CONFIRMED")}
                      >
                        {t.orders.confirm}
                      </button>{" "}
                      {printerReady && (
                        <>
                          <button
                            type="button"
                            className="btn"
                            disabled={printStatus.printing}
                            onClick={() => void printTempSlip(d, s.comments, t.print.slip)}
                          >
                            {t.print.button}
                          </button>{" "}
                        </>
                      )}
                      <button
                        type="button"
                        className="btn"
                        disabled={!canTransition(d.status, "CANCELLED")}
                        onClick={() => store.setDraftStatus(d.id, "CANCELLED")}
                      >
                        {t.orders.cancelOrder}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const EMPTY_FORM = { sku: "", name: "", price: "", colors: "", sizes: "", aliases: "" };

function CatalogTab() {
  const { t, fmt } = useI18n();
  const store = useLiveStore();
  const { catalog } = useLiveSession();
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string>();
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<string>();
  const ids = {
    sku: useId(),
    name: useId(),
    price: useId(),
    colors: useId(),
    sizes: useId(),
    aliases: useId(),
    csv: useId(),
  };
  const c = t.orders.catalog;

  const save = () => {
    const sku = form.sku.trim();
    const name = form.name.trim();
    if (!sku || !name) return setError(c.skuRequired);
    const price = form.price.trim() === "" ? undefined : Number(form.price.replace(/[^\d.]/g, ""));
    if (price !== undefined && !Number.isFinite(price)) return setError(c.priceInvalid);
    store.saveCatalogItem({
      sku,
      name,
      price,
      colors: splitList(form.colors),
      sizes: splitList(form.sizes),
      aliases: splitList(form.aliases),
    });
    setForm(EMPTY_FORM);
    setError(undefined);
  };

  const edit = (item: CatalogItem) =>
    setForm({
      sku: item.sku,
      name: item.name,
      price: item.price?.toString() ?? "",
      colors: item.colors.join(";"),
      sizes: item.sizes.join(";"),
      aliases: item.aliases.join(";"),
    });

  const importCsv = () => {
    const { items, errors } = parseCatalogCsv(csv);
    if (items.length > 0) store.importCatalog(items);
    setResult(fmt(c.importResult, { n: items.length, bad: errors.length }));
    if (errors.length === 0) setCsv("");
  };

  const field = (key: keyof typeof EMPTY_FORM, label: string) => (
    <div className="field">
      <label htmlFor={ids[key]}>{label}</label>
      <input
        id={ids[key]}
        className="input"
        type="text"
        autoComplete="off"
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <>
      <p className="caption">{c.help}</p>
      <div className="catalog-form">
        {field("sku", c.sku)}
        {field("name", c.name)}
        {field("price", c.price)}
        {field("colors", c.colors)}
        {field("sizes", c.sizes)}
        {field("aliases", c.aliases)}
      </div>
      {error && (
        <p className="banner banner--error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="btn btn--primary" onClick={save}>
          {c.save}
        </button>
      </div>

      {catalog.length === 0 ? (
        <EmptyState title={c.emptyTitle} hint={c.emptyHint} />
      ) : (
        <div className="feed-scroll">
          <table className="table orders-table" aria-label={c.title}>
            <thead>
              <tr>
                <th scope="col">{c.sku}</th>
                <th scope="col">{c.name}</th>
                <th scope="col">{c.price}</th>
                <th scope="col">{c.colors}</th>
                <th scope="col">{c.sizes}</th>
                <th scope="col">{c.aliases}</th>
                <th scope="col">{t.orders.columns.actions}</th>
              </tr>
            </thead>
            <tbody>
              {catalog.map((item) => (
                <tr key={item.sku}>
                  <td data-label={c.sku}>
                    <strong>{item.sku}</strong>
                  </td>
                  <td className="wrap" data-label={c.name}>
                    {item.name}
                  </td>
                  <td className="num" data-label={c.price}>
                    {item.price ?? t.common.none}
                  </td>
                  <td className="wrap" data-label={c.colors}>
                    {item.colors.join("、") || t.common.none}
                  </td>
                  <td className="wrap" data-label={c.sizes}>
                    {item.sizes.join("、") || t.common.none}
                  </td>
                  <td className="wrap" data-label={c.aliases}>
                    {item.aliases.join("、") || t.common.none}
                  </td>
                  <td className="cell-actions nowrap">
                    <button
                      type="button"
                      className="btn"
                      aria-label={`${c.edit} ${item.sku}`}
                      onClick={() => edit(item)}
                    >
                      {c.edit}
                    </button>{" "}
                    <button
                      type="button"
                      className="btn"
                      aria-label={`${c.remove} ${item.sku}`}
                      onClick={() => store.deleteCatalogItem(item.sku)}
                    >
                      {c.remove}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="paste">
        <label htmlFor={ids.csv} className="paste__label">
          {c.importTitle}
        </label>
        <textarea
          id={ids.csv}
          className="input input--area"
          rows={4}
          spellCheck={false}
          placeholder={c.importPlaceholder}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
        />
        <p className="caption">{c.importHelp}</p>
        <div className="actions">
          <button type="button" className="btn" disabled={csv.trim() === ""} onClick={importCsv}>
            {c.importButton}
          </button>
        </div>
        {result && (
          <p className="caption" role="status">
            {result}
          </p>
        )}
      </div>
    </>
  );
}
