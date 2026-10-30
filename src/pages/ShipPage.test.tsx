// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { zhTW } from "../i18n/zh-TW";
import type { ShipClient, ShipCustomer, ShipOrder } from "../ship/client";
import { shipSlip } from "../ship/slip";
import {
  cleanPhone,
  cleanRecipient,
  cleanStoreCode,
  firstError,
  EMPTY_SHIP_FORM,
} from "../ship/validate";
import { ShipPage } from "./ShipPage";

afterEach(cleanup);

const order = (over: Partial<ShipOrder> = {}): ShipOrder => ({
  id: "o1",
  tiktokId: "mai",
  recipientName: "Mai",
  phone: "0912345678",
  temperature: "NORMAL",
  storeCode: "131386",
  storeName: "建盛",
  product: "Áo",
  note: "",
  amount: 300,
  shippingFee: 38,
  cod: 338,
  exported: false,
  createdAt: "2026-10-30T02:00:00.000Z",
  ...over,
});

function fake(over: Partial<ShipClient> = {}, orders = [order()], customers: ShipCustomer[] = []) {
  const c: ShipClient = {
    available: true,
    orders: async () => orders,
    saveOrder: vi.fn(async (o: ShipOrder) => ({ ...o, cod: o.amount + o.shippingFee })),
    deleteOrder: vi.fn(async () => undefined),
    setExported: vi.fn(async () => undefined),
    customers: async () => customers,
    saveCustomer: vi.fn(),
    deleteCustomer: vi.fn(async () => undefined),
    importStores: vi.fn(async () => ({ imported: 1, skipped: 0 })),
    lookupStore: async () => undefined,
    storesCount: async () => 0,
    searchStores: vi.fn(async () => []),
    exportXlsx: vi.fn(async () => "/Downloads/x.xlsx"),
    ...over,
  };
  return c;
}

const mount = (c: ShipClient) =>
  render(
    <I18nProvider initial="zh-TW">
      <ShipPage client={c} />
    </I18nProvider>,
  );

describe("ship validation", () => {
  it("follows the 7-ELEVEN import sheet", () => {
    expect(cleanPhone("0912-345 678")).toBe("0912345678");
    expect(cleanStoreCode("131386")).toBe("131386");
    expect(cleanStoreCode("1313")).toBeUndefined();
    expect(cleanRecipient("Mai")).toBe("Mai");
    expect(cleanRecipient("A")).toBeUndefined();
    expect(cleanRecipient("Nguyễn Văn Anh")).toBeUndefined();
    expect(cleanRecipient("Mai2")).toBeUndefined();
    const ok = {
      ...EMPTY_SHIP_FORM,
      phone: "0912345678",
      name: "Mai",
      storeCode: "131386",
      product: "x",
      amount: "20",
    };
    expect(firstError(ok)).toBeUndefined(); // 20 + 38 = 58 is the minimum
  });

  it("accepts the exact minimum total of 58", () => {
    const f = {
      ...EMPTY_SHIP_FORM,
      phone: "0912345678",
      name: "Mai",
      storeCode: "131386",
      product: "x",
      amount: "20",
    };
    expect(firstError(f)).toBeUndefined();
    expect(firstError({ ...f, amount: "19" })).toBe("codMin");
    expect(firstError({ ...f, fee: "101" })).toBe("fee");
  });
});

describe("shipSlip", () => {
  it("prints what was typed and the COD total", () => {
    const text = shipSlip(order(), zhTW.ship.slip)
      .lines.map((l) => l.text)
      .join("\n");
    expect(text).toContain("Mai");
    expect(text).toContain("131386 建盛");
    expect(text).toContain("NT$ 338");
  });
});

describe("ShipPage", () => {
  it("shows pending stats and exports the pending orders", async () => {
    const c = fake();
    mount(c);
    expect(await screen.findByText("NT$ 338", { selector: "strong" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: zhTW.ship.export.button }));
    await waitFor(() => expect(c.exportXlsx).toHaveBeenCalledWith([], true));
    expect(await screen.findByText(/x\.xlsx/)).toBeTruthy();
  });

  it("marks an order as exported by hand", async () => {
    const c = fake();
    mount(c);
    fireEvent.click(await screen.findByRole("button", { name: zhTW.ship.actions.markExported }));
    await waitFor(() => expect(c.setExported).toHaveBeenCalledWith(["o1"], true));
  });

  it("rejects an invalid form before calling the backend, then saves a valid one", async () => {
    const c = fake({}, []);
    mount(c);
    fireEvent.click(await screen.findByRole("button", { name: `+ ${zhTW.ship.create}` }));
    fireEvent.click(screen.getByRole("button", { name: zhTW.ship.form.save }));
    expect((await screen.findByRole("alert")).textContent).toBe(zhTW.ship.errors.phone);
    expect(c.saveOrder).not.toHaveBeenCalled();

    const set = (label: string, value: string) =>
      fireEvent.change(
        screen.getByLabelText(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))),
        { target: { value } },
      );
    set(zhTW.ship.form.phone, "0912 345 678");
    set(zhTW.ship.form.name, "Mai");
    set(zhTW.ship.form.storeCode, "131386");
    set(zhTW.ship.form.product, "Áo");
    set(zhTW.ship.form.amount, "300");
    fireEvent.click(screen.getByRole("button", { name: zhTW.ship.form.save }));
    await waitFor(() => expect(c.saveOrder).toHaveBeenCalledTimes(1));
    const [saved, remember] = (c.saveOrder as ReturnType<typeof vi.fn>).mock.calls[0] as [
      ShipOrder,
      boolean,
    ];
    expect(saved.phone).toBe("0912345678");
    expect(saved.amount).toBe(300);
    expect(remember).toBe(true);
  });

  it("looks the store number up online when it is not in the local list", async () => {
    const c = fake(
      {
        searchStores: vi.fn(async () => [
          { code: "131386", name: "建盛", address: "新竹市", disabled: false },
        ]),
      },
      [],
    );
    mount(c);
    fireEvent.click(await screen.findByRole("button", { name: `+ ${zhTW.ship.create}` }));
    fireEvent.change(screen.getByLabelText(new RegExp(zhTW.ship.form.storeCode)), {
      target: { value: "131386" },
    });
    await waitFor(() =>
      expect((screen.getByLabelText(zhTW.ship.form.storeName) as HTMLInputElement).value).toBe(
        "建盛",
      ),
    );
  });

  it("customer list: create an order from a customer and copy the ask message", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const c = fake(
      {},
      [],
      [
        {
          tiktokId: "lan",
          name: "",
          phone: "",
          storeCode: "",
          storeName: "",
          updatedAt: "2026-10-30T01:00:00Z",
        },
      ],
    );
    mount(c);
    fireEvent.click(await screen.findByRole("button", { name: zhTW.ship.tabs.customers }));
    expect(screen.getByText(zhTW.ship.customers.incomplete)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: zhTW.ship.customers.copyAsk }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(String((writeText.mock.calls[0] as unknown[])[0])).toContain("@lan");
    fireEvent.click(screen.getByRole("button", { name: zhTW.ship.customers.createOrder }));
    expect(
      (screen.getByLabelText(new RegExp(zhTW.ship.form.tiktok)) as HTMLInputElement).value,
    ).toBe("lan");
  });

  it("says plainly when it is not the desktop app", async () => {
    mount(fake({ available: false }));
    expect(await screen.findByText(zhTW.ship.errors.desktopOnly)).toBeTruthy();
  });
});
