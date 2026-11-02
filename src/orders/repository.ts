import { isTauri } from "../live/repository";
import type { CatalogItem, LiveStockItem, OrderDraft, OrderStatus } from "./types";

// Persistence boundary for the catalog and order drafts: SQLite behind Tauri commands in the
// app, an in-memory copy in a plain browser and in tests.

export interface OrderRepository {
  listCatalog(): Promise<CatalogItem[]>;
  upsertCatalogItem(item: CatalogItem): Promise<void>;
  deleteCatalogItem(sku: string): Promise<void>;
  saveDraft(draft: OrderDraft): Promise<void>;
  listDrafts(sessionId: string): Promise<OrderDraft[]>;
  setStatus(id: string, status: OrderStatus, now: string): Promise<boolean>;
  /** Price + "how many are left" per sku, for the Live tab's product panel. */
  stockOverview(): Promise<LiveStockItem[]>;
  /** Remember the exact slip bitmap printed for one order draft, as a PNG, so the seller can
   *  find and check it against the real printout after the session ends. */
  saveSlipImage(orderDraftId: string, imagePng: string): Promise<void>;
  /** Which drafts of a session have a slip image on file (a lightweight marker; not the images
   *  themselves — those are fetched one at a time with `slipImage`). */
  printedSlipIds(sessionId: string): Promise<string[]>;
  slipImage(orderDraftId: string): Promise<string | undefined>;
}

const copyDraft = (d: OrderDraft): OrderDraft => ({
  ...d,
  reasons: [...d.reasons],
  evidence: d.evidence.map((e) => ({ ...e })),
});

export class MemoryOrderRepository implements OrderRepository {
  private catalog = new Map<string, CatalogItem>();
  private drafts = new Map<string, OrderDraft>();
  private slips = new Map<string, string>();

  async listCatalog(): Promise<CatalogItem[]> {
    return [...this.catalog.values()].sort((a, b) => a.sku.localeCompare(b.sku));
  }
  async upsertCatalogItem(item: CatalogItem): Promise<void> {
    this.catalog.set(item.sku, { ...item });
  }
  async deleteCatalogItem(sku: string): Promise<void> {
    this.catalog.delete(sku);
  }
  async saveDraft(draft: OrderDraft): Promise<void> {
    this.drafts.set(draft.id, copyDraft(draft));
  }
  async listDrafts(sessionId: string): Promise<OrderDraft[]> {
    return [...this.drafts.values()].filter((d) => d.sessionId === sessionId).map(copyDraft);
  }
  async setStatus(id: string, status: OrderStatus, now: string): Promise<boolean> {
    const d = this.drafts.get(id);
    if (!d) return false;
    this.drafts.set(id, { ...d, status, updatedAt: now });
    return true;
  }
  // No desktop stock systems exist in the plain-browser/test stand-in: every item reports 0.
  async stockOverview(): Promise<LiveStockItem[]> {
    return [...this.catalog.values()]
      .sort((a, b) => a.sku.localeCompare(b.sku))
      .map((c) => ({ sku: c.sku, name: c.name, price: c.price, stock: 0, source: "biz" as const }));
  }
  async saveSlipImage(orderDraftId: string, imagePng: string): Promise<void> {
    this.slips.set(orderDraftId, imagePng);
  }
  async printedSlipIds(sessionId: string): Promise<string[]> {
    return [...this.drafts.values()]
      .filter((d) => d.sessionId === sessionId && this.slips.has(d.id))
      .map((d) => d.id);
  }
  async slipImage(orderDraftId: string): Promise<string | undefined> {
    return this.slips.get(orderDraftId);
  }
}

interface CatalogDto extends Omit<CatalogItem, "price"> {
  price?: number | null;
}
type DraftDto = {
  [K in keyof OrderDraft]: OrderDraft[K] extends infer V
    ? undefined extends V
      ? V | null
      : V
    : never;
};

const opt = <T>(v: T | null | undefined): T | undefined => v ?? undefined;

export class TauriOrderRepository implements OrderRepository {
  private async call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import("../platform/backend");
    return invoke<T>(cmd, args);
  }

  async listCatalog(): Promise<CatalogItem[]> {
    const rows = await this.call<CatalogDto[]>("catalog_list");
    return rows.map((r) => ({ ...r, price: opt(r.price) }));
  }
  upsertCatalogItem(item: CatalogItem): Promise<void> {
    return this.call("catalog_upsert", { item });
  }
  async deleteCatalogItem(sku: string): Promise<void> {
    await this.call<number>("catalog_delete", { sku });
  }
  saveDraft(draft: OrderDraft): Promise<void> {
    return this.call("order_save", { draft });
  }
  async listDrafts(sessionId: string): Promise<OrderDraft[]> {
    const rows = await this.call<DraftDto[]>("order_list", { sessionId });
    return rows.map((r) => ({
      ...r,
      platformUserId: opt(r.platformUserId),
      username: opt(r.username),
      sku: opt(r.sku),
      color: opt(r.color),
      size: opt(r.size),
      quantity: opt(r.quantity),
    }));
  }
  async setStatus(id: string, status: OrderStatus, now: string): Promise<boolean> {
    return this.call<boolean>("order_set_status", { id, status, now });
  }
  async stockOverview(): Promise<LiveStockItem[]> {
    const rows =
      await this.call<(Omit<LiveStockItem, "price"> & { price?: number | null })[]>(
        "live_stock_overview",
      );
    return rows.map((r) => ({ ...r, price: opt(r.price) }));
  }
  saveSlipImage(orderDraftId: string, imagePng: string): Promise<void> {
    return this.call("order_slip_save", { orderDraftId, imagePng });
  }
  printedSlipIds(sessionId: string): Promise<string[]> {
    return this.call("order_slips_printed", { sessionId });
  }
  async slipImage(orderDraftId: string): Promise<string | undefined> {
    return opt(await this.call<string | null>("order_slip_image", { orderDraftId }));
  }
}

export function createOrderRepository(): OrderRepository {
  return isTauri() ? new TauriOrderRepository() : new MemoryOrderRepository();
}
