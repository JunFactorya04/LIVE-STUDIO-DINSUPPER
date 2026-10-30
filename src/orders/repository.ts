import { isTauri } from "../live/repository";
import type { CatalogItem, OrderDraft, OrderStatus } from "./types";

// Persistence boundary for the catalog and order drafts: SQLite behind Tauri commands in the
// app, an in-memory copy in a plain browser and in tests.

export interface OrderRepository {
  listCatalog(): Promise<CatalogItem[]>;
  upsertCatalogItem(item: CatalogItem): Promise<void>;
  deleteCatalogItem(sku: string): Promise<void>;
  saveDraft(draft: OrderDraft): Promise<void>;
  listDrafts(sessionId: string): Promise<OrderDraft[]>;
  setStatus(id: string, status: OrderStatus, now: string): Promise<boolean>;
}

const copyDraft = (d: OrderDraft): OrderDraft => ({
  ...d,
  reasons: [...d.reasons],
  evidence: d.evidence.map((e) => ({ ...e })),
});

export class MemoryOrderRepository implements OrderRepository {
  private catalog = new Map<string, CatalogItem>();
  private drafts = new Map<string, OrderDraft>();

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
}

export function createOrderRepository(): OrderRepository {
  return isTauri() ? new TauriOrderRepository() : new MemoryOrderRepository();
}
