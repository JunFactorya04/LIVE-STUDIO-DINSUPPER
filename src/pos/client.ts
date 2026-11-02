import { hasBackend, invoke } from "../platform/backend";

// In-person checkout ("Tính tiền"). The sale's goods are shipped through the exact same
// warehouse command the "Xuất kho" tab uses (see ../warehouse/client.ts' `ship`), which is why
// its revenue already shows up on the dashboard with nothing extra to wire. This client only
// covers what that flow doesn't carry: how the sale was paid, and the internal receipt number.

export type PaymentMethod = "CASH" | "TRANSFER" | "OTHER";
export const PAYMENT_METHODS: readonly PaymentMethod[] = ["CASH", "TRANSFER", "OTHER"];

export interface PosSale {
  id: string;
  createdAt: string;
  total: number;
  paymentMethod: PaymentMethod;
  receiptNo: string;
  note: string;
}

export interface PosClient {
  readonly available: boolean;
  save(sale: PosSale): Promise<void>;
  list(limit: number): Promise<PosSale[]>;
}

class TauriPosClient implements PosClient {
  readonly available = true;
  save = (sale: PosSale) =>
    invoke<null>("pos_sale_save", { sale, now: new Date().toISOString() }).then(() => undefined);
  list = (limit: number) => invoke<PosSale[]>("pos_sales_list", { limit });
}

class UnavailablePosClient implements PosClient {
  readonly available = false;
  private no = (): Promise<never> => Promise.reject(new Error("NOT_DESKTOP"));
  save = this.no;
  list = this.no;
}

export const createPosClient = (): PosClient =>
  hasBackend() ? new TauriPosClient() : new UnavailablePosClient();
