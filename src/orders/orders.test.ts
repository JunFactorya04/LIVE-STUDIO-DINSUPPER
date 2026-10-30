import { describe, expect, it } from "vitest";
import type { LiveCommentEvent } from "../live/types";
import { parseCatalogCsv } from "./catalogCsv";
import { applyComment, canTransition } from "./engine";
import { parseOrderComment, toInt } from "./parser";
import type { CatalogItem, OrderDraft } from "./types";

const catalog: CatalogItem[] = [
  {
    sku: "A12",
    name: "黑色連帽衫",
    price: 790,
    colors: ["黑色|黑|black", "白色|白"],
    sizes: ["M", "L", "XL"],
    aliases: ["帽T"],
  },
  { sku: "A123", name: "針織外套", colors: ["米色"], sizes: [], aliases: [] },
  { sku: "B7", name: "托特包", colors: [], sizes: [], aliases: [] },
];

let n = 0;
const newId = (): string => `d${++n}`;
const opts = { newId };

function ev(
  user: string,
  text: string,
  sec = 0,
  extra: Partial<LiveCommentEvent> = {},
): LiveCommentEvent {
  const t = new Date(Date.UTC(2026, 9, 30, 2, 0, sec)).toISOString();
  return {
    eventId: `e-${user}-${sec}-${text}`,
    platform: "tiktok",
    sessionId: "s1",
    username: user,
    commentText: text,
    commentTimestamp: t,
    receivedAt: t,
    source: "MANUAL",
    ...extra,
  };
}

function run(events: LiveCommentEvent[]): OrderDraft[] {
  let drafts: OrderDraft[] = [];
  for (const e of events) drafts = applyComment(drafts, e, catalog, opts).drafts;
  return drafts;
}

describe("parser", () => {
  it("reads a full order", () => {
    const p = parseOrderComment("A12 黑色 M ×2", catalog);
    expect(p).toMatchObject({
      sku: "A12",
      color: "黑色",
      size: "M",
      quantity: 2,
      skuByName: false,
    });
  });

  it("matches the SKU exactly: A12 is not A123", () => {
    expect(parseOrderComment("A123 米色 x1", catalog).sku).toBe("A123");
    expect(parseOrderComment("a-12 黑 l x3", catalog)).toMatchObject({
      sku: "A12",
      color: "黑色",
      size: "L",
      quantity: 3,
    });
  });

  it("does not read SKU or size digits as quantity", () => {
    const p = parseOrderComment("B7", catalog);
    expect(p.sku).toBe("B7");
    expect(p.quantity).toBeUndefined();
  });

  it("reads Chinese, Vietnamese and english quantities", () => {
    expect(parseOrderComment("B7 我要兩個", catalog).quantity).toBe(2);
    expect(parseOrderComment("B7 三件", catalog).quantity).toBe(3);
    expect(parseOrderComment("B7 lấy 4 cái", catalog).quantity).toBe(4);
    expect(parseOrderComment("B7 5 pcs", catalog).quantity).toBe(5);
    expect(toInt("十五")).toBe(15);
    expect(toInt("二十三")).toBe(23);
    expect(toInt("十")).toBe(10);
    expect(toInt("二三")).toBeUndefined();
  });

  it("flags a quantity over the limit instead of storing it", () => {
    const p = parseOrderComment("B7 x500", catalog);
    expect(p.qtyTooLarge).toBe(true);
    expect(p.quantity).toBeUndefined();
  });

  it("finds the product by name, with lower weight", () => {
    const p = parseOrderComment("帽T 白 L 1件", catalog);
    expect(p).toMatchObject({ sku: "A12", skuByName: true, color: "白色", size: "L", quantity: 1 });
  });

  it("a color inside the product name is not the customer's color", () => {
    const p = parseOrderComment("黑色連帽衫 M x1", catalog);
    expect(p.sku).toBe("A12");
    expect(p.color).toBeUndefined();
  });

  it("reports unknown and multiple SKUs", () => {
    expect(parseOrderComment("Z99 x1", catalog).unknownSku).toBe("z99");
    expect(parseOrderComment("A12 B7 各一件", catalog).multipleSku).toBe(true);
    expect(parseOrderComment("A12 Z99", catalog).multipleSku).toBe(true);
  });

  it("a size letter inside a word is not a size", () => {
    expect(parseOrderComment("A12 please", catalog).size).toBeUndefined();
  });

  it("two colors in one comment are a conflict, not a guess", () => {
    const p = parseOrderComment("A12 黑色 白色 M x1", catalog);
    expect(p.color).toBeUndefined();
    expect(p.conflicts).toContain("color");
  });
});

describe("engine", () => {
  it("complete comment -> DRAFT with evidence", () => {
    const [d] = run([ev("amy", "A12 黑色 M x2", 0, { platformUserId: "u1" })]);
    expect(d).toMatchObject({
      status: "DRAFT",
      sku: "A12",
      color: "黑色",
      size: "M",
      quantity: 2,
      confidence: 1,
      reasons: [],
    });
    expect(d?.evidence.map((e) => e.field)).toEqual(["sku", "color", "size", "quantity"]);
  });

  it("spec 7: unknown SKU -> NEEDS_REVIEW", () => {
    const [d] = run([ev("amy", "Z99 x1", 0, { platformUserId: "u1" })]);
    expect(d?.status).toBe("NEEDS_REVIEW");
    expect(d?.reasons).toContain("SKU_NOT_FOUND");
    expect(d?.sku).toBeUndefined();
  });

  it("spec 8: missing color, size and quantity are listed", () => {
    const [d] = run([ev("amy", "A12", 0, { platformUserId: "u1" })]);
    expect(d?.status).toBe("NEEDS_REVIEW");
    expect(d?.reasons).toEqual(["MISSING_COLOR", "MISSING_SIZE", "MISSING_QTY"]);
    expect(d?.confidence).toBeLessThanOrEqual(0.5);
  });

  it("spec 9: one customer completes an order across comments", () => {
    const drafts = run([
      ev("amy", "A12", 0, { platformUserId: "u1" }),
      ev("amy", "黑色", 10, { platformUserId: "u1" }),
      ev("amy", "M", 20, { platformUserId: "u1" }),
      ev("amy", "我要兩個", 30, { platformUserId: "u1" }),
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      status: "DRAFT",
      sku: "A12",
      color: "黑色",
      size: "M",
      quantity: 2,
      reasons: [],
    });
  });

  it("spec 10: two customers interleaved are never mixed", () => {
    const drafts = run([
      ev("amy", "A12 黑色", 0, { platformUserId: "u1" }),
      ev("ben", "B7", 5, { platformUserId: "u2" }),
      ev("amy", "M x1", 10, { platformUserId: "u1" }),
      ev("ben", "x3", 12, { platformUserId: "u2" }),
    ]);
    expect(drafts).toHaveLength(2);
    expect(drafts.find((d) => d.platformUserId === "u1")).toMatchObject({
      sku: "A12",
      color: "黑色",
      size: "M",
      quantity: 1,
      status: "DRAFT",
    });
    expect(drafts.find((d) => d.platformUserId === "u2")).toMatchObject({
      sku: "B7",
      quantity: 3,
      status: "DRAFT",
    });
  });

  it("'我要兩個' with no product context needs review", () => {
    const [d] = run([ev("amy", "我要兩個", 0, { platformUserId: "u1" })]);
    expect(d).toMatchObject({ status: "NEEDS_REVIEW", quantity: 2 });
    expect(d?.reasons).toContain("NO_SKU");
  });

  it("chatter, colors alone and bare numbers never open a draft", () => {
    expect(
      run([
        ev("amy", "好漂亮 😍", 0),
        ev("amy", "黑色", 5),
        ev("amy", "666", 8),
        ev("amy", "2", 9),
      ]),
    ).toHaveLength(0);
  });

  it("a later comment outside the window starts a new draft", () => {
    const drafts = run([
      ev("amy", "B7 x1", 0, { platformUserId: "u1" }),
      ev("amy", "B7 x2", 600, { platformUserId: "u1" }),
    ]);
    expect(drafts).toHaveLength(2);
  });

  it("a different product starts a new draft and keeps the first", () => {
    const drafts = run([
      ev("amy", "B7 x1", 0, { platformUserId: "u1" }),
      ev("amy", "A12 黑 M x1", 20, { platformUserId: "u1" }),
    ]);
    expect(drafts.map((d) => d.sku)).toEqual(["B7", "A12"]);
  });

  it("conflicting values keep the first and ask for review", () => {
    const drafts = run([
      ev("amy", "A12 黑色 M x1", 0, { platformUserId: "u1" }),
      ev("amy", "白色", 10, { platformUserId: "u1" }),
    ]);
    expect(drafts[0]).toMatchObject({ color: "黑色", status: "NEEDS_REVIEW" });
    expect(drafts[0]?.reasons).toContain("CONFLICT_COLOR");
  });

  it("a fixed unknown SKU clears the reason", () => {
    const [d] = run([
      ev("amy", "Z99", 0, { platformUserId: "u1" }),
      ev("amy", "B7 x1", 10, { platformUserId: "u1" }),
    ]);
    expect(d).toMatchObject({ sku: "B7", status: "DRAFT", reasons: [] });
  });

  it("username-only users are capped at 0.8; no user at all needs review", () => {
    const [named] = run([ev("amy", "B7 x1")]);
    expect(named).toMatchObject({ status: "DRAFT", confidence: 0.8 });
    const [anon] = run([ev("", "B7 x1")]);
    expect(anon?.reasons).toContain("NO_USER");
    expect(anon?.status).toBe("NEEDS_REVIEW");
  });

  it("matching by name lowers confidence", () => {
    const [d] = run([ev("amy", "托特包 x1", 0, { platformUserId: "u1" })]);
    expect(d).toMatchObject({ sku: "B7", confidence: 0.85, status: "DRAFT" });
  });

  it("the same comment twice is not counted twice, and the input is not mutated", () => {
    const first = run([ev("amy", "B7 x1", 0, { platformUserId: "u1" })]);
    const snapshot = JSON.stringify(first);
    const again = applyComment(
      first,
      ev("amy", "B7 x1", 0, { platformUserId: "u1" }),
      catalog,
      opts,
    );
    expect(again.changed).toBeUndefined();
    expect(again.drafts).toHaveLength(1);
    applyComment(first, ev("amy", "x5", 5, { platformUserId: "u1" }), catalog, opts);
    expect(JSON.stringify(first)).toBe(snapshot);
  });

  it("confirmed and cancelled drafts are not merged into", () => {
    const first = run([ev("amy", "B7 x1", 0, { platformUserId: "u1" })]);
    const confirmed = first.map((d) => ({ ...d, status: "CONFIRMED" as const }));
    const r = applyComment(confirmed, ev("amy", "x2", 10, { platformUserId: "u1" }), catalog, opts);
    // The confirmed draft is untouched; the new quantity opens a separate draft for review.
    expect(r.drafts[0]).toMatchObject({ status: "CONFIRMED", quantity: 1 });
    expect(r.drafts[1]).toMatchObject({ status: "NEEDS_REVIEW", quantity: 2 });
  });

  it("transitions follow the seller rules", () => {
    expect(canTransition("DRAFT", "CONFIRMED")).toBe(true);
    expect(canTransition("NEEDS_REVIEW", "CONFIRMED")).toBe(false);
    expect(canTransition("CONFIRMED", "CANCELLED")).toBe(true);
    expect(canTransition("CANCELLED", "CANCELLED")).toBe(false);
  });
});

describe("catalog csv", () => {
  it("reads tab and comma data, skips the header, reports bad lines", () => {
    const r = parseCatalogCsv(
      "sku,name,price,colors,sizes,aliases\nA1,連帽衫,NT$790,黑色|黑;白色,M;L,帽T\nbad\nB2\t托特包\t\t\t\t",
    );
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({
      sku: "A1",
      price: 790,
      colors: ["黑色|黑", "白色"],
      sizes: ["M", "L"],
      aliases: ["帽T"],
    });
    expect(r.items[1]).toMatchObject({ sku: "B2", name: "托特包", colors: [] });
    expect(r.errors).toEqual([3]);
  });
});
