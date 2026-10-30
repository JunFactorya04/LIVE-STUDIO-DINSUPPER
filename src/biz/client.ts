import { hasBackend, invoke } from "../platform/backend";

// The shop's books: stock with cost, purchases and expenses. They live in the local database;
// outside the desktop app the client says it is unavailable instead of keeping fake data.

export interface StockItem {
  sku: string;
  /** Average cost per unit, NT$. */
  cost: number;
  stock: number;
  /** Warn when stock falls to this number or below (0 = no warning). */
  minStock: number;
  updatedAt?: string;
}

export interface Purchase {
  id: string;
  sku: string;
  qty: number;
  unitCost: number;
  supplier: string;
  note: string;
  /** yyyy-mm-dd */
  at: string;
}

export type ExpenseKind = "FIXED" | "ONCE";

export interface Expense {
  id: string;
  name: string;
  amount: number;
  kind: ExpenseKind;
  /** FIXED: first day it applies (its month on). ONCE: the day it was paid. */
  at: string;
  active: boolean;
}

export interface BizClient {
  readonly available: boolean;
  stock(): Promise<StockItem[]>;
  saveStock(item: StockItem): Promise<void>;
  deleteStock(sku: string): Promise<void>;
  purchases(): Promise<Purchase[]>;
  addPurchase(p: Purchase): Promise<void>;
  deletePurchase(id: string): Promise<void>;
  expenses(): Promise<Expense[]>;
  saveExpense(e: Expense): Promise<void>;
  deleteExpense(id: string): Promise<void>;
}

const now = () => new Date().toISOString();

class TauriBizClient implements BizClient {
  readonly available = true;
  stock = () => invoke<StockItem[]>("biz_stock_list");
  saveStock = async (item: StockItem) => {
    await invoke("biz_stock_save", { item, now: now() });
  };
  deleteStock = async (sku: string) => {
    await invoke("biz_stock_delete", { sku });
  };
  purchases = () => invoke<Purchase[]>("biz_purchase_list");
  addPurchase = async (purchase: Purchase) => {
    await invoke("biz_purchase_add", { purchase, now: now() });
  };
  deletePurchase = async (id: string) => {
    await invoke("biz_purchase_delete", { id, now: now() });
  };
  expenses = () => invoke<Expense[]>("biz_expense_list");
  saveExpense = async (expense: Expense) => {
    await invoke("biz_expense_save", { expense, now: now() });
  };
  deleteExpense = async (id: string) => {
    await invoke("biz_expense_delete", { id });
  };
}

class UnavailableBizClient implements BizClient {
  readonly available = false;
  private no = (): Promise<never> => Promise.reject(new Error("NOT_DESKTOP"));
  stock = this.no;
  saveStock = this.no;
  deleteStock = this.no;
  purchases = this.no;
  addPurchase = this.no;
  deletePurchase = this.no;
  expenses = this.no;
  saveExpense = this.no;
  deleteExpense = this.no;
}

export const createBizClient = (): BizClient =>
  hasBackend() ? new TauriBizClient() : new UnavailableBizClient();
