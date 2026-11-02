// Internal receipt numbering for the "Tính tiền" tab. Off by default. This is never a
// Taiwanese government e-invoice (統一發票) number: those are issued from a range the tax
// authority assigns to the business, not invented by this app. It is only a running number
// printed on the shop's own internal receipt, so a till history is easy to sort through — a
// seller who later registers for real e-invoicing can turn this off again.

export interface InvoiceSettings {
  enabled: boolean;
  /** Printed right before the number, e.g. "POS-". */
  prefix: string;
  /** The next number to use; advances by one after every sale that prints a receipt. */
  next: number;
}

export const DEFAULT_INVOICE: InvoiceSettings = { enabled: false, prefix: "POS-", next: 1 };

const KEY = "live-studio.pos-invoice";
const MAX_NEXT = 999_999_999;

export function loadInvoiceSettings(): InvoiceSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<InvoiceSettings> | null;
    if (!raw || typeof raw !== "object") return { ...DEFAULT_INVOICE };
    const next = Number(raw.next);
    return {
      enabled: raw.enabled === true,
      prefix: typeof raw.prefix === "string" ? raw.prefix.slice(0, 20) : DEFAULT_INVOICE.prefix,
      next: Number.isInteger(next) && next > 0 && next <= MAX_NEXT ? next : DEFAULT_INVOICE.next,
    };
  } catch {
    return { ...DEFAULT_INVOICE };
  }
}

export function saveInvoiceSettings(s: InvoiceSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // best-effort, same as the other settings modules
  }
}

/** Formats and consumes the next receipt number, or "" when numbering is off. */
export function nextReceiptNo(): string {
  const s = loadInvoiceSettings();
  if (!s.enabled) return "";
  const no = `${s.prefix}${String(s.next).padStart(6, "0")}`;
  saveInvoiceSettings({ ...s, next: s.next + 1 });
  return no;
}
