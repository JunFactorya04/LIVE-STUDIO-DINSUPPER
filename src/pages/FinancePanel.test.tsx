// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { zhTW } from "../i18n/zh-TW";
import type { ShipOrder } from "../ship/client";
import { FinancePanel } from "./FinancePanel";

afterEach(cleanup);
const NOW = new Date(2026, 9, 30, 12);
const order = (day: number, amount: number): ShipOrder => ({
  id: `o${day}${amount}`,
  tiktokId: "mai",
  recipientName: "Mai",
  phone: "0912345678",
  temperature: "NORMAL",
  storeCode: "131386",
  storeName: "x",
  product: "p",
  note: "",
  amount,
  shippingFee: 38,
  cod: amount + 38,
  exported: false,
  createdAt: new Date(2026, 9, day, 9).toISOString(),
});
const view = (orders: ShipOrder[]) =>
  render(
    <I18nProvider initial="zh-TW">
      <FinancePanel orders={orders} now={NOW} />
    </I18nProvider>,
  );

describe("FinancePanel", () => {
  it("says there is nothing yet instead of showing zeros", () => {
    view([]);
    expect(screen.getByText(zhTW.finance.emptyTitle)).toBeTruthy();
  });
  it("shows today's money and switches period", () => {
    view([order(30, 300), order(29, 100)]);
    expect(screen.getAllByText("NT$ 300").length).toBeGreaterThan(0);
    expect(screen.getAllByText("NT$ 338").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: zhTW.finance.periods.month }));
    expect(screen.getAllByText("NT$ 400").length).toBeGreaterThan(0);
  });
});
