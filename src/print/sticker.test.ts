// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { OrderDraft } from "../orders/types";
import {
  DEFAULT_STICKER,
  SAMPLE_STICKER,
  draftSeq,
  loadSticker,
  saveSticker,
  stickerData,
  stickerLines,
} from "./sticker";

beforeEach(() => localStorage.clear());

const draft = (id: string, createdAt: string): OrderDraft => ({
  id,
  sessionId: "s",
  username: "cao240724",
  sku: "A12",
  size: "M",
  quantity: 2,
  confidence: 0.9,
  status: "DRAFT",
  reasons: [],
  evidence: [{ eventId: "e1" }] as OrderDraft["evidence"],
  createdAt,
  updatedAt: createdAt,
});

describe("sticker template", () => {
  it("numbers orders by creation order", () => {
    const ds = [draft("b", "2026-01-01T00:02:00Z"), draft("a", "2026-01-01T00:01:00Z")];
    expect(draftSeq(ds, "a")).toBe(1);
    expect(draftSeq(ds, "b")).toBe(2);
  });

  it("builds the lines in order with the chosen sizes and skips empty or hidden ones", () => {
    const lines = stickerLines(DEFAULT_STICKER, { ...SAMPLE_STICKER, phone: "" });
    expect(lines.map((l) => l.text)).toEqual([
      "#6",
      "10/30 15:24",
      "Chốt 2 áo size M",
      "@cao240724",
      "Nguyễn Phương",
    ]);
    expect(lines.find((l) => l.text === "@cao240724")?.px).toBe(41);
    const t = structuredClone(DEFAULT_STICKER);
    t.fields.comment.show = false;
    t.noteText = "Shop A";
    const again = stickerLines(t, SAMPLE_STICKER);
    expect(again.some((l) => l.text.startsWith("Chốt"))).toBe(false);
    expect(again[again.length - 1].text).toBe("Shop A");
  });

  it("never invents a name or phone", () => {
    const d = stickerData(draft("a", "2026-01-01T00:00:00Z"), [], { seq: 1, unknown: "?" });
    expect(d.name).toBe("");
    expect(d.phone).toBe("");
    expect(d.tiktok).toBe("@cao240724");
  });

  it("keeps saved settings and clamps bad sizes", () => {
    const t = structuredClone(DEFAULT_STICKER);
    t.fields.name.px = 40;
    saveSticker(t);
    expect(loadSticker().fields.name.px).toBe(40);
    localStorage.setItem("live-studio.sticker", JSON.stringify({ fields: { name: { px: 999 } } }));
    expect(loadSticker().fields.name.px).toBe(72);
  });
});
