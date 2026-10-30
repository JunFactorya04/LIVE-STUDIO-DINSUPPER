import { useCallback, useEffect, useId, useState } from "react";
import { useI18n } from "../i18n";
import {
  SECRET_SLOTS,
  createSecretsClient,
  type SecretSlot,
  type SecretsClient,
} from "../secrets/client";

// The seller registers their own API keys here. A key is written to the OS keychain and never
// shown again: this UI only knows "set" or "not set".

function KeyRow({ slot, client }: { slot: SecretSlot; client: SecretsClient }) {
  const { t } = useI18n();
  const [isSet, setIsSet] = useState<boolean>();
  const [value, setValue] = useState("");
  const [note, setNote] = useState<{ text: string; error: boolean }>();
  const id = useId();

  const refresh = useCallback(() => {
    client.exists(slot).then(setIsSet, () => setIsSet(false));
  }, [client, slot]);
  useEffect(refresh, [refresh]);

  const run = async (job: () => Promise<void>, done: string) => {
    try {
      await job();
      setValue("");
      setNote({ text: done, error: false });
    } catch {
      setNote({ text: t.settings.apiError, error: true });
    }
    refresh();
  };

  return (
    <div className="field">
      <label htmlFor={id}>
        {t.settings.apiSlots[slot]}
        <span className={`chip ${isSet ? "tone-green" : "tone-gray"} chip--inline`}>
          {isSet ? t.settings.apiSet : t.settings.apiUnset}
        </span>
      </label>
      <div className="actions">
        <input
          id={id}
          className="input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={t.settings.apiKeyPlaceholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          type="button"
          className="btn btn--primary"
          disabled={value.trim() === ""}
          onClick={() => run(() => client.set(slot, value), t.settings.apiSaved)}
        >
          {isSet ? t.settings.apiReplace : t.settings.apiSave}
        </button>
        {isSet && (
          <button
            type="button"
            className="btn"
            onClick={() => run(() => client.remove(slot), t.settings.apiRemoved)}
          >
            {t.settings.apiRemove}
          </button>
        )}
      </div>
      {slot === "connector" && <span className="caption">{t.settings.apiConnectorHelp}</span>}
      {note && (
        <span className="caption" role={note.error ? "alert" : "status"}>
          {note.text}
        </span>
      )}
    </div>
  );
}

export function ApiKeysSection({ client }: { client?: SecretsClient }) {
  const { t } = useI18n();
  const [resolved] = useState(() => client ?? createSecretsClient());
  return (
    <section className="box">
      <h2 className="section-title">{t.settings.apiTitle}</h2>
      <p className="caption">{t.settings.apiHelp}</p>
      {resolved.available ? (
        SECRET_SLOTS.map((slot) => <KeyRow key={slot} slot={slot} client={resolved} />)
      ) : (
        <p className="note">{t.settings.apiBrowser}</p>
      )}
    </section>
  );
}
