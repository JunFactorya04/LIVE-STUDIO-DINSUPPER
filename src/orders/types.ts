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
  /** Free-form fields the seller defines for shops outside clothing (expiry date, volume,
   *  brand...): key -> value. Optional and defaulted to {} everywhere it is read, so existing
   *  catalog items and fixtures that never set it keep working unchanged. */
  attrs?: Record<string, string>;
}

/** One catalog item with the single stock number to show while live (console/StockPanel.tsx):
 *  whichever of the app's two stock systems the seller actually uses for this sku. */
export interface LiveStockItem {
  sku: string;
  name: string;
  price?: number;
  stock: number;
  /** "wh" = counted from the barcode warehouse (the seller scans units for this sku);
   *  "biz" = the simple per-sku counter, used when the sku is never scanned into the warehouse. */
  source: "wh" | "biz";
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
