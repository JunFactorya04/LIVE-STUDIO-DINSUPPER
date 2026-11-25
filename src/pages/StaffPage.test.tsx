// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiClient } from "../ai/client";
import type { BizClient } from "../biz/client";
import { I18nProvider } from "../i18n";
import { zhTW } from "../i18n/zh-TW";
import { LiveSessionStore } from "../live/sessionStore";
import { LiveSessionProvider } from "../live/useLiveSession";
import type { ShipClient } from "../ship/client";
import type { WarehouseClient } from "../warehouse/client";
import { StaffPage } from "./StaffPage";

const st = zhTW.staff;

function mount(ai: AiClient) {
  const store = new LiveSessionStore();
  const ship = {
    available: true,
    orders: async () => [],
    customers: async () => [],
  } as unknown as ShipClient;
  const wh = { available: true, units: async () => [] } as unknown as WarehouseClient;
  const biz = { available: true, expenses: async () => [] } as unknown as BizClient;
  render(
    <I18nProvider initial="zh-TW">
      <LiveSessionProvider store={store}>
        <StaffPage ai={ai} ship={ship} warehouse={wh} biz={biz} />
      </LiveSessionProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("live-studio.ai", JSON.stringify({ provider: "claude", models: {} }));
});
afterEach(cleanup);

describe("StaffPage", () => {
  it("the lead splits a request into tasks; drafts wait for approval", async () => {
    const complete = vi.fn(async ({ system }: { system: string }) =>
      system.includes("team lead")
        ? '[{"role":"kho","title":"缺貨","input":"列出快缺貨"},{"role":"ketoan","title":"今天","input":"今天營收","period":"today"}]'
        : "草稿內容",
    );
    mount({ available: true, complete });
    fireEvent.change(screen.getByLabelText(st.leadAsk), { target: { value: "看庫存和今天的錢" } });
    fireEvent.click(screen.getByRole("button", { name: st.leadSend }));
    expect(await screen.findByText(st.pending.replace("{n}", "2"))).toBeTruthy();
    expect(complete).toHaveBeenCalledTimes(3);
    const queue = screen.getByRole("region", { name: st.waiting });
    expect(within(queue).getByText("缺貨")).toBeTruthy();
    fireEvent.click(within(queue).getAllByRole("button", { name: st.approve })[0]);
    await waitFor(() => expect(screen.getByText(st.pending.replace("{n}", "1"))).toBeTruthy());
  });

  it("opens a staff member to give a customer reply task on a chosen channel", async () => {
    const complete = vi.fn(async () => "有的，M 號還有 2 件");
    mount({ available: true, complete });
    fireEvent.click(
      screen.getByRole("button", { name: `${st.roles.cskh.name}: ${st.status.idle}` }),
    );
    fireEvent.click(screen.getByRole("button", { name: st.channels.zalo }));
    fireEvent.change(screen.getByLabelText(st.message), { target: { value: "M 還有嗎" } });
    fireEvent.click(screen.getByRole("button", { name: st.assign }));
    expect(await screen.findAllByDisplayValue("有的，M 號還有 2 件")).not.toHaveLength(0);
    const call = complete.mock.calls[0] as unknown as [{ system: string; prompt: string }];
    expect(call[0].system).toContain("private chat");
    expect(call[0].prompt).toContain("Channel: zalo");
  });
});
