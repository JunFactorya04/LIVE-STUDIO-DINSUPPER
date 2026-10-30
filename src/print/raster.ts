import { PrintError, type Bitmap } from "./client";
import type { Slip, SlipLine } from "./slip";

// Draws a slip as a 1-bit bitmap. Using the webview's own fonts means Chinese, Vietnamese and
// emoji print without depending on the printer's character tables.

const FONT_FAMILY =
  '"Noto Sans CJK TC","Microsoft JhengHei","PingFang TC","Segoe UI",system-ui,sans-serif';
const SIZE_DOTS = { sm: 20, md: 26, lg: 34 } as const;
const MARGIN = 8;
const LINE_GAP = 6;

export type Measure = (text: string) => number;

/** Break text to fit `maxWidth`: at spaces when possible, otherwise between any two characters (CJK). */
export function wrapText(text: string, maxWidth: number, measure: Measure): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const ch of Array.from(paragraph)) {
      if (line && measure(line + ch) > maxWidth) {
        const space = line.lastIndexOf(" ");
        if (ch !== " " && space > 0) {
          out.push(line.slice(0, space));
          line = line.slice(space + 1) + ch;
        } else {
          out.push(line);
          line = ch === " " ? "" : ch;
        }
      } else {
        line += ch;
      }
    }
    out.push(line);
  }
  return out;
}

/** Pack RGBA pixels to 1 bit per dot (dark = 1). Transparent counts as white. */
export function packBits(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Uint8Array {
  const rowBytes = Math.ceil(w / 8);
  const bits = new Uint8Array(rowBytes * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const alpha = rgba[i + 3] / 255;
      const lum =
        (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * alpha + 255 * (1 - alpha);
      if (lum < 140) bits[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return bits;
}

interface Placed {
  line: SlipLine;
  text: string;
  y: number;
  h: number;
}

export function layout(slip: Slip, width: number, measureFor: (l: SlipLine) => Measure) {
  const placed: Placed[] = [];
  let y = MARGIN;
  for (const line of slip.lines) {
    if (line.rule) {
      placed.push({ line, text: "", y, h: 8 });
      y += 8 + LINE_GAP;
      continue;
    }
    const h = SIZE_DOTS[line.size];
    for (const text of wrapText(line.text, width - 2 * MARGIN, measureFor(line))) {
      placed.push({ line, text, y, h });
      y += h + LINE_GAP;
    }
  }
  return { placed, height: y + MARGIN };
}

const fontOf = (l: SlipLine) => `${l.bold ? "700 " : ""}${SIZE_DOTS[l.size]}px ${FONT_FAMILY}`;

/** Render with a canvas. Throws PrintError("RENDER") when no canvas is available. */
export function renderSlip(slip: Slip, width: number): Bitmap {
  const canvas = typeof document !== "undefined" ? document.createElement("canvas") : undefined;
  const probe = canvas?.getContext("2d");
  if (!canvas || !probe) throw new PrintError("RENDER");

  const measureFor =
    (l: SlipLine): Measure =>
    (t) => {
      probe.font = fontOf(l);
      return probe.measureText(t).width;
    };
  const { placed, height } = layout(slip, width, measureFor);

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PrintError("RENDER");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";
  for (const p of placed) {
    if (p.line.rule) {
      ctx.fillRect(MARGIN, p.y + 3, width - 2 * MARGIN, 2);
      continue;
    }
    ctx.font = fontOf(p.line);
    const w = ctx.measureText(p.text).width;
    const x = p.line.align === "center" ? Math.max(MARGIN, (width - w) / 2) : MARGIN;
    ctx.fillText(p.text, x, p.y);
  }
  const image = ctx.getImageData(0, 0, width, height);
  return { width, height, bits: packBits(image.data, width, height) };
}
