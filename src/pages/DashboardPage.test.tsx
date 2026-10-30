// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { zhTW } from "../i18n/zh-TW";
import { LiveSessionStore } from "../live/sessionStore";
import { LiveSessionProvider } from "../live/useLiveSession";
import type { ReportClient, SessionSummary } from "../report/client";
import { DashboardPage } from "./DashboardPage";

const row = (id: string, createdAt: string, confirmed: number): SessionSummary => ({
  id,
  username: null,
  providerType: "manual",
  status: "MANUAL",
  createdAt,
  comments: 10,
  ordersDraft: 0,
  ordersNeedsReview: 0,
  ordersConfirmed: confirmed,
  ordersCancelled: 1,
  replies: 0,
  repliesCopied: 0,
});

function client(over: Partial<ReportClient> = {}): ReportClient {
  return {
    available: true,
    sessions: async () => [
      row("b", "2026-10-30T02:00:00Z", 4),
      row("a", "2026-10-29T02:00:00Z", 2),
    ],
    audit: async () => [
      { id: 1, at: "2026-10-30T02:00:00Z", action: "AI_CALL_ERROR", detail: "code=QUOTA" },
    ],
    exportSession: vi.fn(),
    backup: vi.fn(),
    purgeOlder: vi.fn(),
    deleteSession: vi.fn(),
    deleteAll: vi.fn(),
    ...over,
  };
}

function mount(api: ReportClient, onNavigate = vi.fn(), store = new LiveSessionStore()) {
  render(
    <I18nProvider initial="zh-TW">
      <LiveSessionProvider store={store}>
        <DashboardPage client={api} onNavigate={onNavigate} />
      </LiveSessionProvider>
    </I18nProvider>,
  );
  return { onNavigate, store };
}

describe("Dashboard page", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("totals the stored sessions and charts confirmed orders", async () => {
    mount(client());
    const chart = await screen.findByRole("list", { name: zhTW.dashboard.chartTitle });
    expect(within(chart).getAllByRole("listitem")).toHaveLength(2);
    expect(within(chart).getByText("4")).toBeInTheDocument();
    // 2 sessions, 20 comments, 6 confirmed, 2 cancelled in the "all sessions" cards.
    expect(screen.getByText(zhTW.dashboard.kpi.sessions).nextSibling).toHaveTextContent("2");
  });

  it("lists pending work and jumps to the page that handles it", async () => {
    const { onNavigate } = mount(client());
    // Empty catalog, no source, and one AI error in the log.
    // The AI error comes from the audit log, which loads asynchronously: wait for it.
    expect(await screen.findByText("最近 AI 呼叫失敗 1 次")).toBeInTheDocument();
    expect(screen.getByText("尚未建立商品目錄")).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByText("尚未連接留言來源").closest("li")!).getByRole("button"),
    );
    expect(onNavigate).toHaveBeenCalledWith("setup");
  });

  it("says there is nothing to do when everything is handled", async () => {
    const store = new LiveSessionStore();
    store.saveCatalogItem({ sku: "A1", name: "x", price: 1, colors: [], sizes: [], aliases: [] });
    store.receiveMany([
      {
        eventId: "e1",
        platform: "tiktok",
        sessionId: store.getSnapshot().sessionId,
        username: "amy",
        commentText: "hi",
        commentTimestamp: "2026-10-30T02:00:00Z",
        receivedAt: "2026-10-30T02:00:00Z",
        source: "MANUAL",
      },
    ]);
    mount(client({ audit: async () => [] }), vi.fn(), store);
    expect(await screen.findByText(zhTW.dashboard.todoNone)).toBeInTheDocument();
  });

  it("shows no history without the desktop app and invents no numbers", () => {
    mount(client({ available: false }));
    expect(screen.getByText(zhTW.dashboard.desktopOnly)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: zhTW.dashboard.chartTitle })).not.toBeInTheDocument();
  });

  it("reports a failed load instead of showing zeros", async () => {
    mount(
      client({
        sessions: async () => {
          throw new Error("db");
        },
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(zhTW.dashboard.failed);
  });
});
