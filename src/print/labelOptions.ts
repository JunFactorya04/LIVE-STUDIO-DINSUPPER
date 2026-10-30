// How a barcode label is laid out. Stored next to the printer settings; it is a preference, not
// a secret. The label never carries the cost price: that stays in the books for the reports.

export interface LabelOptions {
  /** Copies of each label, 1 to 99. */
  copies: number;
  align: "left" | "center";
  showSku: boolean;
  showCode: boolean;
  showLocation: boolean;
  /** Height of the price text in dots. */
  priceSize: 32 | 40 | 52;
  /** Height of the bars in dots. */
  barHeight: 48 | 64 | 80;
}

export const DEFAULT_LABEL_OPTIONS: LabelOptions = {
  copies: 1,
  align: "center",
  showSku: true,
  showCode: true,
  showLocation: false,
  priceSize: 40,
  barHeight: 64,
};

const KEY = "live-studio.label-options";
const one = <T>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);

export function clampCopies(n: unknown): number {
  const x = Math.floor(Number(n));
  return Number.isFinite(x) ? Math.min(99, Math.max(1, x)) : 1;
}

export function normalise(raw: Partial<LabelOptions> | null | undefined): LabelOptions {
  const d = DEFAULT_LABEL_OPTIONS;
  const r = raw ?? {};
  return {
    copies: clampCopies(r.copies ?? d.copies),
    align: one(r.align, ["left", "center"] as const, d.align),
    showSku: r.showSku ?? d.showSku,
    showCode: r.showCode ?? d.showCode,
    showLocation: r.showLocation ?? d.showLocation,
    priceSize: one(r.priceSize, [32, 40, 52] as const, d.priceSize),
    barHeight: one(r.barHeight, [48, 64, 80] as const, d.barHeight),
  };
}

export function loadLabelOptions(): LabelOptions {
  try {
    return normalise(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return { ...DEFAULT_LABEL_OPTIONS };
  }
}

export function saveLabelOptions(o: LabelOptions): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(normalise(o)));
  } catch {
    /* the options just are not remembered */
  }
}
