import { useCallback, useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { useI18n } from "../i18n";
import { useLiveStore } from "../live/useLiveSession";
import {
  createReportClient,
  type AuditEntry,
  type ExportFormat,
  type ReportClient,
  type SessionSummary,
} from "../report/client";
import {
  loadRetentionDays,
  RETENTION_OPTIONS,
  saveRetentionDays,
  type RetentionDays,
} from "../report/retention";

type Note = { text: string; error: boolean } | undefined;

// Per-session report plus the data controls of the seller: export, retention, backup, delete,
// and a log of what was done (codes only, never comment text or keys).

export function ReportPage({ client }: { client?: ReportClient }) {
  const { t, fmt, locale } = useI18n();
  // A report needs the date as well as the time.
  const formatTime = (iso: string) =>
    new Date(iso).toLocaleString(locale === "vi" ? "vi-VN" : "zh-TW", {
      dateStyle: "short",
      timeStyle: "short",
    });
  const r = t.report;
  const store = useLiveStore();
  const [api] = useState(() => client ?? createReportClient());
  const [sessions, setSessions] = useState<SessionSummary[]>();
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState<Note>();
  const [retention, setRetention] = useState<RetentionDays>(loadRetentionDays);
  const [confirmId, setConfirmId] = useState<string>();
  const [confirmAll, setConfirmAll] = useState(false);
  const [wipeCatalog, setWipeCatalog] = useState(false);

  const load = useCallback(async () => {
    if (!api.available) return;
    setFailed(false);
    try {
      const [s, a] = await Promise.all([api.sessions(), api.audit(50)]);
      setSessions(s);
      setAudit(a);
    } catch {
      setFailed(true);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  // Run an action, show its result, then refresh the numbers and the log.
  const act = async (job: () => Promise<string>) => {
    setNote(undefined);
    try {
      setNote({ text: await job(), error: false });
    } catch {
      setNote({ text: r.failed, error: true });
    }
    await load();
  };

  const exportAs = (id: string, format: ExportFormat) =>
    act(async () => fmt(r.exported, { path: await api.exportSession(id, format) }));

  const deleteOne = (id: string) =>
    act(async () => {
      await api.deleteSession(id);
      if (store.getSnapshot().sessionId === id) await store.forgetSession();
      setConfirmId(undefined);
      return r.deleted;
    });

  const deleteAll = () =>
    act(async () => {
      const n = await api.deleteAll(wipeCatalog);
      await store.forgetSession({ catalog: wipeCatalog });
      setConfirmAll(false);
      return fmt(r.wiped, { n });
    });

  const purgeNow = () =>
    act(async () => {
      const n = await api.purgeOlder(retention);
      // The open session may have been removed.
      const still = (await api.sessions()).some((s) => s.id === store.getSnapshot().sessionId);
      if (n > 0 && !still) await store.forgetSession();
      return fmt(r.purged, { n });
    });

  const chooseRetention = (days: RetentionDays) => {
    setRetention(days);
    saveRetentionDays(days);
  };

  if (!api.available) {
    return (
      <div className="page page--no-inspector">
        <section className="box">
          <p className="banner banner--info" role="note">
            {r.desktopOnly}
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="page page--no-inspector orders">
      <section className="box orders__box">
        <p className="banner banner--info" role="note">
          {r.notice}
        </p>
        <h2 className="section-title">{r.sessionsTitle}</h2>
        {failed ? (
          <ErrorState onRetry={() => void load()} />
        ) : !sessions ? (
          <LoadingState />
        ) : sessions.length === 0 ? (
          <EmptyState title={r.emptyTitle} hint={r.emptyHint} />
        ) : (
          <table className="table orders-table" aria-label={r.sessionsTitle}>
            <thead>
              <tr>
                <th>{r.cols.when}</th>
                <th>{r.cols.source}</th>
                <th className="num">{r.cols.comments}</th>
                <th>{r.cols.orders}</th>
                <th>{r.cols.replies}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td data-label={r.cols.when}>{formatTime(s.createdAt)}</td>
                  <td data-label={r.cols.source}>
                    {(r.sources as Record<string, string>)[s.providerType] ?? s.providerType}
                    {s.username ? ` · ${s.username}` : ""}
                  </td>
                  <td className="num" data-label={r.cols.comments}>
                    {s.comments}
                  </td>
                  <td data-label={r.cols.orders}>
                    <span>
                      {fmt(r.ordersLine, {
                        confirmed: s.ordersConfirmed,
                        review: s.ordersNeedsReview,
                        draft: s.ordersDraft,
                        cancelled: s.ordersCancelled,
                      })}
                    </span>
                  </td>
                  <td data-label={r.cols.replies}>
                    {fmt(r.repliesLine, { copied: s.repliesCopied, total: s.replies })}
                  </td>
                  <td className="cell-actions">
                    {confirmId === s.id ? (
                      <div className="actions">
                        <p className="caption">{r.deleteConfirm}</p>
                        <button
                          type="button"
                          className="btn btn--destructive"
                          onClick={() => void deleteOne(s.id)}
                        >
                          {r.deleteYes}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setConfirmId(undefined)}
                        >
                          {r.cancel}
                        </button>
                      </div>
                    ) : (
                      <div className="actions">
                        <button
                          type="button"
                          className="btn"
                          onClick={() => void exportAs(s.id, "json")}
                        >
                          {r.exportJson}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => void exportAs(s.id, "orders_csv")}
                        >
                          {r.exportCsv}
                        </button>
                        <button type="button" className="btn" onClick={() => setConfirmId(s.id)}>
                          {r.delete}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {note && (
          <p className="caption" role={note.error ? "alert" : "status"}>
            {note.text}
          </p>
        )}
      </section>

      <section className="box">
        <h2 className="section-title">{r.storageTitle}</h2>
        <div className="segmented" role="group" aria-label={r.retention}>
          {RETENTION_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={retention === d}
              onClick={() => chooseRetention(d)}
            >
              {d === 0 ? r.forever : fmt(r.days, { n: d })}
            </button>
          ))}
        </div>
        <p className="caption">{r.retentionHelp}</p>
        <div className="actions">
          <button
            type="button"
            className="btn"
            disabled={retention === 0}
            onClick={() => void purgeNow()}
          >
            {r.purgeNow}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void act(async () => fmt(r.backedUp, { path: await api.backup() }))}
          >
            {r.backup}
          </button>
        </div>
        <p className="caption">{r.backupHelp}</p>
      </section>

      <section className="box">
        <h2 className="section-title">{r.wipeTitle}</h2>
        <p className="caption">{r.wipeHelp}</p>
        <label className="check">
          <input
            type="checkbox"
            checked={wipeCatalog}
            onChange={(e) => setWipeCatalog(e.target.checked)}
          />
          {r.wipeCatalog}
        </label>
        {confirmAll ? (
          <div className="actions">
            <p className="caption">{r.wipeConfirm}</p>
            <button type="button" className="btn btn--destructive" onClick={() => void deleteAll()}>
              {r.wipeYes}
            </button>
            <button type="button" className="btn" onClick={() => setConfirmAll(false)}>
              {r.cancel}
            </button>
          </div>
        ) : (
          <div className="actions">
            <button type="button" className="btn" onClick={() => setConfirmAll(true)}>
              {r.wipeAll}
            </button>
          </div>
        )}
      </section>

      <section className="box">
        <h2 className="section-title">{r.auditTitle}</h2>
        <p className="caption">{r.auditHelp}</p>
        {audit.length === 0 ? (
          <p className="caption">{r.auditEmpty}</p>
        ) : (
          <ul className="audit-list" aria-label={r.auditTitle}>
            {audit.map((a) => (
              <li key={a.id}>
                <span className="caption">{formatTime(a.at)}</span>
                <span>{(r.audit as Record<string, string>)[a.action] ?? a.action}</span>
                {a.detail && <span className="caption">{a.detail}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
