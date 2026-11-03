import { useCallback, useState } from "react";
import { cameraSupported, Scanner } from "../camera/CameraScanner";
import { Icon } from "../components/Icon";
import { NavIcon } from "../components/Icons";
import { useI18n } from "../i18n";
import { useLiveSession } from "../live/useLiveSession";
import { createWarehouseClient, type Unit, type WarehouseClient } from "../warehouse/client";
import { createSkuImageClient, type SkuImageClient } from "../warehouse/images";
import { createScanRelay, type ScanRelay, type ScanTarget } from "../warehouse/relay";
import { ScanBox } from "../warehouse/ScanBox";
import { SkuThumb } from "../warehouse/SkuPhoto";
import { isUnitCode } from "../warehouse/stats";
import { ColorName } from "../warehouse/StockOverview";

// The phone's scan screen: pick what the scans are for, then scan with the camera (or a
// Bluetooth scanner, or by typing). "Tra cứu" answers on the phone itself; the other modes send
// each code to the computer, which opens the matching screen (src/App.tsx, warehouse/relay.ts).

export type ScanMode = "pay" | "lookup" | ScanTarget;
const MODES: readonly ScanMode[] = ["pay", "lookup", "ship", "out", "count"];

let requested: ScanMode | undefined;
/** The home screen's "Quét thanh toán" tile opens this screen in that mode. */
export function requestScanMode(m: ScanMode) {
  requested = m;
}

type Row = {
  id: number;
  code: string;
  mode: ScanMode;
  state: "sending" | "sent" | "failed" | "found" | "missing";
  unit?: Unit;
};

const money = (n: number) => `NT$ ${Math.round(n).toLocaleString("en-US")}`;
let rowId = 0;

export function ScanPage({
  client,
  relay,
  images,
}: {
  client?: WarehouseClient;
  relay?: ScanRelay;
  images?: SkuImageClient;
}) {
  const { t, fmt, locale } = useI18n();
  const sc = t.scan;
  const { catalog } = useLiveSession();
  const [api] = useState(() => client ?? createWarehouseClient());
  const [relayApi] = useState(() => relay ?? createScanRelay());
  const [imagesApi] = useState(() => images ?? createSkuImageClient());
  const [mode, setMode] = useState<ScanMode>(() => {
    const m = requested ?? "pay";
    requested = undefined;
    return m;
  });
  const [camera, setCamera] = useState(false);
  const [hint, setHint] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

  const patch = (id: number, p: Partial<Row>) =>
    setRows((list) => list.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const handle = useCallback(
    (raw: string) => {
      const code = raw.trim();
      if (!code) return;
      const id = ++rowId;
      const m = mode;
      setRows((list) =>
        [{ id, code, mode: m, state: m === "lookup" ? "found" : "sending" } as Row, ...list].slice(
          0,
          30,
        ),
      );
      // What the label is (for every mode, so the list says "Áo hoodie Đen M", not a code).
      if (isUnitCode(code) && api.available) {
        void api
          .unit(code)
          .then((u) => {
            if (u) patch(id, { unit: u });
            else if (m === "lookup") patch(id, { state: "missing" });
          })
          .catch(() => m === "lookup" && patch(id, { state: "missing" }));
      } else if (m === "lookup") patch(id, { state: "missing" });
      if (m !== "lookup") {
        relayApi.push(code, m).then(
          () => patch(id, { state: "sent" }),
          () => patch(id, { state: "failed" }),
        );
      }
    },
    [mode, api, relayApi],
  );

  const nameOf = (u: Unit) => catalog.find((c) => c.sku === u.sku)?.name || u.sku;
  const latest = rows.find((r) => r.mode === "lookup");

  return (
    <div className="page page--no-inspector scanpad">
      <div className="segmented scanpad__modes" role="group" aria-label={t.pages.scan.title}>
        {MODES.map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
            {sc.modes[m]}
          </button>
        ))}
      </div>
      <p className="caption scanpad__help">{sc.help[mode]}</p>

      <button
        type="button"
        className="scanpad__go"
        onClick={() => (cameraSupported() ? setCamera(true) : setHint(true))}
      >
        <NavIcon id="scan" size={44} />
        <span>{sc.start}</span>
        <span className="scanpad__mode">{sc.modes[mode]}</span>
      </button>
      {hint && (
        <p className="note" role="status">
          {sc.needHttps}
        </p>
      )}
      <ScanBox onScan={handle} placeholder={sc.typeCode} label={sc.typeCode} autoFocus={false} />

      {mode === "lookup" && latest && (
        <section className="box scanpad__card" aria-live="polite">
          {latest.unit ? (
            <>
              <div className="scanpad__card-head">
                <SkuThumb sku={latest.unit.sku} images={imagesApi} size={64} />
                <div>
                  <h2 className="stockcard__name">{nameOf(latest.unit)}</h2>
                  <span className="caption">{latest.unit.code}</span>
                  <div className="picker__variant">
                    {latest.unit.color && <ColorName color={latest.unit.color} fallback="" />}
                    {latest.unit.size && <span className="picker__size">{latest.unit.size}</span>}
                  </div>
                </div>
                <strong className="scanpad__price">{money(latest.unit.price)}</strong>
              </div>
              <p className="scanpad__facts">
                <span
                  className={`chip ${latest.unit.status === "IN_STOCK" ? "tone-green" : latest.unit.status === "SHIPPED" ? "tone-blue" : "tone-red"}`}
                >
                  {sc.status[latest.unit.status]}
                </span>
                {latest.unit.location && (
                  <span>{fmt(sc.shelf, { loc: latest.unit.location })}</span>
                )}
                {latest.unit.shippedAt && (
                  <span>
                    {fmt(sc.shippedAt, {
                      when: new Date(latest.unit.shippedAt).toLocaleString(
                        locale === "vi" ? "vi-VN" : "zh-TW",
                        { dateStyle: "short", timeStyle: "short" },
                      ),
                    })}
                  </span>
                )}
                {latest.unit.orderId && (
                  <span>{fmt(sc.order, { id: latest.unit.orderId.slice(0, 8) })}</span>
                )}
              </p>
            </>
          ) : latest.state === "missing" ? (
            <p className="note note--error" role="alert">
              {sc.unknown} ({latest.code})
            </p>
          ) : (
            <p className="caption">{t.common.loading}</p>
          )}
        </section>
      )}

      <section className="box">
        <h2 className="section-title">{sc.history}</h2>
        {rows.length === 0 ? (
          <p className="caption">{sc.none}</p>
        ) : (
          <ul className="scanpad__list">
            {rows.map((r) => (
              <li key={r.id}>
                <span className="scanpad__what">
                  <strong>{r.unit ? nameOf(r.unit) : r.code}</strong>
                  <span className="caption">
                    {sc.modes[r.mode]}
                    {r.unit
                      ? `, ${[r.unit.color, r.unit.size].filter(Boolean).join(" ")} ${money(r.unit.price)}`
                      : ""}
                  </span>
                </span>
                <span
                  className={`scanpad__state scanpad__state--${r.state}`}
                  role={r.state === "failed" || r.state === "missing" ? "alert" : undefined}
                >
                  {r.state === "sent" || r.state === "found" ? (
                    <Icon name="check" size={14} />
                  ) : r.state === "failed" || r.state === "missing" ? (
                    <Icon name="warning" size={14} />
                  ) : null}
                  {r.state === "sending"
                    ? sc.sending
                    : r.state === "sent"
                      ? sc.sent
                      : r.state === "failed"
                        ? sc.failed
                        : r.state === "missing"
                          ? sc.unknown
                          : r.unit
                            ? sc.status[r.unit.status]
                            : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {camera && (
        <Scanner
          label={sc.modes[mode]}
          accept={isUnitCode}
          onScan={handle}
          onClose={() => setCamera(false)}
        />
      )}
    </div>
  );
}
