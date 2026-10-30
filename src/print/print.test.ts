// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrintError, type PrintClient } from "./client";
import { layout, packBits, wrapText } from "./raster";
import { PrintService } from "./service";
import { DEFAULT_PRINTER, loadPrinter, savePrinter, type PrinterSettings } from "./settings";
import { tempSlip, type TempSlipLabels } from "./slip";
import type { LiveCommentEvent } from "../live/types";
import type { OrderDraft } from "../orders/types";

const labels: TempSlipLabels = {
  title: "PHIẾU TẠM",
  note: "CHƯA XÁC NHẬN",
  user: "TikTok",
  time: "Giờ",
  comment: "Bình luận",
  product: "Sản phẩm",
  auto: "(tự đọc)",
  unknown: "Chưa rõ",
};

const draft = (over: Partial<OrderDraft> = {}): OrderDraft => ({
  id: "d1",
  sessionId: "s1",
  username: "amy_shop",
  sku: "A12",
  color: "黑色",
  size: "M",
  quantity: 2,
  confidence: 0.9,
  status: "DRAFT",
  reasons: [],
  evidence: [
    { eventId: "e1", field: "sku", text: "A12" },
    { eventId: "e2", field: "color", text: "黑色" },
  ],
  createdAt: "2026-10-30T02:00:00.000Z",
  updatedAt: "2026-10-30T02:00:00.000Z",
  ...over,
});

const comment = (id: string, text: string): LiveCommentEvent => ({
  eventId: id,
  platform: "tiktok",
  sessionId: "s1",
  username: "amy_shop",
  commentText: text,
  commentTimestamp: "2026-10-30T02:00:00.000Z",
  receivedAt: "2026-10-30T02:00:00.000Z",
  source: "MANUAL",
});

describe("temporary slip", () => {
  it("carries the TikTok id, the comments and a not-confirmed mark, and nothing personal", () => {
    const slip = tempSlip(draft(), [comment("e1", "A12 要兩個"), comment("e2", "黑色 M")], labels);
    const text = slip.lines.map((l) => l.text).join("\n");
    expect(text).toContain("CHƯA XÁC NHẬN");
    expect(text).toContain("TikTok: amy_shop");
    expect(text).toContain("A12 要兩個");
    expect(text).toContain("黑色 M");
    expect(text).toContain("A12  黑色 / M  x2");
    expect(text).not.toMatch(/phone|điện thoại|địa chỉ|電話|地址/i);
  });

  it("says the product is unknown instead of guessing", () => {
    const slip = tempSlip(draft({ sku: undefined, color: undefined, size: undefined }), [], labels);
    expect(slip.lines[slip.lines.length - 1].text).toBe("Chưa rõ");
  });
});

describe("raster helpers", () => {
  const per = (t: string) => t.length * 10;

  it("wraps CJK text between characters and Latin text at spaces", () => {
    expect(wrapText("一二三四五六", 30, per)).toEqual(["一二三", "四五六"]);
    expect(wrapText("hello big world", 100, per)).toEqual(["hello big", "world"]);
    expect(wrapText("a\nb", 100, per)).toEqual(["a", "b"]);
  });

  it("packs dark pixels into bits, most significant bit first", () => {
    // 10 dots wide, 1 row: dark at x=0 and x=9, white elsewhere.
    const rgba = new Uint8Array(10 * 4).fill(255);
    for (const x of [0, 9]) rgba.set([0, 0, 0, 255], x * 4);
    const bits = packBits(rgba, 10, 1);
    expect(Array.from(bits)).toEqual([0b10000000, 0b01000000]);
  });

  it("treats transparent pixels as white", () => {
    expect(Array.from(packBits(new Uint8Array(8 * 4), 8, 1))).toEqual([0]);
  });

  it("lays out lines top to bottom with a margin", () => {
    const { placed, height } = layout(
      {
        lines: [
          { text: "ab", size: "md" },
          { text: "", size: "sm", rule: true },
        ],
      },
      200,
      () => per,
    );
    expect(placed[0].y).toBeLessThan(placed[1].y);
    expect(height).toBeGreaterThan(placed[1].y);
  });
});

describe("printer settings", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to off and ignores a corrupt saved value", () => {
    expect(loadPrinter()).toEqual(DEFAULT_PRINTER);
    localStorage.setItem("live-studio.printer", "{nope");
    expect(loadPrinter()).toEqual(DEFAULT_PRINTER);
    localStorage.setItem(
      "live-studio.printer",
      JSON.stringify({ host: " 192.168.1.9 ", port: 99999, widthDots: 500, autoTemp: "yes" }),
    );
    expect(loadPrinter()).toEqual({
      host: "192.168.1.9",
      port: 9100,
      widthDots: 576,
      autoTemp: false,
    });
  });

  it("round-trips", () => {
    const s: PrinterSettings = { host: "10.0.0.5", port: 9101, widthDots: 384, autoTemp: true };
    savePrinter(s);
    expect(loadPrinter()).toEqual(s);
  });
});

describe("PrintService", () => {
  const settings: PrinterSettings = {
    host: "192.168.1.50",
    port: 9100,
    widthDots: 576,
    autoTemp: false,
  };
  const page = { width: 8, height: 1, bits: new Uint8Array(1) };
  const slip = { lines: [{ text: "x", size: "md" as const }] };

  function service(client: Partial<PrintClient> = {}, loaded = settings) {
    const sent: number[] = [];
    const full: PrintClient = {
      available: true,
      print: vi.fn(async () => void sent.push(sent.length)),
      probe: vi.fn(async () => undefined),
      ...client,
    };
    return {
      svc: new PrintService({ client: full, loadSettings: () => loaded, render: () => page }),
      full,
      sent,
    };
  }

  it("prints slips one at a time and counts them", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { svc } = service({
      print: async () => {
        order.push("start");
        await gate;
        order.push("end");
      },
    });
    const a = svc.print(slip);
    const b = svc.print(slip);
    await Promise.resolve();
    expect(svc.getSnapshot().pending).toBe(2);
    release();
    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect(order).toEqual(["start", "end", "start", "end"]);
    expect(svc.getSnapshot()).toMatchObject({
      printing: false,
      pending: 0,
      printed: 2,
      error: undefined,
    });
  });

  it("keeps the error code of a failed print and keeps going afterwards", async () => {
    let fail = true;
    const { svc } = service({
      print: async () => {
        if (fail) throw new PrintError("UNREACHABLE");
      },
    });
    expect(await svc.print(slip)).toBe(false);
    expect(svc.getSnapshot().error).toBe("UNREACHABLE");
    fail = false;
    expect(await svc.print(slip)).toBe(true);
    expect(svc.getSnapshot().error).toBeUndefined();
  });

  it("does not try to print without an IP", async () => {
    const { svc, full } = service({}, { ...settings, host: "" });
    expect(await svc.print(slip)).toBe(false);
    expect(svc.getSnapshot().error).toBe("NOT_CONFIGURED");
    expect(full.print).not.toHaveBeenCalled();
    expect(await svc.probe({ ...settings, host: "" })).toBe("NOT_CONFIGURED");
  });

  it("reports a render failure as RENDER", async () => {
    const svc = new PrintService({
      client: { available: true, print: async () => undefined, probe: async () => undefined },
      loadSettings: () => settings,
      render: () => {
        throw new Error("no canvas");
      },
    });
    expect(await svc.print(slip)).toBe(false);
    expect(svc.getSnapshot().error).toBe("RENDER");
  });

  it("probe returns undefined when reachable and the code when not", async () => {
    expect(await service().svc.probe(settings)).toBeUndefined();
    const { svc } = service({ probe: async () => Promise.reject(new PrintError("TIMEOUT")) });
    expect(await svc.probe(settings)).toBe("TIMEOUT");
  });
});
