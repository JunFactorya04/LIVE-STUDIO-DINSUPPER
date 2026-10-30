import { describe, expect, it } from "vitest";
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from "@zxing/library";
import { MODULES_PATTERNS, canEncode, modules, symbols } from "./code128";

// Draw the modules as a grayscale bitmap with a quiet zone, then read it back with an
// independent decoder: if the table had a typo, this would not decode.
function decode(text: string, scale = 3): string {
  const mods = modules(text);
  const quiet = 12;
  const w = (mods.length + 2 * quiet) * scale;
  const h = 60;
  const px = new Uint8ClampedArray(w * h).fill(255);
  mods.forEach((bar, i) => {
    if (!bar) return;
    for (let x = 0; x < scale; x++)
      for (let y = 0; y < h; y++) px[y * w + (quiet + i) * scale + x] = 0;
  });
  const reader = new MultiFormatReader();
  reader.setHints(new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]]]));
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(px, w, h)));
  return reader.decode(bitmap).getText();
}

describe("code 128", () => {
  it("has a well-formed symbol table", () => {
    expect(MODULES_PATTERNS).toHaveLength(106);
    expect(new Set(MODULES_PATTERNS).size).toBe(106);
    for (const p of MODULES_PATTERNS) {
      expect(p).toHaveLength(6);
      expect([...p].reduce((n, d) => n + Number(d), 0)).toBe(11);
    }
  });

  it("adds the start symbol and a mod-103 checksum", () => {
    // "A" = 33; 104 + 33*1 = 137; 137 % 103 = 34
    expect(symbols("A")).toEqual([104, 33, 34]);
  });

  it("is 11 modules per symbol and ends with the 13-module stop", () => {
    expect(modules("A12-000001")).toHaveLength((1 + 10 + 1) * 11 + 13);
  });

  it("only accepts printable ASCII", () => {
    expect(canEncode("A12-000001")).toBe(true);
    expect(canEncode("áo")).toBe(false);
    expect(canEncode("")).toBe(false);
    expect(() => modules("áo")).toThrow();
  });

  it("reads back with an independent decoder", () => {
    for (const t of ["A12-000001", "SKU_9.x-000123", "Wikipedia", "0", "~ ~"]) {
      expect(decode(t)).toBe(t);
    }
  });
});
