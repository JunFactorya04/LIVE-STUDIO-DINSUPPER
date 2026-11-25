import { useMemo, useState } from "react";
import { Icon, type IconName } from "../components/Icon";
import { useI18n } from "../i18n";
import { unitLabel } from "../print/label";
import {
  DEFAULT_LABEL_CALIB,
  LABEL_HEIGHTS,
  OFFSET_LIMIT_MM,
  loadLabelCalib,
  normalizeCalib,
  saveLabelCalib,
  type LabelCalib,
} from "../print/labelCalib";
import { loadLabelOptions } from "../print/labelOptions";
import { labelPng } from "../print/raster";
import { getLabelService, type PrintService } from "../print/service";
import { loadLabelPrinter } from "../print/settings";

// Paper alignment for Nhập Kho labels: label height, nudge the print by half millimetres until it
// sits inside the label, and what the printer does after each one. The preview is the exact page
// the printer gets, framed at the label's size.

const PREVIEW_PX = 260;
const SAMPLE = { code: "A12-000123", sku: "A12", price: 790, color: "Đen", size: "M" };

function Nudge({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="icon-btn calib__nudge"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

export function LabelCalibSection({ service }: { service?: PrintService }) {
  const { t } = useI18n();
  const c = t.labelCalib;
  const [svc] = useState(() => service ?? getLabelService());
  const [cal, setCal] = useState<LabelCalib>(loadLabelCalib);
  const [note, setNote] = useState<{ text: string; error: boolean }>();
  const [busy, setBusy] = useState(false);
  const width = loadLabelPrinter().widthDots;

  const update = (patch: Partial<LabelCalib>) => {
    const next = normalizeCalib({ ...cal, ...patch });
    setCal(next);
    saveLabelCalib(next);
    setNote(undefined);
  };
  const nudge = (axis: "offsetXmm" | "offsetYmm", d: number) => update({ [axis]: cal[axis] + d });

  const png = useMemo(
    () => labelPng(unitLabel(SAMPLE, loadLabelOptions()), width, cal),
    [width, cal],
  );

  const test = async () => {
    setBusy(true);
    const ok = await svc.print(unitLabel(SAMPLE, loadLabelOptions()));
    setBusy(false);
    setNote(
      ok
        ? { text: c.testOk, error: false }
        : { text: t.print.errors[svc.getSnapshot().error ?? "UNREACHABLE"], error: true },
    );
  };

  return (
    <section className="box">
      <h2 className="section-title">{c.title}</h2>
      <p className="caption">{c.help}</p>
      <div className="calib">
        <div className="calib__preview">
          <div
            className={`calib__paper${cal.heightMm > 0 ? " is-fixed" : ""}`}
            style={{ width: PREVIEW_PX }}
            aria-label={c.preview}
          >
            {png ? (
              <img src={png} alt={c.preview} width={PREVIEW_PX} />
            ) : (
              <div
                className="calib__blank"
                style={{
                  height: cal.heightMm > 0 ? (PREVIEW_PX * cal.heightMm * 8) / width : 140,
                }}
              />
            )}
          </div>
          <span className="caption">
            {c.paperSize
              .replace("{w}", String(Math.round(width / 8)))
              .replace("{h}", cal.heightMm > 0 ? String(cal.heightMm) : c.auto)}
          </span>
        </div>

        <div className="calib__controls">
          <div className="field">
            <span>{c.height}</span>
            <div className="segmented calib__heights" role="group" aria-label={c.height}>
              {LABEL_HEIGHTS.map((h) => (
                <button
                  key={h}
                  type="button"
                  aria-pressed={cal.heightMm === h}
                  onClick={() => update({ heightMm: h, feed: h > 0 ? 0 : cal.feed })}
                >
                  {h === 0 ? c.auto : `${h} mm`}
                </button>
              ))}
            </div>
            <input
              className="input input--tiny"
              type="number"
              min={0}
              max={150}
              aria-label={c.heightCustom}
              value={cal.heightMm}
              onChange={(e) => update({ heightMm: Number(e.target.value) })}
            />
          </div>

          <div className="calib__pad" role="group" aria-label={c.position}>
            <span className="calib__pad-title">{c.position}</span>
            <div className="calib__grid">
              <span />
              <Nudge icon="up" label={c.up} onClick={() => nudge("offsetYmm", -0.5)} />
              <span />
              <Nudge icon="back" label={c.left} onClick={() => nudge("offsetXmm", -0.5)} />
              <button
                type="button"
                className="btn calib__center"
                onClick={() => update({ offsetXmm: 0, offsetYmm: 0 })}
                title={c.center}
              >
                {cal.offsetXmm.toFixed(1)}, {cal.offsetYmm.toFixed(1)}
              </button>
              <Nudge icon="forward" label={c.right} onClick={() => nudge("offsetXmm", 0.5)} />
              <span />
              <Nudge icon="down" label={c.down} onClick={() => nudge("offsetYmm", 0.5)} />
              <span />
            </div>
            <span className="caption">
              {c.positionHelp.replace("{max}", String(OFFSET_LIMIT_MM))}
            </span>
          </div>

          <div className="field">
            <span>{c.after}</span>
            <div className="calib__after">
              <label className="calib__feed">
                {c.feed}
                <input
                  className="input input--tiny"
                  type="number"
                  min={0}
                  max={10}
                  value={cal.feed}
                  onChange={(e) => update({ feed: Number(e.target.value) })}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={cal.cut}
                  onChange={(e) => update({ cut: e.target.checked })}
                />
                {c.cut}
              </label>
            </div>
            <span className="caption">{c.afterHelp}</span>
          </div>

          <div className="actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || !svc.available}
              onClick={() => void test()}
            >
              {busy ? t.print.printing : c.test}
            </button>
            <button type="button" className="btn" onClick={() => update(DEFAULT_LABEL_CALIB)}>
              {c.reset}
            </button>
          </div>
          {note && (
            <p
              className={`caption${note.error ? " note--error" : ""}`}
              role={note.error ? "alert" : "status"}
            >
              {note.text}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
