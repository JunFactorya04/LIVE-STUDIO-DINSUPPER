import type { LiveCommentEvent } from "../live/types";
import { isOrderLike, parseOrderComment, type ParsedOrder } from "./parser";
import type { CatalogItem, OrderDraft, OrderEvidence, OrderStatus, ReviewReason } from "./types";

export interface EngineOptions {
  newId: () => string;
  /** Comments of one customer within this window join the same draft. */
  windowMs?: number;
  maxQuantity?: number;
}

export interface ApplyResult {
  drafts: OrderDraft[];
  /** The draft that was created or updated (to persist), if any. */
  changed?: OrderDraft;
}

export const DEFAULT_WINDOW_MS = 120_000;

/** Reasons that stay on a draft until a later comment resolves them. */
const STICKY: ReadonlySet<ReviewReason> = new Set<ReviewReason>([
  "SKU_NOT_FOUND",
  "MULTIPLE_SKU",
  "CONFLICT_COLOR",
  "CONFLICT_SIZE",
  "CONFLICT_QTY",
  "QTY_TOO_LARGE",
]);

const isOpen = (s: OrderStatus): boolean => s === "DRAFT" || s === "NEEDS_REVIEW";

export function userKey(u: { platformUserId?: string; username?: string }): string | undefined {
  if (u.platformUserId) return `id:${u.platformUserId}`;
  const name = u.username?.trim().toLowerCase();
  return name ? `name:${name}` : undefined;
}

function findOpen(
  drafts: readonly OrderDraft[],
  event: LiveCommentEvent,
  key: string,
  windowMs: number,
): OrderDraft | undefined {
  const at = Date.parse(event.commentTimestamp);
  for (let i = drafts.length - 1; i >= 0; i--) {
    const d = drafts[i];
    if (!d || d.sessionId !== event.sessionId || !isOpen(d.status) || userKey(d) !== key) continue;
    const last = Date.parse(d.updatedAt);
    if (Number.isNaN(at) || Number.isNaN(last) || Math.abs(at - last) <= windowMs) return d;
  }
  return undefined;
}

export function applyComment(
  drafts: readonly OrderDraft[],
  event: LiveCommentEvent,
  catalog: readonly CatalogItem[],
  opts: EngineOptions,
): ApplyResult {
  const unchanged: ApplyResult = { drafts: [...drafts] };
  // The same comment never counts twice (reconnects, repeated paste).
  if (
    drafts.some(
      (d) => d.sessionId === event.sessionId && d.evidence.some((e) => e.eventId === event.eventId),
    )
  ) {
    return unchanged;
  }

  const key = userKey(event);
  const open = key ? findOpen(drafts, event, key, opts.windowMs ?? DEFAULT_WINDOW_MS) : undefined;
  const openItem = open?.sku ? catalog.find((c) => c.sku === open.sku) : undefined;
  const parsed = parseOrderComment(event.commentText, catalog, {
    contextItem: openItem,
    maxQuantity: opts.maxQuantity,
  });

  const orderLike = isOrderLike(parsed);
  const touches =
    orderLike ||
    parsed.color !== undefined ||
    parsed.size !== undefined ||
    parsed.quantity !== undefined ||
    parsed.qtyTooLarge ||
    parsed.conflicts.length > 0;

  let base: OrderDraft | undefined;
  if (open && touches) {
    // A different product starts a new draft; the earlier one stays as it was.
    const differentProduct =
      parsed.multipleSku ||
      (open.sku !== undefined &&
        ((parsed.sku !== undefined && parsed.sku !== open.sku) || parsed.unknownSku !== undefined));
    base = differentProduct ? undefined : open;
  }
  if (!base && !orderLike) return unchanged;

  const stamp = event.commentTimestamp;
  const start: OrderDraft = base ?? {
    id: opts.newId(),
    sessionId: event.sessionId,
    platformUserId: event.platformUserId,
    username: event.username,
    confidence: 1,
    status: "DRAFT",
    reasons: [],
    evidence: [],
    createdAt: stamp,
    updatedAt: stamp,
  };
  const next = merge(start, parsed, event, catalog);
  const list = base ? drafts.map((d) => (d.id === base.id ? next : d)) : [...drafts, next];
  return { drafts: list, changed: next };
}

function merge(
  d: OrderDraft,
  p: ParsedOrder,
  event: LiveCommentEvent,
  catalog: readonly CatalogItem[],
): OrderDraft {
  let { sku, color, size, quantity } = d;
  const sticky = new Set(d.reasons.filter((r) => STICKY.has(r)));
  const evidence: OrderEvidence[] = [...d.evidence];
  const note = (field: string, text: string): void => {
    if (!evidence.some((e) => e.eventId === event.eventId && e.field === field)) {
      evidence.push({ eventId: event.eventId, field, text });
    }
  };
  const ev = (field: string): string =>
    p.evidence.find((e) => e.field === field)?.text ?? event.commentText;

  if (p.sku && !sku) {
    sku = p.sku;
    sticky.delete("SKU_NOT_FOUND");
    sticky.delete("MULTIPLE_SKU");
    note(p.skuByName ? "sku_name" : "sku", ev(p.skuByName ? "sku_name" : "sku"));
  } else if (p.multipleSku && !sku) {
    sticky.add("MULTIPLE_SKU");
    note("sku", event.commentText);
  } else if (p.unknownSku && !sku) {
    sticky.add("SKU_NOT_FOUND");
    note("unknown_sku", p.unknownSku);
  }

  for (const [field, value] of [
    ["color", p.color],
    ["size", p.size],
  ] as const) {
    const current = field === "color" ? color : size;
    if (value !== undefined) {
      if (current === undefined) {
        if (field === "color") color = value;
        else size = value;
        note(field, ev(field));
      } else if (current !== value) {
        sticky.add(field === "color" ? "CONFLICT_COLOR" : "CONFLICT_SIZE");
      }
    }
    if (p.conflicts.includes(field))
      sticky.add(field === "color" ? "CONFLICT_COLOR" : "CONFLICT_SIZE");
  }

  const qtyField = p.qtyLow ? "quantity_low" : "quantity";
  if (p.qtyTooLarge) {
    sticky.add("QTY_TOO_LARGE");
    note(qtyField, ev(qtyField));
  } else if (p.quantity !== undefined) {
    if (quantity === undefined) {
      quantity = p.quantity;
      sticky.delete("QTY_TOO_LARGE");
      note(qtyField, ev(qtyField));
    } else if (quantity !== p.quantity) {
      sticky.add("CONFLICT_QTY");
    }
  }

  const item = sku ? catalog.find((c) => c.sku === sku) : undefined;
  const reasons: ReviewReason[] = [];
  if (!d.platformUserId && !d.username) reasons.push("NO_USER");
  if (!sku) {
    reasons.push(
      sticky.has("SKU_NOT_FOUND")
        ? "SKU_NOT_FOUND"
        : sticky.has("MULTIPLE_SKU")
          ? "MULTIPLE_SKU"
          : "NO_SKU",
    );
  }
  if (item && item.colors.length > 0 && !color) reasons.push("MISSING_COLOR");
  if (item && item.sizes.length > 0 && !size) reasons.push("MISSING_SIZE");
  if (quantity === undefined && !sticky.has("QTY_TOO_LARGE")) reasons.push("MISSING_QTY");
  for (const r of ["CONFLICT_COLOR", "CONFLICT_SIZE", "CONFLICT_QTY", "QTY_TOO_LARGE"] as const) {
    if (sticky.has(r)) reasons.push(r);
  }

  let confidence = 1;
  if (evidence.some((e) => e.field === "sku_name")) confidence *= 0.85;
  if (evidence.some((e) => e.field === "quantity_low")) confidence *= 0.9;
  if (!d.platformUserId) confidence = Math.min(confidence, 0.8);
  if (reasons.length > 0) confidence = Math.min(confidence, 0.5);

  return {
    ...d,
    sku,
    color,
    size,
    quantity,
    reasons,
    evidence,
    confidence: Math.round(confidence * 100) / 100,
    status: reasons.length > 0 ? "NEEDS_REVIEW" : "DRAFT",
    updatedAt: event.commentTimestamp,
  };
}

/** Seller decisions, same rules as the Rust side: CONFIRMED only from DRAFT. */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (to === "CONFIRMED") return from === "DRAFT";
  if (to === "CANCELLED") return from !== "CANCELLED";
  return false;
}
