import { isTauri } from "../live/repository";

// Shipping orders (7-ELEVEN pickup), saved customers and the importable store list. All data
// lives in the local database through Rust. Outside the desktop app there is nothing stored, so
// the client reports itself as unavailable instead of pretending.

export type Temperature = "NORMAL" | "FROZEN";

export interface ShipOrder {
  id: string;
  tiktokId: string;
  recipientName: string;
  phone: string;
  temperature: Temperature;
  storeCode: string;
  storeName: string;
  product: string;
  note: string;
  amount: number;
  shippingFee: number;
  /** amount + shippingFee, computed by the backend. */
  cod: number;
  exported: boolean;
  createdAt: string;
  /** Catalog sku sold and units; "" and 0 when the order is not tracked in stock. */
  sku: string;
  qty: number;
  /** Cost per unit when the order was saved (computed by the backend). */
  unitCost: number;
}

export interface ShipCustomer {
  tiktokId: string;
  name: string;
  phone: string;
  storeCode: string;
  storeName: string;
  updatedAt: string;
}

export interface FlowRecord {
  tiktokId: string;
  slipPrintedAt: string | null;
  askCopiedAt: string | null;
}

export type FlowMark = "SLIP_PRINTED" | "ASK_COPIED";

export interface Store {
  code: string;
  name: string;
  address: string;
}

export interface StoreHit extends Store {
  /** Listed on the map but cannot take pickup parcels right now. */
  disabled: boolean;
}

export interface ShipClient {
  readonly available: boolean;
  orders(): Promise<ShipOrder[]>;
  saveOrder(order: ShipOrder, remember: boolean): Promise<ShipOrder>;
  deleteOrder(id: string): Promise<void>;
  setExported(ids: string[], exported: boolean): Promise<void>;
  customers(): Promise<ShipCustomer[]>;
  saveCustomer(c: ShipCustomer): Promise<ShipCustomer>;
  deleteCustomer(tiktokId: string): Promise<void>;
  /** Text lines `code,name,address`. Returns how many were imported and skipped. */
  importStores(body: string): Promise<{ imported: number; skipped: number }>;
  lookupStore(code: string): Promise<Store | undefined>;
  storesCount(): Promise<number>;
  /** Which steps of the A-Z routine were done for each buyer. */
  flow(): Promise<FlowRecord[]>;
  markFlow(tiktokId: string, step: FlowMark): Promise<void>;
  /** Search 7-ELEVEN's public map by number, name or address (needs the internet). */
  searchStores(query: string): Promise<StoreHit[]>;
  /** Writes the 7-ELEVEN order-import workbook to Downloads and returns its path. */
  exportXlsx(ids: string[], markExported: boolean): Promise<string>;
}

class TauriShipClient implements ShipClient {
  readonly available = true;
  private async call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
    const { invoke } = await import("../platform/backend");
    return invoke<T>(cmd, args);
  }
  private now = () => new Date().toISOString();
  orders() {
    return this.call<ShipOrder[]>("ship_orders");
  }
  saveOrder(order: ShipOrder, remember: boolean) {
    return this.call<ShipOrder>("ship_order_save", { order, remember, now: this.now() });
  }
  async deleteOrder(id: string) {
    await this.call<number>("ship_order_delete", { id, now: this.now() });
  }
  async setExported(ids: string[], exported: boolean) {
    await this.call<number>("ship_order_exported", { ids, exported });
  }
  customers() {
    return this.call<ShipCustomer[]>("ship_customers");
  }
  saveCustomer(customer: ShipCustomer) {
    return this.call<ShipCustomer>("ship_customer_save", { customer, now: this.now() });
  }
  async deleteCustomer(tiktokId: string) {
    await this.call<number>("ship_customer_delete", { tiktokId });
  }
  async importStores(body: string) {
    const [imported, skipped] = await this.call<[number, number]>("ship_stores_import", { body });
    return { imported, skipped };
  }
  async lookupStore(code: string) {
    return (await this.call<Store | null>("ship_store_lookup", { code })) ?? undefined;
  }
  storesCount() {
    return this.call<number>("ship_stores_count");
  }
  flow() {
    return this.call<FlowRecord[]>("flow_list");
  }
  async markFlow(tiktokId: string, step: FlowMark) {
    await this.call<null>("flow_mark", { tiktokId, step, now: this.now() });
  }
  searchStores(query: string) {
    return this.call<StoreHit[]>("ship_store_search", { query });
  }
  exportXlsx(ids: string[], markExported: boolean) {
    return this.call<string>("ship_export_xlsx", { ids, mark: markExported });
  }
}

class UnavailableShipClient implements ShipClient {
  readonly available = false;
  private no(): Promise<never> {
    return Promise.reject(new Error("NOT_DESKTOP"));
  }
  orders = () => this.no();
  saveOrder = () => this.no();
  deleteOrder = () => this.no();
  setExported = () => this.no();
  customers = () => this.no();
  saveCustomer = () => this.no();
  deleteCustomer = () => this.no();
  importStores = () => this.no();
  lookupStore = () => this.no();
  storesCount = () => this.no();
  flow = () => this.no();
  markFlow = () => this.no();
  searchStores = () => this.no();
  exportXlsx = () => this.no();
}

export function createShipClient(): ShipClient {
  return isTauri() ? new TauriShipClient() : new UnavailableShipClient();
}
