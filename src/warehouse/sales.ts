import type { ShipOrder } from "../ship/client";
import type { Unit } from "./client";

// A unit scanned out is a sale: the selling price on its label is the revenue and the cost on
// the label is the cost of goods, on the day it was scanned. The dashboard adds these to the ship
// orders so profit = revenue - cost of goods - expenses covers both ways of selling.
// A unit that points at an existing ship order (its order id) is skipped: the order already
// carries that revenue.

export function unitSales(units: readonly Unit[], orders: readonly ShipOrder[]): ShipOrder[] {
  const ids = new Set(orders.map((o) => o.id));
  return units
    .filter((u) => u.status === "SHIPPED" && u.shippedAt && !ids.has(u.orderId))
    .map((u) => ({
      id: `unit:${u.code}`,
      tiktokId: "",
      recipientName: "",
      phone: "",
      temperature: "NORMAL" as const,
      storeCode: "",
      storeName: "",
      product: u.sku,
      note: "",
      amount: u.price,
      shippingFee: 0,
      cod: u.price,
      exported: true,
      createdAt: u.shippedAt,
      sku: u.sku,
      qty: 1,
      unitCost: u.cost,
    }));
}
