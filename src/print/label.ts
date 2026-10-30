import { DEFAULT_LABEL_OPTIONS, type LabelOptions } from "./labelOptions";
import type { Slip, SlipLine } from "./slip";

// One barcode label for one unit. It carries the selling price and the bars, never the cost
// price (that is only kept in the books). The code under the bars lets a damaged label be typed.

export interface LabelUnit {
  code: string;
  sku: string;
  price: number;
  location?: string;
}

export function unitLabel(
  u: LabelUnit,
  opts: LabelOptions = DEFAULT_LABEL_OPTIONS,
  currency = "NT$",
): Slip {
  const align = opts.align;
  const lines: SlipLine[] = [];
  if (opts.showSku) lines.push({ text: u.sku, size: "md", bold: true, align, px: 24 });
  lines.push({
    text: `${currency} ${u.price.toLocaleString("en-US")}`,
    size: "lg",
    bold: true,
    align,
    px: opts.priceSize,
  });
  lines.push({ text: u.code, size: "sm", barcode: u.code, align, px: opts.barHeight });
  const under = [opts.showCode ? u.code : "", opts.showLocation ? (u.location ?? "") : ""]
    .filter(Boolean)
    .join("  ·  ");
  if (under) lines.push({ text: under, size: "sm", align, px: 18 });
  return { lines };
}

/** The same label `copies` times, for a roll that needs more than one per item. */
export function labelRun(units: readonly LabelUnit[], opts: LabelOptions): Slip[] {
  const out: Slip[] = [];
  for (const u of units) for (let i = 0; i < opts.copies; i++) out.push(unitLabel(u, opts));
  return out;
}
