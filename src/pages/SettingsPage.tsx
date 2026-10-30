import { LOCALES, useI18n, type Locale } from "../i18n";
import { AiSection } from "./AiSection";
import { ApiKeysSection } from "./ApiKeysSection";
import { PrinterSection } from "./PrinterSection";
import { ShareSection } from "./ShareSection";

export function SettingsPage() {
  const { t, locale, setLocale } = useI18n();
  const locales = Object.keys(LOCALES) as Locale[];

  return (
    <div className="page page--no-inspector">
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
      <ApiKeysSection />
      <AiSection />
      <PrinterSection />
      <ShareSection />
    </div>
  );
}
