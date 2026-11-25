import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { chatStore, type ChatRunState } from "../chat/chat";
import { loadAiConfig } from "../ai/config";
import { isRemote } from "../platform/backend";
import { LOCALES, useI18n, type Locale } from "../i18n";
import { useLiveSession } from "../live/useLiveSession";
import type { PageId } from "../navigation";
import { getLabelService, getPrintService } from "../print/service";
import { isConfigured, loadLabelPrinter, loadPrinter } from "../print/settings";
import { usePrintStatus } from "../print/usePrint";
import { createShareClient } from "../share/client";
import { THEMES, loadTheme, saveTheme, type Theme } from "../theme/theme";
import { AiSection } from "./AiSection";
import { ApiKeysSection } from "./ApiKeysSection";
import {
  ConnGlyph,
  ConnectionsHub,
  CONN_ORDER,
  type ConnId,
  type ConnState,
} from "./ConnectionsHub";
import { TelegramSection, WhatsAppSection } from "./ChatSections";
import { InvoiceSection } from "./InvoiceSection";
import { LabelCalibSection } from "./LabelCalibSection";
import { PrinterSection } from "./PrinterSection";
import { ScannerSection } from "./ScannerSection";
import { ShareSection } from "./ShareSection";
import { StickerSection } from "./StickerSection";
import { WebOpenSection } from "./WebOpenSection";

// Settings as a map of what the app is connected to: the picture at the top shows the links
// (live ones carry moving dots), the cards below hold each connection's own settings. On a phone
// (sharing link) only the phone's own language and light/dark are here.

type Cat = "all" | "in" | "devices" | "services" | "general";
const CATS: Cat[] = ["all", "in", "devices", "services", "general"];
const CAT_OF: Record<ConnId, Exclude<Cat, "all">> = {
  tiktok: "in",
  telegram: "in",
  whatsapp: "in",
  phone: "in",
  scanner: "devices",
  printer: "devices",
  label: "devices",
  ai: "services",
  carriers: "services",
  web: "general",
};

const chatState = (enabled: boolean, run: ChatRunState): ConnState =>
  !enabled || run === "error" || run === "off" ? "off" : run === "running" ? "busy" : "on";

export function SettingsPage({ onNavigate }: { onNavigate?: (page: PageId) => void }) {
  const remote = isRemote();
  return remote ? <PhoneSettings /> : <ConnectedSettings onNavigate={onNavigate} />;
}

function LanguageAndTheme() {
  const { t, locale, setLocale } = useI18n();
  const locales = Object.keys(LOCALES) as Locale[];
  const [theme, setThemeState] = useState<Theme>(loadTheme);
  return (
    <>
      <section className="box">
        <h2 className="section-title">{t.settings.languageTitle}</h2>
        <div className="segmented" role="group" aria-label={t.settings.languageTitle}>
          {locales.map((code) => (
            <button
              key={code}
              type="button"
              aria-pressed={locale === code}
              onClick={() => setLocale(code)}
            >
              {t.settings.languages[code]}
            </button>
          ))}
        </div>
        <p className="caption">{t.settings.languageHelp}</p>
      </section>
      <section className="box">
        <h2 className="section-title">{t.settings.themeTitle}</h2>
        <div className="segmented" role="group" aria-label={t.settings.themeTitle}>
          {THEMES.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={theme === id}
              onClick={() => {
                setThemeState(id);
                saveTheme(id);
              }}
            >
              {t.settings.themes[id]}
            </button>
          ))}
        </div>
        <p className="caption">{t.settings.themeHelp}</p>
      </section>
    </>
  );
}

function PhoneSettings() {
  const { t } = useI18n();
  return (
    <div className="page page--no-inspector">
      <LanguageAndTheme />
      <p className="caption">{t.settings.phoneOnly}</p>
    </div>
  );
}

function ConnectedSettings({ onNavigate }: { onNavigate?: (page: PageId) => void }) {
  const { t } = useI18n();
  const h = t.settingsHub;
  const s = useLiveSession();
  const receipt = usePrintStatus(getPrintService());
  const label = usePrintStatus(getLabelService());
  const [sharing, setSharing] = useState(false);
  const chat = useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot);
  const [cat, setCat] = useState<Cat>("all");
  const [open, setOpen] = useState<ReadonlySet<ConnId | "general">>(new Set());

  useEffect(() => {
    const share = createShareClient();
    if (!share.available) return;
    let live = true;
    const read = () =>
      void share.status().then(
        (st) => live && setSharing(st.running),
        () => undefined,
      );
    read();
    const timer = window.setInterval(read, 15_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);

  const printerState = (configured: boolean, st: typeof receipt): ConnState =>
    !configured || st.error ? "off" : st.printing ? "busy" : "on";
  const states: Record<ConnId, ConnState> = {
    tiktok: s.status === "CONNECTED" || s.status === "DEMO" ? "busy" : "off",
    telegram: chatState(chat.settings.telegram.enabled, chat.live.telegram.state),
    whatsapp: chatState(chat.settings.whatsapp.enabled, chat.live.whatsapp.state),
    phone: sharing ? "busy" : "off",
    scanner: "on",
    ai: loadAiConfig().provider ? "on" : "off",
    printer: printerState(isConfigured(loadPrinter()), receipt),
    label: printerState(isConfigured(loadLabelPrinter()), label),
    carriers: "on",
    web: "on",
  };

  const toggle = (id: ConnId | "general", force?: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (force ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });

  const reveal = (id: ConnId) => {
    setCat("all");
    toggle(id, true);
    window.requestAnimationFrame(() =>
      document
        .getElementById(`conn-${id}`)
        ?.scrollIntoView?.({ behavior: "smooth", block: "start" }),
    );
  };

  const body: Record<ConnId, ReactNode> = {
    tiktok: (
      <div className="conn-card__simple">
        <p className="caption">{h.tiktokBody}</p>
        {onNavigate && (
          <button type="button" className="btn" onClick={() => onNavigate("setup")}>
            {h.openSetup}
          </button>
        )}
      </div>
    ),
    telegram: <TelegramSection />,
    whatsapp: <WhatsAppSection />,
    phone: <ShareSection />,
    scanner: <ScannerSection />,
    ai: (
      <>
        <AiSection />
        <ApiKeysSection />
      </>
    ),
    printer: (
      <>
        <PrinterSection />
        <StickerSection />
        <InvoiceSection />
      </>
    ),
    label: (
      <>
        <PrinterSection kind="label" />
        <LabelCalibSection />
      </>
    ),
    carriers: (
      <div className="conn-card__simple">
        <p className="caption">{h.carriersBody}</p>
        {onNavigate && (
          <button type="button" className="btn" onClick={() => onNavigate("carriers")}>
            {h.openCarriers}
          </button>
        )}
      </div>
    ),
    web: <WebOpenSection />,
  };

  const shown = CONN_ORDER.filter((id) => cat === "all" || CAT_OF[id] === cat);

  return (
    <div className="page page--no-inspector settings-hub">
      <header className="settings-hub__head">
        <h2 className="settings-hub__title">{h.title}</h2>
        <p className="muted">{h.help}</p>
      </header>

      <ConnectionsHub
        states={states}
        labels={h.names}
        stateLabels={h.states}
        appName="LIVE STUDIO"
        onOpen={reveal}
      />

      <div className="settings-hub__cats" role="tablist" aria-label={h.title}>
        {CATS.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={cat === c}
            className={`settings-hub__cat${cat === c ? " is-on" : ""}`}
            onClick={() => setCat(c)}
          >
            {h.cats[c]}
          </button>
        ))}
      </div>
      <p className="caption settings-hub__cat-help">{h.catHelp[cat]}</p>

      <div className="settings-hub__cards">
        {(cat === "all" || cat === "general") && (
          <article className="conn-card" id="conn-general">
            <button
              type="button"
              className="conn-card__head"
              aria-expanded={open.has("general")}
              onClick={() => toggle("general")}
            >
              <span className="conn-card__icon conn-card__icon--general">
                <svg
                  width={20}
                  height={20}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4 12h2M18 12h2M12 4v2M12 18v2" />
                </svg>
              </span>
              <span className="conn-card__text">
                <strong>{h.general}</strong>
                <span className="caption">{h.generalDesc}</span>
              </span>
            </button>
            {open.has("general") && (
              <div className="conn-card__body">
                <LanguageAndTheme />
              </div>
            )}
          </article>
        )}
        {shown.map((id) => (
          <article key={id} className={`conn-card is-${states[id]}`} id={`conn-${id}`}>
            <button
              type="button"
              className="conn-card__head"
              aria-expanded={open.has(id)}
              onClick={() => toggle(id)}
            >
              <span className={`conn-card__icon conn-card__icon--${id}`}>
                <ConnGlyph id={id} />
              </span>
              <span className="conn-card__text">
                <strong>{h.names[id]}</strong>
                <span className="caption">{h.desc[id]}</span>
              </span>
              <span className={`chip conn-card__state is-${states[id]}`}>
                <i aria-hidden="true" />
                {h.states[states[id]]}
              </span>
            </button>
            {open.has(id) && <div className="conn-card__body">{body[id]}</div>}
          </article>
        ))}
      </div>
    </div>
  );
}
