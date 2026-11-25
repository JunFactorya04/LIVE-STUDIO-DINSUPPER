import { useId, useState, useSyncExternalStore } from "react";
import {
  chatStore,
  saveChat,
  sendChat,
  startTelegram,
  startWhatsApp,
  stopTelegram,
  stopWhatsApp,
  type ChatSettings,
} from "../chat/chat";
import { useI18n } from "../i18n";
import { createSecretsClient, type SecretsClient } from "../secrets/client";
import { KeyRow } from "./ApiKeysSection";

// Settings cards for talking to the AI team from the owner's phone: Telegram (a bot of their
// own, linked to their chat with a code) and WhatsApp (Meta's Cloud API, plus a small relay on
// the internet that receives the messages). Tokens go to the keychain through KeyRow.

function useChat() {
  return useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot);
}

function errorText(t: ReturnType<typeof useI18n>["t"], code: string | undefined) {
  if (!code) return "";
  return (t.chatSetup.errors as Record<string, string>)[code] ?? code;
}

export function TelegramSection({ secrets }: { secrets?: SecretsClient }) {
  const { t, fmt } = useI18n();
  const c = t.chatSetup;
  const { settings, live } = useChat();
  const [client] = useState(() => secrets ?? createSecretsClient());
  const [note, setNote] = useState<{ text: string; error: boolean }>();
  const tg = settings.telegram;
  const on = tg.enabled;

  const set = (patch: Partial<ChatSettings["telegram"]>) =>
    saveChat({ ...settings, telegram: { ...tg, ...patch } });

  const toggle = async () => {
    setNote(undefined);
    if (on) {
      set({ enabled: false });
      await stopTelegram();
    } else {
      set({ enabled: true });
      await startTelegram();
    }
  };

  const test = async () => {
    try {
      await sendChat("telegram", c.testText);
      setNote({ text: c.testOk, error: false });
    } catch (e) {
      setNote({ text: errorText(t, String(e)), error: true });
    }
  };

  return (
    <section className="box chat-setup">
      <h2 className="section-title">{c.telegramTitle}</h2>
      <ol className="chat-setup__steps">
        <li>{c.tgStep1}</li>
        <li>{c.tgStep2}</li>
        <li>{c.tgStep3}</li>
      </ol>
      {client.available ? (
        <KeyRow slot="telegram" client={client} />
      ) : (
        <p className="note">{t.settings.apiBrowser}</p>
      )}
      <div className="actions">
        <button
          type="button"
          className={`btn${on ? "" : " btn--primary"}`}
          onClick={() => void toggle()}
        >
          {on ? c.turnOff : c.turnOn}
        </button>
        {tg.owner && (
          <>
            <button type="button" className="btn" disabled={!on} onClick={() => void test()}>
              {c.test}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                set({ owner: "" });
                if (on) void startTelegram();
              }}
            >
              {c.unlink}
            </button>
          </>
        )}
      </div>
      {on && live.telegram.state === "pairing" && live.telegram.pairCode && (
        <div className="chat-setup__pair" role="status">
          <span className="caption">{c.pairHelp}</span>
          <code className="chat-setup__code">/start {live.telegram.pairCode}</code>
        </div>
      )}
      {on && tg.owner && live.telegram.state !== "error" && (
        <p className="caption chat-setup__ok">{fmt(c.linked, { id: tg.owner })}</p>
      )}
      {live.telegram.state === "error" && (
        <p className="note note--error" role="alert">
          {errorText(t, live.telegram.code)}
        </p>
      )}
      {note && (
        <p className={`caption${note.error ? " note--error" : ""}`} role="status">
          {note.text}
        </p>
      )}
      <p className="caption">{c.commands}</p>
    </section>
  );
}

export function WhatsAppSection({ secrets }: { secrets?: SecretsClient }) {
  const { t } = useI18n();
  const c = t.chatSetup;
  const { settings, live } = useChat();
  const [client] = useState(() => secrets ?? createSecretsClient());
  const [note, setNote] = useState<{ text: string; error: boolean }>();
  const w = settings.whatsapp;
  const ownerId = useId();
  const phoneIdId = useId();
  const relayId = useId();

  const set = (patch: Partial<ChatSettings["whatsapp"]>) =>
    saveChat({ ...settings, whatsapp: { ...w, ...patch } });

  const toggle = async () => {
    setNote(undefined);
    if (w.enabled) {
      set({ enabled: false });
      await stopWhatsApp();
    } else {
      set({ enabled: true });
      await startWhatsApp();
    }
  };

  const test = async () => {
    try {
      await sendChat("whatsapp", c.testText);
      setNote({ text: c.testOk, error: false });
    } catch (e) {
      setNote({ text: errorText(t, String(e)), error: true });
    }
  };

  return (
    <section className="box chat-setup">
      <h2 className="section-title">{c.whatsappTitle}</h2>
      <p className="caption">{c.waIntro}</p>
      <ol className="chat-setup__steps">
        <li>{c.waStep1}</li>
        <li>{c.waStep2}</li>
        <li>{c.waStep3}</li>
      </ol>
      <div className="field">
        <label htmlFor={ownerId}>{c.waOwner}</label>
        <input
          id={ownerId}
          className="input"
          inputMode="tel"
          placeholder="886912345678"
          value={w.owner}
          onChange={(e) => set({ owner: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor={phoneIdId}>{c.waPhoneId}</label>
        <input
          id={phoneIdId}
          className="input"
          inputMode="numeric"
          value={w.phoneId}
          onChange={(e) => set({ phoneId: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor={relayId}>{c.waRelay}</label>
        <input
          id={relayId}
          className="input"
          type="url"
          placeholder="https://live-studio-relay.vercel.app"
          value={w.relay}
          onChange={(e) => set({ relay: e.target.value })}
        />
      </div>
      {client.available ? (
        <>
          <KeyRow slot="whatsapp" client={client} />
          <KeyRow slot="whatsapp-relay" client={client} />
        </>
      ) : (
        <p className="note">{t.settings.apiBrowser}</p>
      )}
      <div className="actions">
        <button
          type="button"
          className={`btn${w.enabled ? "" : " btn--primary"}`}
          onClick={() => void toggle()}
        >
          {w.enabled ? c.turnOff : c.turnOn}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!w.owner || !w.phoneId}
          onClick={() => void test()}
        >
          {c.test}
        </button>
      </div>
      {live.whatsapp.state === "error" && (
        <p className="note note--error" role="alert">
          {errorText(t, live.whatsapp.code)}
        </p>
      )}
      {note && (
        <p className={`caption${note.error ? " note--error" : ""}`} role="status">
          {note.text}
        </p>
      )}
      <p className="caption">{c.waWindow}</p>
      <p className="caption">{c.commands}</p>
    </section>
  );
}
