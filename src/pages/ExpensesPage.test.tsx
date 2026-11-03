// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BizClient, Expense } from "../biz/client";
import { I18nProvider } from "../i18n";
import { zhTW } from "../i18n/zh-TW";
import { ExpensesPage } from "./ExpensesPage";

afterEach(cleanup);

function fake(): BizClient & { calls: string[] } {
  const calls: string[] = [];
  const expenses: Expense[] = [];
  return {
    calls,
    available: true,
    stock: async () => [],
    saveStock: vi.fn(),
    deleteStock: vi.fn(),
    purchases: async () => [],
    addPurchase: vi.fn(),
    deletePurchase: vi.fn(),
    expenses: async () => expenses,
    saveExpense: async (e) => void calls.push(`exp:${e.name}:${e.kind}:${e.amount}`),
    deleteExpense: vi.fn(),
  };
}

const view = (c: BizClient) =>
  render(
    <I18nProvider initial="zh-TW">
      <ExpensesPage client={c} />
    </I18nProvider>,
  );

describe("ExpensesPage", () => {
  it("adds a monthly expense", async () => {
    const c = fake();
    view(c);
    fireEvent.change(screen.getByLabelText(zhTW.inventory.name), { target: { value: "倉庫租金" } });
    fireEvent.change(screen.getByLabelText(zhTW.inventory.amount), { target: { value: "5000" } });
    fireEvent.click(screen.getAllByRole("button", { name: zhTW.inventory.addExpense })[0]);
    await waitFor(() => expect(c.calls).toContain("exp:倉庫租金:FIXED:5000"));
  });

  it("rejects an expense without a name", async () => {
    const c = fake();
    view(c);
    fireEvent.change(screen.getByLabelText(zhTW.inventory.amount), { target: { value: "5000" } });
    fireEvent.click(screen.getAllByRole("button", { name: zhTW.inventory.addExpense })[0]);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(c.calls).toEqual([]);
  });
});
