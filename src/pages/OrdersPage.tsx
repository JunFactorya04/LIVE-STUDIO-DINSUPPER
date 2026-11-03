import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isSearchKey, searchShortcut } from "../components/shortcut";
import { EmptyState } from "../components/States";
import { useI18n } from "../i18n";
import { useLiveSession, useLiveStore } from "../live/useLiveSession";
import { canTransition } from "../orders/engine";
import { duplicateDraftIds } from "../orders/insights";
import { getPrintService } from "../print/service";
import { isConfigured, loadPrinter } from "../print/settings";
import { printTempSlip } from "../print/tempPrint";
import { usePrintStatus } from "../print/usePrint";
import { createShipClient, type FlowRecord } from "../ship/client";
import type { OrderStatus } from "../orders/types";

/** Lower-cased, no leading "@" — how `markFlow`/flow records key a buyer's TikTok id. */
const flowKey = (username?: string) => (username ?? "").toLowerCase().replace(/^@/, "");

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
  return (
    <div className="page page--no-inspector orders">
      <section className="box orders__box">
        <p className="banner banner--info" role="note">
          {t.orders.notice}
        </p>
        <DraftsTab />
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
  const [api] = useState(() => createShipClient());
  const [flow, setFlow] = useState<FlowRecord[]>([]);
  const refreshFlow = useCallback(() => {
    if (!api.available) return;
    void api.flow().then(setFlow, () => undefined);
  }, [api]);
  const [slipIds, setSlipIds] = useState<ReadonlySet<string>>(new Set());
  const refreshSlipIds = useCallback(() => {
    void store.printedSlipIds().then(
      (ids) => setSlipIds(new Set(ids)),
      () => undefined,
    );
  }, [store]);
  // The seller's printer runs AutoPrint in the background, outside this page; poll lightly so
  // "already printed" catches up without the seller having to reload the tab.
  useEffect(() => {
    refreshFlow();
    refreshSlipIds();
    const id = window.setInterval(() => {
      refreshFlow();
      refreshSlipIds();
    }, 4000);
    return () => window.clearInterval(id);
  }, [refreshFlow, refreshSlipIds]);
  const slipPrinted = useMemo(
    () => new Set(flow.filter((f) => f.slipPrintedAt).map((f) => f.tiktokId)),
    [flow],
  );
  const [slipView, setSlipView] = useState<{ id: string; src?: string } | undefined>();
  const openSlip = (id: string) => {
    setSlipView({ id });
    void store.slipImage(id).then(
      (src) => setSlipView({ id, src: src ?? "" }),
      () => setSlipView({ id, src: "" }),
    );
  };

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
                          {slipPrinted.has(flowKey(d.username)) && (
                            <span className="chip tone-green chip--inline">
                              {t.orders.slipPrinted}
                            </span>
                          )}{" "}
                          <button
                            type="button"
                            className="btn"
                            disabled={printStatus.printing}
                            onClick={() =>
                              void printTempSlip(d, s.comments, t.print.slip, {
                                drafts: s.drafts,
                              }).then(refreshFlow)
                            }
                          >
                            {slipPrinted.has(flowKey(d.username))
                              ? t.print.reprint
                              : t.print.button}
                          </button>{" "}
                        </>
                      )}
                      {slipIds.has(d.id) && (
                        <button type="button" className="btn" onClick={() => openSlip(d.id)}>
                          {t.orders.viewSlip}
                        </button>
                      )}{" "}
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
      {slipView && (
        <div
          className="slip-modal"
          role="dialog"
          aria-modal="true"
          aria-label={t.orders.slipModalTitle}
        >
          <div className="slip-modal__box box">
            <h3 className="section-title">{t.orders.slipModalTitle}</h3>
            {slipView.src === undefined ? (
              <p className="caption">{t.common.loading}</p>
            ) : slipView.src === "" ? (
              <p className="caption">{t.orders.slipLoadError}</p>
            ) : (
              <img className="slip-modal__img" src={slipView.src} alt={t.orders.slipModalTitle} />
            )}
            <button type="button" className="btn" onClick={() => setSlipView(undefined)}>
              {t.common.close}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
