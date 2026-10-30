import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import {
  CARRIERS,
  SECRET_FIELDS,
  slotFor,
  statusOf,
  type Carrier,
  type CarrierField,
} from "../carriers/registry";
import { useI18n } from "../i18n";
import { createSecretsClient, type SecretsClient } from "../secrets/client";

// Shipping carriers in Taiwan and the credentials each one needs. Secrets go to the OS keychain
// through the same path as the AI keys: they can be set and removed, never read back. The tile
// shows the seller's own copy of the official logo when they add one; until then a neutral mark.

const LOGO_KEY = "live-studio.carrier-logos";
const MAX_LOGO_BYTES = 200_000;

const loadLogos = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(LOGO_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
};
const saveLogos = (m: Record<string, string>) => {
  try {
    localStorage.setItem(LOGO_KEY, JSON.stringify(m));
  } catch {
    /* too large or blocked: the logo applies until the page is closed */
  }
};

export function CarriersPage({ secrets }: { secrets?: SecretsClient }) {
  const { t, locale } = useI18n();
  const c = t.carriers;
  const [api] = useState(() => secrets ?? createSecretsClient());
  const [filled, setFilled] = useState<Record<string, Set<CarrierField>>>({});
  const [open, setOpen] = useState<string>();
  const [logos, setLogos] = useState(loadLogos);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    if (!api.available) return;
    const next: Record<string, Set<CarrierField>> = {};
    for (const car of CARRIERS) {
      const set = new Set<CarrierField>();
      for (const f of car.fields) {
        try {
          if (await api.exists(slotFor(car.id, f))) set.add(f);
        } catch {
          /* unreadable slot counts as empty */
        }
      }
      next[car.id] = set;
    }
    setFilled(next);
  }, [api]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onLogo = (id: string, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(file.type) || file.size > MAX_LOGO_BYTES) {
      return setError(c.logoBad);
    }
    setError(undefined);
    const reader = new FileReader();
    reader.onload = () => {
      const next = { ...logos, [id]: String(reader.result) };
      setLogos(next);
      saveLogos(next);
    };
    reader.readAsDataURL(file);
  };
  const clearLogo = (id: string) => {
    const next = { ...logos };
    delete next[id];
    setLogos(next);
    saveLogos(next);
  };

  return (
    <div className="page page--no-inspector">
      <section className="box">
        <h2 className="section-title">{c.title}</h2>
        <p className="caption">{c.help}</p>
        {!api.available && <p className="note">{c.desktopOnly}</p>}
        {error && (
          <p className="note note--error" role="alert">
            {error}
          </p>
        )}
      </section>
      <div className="carrier-grid">
        {CARRIERS.map((car) => {
          const status = statusOf(car, filled[car.id] ?? new Set());
          return (
            <article key={car.id} className="carrier">
              <div className="carrier__head">
                <Mark car={car} logo={logos[car.id]} />
                <div className="carrier__name">
                  <strong>{car.zh}</strong>
                  <span className="muted">{locale === "vi" ? car.vi : car.zh}</span>
                </div>
                <span
                  className={`chip ${
                    status === "saved"
                      ? "tone-green"
                      : status === "excel"
                        ? "tone-blue"
                        : status === "partial"
                          ? "tone-orange"
                          : "tone-gray"
                  }`}
                >
                  {c.status[status]}
                </span>
              </div>
              <div className="carrier__modes">
                {car.modes.map((m) => (
                  <span key={m} className="chip tone-gray">
                    {c.modes[m]}
                  </span>
                ))}
              </div>
              <p className="caption">{c.how[car.id as keyof typeof c.how]}</p>
              <div className="carrier__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={!api.available}
                  onClick={() => setOpen(open === car.id ? undefined : car.id)}
                >
                  {open === car.id ? c.close : c.connect}
                </button>
                <label className="btn">
                  {logos[car.id] ? c.logoChange : c.logoAdd}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                    className="sr-only"
                    onChange={(e) => onLogo(car.id, e)}
                  />
                </label>
                {logos[car.id] && (
                  <button type="button" className="btn" onClick={() => clearLogo(car.id)}>
                    {c.logoRemove}
                  </button>
                )}
              </div>
              {open === car.id && (
                <CredentialForm
                  car={car}
                  api={api}
                  filled={filled[car.id] ?? new Set()}
                  onChanged={() => void refresh()}
                />
              )}
            </article>
          );
        })}
      </div>
      <p className="caption">{c.note}</p>
    </div>
  );
}

function Mark({ car, logo }: { car: Carrier; logo?: string }) {
  if (logo) return <img className="carrier__logo" src={logo} alt={car.zh} />;
  return (
    <span className={`carrier__mark tone-${car.tone}`} aria-hidden="true">
      {car.mark}
    </span>
  );
}

function CredentialForm({
  car,
  api,
  filled,
  onChanged,
}: {
  car: Carrier;
  api: SecretsClient;
  filled: Set<CarrierField>;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const c = t.carriers;
  const [values, setValues] = useState<Partial<Record<CarrierField, string>>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean }>();

  const save = async () => {
    setBusy(true);
    setMsg(undefined);
    try {
      for (const f of car.fields) {
        const v = values[f]?.trim();
        if (v) await api.set(slotFor(car.id, f), v);
      }
      setValues({});
      setMsg({ text: c.saved, error: false });
      onChanged();
    } catch {
      setMsg({ text: c.saveFail, error: true });
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    setBusy(true);
    try {
      for (const f of car.fields) await api.remove(slotFor(car.id, f));
      setMsg({ text: c.removed, error: false });
      onChanged();
    } catch {
      setMsg({ text: c.saveFail, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="carrier__form">
      {car.fields.map((f) => (
        <label key={f} className="field">
          {c.fields[f]} {filled.has(f) && <span className="chip tone-green">{c.fieldSet}</span>}
          <input
            className="input"
            type={SECRET_FIELDS.has(f) ? "password" : "text"}
            autoComplete="off"
            spellCheck={false}
            placeholder={filled.has(f) ? c.replaceHint : ""}
            value={values[f] ?? ""}
            onChange={(e) => setValues((prev) => ({ ...prev, [f]: e.target.value }))}
          />
        </label>
      ))}
      <p className="caption">{c.secretNote}</p>
      {msg && (
        <p
          className={`note${msg.error ? " note--error" : ""}`}
          role={msg.error ? "alert" : "status"}
        >
          {msg.text}
        </p>
      )}
      <div className="carrier__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={() => void save()}
        >
          {c.save}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || filled.size === 0}
          onClick={() => void clear()}
        >
          {c.clear}
        </button>
      </div>
    </div>
  );
}
