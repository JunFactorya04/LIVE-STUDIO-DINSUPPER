import { hasTauri, invoke } from "../platform/backend";

// Telegram and WhatsApp settings (not secret: the tokens are in the keychain) and the live
// state of each connection, shared by the Settings cards and the bridge that runs them.

export type ChatChannel = "telegram" | "whatsapp";

export interface ChatSettings {
  telegram: { enabled: boolean; owner: string };
  whatsapp: { enabled: boolean; owner: string; phoneId: string; relay: string };
}

export type ChatRunState = "off" | "running" | "error" | "pairing";

export interface ChatLive {
  telegram: { state: ChatRunState; code?: string; pairCode?: string };
  whatsapp: { state: ChatRunState; code?: string };
}

const KEY = "live-studio.chat";
const empty = (): ChatSettings => ({
  telegram: { enabled: false, owner: "" },
  whatsapp: { enabled: false, owner: "", phoneId: "", relay: "" },
});

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function loadChat(): ChatSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<ChatSettings> | null;
    if (!raw || typeof raw !== "object") return empty();
    return {
      telegram: { enabled: raw.telegram?.enabled === true, owner: str(raw.telegram?.owner) },
      whatsapp: {
        enabled: raw.whatsapp?.enabled === true,
        owner: str(raw.whatsapp?.owner),
        phoneId: str(raw.whatsapp?.phoneId),
        relay: str(raw.whatsapp?.relay),
      },
    };
  } catch {
    return empty();
  }
}

// ---- one small store for settings + live state ----

let settings = loadChat();
let live: ChatLive = { telegram: { state: "off" }, whatsapp: { state: "off" } };
const listeners = new Set<() => void>();
let snap = { settings, live };
const emit = () => {
  snap = { settings, live };
  listeners.forEach((l) => l());
};

export const chatStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  getSnapshot: () => snap,
};

export function saveChat(next: ChatSettings) {
  settings = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // kept for this run only
  }
  emit();
}

export function setLive(channel: ChatChannel, patch: Partial<ChatLive[ChatChannel]>) {
  live = { ...live, [channel]: { ...live[channel], ...patch } };
  emit();
}

export const chatSettings = () => settings;

const pairCode = () => String(Math.floor(100000 + Math.random() * 900000));

/** Start listening on the bot; without a linked chat it waits for /start <code>. */
export async function startTelegram(): Promise<void> {
  if (!hasTauri()) return;
  const owner = settings.telegram.owner;
  const code = owner ? undefined : pairCode();
  try {
    await invoke("chat_telegram_start", { owner: owner || null, code: code ?? null });
    setLive("telegram", { state: owner ? "running" : "pairing", code: undefined, pairCode: code });
  } catch (e) {
    setLive("telegram", { state: "error", code: String(e), pairCode: undefined });
  }
}

export async function stopTelegram(): Promise<void> {
  if (hasTauri()) await invoke("chat_telegram_stop").catch(() => undefined);
  setLive("telegram", { state: "off", pairCode: undefined, code: undefined });
}

export async function startWhatsApp(): Promise<void> {
  if (!hasTauri()) return;
  const w = settings.whatsapp;
  if (!w.relay || !w.owner) {
    setLive("whatsapp", { state: "error", code: "SETUP" });
    return;
  }
  try {
    await invoke("chat_whatsapp_start", { relay: w.relay, owner: w.owner });
    setLive("whatsapp", { state: "running", code: undefined });
  } catch (e) {
    setLive("whatsapp", { state: "error", code: String(e) });
  }
}

export async function stopWhatsApp(): Promise<void> {
  if (hasTauri()) await invoke("chat_whatsapp_stop").catch(() => undefined);
  setLive("whatsapp", { state: "off", code: undefined });
}

/** A message to the owner on one channel. */
export async function sendChat(channel: ChatChannel, text: string, to?: string): Promise<void> {
  const target = to ?? (channel === "telegram" ? settings.telegram.owner : settings.whatsapp.owner);
  await invoke("chat_send", {
    channel,
    to: target,
    text,
    phoneId: channel === "whatsapp" ? settings.whatsapp.phoneId : null,
  });
}
