import { useEffect, useId, useMemo, useState } from "react";
import { EmptyState } from "../components/States";
import { StatusChip } from "../components/StatusChip";
import { useI18n } from "../i18n";
import type { LiveSessionStore } from "../live/sessionStore";
import type { LiveProviderStatus } from "../live/types";
import { useLiveSession, useLiveStore } from "../live/useLiveSession";
import { avatarTone } from "./ConsolePage";
import { ReplyCard } from "./ReplyCard";

const READY: readonly LiveProviderStatus[] = ["CONNECTED", "DEMO", "MANUAL"];
const FAILED: readonly LiveProviderStatus[] = ["UNAVAILABLE", "ERROR", "DISCONNECTED"];
const VIEWER_LIMIT = 60;

/** Resolves once the provider reaches a terminal status (ready to start, or failed/closed). */
function waitForOutcome(store: LiveSessionStore): Promise<boolean> {
  return new Promise((resolve) => {
    const check = () => {
      const { status } = store.getSnapshot();
      if (READY.includes(status)) {
        unsub();
        resolve(true);
      } else if (FAILED.includes(status)) {
        unsub();
        resolve(false);
      }
    };
    const unsub = store.subscribe(check);
    check();
  });
}

export function SetupPage({ onStarted }: { onStarted: () => void }) {
  const { t, formatTime } = useI18n();
  const store = useLiveStore();
  const s = useLiveSession();
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [now, setNow] = useState(() => Date.now());
  const ids = { title: useId(), user: useId() };

  const running = Boolean(s.startedAt && !s.endedAt);
  const connecting = busy || s.status === "CONNECTING";
  const noSource =
    s.comments.length === 0 && (s.status === "DISCONNECTED" || s.status === "UNAVAILABLE");
  // Newest first; only the latest VIEWER_LIMIT rows are put in the DOM.
  const rows = useMemo(() => s.comments.slice(-VIEWER_LIMIT).reverse(), [s.comments]);
  const selected = rows.find((c) => c.eventId === selectedId);

  useEffect(() => {
    if (s.form.source !== "live") store.updateForm({ source: "live" });
  }, [s.form.source, store]);

  // Ticks the "elapsed" stat below while the session is running; stops otherwise.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const elapsed = running && s.startedAt ? Math.max(0, now - new Date(s.startedAt).getTime()) : 0;
  const elapsedLabel = (() => {
    const total = Math.floor(elapsed / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
      : `${m}:${String(sec).padStart(2, "0")}`;
  })();

  const start = async () => {
    setBusy(true);
    try {
      const connected = (await store.connectSource()) && (await waitForOutcome(store));
      if (connected && store.startSession()) onStarted();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <section className="box" aria-labelledby={ids.title}>
        <h2 className="section-title" id={ids.title}>
          {t.setup.sourceTitle}
        </h2>

        <div className="field">
          <input
            id={ids.user}
            className="input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            aria-label={t.setup.username}
            placeholder={t.setup.usernamePlaceholder}
            value={s.form.username}
            disabled={running}
            onChange={(e) => store.updateForm({ username: e.target.value })}
          />
        </div>

        {s.issues.length > 0 && (
          <ul className="issues" role="alert">
            {s.issues.map((issue) => (
              <li key={issue}>{t.setup.issues[issue]}</li>
            ))}
          </ul>
        )}

        <label className="check">
          <input
            type="checkbox"
            checked={s.form.acknowledged}
            disabled={running}
            onChange={(e) => store.updateForm({ acknowledged: e.target.checked })}
          />
          <span>{t.setup.ack}</span>
        </label>

        <div className="actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void start()}
            disabled={running || connecting || !s.form.acknowledged}
          >
            {connecting ? t.setup.connecting : t.setup.start}
          </button>
          <span className="toolbar__spacer" />
          <button
            type="button"
            className="btn"
            onClick={() => void store.endSession()}
            disabled={!running}
          >
            {t.setup.endSession}
          </button>
        </div>
      </section>

      <aside className="inspector" aria-label={t.setup.statusTitle}>
        <h2 className="section-title">{t.setup.statusTitle}</h2>
        <StatusChip status={s.status} />
        {s.statusReason && (
          <p className="status-help" role="status">
            {t.statusReason[s.statusReason as keyof typeof t.statusReason] ?? t.statusReason.OTHER}
          </p>
        )}
        <dl className="kv">
          <dt>{t.setup.session}</dt>
          <dd className="mono">{s.providerType ? s.sessionId : t.common.none}</dd>
        </dl>
      </aside>

      <section className="box setup-chat" aria-label={t.setup.viewerTitle}>
        <h2 className="section-title">{t.setup.viewerTitle}</h2>
        {running && (
          <div className="setup-chat__stats" role="status">
            <span className="chip chip--inline tone-blue">
              {t.setup.liveStats.elapsed} · {elapsedLabel}
            </span>
            <span className="chip chip--inline tone-gray">
              {t.setup.liveStats.comments} · {s.comments.length}
            </span>
            <span className="chip chip--inline tone-gray">
              {t.setup.liveStats.drafts} · {s.drafts.length}
            </span>
          </div>
        )}
        {noSource ? (
          <EmptyState title={t.console.noSource} hint={t.console.noSourceHint} />
        ) : s.comments.length === 0 ? (
          <EmptyState title={t.console.emptyFeed} hint={t.console.emptyFeedHint} />
        ) : (
          <div className="setup-chat__body">
            <ul className="setup-chat__list" role="list">
              {rows.map((c) => (
                <li key={`${c.source}-${c.eventId}`}>
                  <button
                    type="button"
                    className={`setup-chat__row${c.eventId === selectedId ? " setup-chat__row--selected" : ""}`}
                    onClick={() => setSelectedId(c.eventId)}
                  >
                    <span className={`avatar tone-${avatarTone(c.username)}`} aria-hidden="true">
                      {(c.username ?? "?").replace(/^@/, "").slice(0, 1).toUpperCase()}
                    </span>
                    <span className="setup-chat__text">
                      <span className="setup-chat__user">{c.username ?? t.common.none}</span>
                      <span className="setup-chat__comment">{c.commentText}</span>
                    </span>
                    <span className="setup-chat__time num nowrap">
                      {formatTime(c.commentTimestamp)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="setup-chat__reply">
              {selected ? (
                <ReplyCard comment={selected} />
              ) : (
                <p className="muted">{t.insight.replyOff}</p>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
