import { useState } from "react";
import { loadOpenMode, saveOpenMode, type OpenMode, type WebKind } from "../browser/route";
import { useI18n } from "../i18n";

// Where carrier pages (MyShip, ECPay, ...) and TikTok pages open: in the app's Browser tab, or
// the system browser. Per kind, remembered on this computer.

export function WebOpenSection() {
  const { t } = useI18n();
  const s = t.settings.webOpen;
  const [mode, setMode] = useState<Record<WebKind, OpenMode>>(() => ({
    carrier: loadOpenMode("carrier"),
    tiktok: loadOpenMode("tiktok"),
  }));
  const pick = (kind: WebKind, m: OpenMode) => {
    saveOpenMode(kind, m);
    setMode((prev) => ({ ...prev, [kind]: m }));
  };
  return (
    <section className="box webopen">
      <h2 className="section-title">{s.title}</h2>
      <p className="caption">{s.help}</p>
      {(["carrier", "tiktok"] as const).map((kind) => (
        <div className="field" key={kind}>
          <span>{s[kind]}</span>
          <div className="segmented" role="group" aria-label={s[kind]}>
            {(["app", "external"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode[kind] === m}
                onClick={() => pick(kind, m)}
              >
                {s[m]}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="caption">{s.tiktokNote}</p>
    </section>
  );
}
