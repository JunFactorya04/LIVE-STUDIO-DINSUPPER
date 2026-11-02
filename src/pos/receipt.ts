import type { Slip, SlipLine } from "../print/slip";
import type { Unit } from "../warehouse/client";
import type { PaymentMethod } from "./client";

// The slip printed at checkout on the "Tính tiền" tab: same shape as the warehouse ship receipt,
// plus the payment method and, when the seller turned numbering on in Settings, the internal
// receipt number — never a real Taiwanese 統一發票 number (see ../pos/settings.ts).

export interface PosReceiptLabels {
  title: string;
  total: string;
  items: string;
  currency: string;
  receiptNo: string;
  payment: string;
  methods: Record<PaymentMethod, string>;
}

const money = (n: number, c: string) => `${c} ${n.toLocaleString("en-US")}`;

export function posReceipt(
  units: readonly Unit[],
  paymentMethod: PaymentMethod,
  receiptNo: string,
  l: PosReceiptLabels,
): Slip {
  const lines: SlipLine[] = [{ text: l.title, size: "lg", bold: true, align: "center" }];
  if (receiptNo) lines.push({ text: `${l.receiptNo}: ${receiptNo}`, size: "sm", align: "center" });
  lines.push({ text: "", size: "sm", rule: true });
  for (const u of units) {
    lines.push({ text: `${u.sku}  ${money(u.price, l.currency)}`, size: "md" });
    lines.push({ text: u.code, size: "sm" });
  }
  lines.push({ text: "", size: "sm", rule: true });
  lines.push({ text: `${l.items}: ${units.length}`, size: "md" });
  lines.push({
    text: `${l.total}: ${money(
      units.reduce((n, u) => n + u.price, 0),
      l.currency,
    )}`,
    size: "lg",
    bold: true,
  });
  lines.push({ text: `${l.payment}: ${l.methods[paymentMethod]}`, size: "sm" });
  return { lines };
}
