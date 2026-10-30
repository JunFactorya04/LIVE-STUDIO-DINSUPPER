import { describe, expect, it } from "vitest";
import { createDwell, cropRect } from "./dwell";

describe("dwell", () => {
  it("accepts a code only after 3 seconds of the same code, once", () => {
    const d = createDwell(3000, 600);
    expect(d.feed("A-000001", 0).done).toBe(false);
    expect(d.feed("A-000001", 1500).progress).toBeCloseTo(0.5);
    const end = d.feed("A-000001", 3000);
    expect(end.done).toBe(true);
    // still in front of the camera: no second acceptance
    expect(d.feed("A-000001", 3200).done).toBe(false);
    expect(d.feed("A-000001", 9000).done).toBe(false);
  });

  it("restarts when another code takes over, and survives a short blur", () => {
    const d = createDwell(3000, 600);
    d.feed("A-000001", 0);
    d.feed("B-000002", 1000); // overlapping label read: the count restarts
    expect(d.feed("B-000002", 3500).done).toBe(false);
    d.feed(undefined, 3700); // one lost frame
    expect(d.feed("B-000002", 4100).done).toBe(true);
  });

  it("forgets the code after a longer gap and can accept it again later", () => {
    const d = createDwell(1000, 300);
    d.feed("A-000001", 0);
    expect(d.feed("A-000001", 1000).done).toBe(true);
    d.feed(undefined, 1200);
    d.feed(undefined, 2000); // left the frame
    d.feed("A-000001", 2100);
    expect(d.feed("A-000001", 3100).done).toBe(true);
  });
});

describe("cropRect", () => {
  it("maps the window to the picture for a cover-fitted video", () => {
    // 400x800 screen showing a 1280x720 picture: scale 800/720, centred horizontally
    const r = cropRect({ w: 400, h: 800 }, { x: 40, y: 300, w: 320, h: 120 }, { w: 1280, h: 720 });
    expect(r.h).toBe(108);
    expect(r.y).toBe(270);
    expect(r.w).toBeGreaterThan(250);
    expect(r.x + r.w).toBeLessThanOrEqual(1280);
  });
});
