import { describe, expect, it } from "vitest";
import type { LiveCommentEvent } from "../live/types";
import { duplicateDraftIds, topAsked } from "./insights";
import type { CatalogItem, OrderDraft } from "./types";

const draft = (id: string, over: Partial<OrderDraft> = {}): OrderDraft => ({
  id,
  sessionId: "s1",
  username: "mai",
  sku: "A01",
  color: "đen",
  size: "M",
  quantity: 1,
  confidence: 0.9,
  status: "DRAFT",
  reasons: [],
  evidence: [],
  createdAt: "2026-10-30T01:00:00Z",
  updatedAt: "2026-10-30T01:00:00Z",
  ...over,
});

const comment = (id: string, text: string): LiveCommentEvent =>
  ({ eventId: id, commentText: text }) as LiveCommentEvent;

const item = (sku: string, name: string, aliases: string[] = []): CatalogItem => ({
  sku,
  name,
  colors: [],
  sizes: [],
  aliases,
});

describe("duplicateDraftIds", () => {
  it("flags the same buyer ordering the same variant twice", () => {
    expect([...duplicateDraftIds([draft("a"), draft("b")])].sort()).toEqual(["a", "b"]);
  });
  it("ignores other buyers, other variants, cancelled and unknown products", () => {
    const ids = duplicateDraftIds([
      draft("a"),
      draft("b", { username: "lan" }),
      draft("c", { size: "L" }),
      draft("d", { status: "CANCELLED" }),
      draft("e", { sku: undefined }),
      draft("f", { sku: undefined }),
    ]);
    expect(ids.size).toBe(0);
  });
  it("treats a cancelled copy as resolved", () => {
    expect(duplicateDraftIds([draft("a"), draft("b", { status: "CANCELLED" })]).size).toBe(0);
  });
});

describe("topAsked", () => {
  const catalog = [item("A-01", "Áo thun", ["áo trắng"]), item("B02", "Quần jean")];
  it("counts each comment once per product, by SKU, name or alias", () => {
    const r = topAsked(
      [
        comment("1", "A01 còn không"),
        comment("2", "áo thun size M"),
        comment("3", "áo trắng áo thun"),
        comment("4", "quần jean giá bao nhiêu"),
        comment("5", "chào shop"),
      ],
      catalog,
    );
    expect(r).toEqual([
      { sku: "A-01", name: "Áo thun", count: 3 },
      { sku: "B02", name: "Quần jean", count: 1 },
    ]);
  });
  it("returns nothing without a catalog or matches, and respects the limit", () => {
    expect(topAsked([comment("1", "x")], [])).toEqual([]);
    expect(topAsked([comment("1", "A01 B02")], catalog, 1)).toHaveLength(1);
  });
});
