import type { LiveCommentEvent } from "../live/types";
import type { OrderDraft } from "../orders/types";
import type { FlowRecord, ShipCustomer, ShipOrder } from "./client";
import { cleanTikTokId } from "./validate";

// The A-Z routine for one buyer, worked out from data that already exists. Nothing here sends
// or changes anything: it only says which step is done and which one comes next.

export const STEPS = ["order", "slip", "ask", "info", "ship"] as const;
export type StepId = (typeof STEPS)[number];

export interface BuyerFlow {
  tiktokId: string;
  name: string;
  /** The draft to print a temporary slip for, if the buyer has one. */
  draftId?: string;
  steps: Record<StepId, boolean>;
  next?: StepId;
  /** Shipping order state: none yet, waiting for export, or marked exported. */
  ship: "none" | "pending" | "exported";
}

export interface FlowInput {
  drafts: readonly OrderDraft[];
  customers: readonly ShipCustomer[];
  orders: readonly ShipOrder[];
  flow: readonly FlowRecord[];
}

export function buildFlow(i: FlowInput & { printerReady?: boolean }): BuyerFlow[] {
  // Without a printer the slip step cannot be done, so it never blocks the next one.
  const skip: StepId | undefined = i.printerReady === false ? "slip" : undefined;
  const ids = new Map<string, number>(); // id -> sort weight (newer first)
  const touch = (id: string | undefined, at: string) => {
    const k = id ? cleanTikTokId(id) : undefined;
    if (k) ids.set(k, Math.max(ids.get(k) ?? 0, Date.parse(at) || 0));
  };
  for (const d of i.drafts) if (d.status === "CONFIRMED") touch(d.username, d.updatedAt);
  for (const c of i.customers) touch(c.tiktokId, c.updatedAt);
  for (const o of i.orders) touch(o.tiktokId, o.createdAt);

  const out: BuyerFlow[] = [];
  for (const [id] of ids) {
    const confirmed = i.drafts.filter(
      (d) => d.status === "CONFIRMED" && cleanTikTokId(d.username ?? "") === id,
    );
    const customer = i.customers.find((c) => c.tiktokId === id);
    const orders = i.orders.filter((o) => o.tiktokId === id);
    const rec = i.flow.find((f) => f.tiktokId === id);
    const hasInfo = Boolean(customer?.name && customer.phone && customer.storeCode);
    const steps: Record<StepId, boolean> = {
      order: confirmed.length > 0 || Boolean(customer),
      slip: Boolean(rec?.slipPrintedAt),
      ask: Boolean(rec?.askCopiedAt),
      info: hasInfo || orders.length > 0,
      ship: orders.length > 0,
    };
    out.push({
      tiktokId: id,
      name: customer?.name || orders[0]?.recipientName || "",
      draftId: confirmed[confirmed.length - 1]?.id,
      steps,
      next: STEPS.find((s) => !steps[s] && s !== skip),
      ship: orders.length === 0 ? "none" : orders.every((o) => o.exported) ? "exported" : "pending",
    });
  }
  // Work still to do first (newest activity on top), finished buyers after.
  return out.sort(
    (a, b) =>
      Number(a.next === undefined) - Number(b.next === undefined) ||
      (ids.get(b.tiktokId) ?? 0) - (ids.get(a.tiktokId) ?? 0),
  );
}

export interface WorkReport {
  comments: number;
  drafts: number;
  confirmed: number;
  slips: number;
  asks: number;
  infos: number;
  shipOrders: number;
  exported: number;
  pending: number;
  codPending: number;
}

const sameDay = (iso: string | null | undefined, day: string): boolean =>
  Boolean(iso) && new Date(iso as string).toDateString() === day;

/** Numbers for the report: the live session as it is now, and today's follow-up work. */
export function workReport(
  i: FlowInput & { comments: readonly LiveCommentEvent[]; now?: Date },
): WorkReport {
  const day = (i.now ?? new Date()).toDateString();
  const today = i.orders.filter((o) => sameDay(o.createdAt, day));
  return {
    comments: i.comments.length,
    drafts: i.drafts.filter((d) => d.status !== "CANCELLED").length,
    confirmed: i.drafts.filter((d) => d.status === "CONFIRMED").length,
    slips: i.flow.filter((f) => sameDay(f.slipPrintedAt, day)).length,
    asks: i.flow.filter((f) => sameDay(f.askCopiedAt, day)).length,
    infos: i.customers.filter((c) => c.name && c.phone && c.storeCode && sameDay(c.updatedAt, day))
      .length,
    shipOrders: today.length,
    exported: today.filter((o) => o.exported).length,
    pending: i.orders.filter((o) => !o.exported).length,
    codPending: i.orders.filter((o) => !o.exported).reduce((n, o) => n + o.cod, 0),
  };
}
