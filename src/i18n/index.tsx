import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { vi } from "./vi";
import { zhTW } from "./zh-TW";

// zh-TW is the shape every locale must follow; a missing key is a type error.
export type Messages = typeof zhTW;

export const LOCALES = { "zh-TW": zhTW, vi } as const satisfies Record<string, Messages>;
export type Locale = keyof typeof LOCALES;
export const DEFAULT_LOCALE: Locale = "vi";
const STORAGE_KEY = "live-studio.locale";

function readStoredLocale(): Locale {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value && value in LOCALES) return value as Locale;
  } catch {
    // storage unavailable (private mode, tests): fall back to the default
  }
  return DEFAULT_LOCALE;
}

/** Replace `{name}` placeholders. Unknown placeholders are left as they are. */
export function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m));
}

interface I18nValue {
  locale: Locale;
  t: Messages;
  setLocale: (locale: Locale) => void;
  fmt: typeof format;
  formatTime: (iso: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(() => initial ?? readStoredLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // not persisted; the choice still applies for this run
    }
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      t: LOCALES[locale],
      setLocale,
      fmt: format,
      formatTime: (iso) =>
        new Intl.DateTimeFormat(locale, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(new Date(iso)),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("I18nProvider is missing");
  return value;
}
