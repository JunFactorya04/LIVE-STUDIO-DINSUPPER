// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { zhTW } from "../i18n/zh-TW";
import type { SecretsClient } from "../secrets/client";
import { CarriersPage } from "./CarriersPage";

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
  fetchLogo: (id: string) => Promise<string> = async () => {
    throw new Error("offline");
  },
) =>
  render(
    <I18nProvider initial="zh-TW">
      <CarriersPage secrets={s} fetchLogo={fetchLogo} />
    </I18nProvider>,
  );

describe("CarriersPage", () => {
  it("fetches each missing logo from the official site once and shows it", async () => {
    localStorage.clear();
    const asked: string[] = [];
    view(vault(), async (id) => {
      asked.push(id);
      return "data:image/png;base64,AAAA";
    });
    await waitFor(() => expect(document.querySelectorAll("img.carrier__logo").length).toBe(7));
    expect(asked.sort()).toEqual(["ecpay", "family", "hct", "post", "seven", "shopee", "tcat"]);
    localStorage.clear();
  });

  it("lists the carriers and never claims a connection it did not verify", async () => {
    view(vault());
    expect(screen.getAllByText("黑貓宅急便").length).toBeGreaterThan(0);
    expect(screen.queryByText("已連線")).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: zhTW.carriers.save }));
    await waitFor(() => expect(v.map.get("carrier-ecpay-merchantid")).toBe("2000132"));
    expect(v.map.has("carrier-ecpay-hashkey")).toBe(true);
    expect(await screen.findAllByText(zhTW.carriers.status.saved)).not.toHaveLength(0);
  });
});
