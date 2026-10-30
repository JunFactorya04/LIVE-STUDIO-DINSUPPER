import { useI18n } from "../i18n";
import { clampCopies, type LabelOptions } from "../print/labelOptions";

// Print options for barcode labels: how many copies, alignment and which lines to show.
// The cost price is never one of the lines; it only goes to the books.

export function LabelOptionsPanel({
  value,
  onChange,
}: {
  value: LabelOptions;
  onChange: (next: LabelOptions) => void;
}) {
  const { t } = useI18n();
  const o = t.warehouse.labelOpts;
  const set = (patch: Partial<LabelOptions>) => onChange({ ...value, ...patch });
  const presets = [1, 2, 5, 10];
  return (
    <fieldset className="lbl-opts">
      <legend>{o.title}</legend>
      <div className="lbl-opts__row">
        <span className="lbl-opts__name">{o.copies}</span>
        <div className="segmented" role="group" aria-label={o.copies}>
          {presets.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={value.copies === n}
              onClick={() => set({ copies: n })}
            >
              {n}
            </button>
          ))}
        </div>
        <input
          className="input input--tiny"
          type="number"
          min={1}
          max={99}
          inputMode="numeric"
          aria-label={o.custom}
          value={value.copies}
          onChange={(e) => set({ copies: clampCopies(e.target.value) })}
        />
      </div>
      <div className="lbl-opts__row">
        <span className="lbl-opts__name">{o.align}</span>
        <div className="segmented" role="group" aria-label={o.align}>
          {(["left", "center"] as const).map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={value.align === a}
              onClick={() => set({ align: a })}
            >
              {o[a]}
            </button>
          ))}
        </div>
      </div>
      <div className="lbl-opts__row">
        <span className="lbl-opts__name">{o.priceSize}</span>
        <div className="segmented" role="group" aria-label={o.priceSize}>
          {([32, 40, 52] as const).map((n, i) => (
            <button
              key={n}
              type="button"
              aria-pressed={value.priceSize === n}
              onClick={() => set({ priceSize: n })}
            >
              {o.sizes[i]}
            </button>
          ))}
        </div>
      </div>
      <div className="lbl-opts__row">
        <span className="lbl-opts__name">{o.barHeight}</span>
        <div className="segmented" role="group" aria-label={o.barHeight}>
          {([48, 64, 80] as const).map((n, i) => (
            <button
              key={n}
              type="button"
              aria-pressed={value.barHeight === n}
              onClick={() => set({ barHeight: n })}
            >
              {o.sizes[i]}
            </button>
          ))}
        </div>
      </div>
      <div className="lbl-opts__row lbl-opts__checks">
        <label>
          <input
            type="checkbox"
            checked={value.showSku}
            onChange={(e) => set({ showSku: e.target.checked })}
          />{" "}
          {o.showSku}
        </label>
        <label>
          <input
            type="checkbox"
            checked={value.showCode}
            onChange={(e) => set({ showCode: e.target.checked })}
          />{" "}
          {o.showCode}
        </label>
        <label>
          <input
            type="checkbox"
            checked={value.showLocation}
            onChange={(e) => set({ showLocation: e.target.checked })}
          />{" "}
          {o.showLocation}
        </label>
      </div>
      <p className="caption">{o.help}</p>
    </fieldset>
  );
}
