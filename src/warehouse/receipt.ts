import type { Slip, SlipLine } from "../print/slip";
import type { Unit } from "./client";

// The slip printed when units are scanned out: what is going, each price and the total to collect.

export interface ReceiptLabels {
  title: string;
  total: string;
  items: string;
  currency: string;
}

const money = (n: number, c: string) => `${c} ${n.toLocaleString("en-US")}`;

export function shipReceipt(units: readonly Unit[], l: ReceiptLabels): Slip {
  const lines: SlipLine[] = [
    { text: l.title, size: "lg", bold: true, align: "center" },
    { text: "", size: "sm", rule: true },
  ];
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
  return { lines };
}
