import { useEffect, useMemo, useState } from "react";
import { loadAiConfig } from "../ai/config";
import { confirmedBars, countAiErrors, todoItems, totals } from "../dashboard/metrics";
import { useI18n } from "../i18n";
import { useLiveSession } from "../live/useLiveSession";
import type { PageId } from "../navigation";
import { createReportClient, type ReportClient, type SessionSummary } from "../report/client";

// Overview for the seller: this session at a glance, what still needs doing, and how the
// stored sessions compare. Numbers come from the store (this session) and SQLite (history);
// without the desktop app there is no history and the page says so instead of inventing any.

export function DashboardPage({
  client,
  onNavigate,
}: {
  client?: ReportClient;
  onNavigate: (page: PageId) => void;
}) {
  const { t, fmt, locale } = useI18n();
  const d = t.dashboard;
  const s = useLiveSession();
  const [api] = useState(() => client ?? createReportClient());
  const [sessions, setSessions] = useState<SessionSummary[]>();
  const [aiErrors, setAiErrors] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!api.available) return;
    let alive = true;
    Promise.all([api.sessions(), api.audit(50)])
      .then(([list, audit]) => {
        if (!alive) return;
        setSessions(list);
        setAiErrors(countAiErrors(audit));
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [api]);

  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "vi" ? "vi-VN" : "zh-TW", {
      month: "numeric",
      day: "numeric",
    });

  const now = useMemo(() => {
    const needsReview = s.drafts.filter((x) => x.status === "NEEDS_REVIEW").length;
    return {
      comments: s.comments.length,
      needsReview,
      confirmed: s.drafts.filter((x) => x.status === "CONFIRMED").length,
      copied: s.replies.filter((x) => x.status === "COPIED").length,
      unclassified: s.comments.filter((c) => !c.intent).length,
    };
  }, [s.comments, s.drafts, s.replies]);

  const todo = todoItems({
    needsReview: now.needsReview,
    unclassified: now.unclassified,
    aiChosen: Boolean(loadAiConfig().provider),
    catalogEmpty: s.catalog.length === 0,
    noSource:
      s.comments.length === 0 && (s.status === "DISCONNECTED" || s.status === "UNAVAILABLE"),
    aiErrors,
  });

  const all = sessions ? totals(sessions) : undefined;
  const bars = sessions ? confirmedBars(sessions) : [];
  const max = Math.max(1, ...bars.map((b) => b.value));
  const recent = (sessions ?? []).slice(0, 5);

  const kpi = (label: string, value: number) => (
    <div className="kpi">
      <span className="kpi__label">{label}</span>
      <span className="kpi__value">{value}</span>
    </div>
  );

  return (
    <div className="page page--no-inspector orders">
      <section className="box">
        <h2 className="section-title">{d.currentTitle}</h2>
        <div className="kpi-grid">
          {kpi(d.kpi.comments, now.comments)}
          {kpi(d.kpi.review, now.needsReview)}
          {kpi(d.kpi.confirmed, now.confirmed)}
          {kpi(d.kpi.copied, now.copied)}
        </div>
      </section>

      <section className="box">
        <h2 className="section-title">{d.todoTitle}</h2>
        {todo.length === 0 ? (
          <p className="caption">{d.todoNone}</p>
        ) : (
          <ul className="todo-list" aria-label={d.todoTitle}>
            {todo.map((item) => (
              <li key={item.id}>
                <span>{fmt(d.todo[item.id], { n: item.count })}</span>
                <button type="button" className="btn" onClick={() => onNavigate(item.page)}>
                  {d.open}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="box">
        <h2 className="section-title">{d.allTitle}</h2>
        {!api.available ? (
          <p className="banner banner--info" role="note">
            {d.desktopOnly}
          </p>
        ) : failed ? (
          <p className="caption" role="alert">
            {d.failed}
          </p>
        ) : !all ? (
          <p className="caption">{t.common.loading}</p>
        ) : (
          <>
            <div className="kpi-grid">
              {kpi(d.kpi.sessions, all.sessions)}
              {kpi(d.kpi.comments, all.comments)}
              {kpi(d.kpi.confirmed, all.confirmed)}
              {kpi(d.kpi.cancelled, all.cancelled)}
            </div>
            <h3 className="subsection-title">{d.chartTitle}</h3>
            {bars.length === 0 ? (
              <p className="caption">{d.noSessions}</p>
            ) : (
              <ul className="bars" aria-label={d.chartTitle}>
                {bars.map((b) => (
                  <li key={b.id}>
                    <span className="bars__label">{day(b.createdAt)}</span>
                    <span className="bars__track" aria-hidden="true">
                      <span className="bars__fill" style={{ width: `${(b.value / max) * 100}%` }} />
                    </span>
                    <span className="bars__value">{b.value}</span>
                  </li>
                ))}
              </ul>
            )}
            {recent.length > 0 && (
              <>
                <h3 className="subsection-title">{d.recentTitle}</h3>
                <ul className="todo-list" aria-label={d.recentTitle}>
                  {recent.map((r) => (
                    <li key={r.id}>
                      <span>
                        {day(r.createdAt)} ·{" "}
                        {(t.report.sources as Record<string, string>)[r.providerType] ??
                          r.providerType}{" "}
                        · {fmt(d.recentLine, { c: r.comments, o: r.ordersConfirmed })}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="actions">
                  <button type="button" className="btn" onClick={() => onNavigate("report")}>
                    {d.viewReport}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
