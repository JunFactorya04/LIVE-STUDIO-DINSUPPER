// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { zhTW } from "../i18n/zh-TW";
import type { SecretsClient } from "../secrets/client";
import { CarriersPage, type EcpayCheck } from "./CarriersPage";

afterEach(cleanup);

function vault(): SecretsClient & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    available: true,
    exists: async (slot) => map.has(slot),
    set: async (slot, value) => void map.set(slot, value),
    remove: async (slot) => void map.delete(slot),
  };
}

const view = (
  s: SecretsClient,
  check: (stage: boolean) => Promise<EcpayCheck> = async () => ({ accepted: false, message: "" }),
  openPage: (url: string) => Promise<void> = async () => {},
) =>
  render(
    <I18nProvider initial="zh-TW">
      <CarriersPage secrets={s} check={check} openPage={openPage} />
    </I18nProvider>,
  );

describe("CarriersPage", () => {
  it("shows the bundled logo of every carrier, with no logo upload or fetch controls", () => {
    view(vault());
    expect(document.querySelectorAll("img.carrier__logo").length).toBe(7);
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("lists the carriers and never claims a connection it did not verify", async () => {
    view(vault());
    expect(screen.getAllByText("黑貓宅急便").length).toBeGreaterThan(0);
    expect(screen.queryByText("已連線")).toBeNull();
    expect(screen.queryByText(zhTW.carriers.status.verified)).toBeNull();
    expect(screen.getAllByText(zhTW.carriers.status.none).length).toBeGreaterThan(0);
  });

  it("saves credentials to the keychain under carrier slots, as secrets", async () => {
    const v = vault();
    view(v);
    const connect = screen.getAllByRole("button", { name: zhTW.carriers.connect });
    fireEvent.click(connect[0]); // ECPay is first
    const key = screen.getByLabelText(/HashKey/) as HTMLInputElement;
    expect(key.type).toBe("password");
    fireEvent.change(screen.getByLabelText(/MerchantID/), { target: { value: "2000132" } });
    fireEvent.change(key, { target: { value: "k" } });
    fireEvent.change(screen.getByLabelText(/HashIV/), { target: { value: "v" } });
    fireEvent.change(screen.getByLabelText(/寄件人姓名/), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText(/寄件人手機/), { target: { value: "0912345678" } });
    fireEvent.click(screen.getByRole("button", { name: zhTW.carriers.save }));
    await waitFor(() => expect(v.map.get("carrier-ecpay-merchantid")).toBe("2000132"));
    expect(v.map.has("carrier-ecpay-hashkey")).toBe(true);
    expect(await screen.findAllByText(zhTW.carriers.status.saved)).not.toHaveLength(0);
  });

  it("marks ECPay verified only after ECPay accepts the keys, in the chosen environment", async () => {
    localStorage.clear();
    const check = vi.fn(async () => ({ accepted: true, message: "TradeNo not found" }));
    view(vault(), check);
    fireEvent.click(screen.getByRole("button", { name: zhTW.carriers.envLive }));
    fireEvent.click(screen.getByRole("button", { name: zhTW.carriers.check }));
    expect(await screen.findByText(zhTW.carriers.status.verified)).toBeTruthy();
    expect(check).toHaveBeenCalledWith(false);
    localStorage.clear();
  });

  it("shows ECPay's own refusal instead of a green status", async () => {
    view(vault(), async () => ({ accepted: false, message: "CheckMacValue Error" }));
    fireEvent.click(screen.getByRole("button", { name: zhTW.carriers.check }));
    expect(await screen.findByText(/CheckMacValue Error/)).toBeTruthy();
    expect(screen.queryByText(zhTW.carriers.status.verified)).toBeNull();
  });

  it("opens the carrier's own pages through the backend", async () => {
    const open = vi.fn(async () => {});
    view(vault(), undefined, open);
    fireEvent.click(screen.getAllByRole("button", { name: zhTW.carriers.openLogin })[0]);
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://myship.7-11.com.tw/"));
  });
});
