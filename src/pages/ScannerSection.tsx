import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "../i18n";
import { isRemote } from "../platform/backend";
import { createScanRelay, type ScanRelay } from "../warehouse/relay";
import { isUnitCode } from "../warehouse/stats";

// "Cài đặt → Máy quét": the ways to scan, and a box to try one. A USB or Bluetooth (BLE) scanner
// in HID mode is a keyboard to the computer: it types the code and presses Enter, so it needs no
// setup in this app, only pairing in the system. A phone that opened the sharing link can scan
// with its camera and send each code to the screen open on the computer.

/** A scanner types a whole code in a few ms per key; a person needs far longer. */
const SCANNER_MS_PER_KEY = 35;

type Result = { code: string; scanner: boolean; ours: boolean; from: "keys" | "phone" };

export function ScannerSection({ relay }: { relay?: ScanRelay }) {
  const { t, fmt } = useI18n();
  const s = t.settings.scanner;
  const [relayApi] = useState(() => relay ?? createScanRelay());
  const [value, setValue] = useState("");
  const [result, setResult] = useState<Result>();
  const stamps = useRef<number[]>([]);

  // Codes a phone sends while this page is open show up here, to try the phone link too.
  useEffect(() => {
    if (isRemote()) return;
    let off = () => {};
    let alive = true;
    void relayApi
      .listen((code) => setResult({ code, scanner: true, ours: isUnitCode(code), from: "phone" }))
      .then((u) => (alive ? (off = u) : u()));
    return () => {
      alive = false;
      off();
    };
  }, [relayApi]);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") {
      if (e.key.length === 1) stamps.current.push(performance.now());
      return;
    }
    e.preventDefault();
    const code = value.trim();
    const times = stamps.current;
    stamps.current = [];
    setValue("");
    if (!code) return;
    const span = times.length > 1 ? (times[times.length - 1] - times[0]) / (times.length - 1) : 999;
    setResult({
      code,
      scanner: code.length >= 3 && span < SCANNER_MS_PER_KEY,
      ours: isUnitCode(code),
      from: "keys",
    });
  };

  return (
    <section className="box scanner-set">
      <h2 className="section-title">{s.title}</h2>
      <p className="caption">{s.help}</p>
      <ol className="scanner-set__ways">
        <li>
          <strong>{s.hidTitle}</strong>
          <span className="caption">{s.hidBody}</span>
        </li>
        <li>
          <strong>{s.phoneTitle}</strong>
          <span className="caption">{s.phoneBody}</span>
        </li>
        <li>
          <strong>{s.cameraTitle}</strong>
          <span className="caption">{s.cameraBody}</span>
        </li>
      </ol>
      <label className="field">
        {s.testLabel}
        <input
          className="input"
          value={value}
          placeholder={s.testPh}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
        />
      </label>
      {result && (
        <p className="note" role="status">
          {fmt(result.from === "phone" ? s.gotPhone : result.scanner ? s.gotScanner : s.gotTyped, {
            code: result.code,
          })}{" "}
          {result.ours ? s.ours : s.notOurs}
        </p>
      )}
      <p className="caption">{s.buyHint}</p>
    </section>
  );
}
