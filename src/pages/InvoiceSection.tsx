import { useState } from "react";
import { useI18n } from "../i18n";
import {
  DEFAULT_INVOICE,
  loadInvoiceSettings,
  saveInvoiceSettings,
  type InvoiceSettings,
} from "../pos/settings";

// Internal receipt numbering for the "Tính tiền" (POS) tab. Off by default, and this is never
// a Taiwanese government e-invoice (統一發票) number — just a running count printed on the
// shop's own receipt so a till history sorts cleanly, with room to turn it off again once the
// seller registers for real e-invoicing and wires that in instead.

export function InvoiceSection() {
  const { t } = useI18n();
  const s = t.settings.invoice;
  const [cfg, setCfg] = useState<InvoiceSettings>(loadInvoiceSettings);

  const update = (next: InvoiceSettings) => {
    setCfg(next);
    saveInvoiceSettings(next);
  };

  return (
    <section className="box">
      <h2 className="section-title">{s.title}</h2>
      <p className="caption">{s.help}</p>
      <label className="check">
        <input
          type="checkbox"
          checked={cfg.enabled}
          onChange={(e) => update({ ...cfg, enabled: e.target.checked })}
        />
        {s.enable}
      </label>
      {cfg.enabled && (
        <>
          <label className="field">
            {s.prefix}
            <input
              className="input"
              value={cfg.prefix}
              maxLength={20}
              onChange={(e) => update({ ...cfg, prefix: e.target.value })}
            />
          </label>
          <label className="field">
            {s.next}
            <input
              type="number"
              className="input"
              min={1}
              value={cfg.next}
              onChange={(e) => {
                const n = Number(e.target.value);
                update({ ...cfg, next: Number.isInteger(n) && n > 0 ? n : DEFAULT_INVOICE.next });
              }}
            />
          </label>
        </>
      )}
    </section>
  );
}
