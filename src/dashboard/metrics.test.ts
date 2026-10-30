import { describe, expect, it } from "vitest";
import type { SessionSummary } from "../report/client";
import { confirmedBars, countAiErrors, todoItems, totals } from "./metrics";

const s = (id: string, createdAt: string, over: Partial<SessionSummary> = {}): SessionSummary => ({
  id,
  username: null,
  providerType: "manual",
  status: "MANUAL",
  createdAt,
  comments: 10,
  ordersDraft: 0,
  ordersNeedsReview: 1,
  ordersConfirmed: 2,
  ordersCancelled: 1,
  replies: 3,
  repliesCopied: 1,
  ...over,
});

describe("dashboard metrics", () => {
  it("adds up every session", () => {
    expect(totals([s("a", "2026-01-01"), s("b", "2026-01-02", { ordersConfirmed: 5 })])).toEqual({
      sessions: 2,
      comments: 20,
      confirmed: 7,
      cancelled: 2,
      needsReview: 2,
      repliesCopied: 2,
    });
    expect(totals([]).confirmed).toBe(0);
  });

  it("lists pending work most urgent first and nothing when all is done", () => {
    const todo = todoItems({
      needsReview: 3,
      unclassified: 4,
      aiChosen: true,
      catalogEmpty: true,
      noSource: true,
      aiErrors: 2,
    });
    expect(todo.map((t) => t.id)).toEqual([
      "review",
      "source",
      "catalog",
      "unclassified",
      "aiErrors",
    ]);
    expect(todo[0]).toEqual({ id: "review", count: 3, page: "orders" });
    expect(
      todoItems({
        needsReview: 0,
        unclassified: 0,
        aiChosen: false,
        catalogEmpty: false,
        noSource: false,
        aiErrors: 0,
      }),
    ).toEqual([]);
  });

  it("does not nag about classifying when no AI service is chosen", () => {
    const todo = todoItems({
      needsReview: 0,
      unclassified: 9,
      aiChosen: false,
      catalogEmpty: false,
      noSource: false,
      aiErrors: 0,
    });
    expect(todo).toEqual([]);
  });

  it("counts only AI errors from the audit log", () => {
    const at = "2026-01-01";
    expect(
      countAiErrors([
        { id: 1, at, action: "AI_CALL_ERROR", detail: "" },
        { id: 2, at, action: "AI_CALL_OK", detail: "" },
        { id: 3, at, action: "AI_CALL_ERROR", detail: "" },
      ]),
    ).toBe(2);
  });

  it("charts the latest sessions oldest first", () => {
    const list = [
      s("c", "2026-01-03", { ordersConfirmed: 3 }),
      s("a", "2026-01-01", { ordersConfirmed: 1 }),
      s("b", "2026-01-02", { ordersConfirmed: 2 }),
    ];
    expect(confirmedBars(list).map((b) => b.id)).toEqual(["a", "b", "c"]);
    expect(confirmedBars(list, 2).map((b) => b.value)).toEqual([2, 3]);
  });
});
