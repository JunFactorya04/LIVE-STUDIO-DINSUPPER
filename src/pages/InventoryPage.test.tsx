// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BizClient, Expense, Purchase, StockItem } from "../biz/client";
import { I18nProvider } from "../i18n";
import { zhTW } from "../i18n/zh-TW";
import { LiveSessionStore } from "../live/sessionStore";
import { LiveSessionProvider } from "../live/useLiveSession";
import { InventoryPage } from "./InventoryPage";

afterEach(cleanup);

function fake(): BizClient & { calls: string[] } {
  const calls: string[] = [];
  const stock: StockItem[] = [{ sku: "A12", cost: 100, stock: 2, minStock: 5 }];
  const purchases: Purchase[] = [];
  const expenses: Expense[] = [];
  return {
    calls,
    available: true,
    stock: async () => [...stock],
    saveStock: async (i) => void calls.push(`stock:${i.sku}:${i.stock}`),
    deleteStock: vi.fn(),
    purchases: async () => purchases,
    addPurchase: async (p) => void calls.push(`buy:${p.sku}:${p.qty}:${p.unitCost}`),
    deletePurchase: vi.fn(),
    expenses: async () => expenses,
    saveExpense: async (e) => void calls.push(`exp:${e.name}:${e.kind}:${e.amount}`),
    deleteExpense: vi.fn(),
  };
}

const view = (c: BizClient) =>
  render(
    <I18nProvider initial="zh-TW">
      <LiveSessionProvider store={new LiveSessionStore()}>
        <InventoryPage client={c} />
      </LiveSessionProvider>
    </I18nProvider>,
  );

describe("InventoryPage", () => {
  it("flags low stock", async () => {
    view(fake());
    expect(await screen.findAllByText(zhTW.inventory.low)).not.toHaveLength(0);
  });

  it("adds a monthly expense", async () => {
    const c = fake();
    view(c);
    fireEvent.click(screen.getByRole("tab", { name: zhTW.inventory.tabs.expenses }));
    fireEvent.change(screen.getByLabelText(zhTW.inventory.name), { target: { value: "倉庫租金" } });
    fireEvent.change(screen.getByLabelText(zhTW.inventory.amount), { target: { value: "5000" } });
    fireEvent.click(screen.getAllByRole("button", { name: zhTW.inventory.addExpense })[0]);
    await waitFor(() => expect(c.calls).toContain("exp:倉庫租金:FIXED:5000"));
  });

  it("rejects a purchase without a product", async () => {
    const c = fake();
    view(c);
    fireEvent.click(screen.getByRole("tab", { name: zhTW.inventory.tabs.purchases }));
    fireEvent.change(screen.getByLabelText(zhTW.inventory.qty), { target: { value: "3" } });
    fireEvent.click(screen.getAllByRole("button", { name: zhTW.inventory.addPurchase })[0]);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(c.calls).toEqual([]);
  });
});
