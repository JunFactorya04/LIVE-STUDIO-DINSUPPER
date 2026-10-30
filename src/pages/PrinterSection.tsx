import { useId, useState } from "react";
import { useI18n } from "../i18n";
import { PAPER_WIDTHS, loadPrinter, savePrinter, type PrinterSettings } from "../print/settings";
import { testSlip } from "../print/slip";
import { getPrintService, type PrintService } from "../print/service";
import { usePrintStatus } from "../print/usePrint";
import type { PrintErrorCode } from "../print/client";
import { createShareClient } from "../share/client";

// Where the receipt printer is on the network, plus a connection check and a test print.

export function PrinterSection({ service }: { service?: PrintService }) {
  const { t } = useI18n();
  const [svc] = useState(() => service ?? getPrintService());
  const status = usePrintStatus(svc);
  const [cfg, setCfg] = useState<PrinterSettings>(loadPrinter);
  const [note, setNote] = useState<{ text: string; error: boolean }>();
  const [busy, setBusy] = useState(false);
  const hostId = useId();
  const portId = useId();
  const widthId = useId();
  const p = t.print;

  const update = (next: PrinterSettings) => {
    setCfg(next);
    savePrinter(next);
    void createShareClient()
      .syncPrinter()
      .catch(() => undefined);
    setNote(undefined);
  };
  const fail = (code: PrintErrorCode) => setNote({ text: p.errors[code], error: true });

  const probe = async () => {
    setBusy(true);
    const code = await svc.probe(cfg);
    setBusy(false);
    if (code) fail(code);
    else setNote({ text: p.probeOk, error: false });
  };

  const test = async () => {
    setBusy(true);
    setNote(undefined);
    const ok = await svc.print(testSlip(p.slip.testTitle, p.slip.testBody));
    setBusy(false);
    if (ok) setNote({ text: p.testOk, error: false });
    else fail(svc.getSnapshot().error ?? "UNREACHABLE");
  };

  return (
    <section className="box">
      <h2 className="section-title">{p.title}</h2>
      <p className="caption">{p.help}</p>
      {!svc.available && <p className="note">{p.desktopOnly}</p>}
      <div className="field">
        <label htmlFor={hostId}>{p.host}</label>
        <input
          id={hostId}
          className="input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder="192.168.1.50"
          value={cfg.host}
          onChange={(e) => update({ ...cfg, host: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor={portId}>{p.port}</label>
        <input
          id={portId}
          className="input"
          type="number"
          min={1}
          max={65535}
          value={cfg.port}
          onChange={(e) => update({ ...cfg, port: Number(e.target.value) || 9100 })}
        />
      </div>
      <div className="field">
        <label htmlFor={widthId}>{p.width}</label>
        <select
          id={widthId}
          className="input"
          value={cfg.widthDots}
          onChange={(e) =>
            update({ ...cfg, widthDots: Number(e.target.value) as (typeof PAPER_WIDTHS)[number] })
          }
        >
          <option value={384}>{p.width58}</option>
          <option value={576}>{p.width80}</option>
        </select>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={cfg.autoTemp}
          onChange={(e) => update({ ...cfg, autoTemp: e.target.checked })}
        />
        {p.autoTemp}
      </label>
      <p className="caption">{p.autoTempHelp}</p>
      <div className="actions">
        <button
          type="button"
          className="btn"
          disabled={busy || !svc.available}
          onClick={() => void probe()}
        >
          {p.probe}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || !svc.available}
          onClick={() => void test()}
        >
          {busy ? p.printing : p.test}
        </button>
      </div>
      {note && (
        <p className="caption" role={note.error ? "alert" : "status"}>
          {note.text}
        </p>
      )}
      {!note && status.error && (
        <p className="caption" role="alert">
          {p.errors[status.error]}
        </p>
      )}
    </section>
  );
}
