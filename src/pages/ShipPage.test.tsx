// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { LiveSessionStore } from "../live/sessionStore";
import { LiveSessionProvider } from "../live/useLiveSession";
import type { Unit, WarehouseClient } from "../warehouse/client";
import type { SkuImageClient } from "../warehouse/images";
import type { ScanRelay } from "../warehouse/relay";
import { ShipPage } from "./ShipPage";

afterEach(cleanup);

const fmtLeft = (n: number) => zhTW.ship.form.picker.left.replace("{n}", String(n));

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
  sku: "",
  qty: 0,
  unitCost: 0,
  ...over,
});

function fake(over: Partial<ShipClient> = {}, orders = [order()], customers: ShipCustomer[] = []) {
  const c: ShipClient = {
    available: true,
    orders: async () => orders,
    saveOrder: vi.fn(async (o: ShipOrder) => ({ ...o, cod: o.amount + o.shippingFee })),
    deleteOrder: vi.fn(async () => undefined),
    createWaybill: vi.fn(),
    setExported: vi.fn(async () => undefined),
    customers: async () => customers,
    saveCustomer: vi.fn(),
    deleteCustomer: vi.fn(async () => undefined),
    importStores: vi.fn(async () => ({ imported: 1, skipped: 0 })),
    lookupStore: async () => undefined,
    storesCount: async () => 0,
    flow: async () => [],
    markFlow: vi.fn(async () => undefined),
    searchStores: vi.fn(async () => []),
    storesInArea: vi.fn(async () => []),
    exportXlsx: vi.fn(async () => "/Downloads/x.xlsx"),
    openBuyerPage: vi.fn(async () => undefined),
    openTikTokLogin: vi.fn(async () => undefined),
    openCarrierPage: vi.fn(async () => undefined),
    revealExport: vi.fn(async () => undefined),
    ...over,
  };
  return c;
}

const mount = (c: ShipClient) =>
  render(
    <I18nProvider initial="zh-TW">
      <LiveSessionProvider store={new LiveSessionStore()}>
        <ShipPage client={c} />
      </LiveSessionProvider>
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

  it("picks the product from the shelf by colour and size, and a scanned label adds one more", async () => {
    const c = fake({}, []);
    const unit = (n: number, color: string, size: string): Unit => ({
      code: `A12-00000${n}`,
      sku: "A12",
      price: 350,
      cost: 100,
      location: "",
      status: "IN_STOCK",
      receivedAt: "",
      shippedAt: "",
      orderId: "",
      color,
      size,
    });
    const shelf = [unit(1, "黑色", "M"), unit(2, "黑色", "M"), unit(3, "白色", "L")];
    const warehouse = {
      available: true,
      units: async () => shelf,
      unit: async (code: string) => shelf.find((u) => u.code === code),
    } as unknown as WarehouseClient;
    const images = { available: false } as unknown as SkuImageClient;
    let push: ((code: string) => void) | undefined;
    const relay: ScanRelay = {
      push: async () => {},
      listen: async (h) => {
        push = h;
        return () => {};
      },
    };
    const store = new LiveSessionStore();
    store.saveCatalogItem({ sku: "A12", name: "連帽衫", colors: [], sizes: [], aliases: [] });
    render(
      <I18nProvider initial="zh-TW">
        <LiveSessionProvider store={store}>
          <ShipPage client={c} warehouse={warehouse} images={images} relay={relay} />
        </LiveSessionProvider>
      </I18nProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: `+ ${zhTW.ship.create}` }));
    fireEvent.change(screen.getByLabelText(zhTW.ship.form.picker.search), {
      target: { value: "連帽衫 黑" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "選擇 黑色 M，剩 2" }));
    expect(screen.queryByRole("button", { name: /白色 L/ })).toBeNull();
    expect(await screen.findByText(fmtLeft(2))).toBeInTheDocument();
    expect((screen.getByLabelText(`${zhTW.ship.form.amount} *`) as HTMLInputElement).value).toBe(
      "350",
    );
    // a phone (sharing link) scans another black M label: one more, the amount follows
    await waitFor(() => expect(push).toBeDefined());
    await act(async () => {
      push!("A12-000002");
    });
    expect((screen.getByLabelText(`${zhTW.ship.form.amount} *`) as HTMLInputElement).value).toBe(
      "700",
    );

    const set = (label: string, value: string) =>
      fireEvent.change(
        screen.getByLabelText(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))),
        { target: { value } },
      );
    set(zhTW.ship.form.phone, "0912345678");
    set(zhTW.ship.form.name, "Mai");
    set(zhTW.ship.form.storeCode, "131386");
    fireEvent.click(screen.getByRole("button", { name: zhTW.ship.form.save }));
    await waitFor(() => expect(c.saveOrder).toHaveBeenCalledTimes(1));
    const [saved] = (c.saveOrder as ReturnType<typeof vi.fn>).mock.calls[0] as [ShipOrder];
    expect(saved).toMatchObject({
      sku: "A12",
      color: "黑色",
      size: "M",
      qty: 2,
      product: "連帽衫 黑色 M",
      amount: 700,
    });
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

describe("ECPay waybill", () => {
  it("asks ECPay in the test environment by default and says nothing shipped for real", async () => {
    localStorage.clear();
    const createWaybill = vi.fn(async () => ({
      ok: true,
      logisticsId: "L1",
      paymentNo: "F123",
      validationNo: "9",
      message: "",
    }));
    mount(fake({ createWaybill }));
    fireEvent.click(await screen.findByRole("button", { name: zhTW.ship.waybill.create }));
    await waitFor(() =>
      expect(createWaybill).toHaveBeenCalledWith(expect.objectContaining({ id: "o1" }), true),
    );
    expect(await screen.findByText(/F123/)).toBeTruthy();
    expect(screen.getByText(new RegExp(zhTW.ship.waybill.envTest))).toBeTruthy();
  });

  it("shows ECPay's refusal and hides the button once an order has a waybill", async () => {
    const createWaybill = vi.fn(async () => ({
      ok: false,
      logisticsId: "",
      paymentNo: "",
      validationNo: "",
      message: "store closed",
    }));
    mount(fake({ createWaybill }));
    fireEvent.click(await screen.findByRole("button", { name: zhTW.ship.waybill.create }));
    expect(await screen.findByText(/store closed/)).toBeTruthy();
    cleanup();
    mount(fake({}, [order({ carrier: "ecpay", tracking: "F1239" })]));
    await screen.findByText(/F1239/);
    expect(screen.queryByRole("button", { name: zhTW.ship.waybill.create })).toBeNull();
  });
});

describe("MyShip export", () => {
  it("writes the order, copies and reveals the file, then opens MyShip", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const exportXlsx = vi.fn(async () => "/Downloads/7-eleven-orders-1.xlsx");
    const openCarrierPage = vi.fn(async () => undefined);
    const revealExport = vi.fn(async () => undefined);
    mount(fake({ exportXlsx, openCarrierPage, revealExport }));
    fireEvent.click(await screen.findByRole("button", { name: zhTW.ship.waybill.myship }));
    await waitFor(() => expect(exportXlsx).toHaveBeenCalledWith(["o1"], true));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("/Downloads/7-eleven-orders-1.xlsx"),
    );
    await waitFor(() =>
      expect(revealExport).toHaveBeenCalledWith("/Downloads/7-eleven-orders-1.xlsx"),
    );
    await waitFor(() =>
      expect(openCarrierPage).toHaveBeenCalledWith(expect.stringContaining("myship.7-11.com.tw")),
    );
    expect(await screen.findByText(/7-eleven-orders-1\.xlsx/)).toBeTruthy();
  });

  it("reports when the workbook could not be written and never opens MyShip", async () => {
    const exportXlsx = vi.fn(async () => {
      throw "EMPTY";
    });
    const openCarrierPage = vi.fn(async () => undefined);
    mount(fake({ exportXlsx, openCarrierPage }));
    fireEvent.click(await screen.findByRole("button", { name: zhTW.ship.waybill.myship }));
    await screen.findByText(zhTW.ship.export.empty);
    expect(openCarrierPage).not.toHaveBeenCalled();
  });
});
