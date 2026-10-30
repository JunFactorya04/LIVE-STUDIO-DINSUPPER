import { useId, useState } from "react";
import { StatusChip } from "../components/StatusChip";
import { useI18n } from "../i18n";
import type { SourceMode } from "../live/sessionStore";
import { useLiveSession, useLiveStore } from "../live/useLiveSession";

const SOURCES: readonly SourceMode[] = ["manual", "demo", "live"];

export function SetupPage({ onStarted }: { onStarted: () => void }) {
  const { t } = useI18n();
  const store = useLiveStore();
  const s = useLiveSession();
  const [busy, setBusy] = useState(false);
  const [studioHint, setStudioHint] = useState(false);
  const ids = { url: useId(), user: useId(), hint: useId(), mode: useId() };

  const running = Boolean(s.startedAt && !s.endedAt);
  const canStart = store.canStart();
  const connecting = busy || s.status === "CONNECTING";

  const connect = async () => {
    setBusy(true);
    try {
      await store.connectSource();
    } finally {
      setBusy(false);
    }
  };

  const start = () => {
    if (store.startSession()) onStarted();
  };

  const providerKey =
    s.providerType === "manual" || s.providerType === "demo" || s.providerType === "euler"
      ? s.providerType
      : "unset";

  return (
    <div className="page">
      <section className="box" aria-labelledby={ids.hint}>
        <h2 className="section-title" id={ids.hint}>
          {t.setup.sourceTitle}
        </h2>

        <div className="field">
          <label htmlFor={ids.url}>{t.setup.liveUrl}</label>
          <input
            id={ids.url}
            className="input"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder={t.setup.liveUrlPlaceholder}
            value={s.form.liveUrl}
            disabled={running}
            onChange={(e) => store.updateForm({ liveUrl: e.target.value })}
          />
          <span className="caption">{t.setup.liveUrlHelp}</span>
        </div>

        <div className="field">
          <label htmlFor={ids.user}>{t.setup.username}</label>
          <input
            id={ids.user}
            className="input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder={t.setup.usernamePlaceholder}
            value={s.form.username}
            disabled={running}
            onChange={(e) => store.updateForm({ username: e.target.value })}
          />
          {s.form.source === "live" && <span className="caption">{t.setup.atLeastOne}</span>}
        </div>

        {s.issues.length > 0 && (
          <ul className="issues" role="alert">
            {s.issues.map((issue) => (
              <li key={issue}>{t.setup.issues[issue]}</li>
            ))}
          </ul>
        )}

        <fieldset className="field field--group" disabled={running}>
          <legend>{t.setup.sourceMode}</legend>
          {SOURCES.map((mode) => (
            <label className="check" key={mode}>
              <input
                type="radio"
                name={ids.mode}
                value={mode}
                checked={s.form.source === mode}
                onChange={() => store.updateForm({ source: mode })}
              />
              <span>
                {t.setup.sources[mode]}
                <span className="caption block">{t.setup.sources[`${mode}Help`]}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {s.form.source === "live" && (
          <label className="check">
            <input
              type="checkbox"
              checked={s.form.acknowledged}
              disabled={running}
              onChange={(e) => store.updateForm({ acknowledged: e.target.checked })}
            />
            <span>{t.setup.ack}</span>
          </label>
        )}

        <div className="actions">
          <button
            type="button"
            className="btn"
            onClick={() => setStudioHint((v) => !v)}
            aria-expanded={studioHint}
          >
            {t.setup.openStudio}
          </button>
          <button type="button" className="btn" onClick={connect} disabled={running || connecting}>
            {connecting ? t.setup.connecting : t.setup.connect}
          </button>
          <span className="toolbar__spacer" />
          <button type="button" className="btn btn--primary" onClick={start} disabled={!canStart}>
            {t.setup.start}
          </button>
        </div>
        {studioHint && <p className="note">{t.setup.openStudioHelp}</p>}
        {!canStart && !running && <p className="caption">{t.setup.startHint}</p>}
      </section>

      <aside className="inspector" aria-label={t.setup.statusTitle}>
        <h2 className="section-title">{t.setup.statusTitle}</h2>
        <StatusChip status={s.status} />
        <p className="status-help">{t.statusHelp[s.status]}</p>
        {s.statusReason && (
          <p className="status-help" role="status">
            {t.statusReason[s.statusReason as keyof typeof t.statusReason] ?? t.statusReason.OTHER}
          </p>
        )}
        <dl className="kv">
          <dt>{t.setup.provider}</dt>
          <dd>{t.setup.providerValue[providerKey]}</dd>
          <dt>{t.setup.session}</dt>
          <dd className="mono">{s.providerType ? s.sessionId : t.common.none}</dd>
        </dl>
        {running && (
          <button type="button" className="btn" onClick={() => void store.endSession()}>
            {t.setup.endSession}
          </button>
        )}
      </aside>
    </div>
  );
}
