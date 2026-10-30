import { useEffect, useId, useState } from "react";
import { StatusChip } from "../components/StatusChip";
import { useI18n } from "../i18n";
import type { LiveSessionStore } from "../live/sessionStore";
import type { LiveProviderStatus } from "../live/types";
import { useLiveSession, useLiveStore } from "../live/useLiveSession";

const READY: readonly LiveProviderStatus[] = ["CONNECTED", "DEMO", "MANUAL"];
const FAILED: readonly LiveProviderStatus[] = ["UNAVAILABLE", "ERROR", "DISCONNECTED"];

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
  const { t } = useI18n();
  const store = useLiveStore();
  const s = useLiveSession();
  const [busy, setBusy] = useState(false);
  const ids = { title: useId(), user: useId() };

  const running = Boolean(s.startedAt && !s.endedAt);
  const connecting = busy || s.status === "CONNECTING";

  useEffect(() => {
    if (s.form.source !== "live") store.updateForm({ source: "live" });
  }, [s.form.source, store]);

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
    </div>
  );
}
