import { describe, expect, it } from "vitest";
import { DEFAULT_LABEL_CALIB, labelPage, normalizeCalib } from "./labelCalib";

describe("label paper alignment", () => {
  it("keeps the old behaviour by default: content height, feed 4, cut", () => {
    expect(normalizeCalib(null)).toEqual(DEFAULT_LABEL_CALIB);
    expect(labelPage(200, DEFAULT_LABEL_CALIB)).toEqual({ x: 0, y: 0, height: 200 });
  });

  it("makes a page of the label's height and shifts the print by half millimetres", () => {
    const c = normalizeCalib({ heightMm: 30, offsetXmm: 1.3, offsetYmm: -2, feed: 0, cut: false });
    expect(c.offsetXmm).toBe(1.5);
    expect(labelPage(200, c)).toEqual({ x: 12, y: -16, height: 240 });
  });

  it("clamps silly values", () => {
    const c = normalizeCalib({ heightMm: 999, offsetXmm: 99, feed: 50 });
    expect(c).toMatchObject({ heightMm: 150, offsetXmm: 15, feed: 10 });
  });
});
