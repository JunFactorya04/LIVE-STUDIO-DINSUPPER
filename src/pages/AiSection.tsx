import { useId, useState } from "react";
import { AiError, createAiClient, type AiClient } from "../ai/client";
import {
  AI_PROVIDERS,
  DEFAULT_MODELS,
  loadAiConfig,
  saveAiConfig,
  type AiConfig,
  type AiProviderId,
} from "../ai/config";
import { useI18n } from "../i18n";

// Pick which AI service to use (the key is entered above) and check that it answers.

export function AiSection({ client }: { client?: AiClient }) {
  const { t } = useI18n();
  const [ai] = useState(() => client ?? createAiClient());
  const [config, setConfig] = useState<AiConfig>(loadAiConfig);
  const [note, setNote] = useState<{ text: string; error: boolean }>();
  const [busy, setBusy] = useState(false);
  const modelId = useId();
  const provider = config.provider;

  const update = (next: AiConfig) => {
    setConfig(next);
    saveAiConfig(next);
    setNote(undefined);
  };

  const test = async () => {
    if (!provider) return;
    setBusy(true);
    setNote(undefined);
    try {
      await ai.complete({
        provider,
        model: config.models[provider],
        system: "Reply with the single word OK.",
        prompt: "ping",
        maxTokens: 16,
      });
      setNote({ text: t.settings.ai.testOk, error: false });
    } catch (e) {
      const code = e instanceof AiError ? e.code : "NETWORK";
      setNote({ text: t.settings.ai.errors[code], error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="box">
      <h2 className="section-title">{t.settings.ai.title}</h2>
      <p className="caption">{t.settings.ai.help}</p>
      <div className="segmented" role="group" aria-label={t.settings.ai.title}>
        {AI_PROVIDERS.map((p: AiProviderId) => (
          <button
            key={p}
            type="button"
            aria-pressed={provider === p}
            onClick={() => update({ ...config, provider: p })}
          >
            {t.settings.apiSlots[p]}
          </button>
        ))}
      </div>
      {provider ? (
        <>
          <div className="field">
            <label htmlFor={modelId}>{t.settings.ai.model}</label>
            <input
              id={modelId}
              className="input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder={DEFAULT_MODELS[provider]}
              value={config.models[provider] ?? ""}
              onChange={(e) =>
                update({ ...config, models: { ...config.models, [provider]: e.target.value } })
              }
            />
            <span className="caption">{t.settings.ai.modelHelp}</span>
          </div>
          <div className="actions">
            <button
              type="button"
              className="btn"
              disabled={busy || !ai.available}
              onClick={() => void test()}
            >
              {busy ? t.settings.ai.testing : t.settings.ai.test}
            </button>
          </div>
          {!ai.available && <p className="note">{t.settings.apiBrowser}</p>}
        </>
      ) : (
        <p className="caption">{t.settings.ai.choose}</p>
      )}
      {note && (
        <p className="caption" role={note.error ? "alert" : "status"}>
          {note.text}
        </p>
      )}
    </section>
  );
}
