import { hasBackend, invoke } from "../platform/backend";

// Warehouse with a barcode on every unit. The data lives in the local database; outside the
// desktop app (and a phone that opened the sharing link) the client says it is unavailable.

export type UnitStatus = "IN_STOCK" | "SHIPPED" | "VOID";

export interface Unit {
  code: string;
  sku: string;
  price: number;
  cost: number;
  location: string;
  status: UnitStatus;
  receivedAt: string;
  shippedAt: string;
  orderId: string;
}

export interface ReceiveReq {
  purchaseId: string;
  sku: string;
  qty: number;
  price: number;
  unitCost: number;
  location: string;
  supplier: string;
  /** yyyy-mm-dd */
  at: string;
  /** When the goods came in (ISO). Defaults to now; the shelf-age analysis counts from it. */
  receivedAt?: string;
}

export interface ShipResult {
  units: Unit[];
  total: number;
}

export interface CountResult {
  missing: Unit[];
  unexpected: string[];
}

export interface Move {
  id: number;
  at: string;
  kind: "IN" | "OUT" | "MOVE" | "VOID" | "RETURN";
  code: string;
  sku: string;
  location: string;
  note: string;
}

export interface WarehouseClient {
  readonly available: boolean;
  units(status: UnitStatus): Promise<Unit[]>;
  unit(code: string): Promise<Unit | undefined>;
  receive(req: ReceiveReq): Promise<Unit[]>;
  /** `stockHandled`: a ship order with the sku and quantity already took the stock off. */
  ship(codes: string[], orderId: string, stockHandled: boolean): Promise<ShipResult>;
  move(code: string, location: string): Promise<Unit>;
  void(code: string, reason: string): Promise<Unit>;
  restock(code: string, location: string): Promise<Unit>;
  countApply(location: string, scanned: string[]): Promise<CountResult>;
  moves(limit: number): Promise<Move[]>;
}

const now = () => new Date().toISOString();

class TauriWarehouseClient implements WarehouseClient {
  readonly available = true;
  units = (status: UnitStatus) => invoke<Unit[]>("wh_units_list", { status, limit: 20000 });
  unit = async (code: string) => (await invoke<Unit | null>("wh_unit_get", { code })) ?? undefined;
  receive = (req: ReceiveReq) =>
    invoke<Unit[]>("wh_receive", { req, now: req.receivedAt ?? now() });
  ship = (codes: string[], orderId: string, stockHandled: boolean) =>
    invoke<ShipResult>("wh_ship", { codes, orderId, stockHandled, now: now() });
  move = (code: string, location: string) =>
    invoke<Unit>("wh_move", { code, location, now: now() });
  void = (code: string, reason: string) => invoke<Unit>("wh_void", { code, reason, now: now() });
  restock = (code: string, location: string) =>
    invoke<Unit>("wh_restock", { code, location, now: now() });
  countApply = (location: string, scanned: string[]) =>
    invoke<CountResult>("wh_count_apply", { location, scanned, now: now() });
  moves = (limit: number) => invoke<Move[]>("wh_moves_list", { limit });
}

class UnavailableWarehouseClient implements WarehouseClient {
  readonly available = false;
  private no = (): Promise<never> => Promise.reject(new Error("NOT_DESKTOP"));
  units = this.no;
  unit = this.no;
  receive = this.no;
  ship = this.no;
  move = this.no;
  void = this.no;
  restock = this.no;
  countApply = this.no;
  moves = this.no;
}

export const createWarehouseClient = (): WarehouseClient =>
  hasBackend() ? new TauriWarehouseClient() : new UnavailableWarehouseClient();

/** The short code of a backend error: "NOT_IN_STOCK:A12-1" -> ["NOT_IN_STOCK", "A12-1"]. */
export function errorParts(e: unknown): [string, string] {
  const raw = typeof e === "string" ? e : e instanceof Error ? e.message : "";
  const i = raw.indexOf(":");
  return i < 0 ? [raw, ""] : [raw.slice(0, i), raw.slice(i + 1)];
}
