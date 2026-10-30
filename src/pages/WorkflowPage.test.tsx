// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { zhTW } from "../i18n/zh-TW";
import { LiveSessionStore } from "../live/sessionStore";
import { LiveSessionProvider } from "../live/useLiveSession";
import type { ShipClient } from "../ship/client";
import { takeShipPrefill } from "../ship/prefill";
import { WorkflowPage } from "./WorkflowPage";

afterEach(cleanup);

function fake(over: Partial<ShipClient> = {}): ShipClient {
  return {
    available: true,
    orders: async () => [],
    saveOrder: vi.fn(),
    deleteOrder: vi.fn(),
    setExported: vi.fn(),
    customers: async () => [
      {
        tiktokId: "mai",
        name: "",
        phone: "",
        storeCode: "",
        storeName: "",
        updatedAt: "2026-10-30T02:00:00Z",
      },
    ],
    saveCustomer: vi.fn(),
    deleteCustomer: vi.fn(),
    importStores: vi.fn(),
    lookupStore: vi.fn(),
    storesCount: vi.fn(),
    searchStores: vi.fn(),
    exportXlsx: vi.fn(),
    flow: async () => [{ tiktokId: "mai", slipPrintedAt: "t", askCopiedAt: null }],
    markFlow: vi.fn(async () => undefined),
    ...over,
  };
}

const mount = (c: ShipClient, onNavigate = vi.fn()) =>
  render(
    <I18nProvider initial="zh-TW">
      <LiveSessionProvider store={new LiveSessionStore({ newId: () => "s1" })}>
        <WorkflowPage client={c} onNavigate={onNavigate} />
      </LiveSessionProvider>
    </I18nProvider>,
  );

describe("WorkflowPage", () => {
  it("shows the buyer and copies the ask message, recording the step", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const c = fake();
    mount(c);
    expect(await screen.findByText("@mai")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: zhTW.flow.actions.ask }));
    await waitFor(() => expect(c.markFlow).toHaveBeenCalledWith("mai", "ASK_COPIED"));
    expect(String((writeText.mock.calls[0] as unknown[])[0])).toContain("@mai");
  });

  it("hands the buyer to the shipping form for the info step", async () => {
    const onNavigate = vi.fn();
    const c = fake({
      flow: async () => [{ tiktokId: "mai", slipPrintedAt: "t", askCopiedAt: "t" }],
    });
    mount(c, onNavigate);
    fireEvent.click(await screen.findByRole("button", { name: zhTW.flow.actions.info }));
    expect(onNavigate).toHaveBeenCalledWith("ship");
    expect(takeShipPrefill()).toBe("mai");
    expect(takeShipPrefill()).toBeUndefined();
  });

  it("says plainly when it is not the desktop app", async () => {
    mount(fake({ available: false }));
    expect(await screen.findByText(zhTW.ship.errors.desktopOnly)).toBeTruthy();
  });
});
