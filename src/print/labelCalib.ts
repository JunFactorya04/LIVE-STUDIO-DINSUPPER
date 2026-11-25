// Paper alignment for the label printer (Nhập Kho barcode labels): how tall one label is, how
// far to shift the print so it lands inside the label, and what the printer does after each
// label. 203 dpi printers draw 8 dots per millimetre. Kept on this computer like the printer.

export const DOTS_PER_MM = 8;

export interface LabelCalib {
  /** Height of one label in mm; 0 = as tall as the content (continuous paper). */
  heightMm: number;
  /** Shift right (+) or left (−), in mm. */
  offsetXmm: number;
  /** Shift down (+) or up (−), in mm. */
  offsetYmm: number;
  /** Lines fed after each label (0 for gap labels whose height is set). */
  feed: number;
  /** Cut after each label (only printers with a cutter). */
  cut: boolean;
}

/** The behaviour before alignment existed: content height, 4 lines feed, cut. */
export const DEFAULT_LABEL_CALIB: LabelCalib = {
  heightMm: 0,
  offsetXmm: 0,
  offsetYmm: 0,
  feed: 4,
  cut: true,
};

export const LABEL_HEIGHTS = [0, 20, 25, 30, 40, 50, 60] as const;
export const OFFSET_LIMIT_MM = 15;

const KEY = "live-studio.label-calib";
const clamp = (n: unknown, lo: number, hi: number, d: number) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
};

export function normalizeCalib(raw: Partial<LabelCalib> | null | undefined): LabelCalib {
  const d = DEFAULT_LABEL_CALIB;
  if (!raw || typeof raw !== "object") return { ...d };
  return {
    heightMm: clamp(raw.heightMm, 0, 150, d.heightMm),
    offsetXmm: Math.round(clamp(raw.offsetXmm, -OFFSET_LIMIT_MM, OFFSET_LIMIT_MM, 0) * 2) / 2,
    offsetYmm: Math.round(clamp(raw.offsetYmm, -OFFSET_LIMIT_MM, OFFSET_LIMIT_MM, 0) * 2) / 2,
    feed: Math.round(clamp(raw.feed, 0, 10, d.feed)),
    cut: typeof raw.cut === "boolean" ? raw.cut : d.cut,
  };
}

export function loadLabelCalib(): LabelCalib {
  try {
    return normalizeCalib(JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<LabelCalib>);
  } catch {
    return { ...DEFAULT_LABEL_CALIB };
  }
}

export function saveLabelCalib(c: LabelCalib): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(normalizeCalib(c)));
  } catch {
    // kept for this run only
  }
}

/** Where the content goes on the label page, in dots. */
export function labelPage(contentHeight: number, c: LabelCalib) {
  const x = Math.round(c.offsetXmm * DOTS_PER_MM);
  const y = Math.round(c.offsetYmm * DOTS_PER_MM);
  const height =
    c.heightMm > 0
      ? Math.round(c.heightMm * DOTS_PER_MM)
      : Math.max(1, contentHeight + Math.max(0, y));
  return { x, y, height };
}
