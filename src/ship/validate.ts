// Same rules as src-tauri/src/ship.rs (the backend re-checks everything).

export const MIN_TOTAL = 58; // order amount + shipping fee
export const DEFAULT_FEE = 38;

export const cleanTikTokId = (raw: string): string | undefined => {
  const id = raw.trim().replace(/^@+/, "").toLowerCase();
  return /^[a-z0-9._]{1,24}$/.test(id) ? id : undefined;
};

/** Taiwan mobile: 09 + 8 digits; spaces and dashes are ignored. */
export const cleanPhone = (raw: string): string | undefined => {
  const d = raw.replace(/[\s-]/g, "");
  return /^09\d{8}$/.test(d) ? d : undefined;
};

/** 7-ELEVEN store number: exactly 6 digits. */
export const cleanStoreCode = (raw: string): string | undefined => {
  const c = raw.trim();
  return /^\d{6}$/.test(c) ? c : undefined;
};

const FORBIDDEN_NAME = /[0-9`~!@#$%^&*()/\\|,.<>'?";:_+=\-[\]{}]/;

/** Recipient name as the 7-ELEVEN import sheet wants it: 2 to 10 characters, no digits or symbols. */
export const cleanRecipient = (raw: string): string | undefined => {
  const n = raw.trim().replace(/\s+/g, " ");
  const len = [...n].length;
  return len >= 2 && len <= 10 && !FORBIDDEN_NAME.test(n) ? n : undefined;
};

export interface ShipForm {
  tiktokId: string;
  phone: string;
  name: string;
  temperature: "NORMAL" | "FROZEN";
  storeCode: string;
  storeName: string;
  product: string;
  note: string;
  amount: string;
  fee: string;
}

export const EMPTY_SHIP_FORM: ShipForm = {
  tiktokId: "",
  phone: "",
  name: "",
  temperature: "NORMAL",
  storeCode: "",
  storeName: "",
  product: "",
  note: "",
  amount: "",
  fee: String(DEFAULT_FEE),
};

export type FormError =
  "phone" | "name" | "storeCode" | "product" | "amount" | "fee" | "codMin" | "tiktokId" | "note";

const int = (s: string): number | undefined => (/^\d{1,7}$/.test(s.trim()) ? Number(s) : undefined);

export const total = (f: ShipForm): number => (int(f.amount) ?? 0) + (int(f.fee) ?? 0);

/** Returns the first problem, or undefined when the form can be saved. */
export function firstError(f: ShipForm): FormError | undefined {
  if (!cleanPhone(f.phone)) return "phone";
  if (!cleanRecipient(f.name)) return "name";
  if (!cleanStoreCode(f.storeCode)) return "storeCode";
  if (!f.product.trim() || f.product.trim().length > 200) return "product";
  const amount = int(f.amount);
  if (amount === undefined || amount > 20_000) return "amount";
  const fee = int(f.fee);
  if (fee === undefined || fee > 100) return "fee";
  if (amount + fee < MIN_TOTAL || amount + fee > 20_000) return "codMin";
  if (f.tiktokId.trim() && !cleanTikTokId(f.tiktokId)) return "tiktokId";
  if (f.note.trim().length > 200) return "note";
  return undefined;
}
