// Catalog and order drafts (docs/TIKTOK_LIVE_ASSISTANT.md, orders section).
// A draft is only a suggestion for the seller. Nothing here creates a real order, and the
// engine never invents a name, phone number or address.

export interface CatalogItem {
  sku: string;
  name: string;
  price?: number;
  /** Each entry may carry aliases separated by "|", e.g. "黑色|黑|black". The first one is canonical. */
  colors: string[];
  sizes: string[];
  /** Extra names customers use for the product. */
  aliases: string[];
}

export type OrderStatus = "DRAFT" | "NEEDS_REVIEW" | "CONFIRMED" | "CANCELLED";

export type ReviewReason =
  | "NO_USER"
  | "NO_SKU"
  | "SKU_NOT_FOUND"
  | "MULTIPLE_SKU"
  | "MISSING_COLOR"
  | "MISSING_SIZE"
  | "MISSING_QTY"
  | "QTY_TOO_LARGE"
  | "CONFLICT_COLOR"
  | "CONFLICT_SIZE"
  | "CONFLICT_QTY";

/** Which comment produced which field. `sku_name` / `quantity_low` mark weaker evidence. */
export interface OrderEvidence {
  eventId: string;
  field: string;
  text: string;
}

export interface OrderDraft {
  id: string;
  sessionId: string;
  platformUserId?: string;
  username?: string;
  sku?: string;
  color?: string;
  size?: string;
  quantity?: number;
  confidence: number;
  status: OrderStatus;
  reasons: ReviewReason[];
  evidence: OrderEvidence[];
  createdAt: string;
  updatedAt: string;
}
