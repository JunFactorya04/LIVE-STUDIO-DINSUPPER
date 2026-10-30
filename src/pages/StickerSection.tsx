import { useState } from "react";
import { useI18n } from "../i18n";
import { loadPrinter } from "../print/settings";
import {
  DEFAULT_STICKER,
  PX_MAX,
  PX_MIN,
  SAMPLE_STICKER,
  STICKER_FIELDS,
  loadSticker,
  saveSticker,
  stickerLines,
  type StickerField,
  type StickerTemplate,
} from "../print/sticker";

// Layout of the sticker printed for each live order: which lines, and how big. The preview is
// drawn with the same lines the printer gets, scaled to the paper width chosen in Printer.

const PREVIEW_CSS_WIDTH = 300;

export function StickerSection() {
  const { t } = useI18n();
  const s = t.sticker;
  const [tpl, setTpl] = useState<StickerTemplate>(loadSticker);
  const dots = loadPrinter().widthDots;
  const scale = PREVIEW_CSS_WIDTH / dots;

  const update = (next: StickerTemplate) => {
    setTpl(next);
    saveSticker(next);
  };
  const setField = (f: StickerField, patch: Partial<StickerTemplate["fields"][StickerField]>) =>
    update({ ...tpl, fields: { ...tpl.fields, [f]: { ...tpl.fields[f], ...patch } } });

  const lines = stickerLines(tpl, SAMPLE_STICKER);

  return (
    <section className="box">
      <h2 className="section-title">{s.title}</h2>
      <p className="caption">{s.help}</p>
      <div className="sticker">
        <div className="sticker__preview" aria-label={s.preview}>
          <div className="sticker__paper" style={{ width: PREVIEW_CSS_WIDTH }}>
            {lines.map((l, i) => (
              <div
                key={i}
                className="sticker__line"
                style={{ fontSize: (l.px ?? 26) * scale, fontWeight: l.bold ? 700 : 400 }}
              >
                {l.text}
              </div>
            ))}
          </div>
          <span className="caption">{s.previewNote}</span>
        </div>
        <div className="sticker__controls">
          {STICKER_FIELDS.map((f) => {
            const row = tpl.fields[f];
            return (
              <div key={f} className="sticker__row">
                <label className="sticker__toggle">
                  <input
                    type="checkbox"
                    checked={row.show}
                    onChange={(e) => setField(f, { show: e.target.checked })}
                  />
                  {s.fields[f]}
                </label>
                <div className="sticker__size">
                  <button
                    type="button"
                    className="btn"
                    aria-label={`${s.fields[f]} −`}
                    disabled={!row.show || row.px <= PX_MIN}
                    onClick={() => setField(f, { px: Math.max(PX_MIN, row.px - 2) })}
                  >
                    −
                  </button>
                  <input
                    type="range"
                    min={PX_MIN}
                    max={PX_MAX}
                    value={row.px}
                    disabled={!row.show}
                    aria-label={`${s.fields[f]}: ${row.px}`}
                    onChange={(e) => setField(f, { px: Number(e.target.value) })}
                  />
                  <button
                    type="button"
                    className="btn"
                    aria-label={`${s.fields[f]} +`}
                    disabled={!row.show || row.px >= PX_MAX}
                    onClick={() => setField(f, { px: Math.min(PX_MAX, row.px + 2) })}
                  >
                    +
                  </button>
                  <span className="sticker__px">{row.px}</span>
                </div>
              </div>
            );
          })}
          <div className="field">
            <label htmlFor="sticker-note">{s.noteText}</label>
            <input
              id="sticker-note"
              className="input"
              maxLength={60}
              value={tpl.noteText}
              placeholder={s.notePlaceholder}
              onChange={(e) => update({ ...tpl, noteText: e.target.value })}
            />
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => update(structuredClone(DEFAULT_STICKER))}
          >
            {s.reset}
          </button>
        </div>
      </div>
      <p className="caption">{s.privacy}</p>
    </section>
  );
}
