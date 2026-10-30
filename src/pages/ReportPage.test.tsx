// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { zhTW } from "../i18n/zh-TW";
import { LiveSessionStore } from "../live/sessionStore";
import { LiveSessionProvider } from "../live/useLiveSession";
import type { LiveCommentEvent } from "../live/types";
import type { ReportClient, SessionSummary } from "../report/client";
import { DEFAULT_RETENTION_DAYS, loadRetentionDays, runRetention } from "../report/retention";
import { ReportPage } from "./ReportPage";

const summary = (id: string, over: Partial<SessionSummary> = {}): SessionSummary => ({
  id,
  username: "shop",
  providerType: "manual",
  status: "MANUAL",
  createdAt: "2026-10-30T02:00:00.000Z",
  comments: 12,
  ordersDraft: 1,
  ordersNeedsReview: 2,
  ordersConfirmed: 3,
  ordersCancelled: 4,
  replies: 5,
  repliesCopied: 2,
  ...over,
});

function fakeClient(over: Partial<ReportClient> = {}): ReportClient {
  return {
    available: true,
    sessions: async () => [summary("s1")],
    audit: async () => [
      { id: 2, at: "2026-10-30T03:00:00.000Z", action: "ORDER_CONFIRMED", detail: "" },
      { id: 1, at: "2026-10-30T02:00:00.000Z", action: "FUTURE_ACTION", detail: "x=1" },
    ],
    exportSession: vi.fn(async () => "/Downloads/out.json"),
    backup: vi.fn(async () => "/Downloads/backup.db"),
    purgeOlder: vi.fn(async () => 2),
    deleteSession: vi.fn(async () => undefined),
    deleteAll: vi.fn(async () => 3),
    ...over,
  };
}

function mount(client: ReportClient, store = new LiveSessionStore({ newId: () => "s1" })) {
  render(
    <I18nProvider initial="zh-TW">
      <LiveSessionProvider store={store}>
        <ReportPage client={client} />
      </LiveSessionProvider>
    </I18nProvider>,
  );
  return store;
}

const event = (sessionId: string): LiveCommentEvent => ({
  eventId: "e1",
  platform: "tiktok",
  sessionId,
  username: "amy",
  commentText: "A12 黑色 M",
  commentTimestamp: "2026-10-30T02:00:00.000Z",
  receivedAt: "2026-10-30T02:00:00.000Z",
  source: "MANUAL",
});

describe("Report page", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("shows per-session counts and translated audit entries", async () => {
    mount(fakeClient());
    expect(await screen.findByText(/已確認 3・待確認 2・草稿 1・已取消 4/)).toBeInTheDocument();
    expect(screen.getByText("已複製 2／5")).toBeInTheDocument();
    expect(screen.getByText(zhTW.report.audit.ORDER_CONFIRMED)).toBeInTheDocument();
    // An action this build does not know is shown as its code, not hidden.
    expect(screen.getByText("FUTURE_ACTION")).toBeInTheDocument();
  });

  it("exports JSON and orders CSV and shows where the file went", async () => {
    const client = fakeClient();
    mount(client);
    await screen.findByText(zhTW.report.exportJson);
    fireEvent.click(screen.getByRole("button", { name: zhTW.report.exportJson }));
    expect(await screen.findByText("已儲存：/Downloads/out.json")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: zhTW.report.exportCsv }));
    await waitFor(() => expect(client.exportSession).toHaveBeenCalledTimes(2));
    expect(client.exportSession).toHaveBeenNthCalledWith(1, "s1", "json");
    expect(client.exportSession).toHaveBeenNthCalledWith(2, "s1", "orders_csv");
  });

  it("asks before deleting a session and resets the open one", async () => {
    const client = fakeClient();
    const store = new LiveSessionStore({ newId: () => "s1" });
    store.receiveMany([event("s1")]);
    expect(store.getSnapshot().comments).toHaveLength(1);
    mount(client, store);
    await screen.findByText(zhTW.report.delete);
    fireEvent.click(screen.getByRole("button", { name: zhTW.report.delete }));
    expect(client.deleteSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: zhTW.report.cancel }));
    expect(client.deleteSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: zhTW.report.delete }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: zhTW.report.deleteYes }));
    });
    expect(client.deleteSession).toHaveBeenCalledWith("s1");
    expect(store.getSnapshot().comments).toHaveLength(0);
  });

  it("deletes all data after a confirmation, optionally with the catalog", async () => {
    const client = fakeClient();
    const store = new LiveSessionStore({ newId: () => "s1" });
    store.saveCatalogItem({
      sku: "A12",
      name: "連帽衫",
      price: 1,
      colors: [],
      sizes: [],
      aliases: [],
    });
    mount(client, store);
    await screen.findByText(zhTW.report.wipeAll);
    fireEvent.click(screen.getByRole("button", { name: zhTW.report.wipeAll }));
    expect(client.deleteAll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(zhTW.report.wipeCatalog));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: zhTW.report.wipeYes }));
    });
    expect(client.deleteAll).toHaveBeenCalledWith(true);
    expect(store.getSnapshot().catalog).toHaveLength(0);
    expect(await screen.findByText("已刪除 3 場直播的資料。")).toBeInTheDocument();
  });

  it("keeps the catalog when it was not ticked", async () => {
    const client = fakeClient();
    const store = new LiveSessionStore({ newId: () => "s1" });
    store.saveCatalogItem({
      sku: "A12",
      name: "連帽衫",
      price: 1,
      colors: [],
      sizes: [],
      aliases: [],
    });
    mount(client, store);
    await screen.findByText(zhTW.report.wipeAll);
    fireEvent.click(screen.getByRole("button", { name: zhTW.report.wipeAll }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: zhTW.report.wipeYes }));
    });
    expect(client.deleteAll).toHaveBeenCalledWith(false);
    expect(store.getSnapshot().catalog).toHaveLength(1);
  });

  it("remembers the retention choice; forever disables the manual purge", async () => {
    const client = fakeClient();
    mount(client);
    await screen.findByText(zhTW.report.purgeNow);
    expect(loadRetentionDays()).toBe(DEFAULT_RETENTION_DAYS);
    fireEvent.click(screen.getByRole("button", { name: "30 天" }));
    expect(loadRetentionDays()).toBe(30);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: zhTW.report.purgeNow }));
    });
    expect(client.purgeOlder).toHaveBeenCalledWith(30);
    fireEvent.click(screen.getByRole("button", { name: zhTW.report.forever }));
    expect(screen.getByRole("button", { name: zhTW.report.purgeNow })).toBeDisabled();
  });

  it("backs up the database and reports the path", async () => {
    mount(fakeClient());
    await screen.findByText(zhTW.report.backup);
    fireEvent.click(screen.getByRole("button", { name: zhTW.report.backup }));
    expect(await screen.findByText("已備份：/Downloads/backup.db")).toBeInTheDocument();
  });

  it("says so when an action fails and does not claim success", async () => {
    mount(
      fakeClient({
        exportSession: async () => {
          throw new Error("disk full");
        },
      }),
    );
    await screen.findByText(zhTW.report.exportJson);
    fireEvent.click(screen.getByRole("button", { name: zhTW.report.exportJson }));
    expect(await screen.findByRole("alert")).toHaveTextContent(zhTW.report.failed);
  });

  it("explains that it needs the desktop app instead of showing fake numbers", () => {
    mount(fakeClient({ available: false }));
    expect(screen.getByText(zhTW.report.desktopOnly)).toBeInTheDocument();
    expect(screen.queryByText(zhTW.report.sessionsTitle)).not.toBeInTheDocument();
  });
});

describe("runRetention", () => {
  beforeEach(() => localStorage.clear());

  it("purges with the chosen days and never throws", async () => {
    const client = fakeClient();
    expect(await runRetention(client, 90)).toBe(2);
    expect(client.purgeOlder).toHaveBeenCalledWith(90);
    expect(await runRetention(client, 0)).toBe(0);
    expect(await runRetention(fakeClient({ available: false }), 90)).toBe(0);
    const broken = fakeClient({
      purgeOlder: async () => {
        throw new Error("db locked");
      },
    });
    expect(await runRetention(broken, 90)).toBe(0);
  });
});
