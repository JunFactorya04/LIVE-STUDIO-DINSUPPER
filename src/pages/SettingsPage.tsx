import { useState } from "react";
import { LOCALES, useI18n, type Locale } from "../i18n";
import { AiSection } from "./AiSection";
import { ApiKeysSection } from "./ApiKeysSection";
import { THEMES, loadTheme, saveTheme, type Theme } from "../theme/theme";
import { PrinterSection } from "./PrinterSection";
import { ShareSection } from "./ShareSection";
import { StickerSection } from "./StickerSection";

type Tab = "general" | "printing" | "phone" | "ai";
const TABS: Tab[] = ["general", "printing", "phone", "ai"];

// Settings grouped by what the seller is doing: language, the printer and its sticker,
// the phone link, and the AI service with its keys.
export function SettingsPage() {
  const { t, locale, setLocale } = useI18n();
  const locales = Object.keys(LOCALES) as Locale[];
  const [tab, setTab] = useState<Tab>("general");
  const [theme, setThemeState] = useState<Theme>(loadTheme);

  return (
    <div className="page page--no-inspector">
      <div className="segmented" role="tablist" aria-label={t.nav.settings}>
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {t.settingsTabs[id]}
          </button>
        ))}
      </div>
      {tab === "general" && (
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
      )}
      {tab === "general" && (
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
      )}
      {tab === "printing" && (
        <>
          <PrinterSection />
          <PrinterSection kind="label" />
          <StickerSection />
        </>
      )}
      {tab === "phone" && <ShareSection />}
      {tab === "ai" && (
        <>
          <AiSection />
          <ApiKeysSection />
        </>
      )}
    </div>
  );
}
