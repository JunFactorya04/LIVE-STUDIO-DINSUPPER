import type { Slip } from "../print/slip";
import type { ShipOrder } from "./client";

export interface ShipSlipLabels {
  title: string;
  recipient: string;
  phone: string;
  store: string;
  temperature: string;
  normal: string;
  frozen: string;
  product: string;
  note: string;
  cod: string;
  tiktok: string;
}

/** Shipping slip: what the seller typed, nothing generated. COD is amount + shipping fee. */
export function shipSlip(o: ShipOrder, l: ShipSlipLabels): Slip {
  const lines: Slip["lines"] = [
    { text: l.title, size: "lg", bold: true, align: "center" },
    { text: "", size: "sm", rule: true },
    { text: `${l.recipient}: ${o.recipientName}`, size: "lg", bold: true },
    { text: `${l.phone}: ${o.phone}`, size: "md", bold: true },
    { text: `${l.store}: ${[o.storeCode, o.storeName].filter(Boolean).join(" ")}`, size: "md" },
    {
      text: `${l.temperature}: ${o.temperature === "FROZEN" ? l.frozen : l.normal}`,
      size: "md",
    },
    { text: "", size: "sm", rule: true },
    { text: `${l.product}: ${o.product}`, size: "md" },
  ];
  if (o.note) lines.push({ text: `${l.note}: ${o.note}`, size: "sm" });
  if (o.tiktokId) lines.push({ text: `${l.tiktok}: @${o.tiktokId}`, size: "sm" });
  lines.push({ text: "", size: "sm", rule: true });
  lines.push({ text: `${l.cod}: NT$ ${o.cod}`, size: "lg", bold: true });
  return { lines };
}
