import type { LiveCommentEvent } from "../live/types";
import { userKey } from "./engine";
import { normalize } from "./parser";
import type { CatalogItem, OrderDraft } from "./types";

// Read-only views over the current session: nothing here changes a draft.

/**
 * Drafts that look like the same order placed twice: same buyer, same product and variant, not
 * cancelled. They are only flagged; the seller decides which one to keep.
 */
export function duplicateDraftIds(drafts: readonly OrderDraft[]): Set<string> {
  const groups = new Map<string, string[]>();
  for (const d of drafts) {
    const who = userKey(d);
    if (d.status === "CANCELLED" || !who || !d.sku) continue;
    const key = [d.sessionId, who, d.sku, d.color ?? "", d.size ?? ""].join("|");
    groups.set(key, [...(groups.get(key) ?? []), d.id]);
  }
  const out = new Set<string>();
  for (const ids of groups.values()) if (ids.length > 1) ids.forEach((id) => out.add(id));
  return out;
}

export interface AskedProduct {
  sku: string;
  name: string;
  count: number;
}

const squash = (s: string): string => normalize(s).replace(/[-_\s]/g, "");

/** Products named most often in comments (SKU, name or alias), each comment counted once. */
export function topAsked(
  comments: readonly LiveCommentEvent[],
  catalog: readonly CatalogItem[],
  limit = 5,
): AskedProduct[] {
  const terms = catalog.map((c) => ({
    c,
    names: [c.name, ...c.aliases].map(normalize).filter((n) => n.length >= 2),
    sku: squash(c.sku),
  }));
  const counts = new Map<string, number>();
  for (const e of comments) {
    const text = normalize(e.commentText);
    const flat = squash(e.commentText);
    for (const t of terms) {
      if ((t.sku && flat.includes(t.sku)) || t.names.some((n) => text.includes(n))) {
        counts.set(t.c.sku, (counts.get(t.c.sku) ?? 0) + 1);
      }
    }
  }
  return terms
    .filter((t) => counts.has(t.c.sku))
    .map((t) => ({ sku: t.c.sku, name: t.c.name, count: counts.get(t.c.sku) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.sku.localeCompare(b.sku))
    .slice(0, limit);
}
