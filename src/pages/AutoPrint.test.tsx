// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { LiveSessionStore } from "../live/sessionStore";
import { LiveSessionProvider } from "../live/useLiveSession";
import type { OrderDraft } from "../orders/types";
import type { PrintService } from "../print/service";

const printed = vi.hoisted(() => [] as string[]);
vi.mock("../print/tempPrint", () => ({
  printTempSlip: async (d: OrderDraft) => {
    printed.push(d.id);
    return true;
  },
}));
vi.mock("../print/settings", async (orig) => ({
  ...(await orig<typeof import("../print/settings")>()),
  loadPrinter: () => ({ host: "192.168.1.9", port: 9100, widthDots: 576, autoTemp: false }),
  isConfigured: () => true,
}));

import { AutoPrint } from "./AutoPrint";

afterEach(() => {
  cleanup();
  printed.length = 0;
});

const draft = (id: string, at: string): OrderDraft => ({
  id,
  sessionId: "s1",
  username: "mai",
  confidence: 1,
  status: "DRAFT",
  reasons: [],
  evidence: [],
  createdAt: at,
  updatedAt: at,
});

describe("AutoPrint", () => {
  it("prints an order made on a phone even with auto-print off, never one made here", async () => {
    const later = new Date(Date.now() + 60_000).toISOString();
    let fromDb: OrderDraft[] = [];
    const store = new LiveSessionStore({
      orders: { listDrafts: async () => fromDb } as never,
      replies: { list: async () => [] } as never,
    });
    (store as unknown as { set: (p: object) => void }).set({
      sessionId: "s1",
      drafts: [draft("here", later)],
    });
    render(
      <I18nProvider initial="vi">
        <LiveSessionProvider store={store}>
          <AutoPrint service={{} as PrintService} />
        </LiveSessionProvider>
      </I18nProvider>,
    );
    fromDb = [draft("here", later), draft("phone", later)];
    await act(async () => {
      await store.mergeFromDb();
    });
    expect(store.isFromPhone("phone")).toBe(true);
    expect(store.isFromPhone("here")).toBe(false);
    expect(printed).toEqual(["phone"]);
  });
});
