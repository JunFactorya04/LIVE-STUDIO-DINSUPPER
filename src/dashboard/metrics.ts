import type { AuditEntry, SessionSummary } from "../report/client";
import type { PageId } from "../navigation";

// Pure calculations for the dashboard, so the numbers are testable without the UI.

export interface Totals {
  sessions: number;
  comments: number;
  confirmed: number;
  cancelled: number;
  needsReview: number;
  repliesCopied: number;
}

export function totals(sessions: readonly SessionSummary[]): Totals {
  const sum = (pick: (s: SessionSummary) => number) => sessions.reduce((n, s) => n + pick(s), 0);
  return {
    sessions: sessions.length,
    comments: sum((s) => s.comments),
    confirmed: sum((s) => s.ordersConfirmed),
    cancelled: sum((s) => s.ordersCancelled),
    needsReview: sum((s) => s.ordersNeedsReview),
    repliesCopied: sum((s) => s.repliesCopied),
  };
}

export type TodoId = "review" | "unclassified" | "catalog" | "source" | "aiErrors";

export interface Todo {
  id: TodoId;
  count: number;
  /** Page that lets the seller deal with it. */
  page: PageId;
}

export interface TodoInput {
  needsReview: number;
  unclassified: number;
  /** Only suggest classifying when an AI service has been chosen. */
  aiChosen: boolean;
  catalogEmpty: boolean;
  noSource: boolean;
  aiErrors: number;
}

/** What the seller still has to do, most urgent first. Empty list = nothing pending. */
export function todoItems(i: TodoInput): Todo[] {
  const out: Todo[] = [];
  if (i.needsReview > 0) out.push({ id: "review", count: i.needsReview, page: "orders" });
  if (i.noSource) out.push({ id: "source", count: 1, page: "setup" });
  if (i.catalogEmpty) out.push({ id: "catalog", count: 1, page: "orders" });
  if (i.aiChosen && i.unclassified > 0) {
    out.push({ id: "unclassified", count: i.unclassified, page: "console" });
  }
  if (i.aiErrors > 0) out.push({ id: "aiErrors", count: i.aiErrors, page: "settings" });
  return out;
}

export function countAiErrors(audit: readonly AuditEntry[]): number {
  return audit.filter((a) => a.action === "AI_CALL_ERROR").length;
}

export interface Bar {
  id: string;
  createdAt: string;
  value: number;
}

/** Confirmed orders of the latest `n` sessions, oldest first (left to right in time). */
export function confirmedBars(sessions: readonly SessionSummary[], n = 8): Bar[] {
  return [...sessions]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-n)
    .map((s) => ({ id: s.id, createdAt: s.createdAt, value: s.ordersConfirmed }));
}
