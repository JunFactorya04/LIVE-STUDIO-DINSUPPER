import { useEffect } from "react";
import { useI18n } from "../i18n";
import { useLiveSession } from "../live/useLiveSession";
import { hasTauri } from "../platform/backend";
import { getTeam } from "../staff/sharedTeam";
import {
  chatSettings,
  saveChat,
  sendChat,
  setLive,
  startTelegram,
  startWhatsApp,
  type ChatChannel,
} from "./chat";

// Runs the owner's Telegram and WhatsApp links while the app is open (window hidden included):
// messages go to the AI team, the team's drafts come back to the same chat. Renders nothing.

interface Incoming {
  channel: ChatChannel;
  from: string;
  text: string;
}

export function ChatBridge() {
  const { t, locale } = useI18n();
  const s = useLiveSession();

  useEffect(() => {
    getTeam().configure({
      catalog: () => s.catalog,
      lang: () => locale,
      texts: () => t.staff.chat,
      send: (o, text) => sendChat(o.channel, text, o.to),
    });
  }, [s.catalog, locale, t]);

  useEffect(() => {
    if (!hasTauri()) return;
    let off: (() => void)[] = [];
    let alive = true;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const subs = await Promise.all([
        listen<Incoming>("chat://incoming", (e) => {
          const { channel, from, text } = e.payload;
          void getTeam().handleChat({ channel, to: from }, text);
        }),
        listen<{ channel: ChatChannel; chat: string }>("chat://paired", (e) => {
          if (e.payload.channel !== "telegram") return;
          const cur = chatSettings();
          saveChat({ ...cur, telegram: { ...cur.telegram, owner: e.payload.chat } });
          void startTelegram().then(() =>
            sendChat("telegram", t.staff.chat.paired + "\n\n" + t.staff.chat.help).catch(
              () => undefined,
            ),
          );
        }),
        listen<{ channel: ChatChannel; state: string; code?: string }>("chat://status", (e) => {
          const { channel, state, code } = e.payload;
          if (state === "error") setLive(channel, { state: "error", code });
          if (state === "running" && channel === "whatsapp") setLive(channel, { state: "running" });
        }),
      ]);
      if (alive) off = subs;
      else subs.forEach((u) => u());
      const cfg = chatSettings();
      if (cfg.telegram.enabled) await startTelegram();
      if (cfg.whatsapp.enabled) await startWhatsApp();
    })();
    return () => {
      alive = false;
      off.forEach((u) => u());
    };
    // Started once; the messages above read the latest texts through getTeam().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
