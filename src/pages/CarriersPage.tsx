import { useCallback, useEffect, useState } from "react";
import { readStage, writeStage } from "../carriers/env";
import { CARRIER_LOGOS } from "../carriers/logos";
import {
  CARRIERS,
  SECRET_FIELDS,
  slotFor,
  statusOf,
  type Carrier,
  type CarrierField,
} from "../carriers/registry";
import { useI18n } from "../i18n";
import { invoke } from "../platform/backend";
import { createSecretsClient, type SecretsClient } from "../secrets/client";

// Shipping carriers in Taiwan and how each one is really reached. Keys and passwords go to the OS
// keychain (set and removed, never read back). Only ECPay has an API the app calls itself; the
// other carriers are used through their own sign-in pages, which the app opens in the browser.
// "Verified" is shown only after ECPay itself answered that the keys are good.

export interface EcpayCheck {
  accepted: boolean;
  message: string;
}

const defaultCheck = (stage: boolean) => invoke<EcpayCheck>("ecpay_check", { stage });
const defaultOpen = (url: string) => invoke<void>("open_carrier_page", { url });

export function CarriersPage({
  secrets,
  check = defaultCheck,
  openPage = defaultOpen,
}: {
  secrets?: SecretsClient;
  /** Asks ECPay whether the saved keys work; replaced in tests. */
  check?: (stage: boolean) => Promise<EcpayCheck>;
  /** Opens a carrier's own page in the system browser; replaced in tests. */
  openPage?: (url: string) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const c = t.carriers;
  const [api] = useState(() => secrets ?? createSecretsClient());
  const [filled, setFilled] = useState<Record<string, Set<CarrierField>>>({});
  const [open, setOpen] = useState<string>();
  const [stage, setStage] = useState(readStage);
  const [verified, setVerified] = useState<Record<string, EcpayCheck | "busy" | "error">>({});
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

  const setEnv = (value: boolean) => {
    setStage(value);
    setVerified({});
    writeStage(value);
  };

  const runCheck = async () => {
    setVerified((v) => ({ ...v, ecpay: "busy" }));
    try {
      const r = await check(stage);
      setVerified((v) => ({ ...v, ecpay: r }));
    } catch {
      setVerified((v) => ({ ...v, ecpay: "error" }));
    }
  };

  const go = async (url: string) => {
    try {
      await openPage(url);
      setError(undefined);
    } catch {
      setError(c.openFail);
    }
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
          const v = verified[car.id];
          const checked = v && typeof v === "object" ? v : undefined;
          const status = checked?.accepted
            ? "verified"
            : statusOf(car, filled[car.id] ?? new Set());
          return (
            <article key={car.id} className="carrier">
              <div className="carrier__head">
                <Mark car={car} />
                <div className="carrier__name">
                  <strong>{car.zh}</strong>
                  <span className="muted">{locale === "vi" ? car.vi : car.zh}</span>
                </div>
                <span
                  className={`chip ${
                    status === "verified" || status === "saved"
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

              {car.live && (
                <div className="carrier__env">
                  <div className="segmented" role="group" aria-label={c.envTitle}>
                    <button type="button" aria-pressed={stage} onClick={() => setEnv(true)}>
                      {c.envTest}
                    </button>
                    <button type="button" aria-pressed={!stage} onClick={() => setEnv(false)}>
                      {c.envLive}
                    </button>
                  </div>
                  <p className="caption">{stage ? c.envTestHelp : c.envLiveHelp}</p>
                  <button
                    type="button"
                    className="btn"
                    disabled={!api.available || v === "busy"}
                    onClick={() => void runCheck()}
                  >
                    {v === "busy" ? c.checking : c.check}
                  </button>
                  {checked && (
                    <p
                      className={`note${checked.accepted ? "" : " note--error"}`}
                      role={checked.accepted ? "status" : "alert"}
                    >
                      {checked.accepted ? c.checkOk : c.checkBad}
                      {checked.message && <code className="reply"> {checked.message}</code>}
                    </p>
                  )}
                  {v === "error" && (
                    <p className="note note--error" role="alert">
                      {c.checkNoNet}
                    </p>
                  )}
                </div>
              )}

              <div className="carrier__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={!api.available}
                  onClick={() => setOpen(open === car.id ? undefined : car.id)}
                >
                  {open === car.id ? c.close : c.connect}
                </button>
                <button type="button" className="btn" onClick={() => void go(car.consoleUrl)}>
                  {car.live ? c.openConsole : c.openLogin}
                </button>
                <button type="button" className="btn" onClick={() => void go(car.trackUrl)}>
                  {c.track}
                </button>
              </div>
              {open === car.id && (
                <CredentialForm
                  car={car}
                  api={api}
                  filled={filled[car.id] ?? new Set()}
                  onChanged={() => {
                    setVerified((x) => {
                      const next = { ...x };
                      delete next[car.id];
                      return next;
                    });
                    void refresh();
                  }}
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

function Mark({ car }: { car: Carrier }) {
  const logo = CARRIER_LOGOS[car.id];
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
      <p className="caption">{car.live ? c.secretNoteLive : c.secretNote}</p>
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
