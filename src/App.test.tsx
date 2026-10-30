// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";
import { I18nProvider } from "./i18n";
import { zhTW } from "./i18n/zh-TW";
import { vi as viMessages } from "./i18n/vi";
import { DemoLiveCommentProvider } from "./live/demoProvider";
import { LiveSessionStore } from "./live/sessionStore";
import { LiveSessionProvider } from "./live/useLiveSession";
import type { LiveCommentEvent } from "./live/types";

function setup(initialPage?: "setup" | "console" | "settings") {
  let n = 0;
  const store = new LiveSessionStore({
    newId: () => `sess-${++n}`,
    createDemoProvider: () => new DemoLiveCommentProvider({ intervalMs: 3_600_000 }),
  });
  render(
    <I18nProvider initial="zh-TW">
      <LiveSessionProvider store={store}>
        <App initialPage={initialPage} />
      </LiveSessionProvider>
    </I18nProvider>,
  );
  return store;
}

function demoEvent(sessionId: string, id: string, text: string): LiveCommentEvent {
  const t = new Date("2026-10-30T02:00:00Z").toISOString();
  return {
    eventId: id,
    platform: "tiktok",
    sessionId,
    username: "demo_amy",
    commentText: text,
    commentTimestamp: t,
    receivedAt: t,
    source: "DEMO",
  };
}

const statusChip = () => document.querySelector("[data-status]") as HTMLElement;

describe("Live Assistant UI", () => {
  beforeEach(() => localStorage.clear());

  it("uses zh-TW by default and shows 'no source' instead of fake comments", () => {
    setup("console");
    expect(screen.getByText(zhTW.console.noSource)).toBeInTheDocument();
    expect(statusChip().dataset.status).toBe("DISCONNECTED");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("a valid URL with no verified provider ends UNAVAILABLE and cannot start", async () => {
    setup("setup");
    fireEvent.change(screen.getByLabelText(zhTW.setup.liveUrl), {
      target: { value: "https://www.tiktok.com/@shop/live" },
    });
    fireEvent.click(screen.getByLabelText(zhTW.setup.ack));
    fireEvent.click(screen.getByRole("button", { name: zhTW.setup.connect }));
    await waitFor(() => expect(statusChip().dataset.status).toBe("UNAVAILABLE"));
    expect(screen.getByText(zhTW.statusHelp.UNAVAILABLE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: zhTW.setup.start })).toBeDisabled();
  });

  it("rejects a malformed URL with a readable message", async () => {
    setup("setup");
    fireEvent.change(screen.getByLabelText(zhTW.setup.liveUrl), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: zhTW.setup.connect }));
    expect(await screen.findByRole("alert")).toHaveTextContent(zhTW.setup.issues.URL_FORMAT);
    expect(statusChip().dataset.status).toBe("DISCONNECTED");
  });

  it("demo flow: DEMO status, DEMO banner, every row labelled DEMO, never CONNECTED", async () => {
    const store = setup("setup");
    fireEvent.click(screen.getByLabelText(new RegExp(zhTW.setup.demo.slice(0, 6))));
    fireEvent.click(screen.getByRole("button", { name: zhTW.setup.connect }));
    await waitFor(() => expect(statusChip().dataset.status).toBe("DEMO"));
    fireEvent.click(screen.getByRole("button", { name: zhTW.setup.start }));

    // Start moves to the console.
    expect(await screen.findByText(zhTW.console.demoBanner)).toBeInTheDocument();
    const sid = store.getSnapshot().sessionId;
    await act(async () => {
      store.receive(demoEvent(sid, "e1", "黑色 M ×2 🔥"));
      store.receive(demoEvent(sid, "e1", "黑色 M ×2 🔥")); // replayed event
      store.receive(demoEvent(sid, "e2", "Cho mình 2 cái nhé!!"));
    });

    const grid = screen.getByRole("grid");
    const rows = within(grid).getAllByRole("row").slice(1); // skip header
    expect(rows).toHaveLength(2);
    rows.forEach((row) => expect(within(row).getByText("DEMO")).toBeInTheDocument());
    expect(within(grid).getByText("黑色 M ×2 🔥")).toBeInTheDocument();
    expect(document.querySelector('[data-status="CONNECTED"]')).toBeNull();

    // Selecting a row shows its detail; AI stays honestly "unclassified".
    fireEvent.click(rows[0]);
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(zhTW.insight.aiOff)).toBeInTheDocument();
    await act(async () => store.dispose());
  });

  it("AI-only filters say they need Phase 3 instead of showing fake results", async () => {
    setup("console");
    fireEvent.click(screen.getByRole("button", { name: zhTW.console.filters.purchase }));
    expect(screen.getByText(zhTW.console.filterNeedsAi)).toBeInTheDocument();
  });

  it("Ctrl+F focuses the feed search", () => {
    setup("console");
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(screen.getByLabelText(zhTW.console.searchPlaceholder)).toHaveFocus();
  });

  it("switching language updates the UI and is remembered", () => {
    setup("settings");
    expect(screen.getAllByText(zhTW.nav.setup).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: zhTW.settings.languages.vi }));
    expect(screen.getAllByText(viMessages.nav.setup).length).toBeGreaterThan(0);
    expect(localStorage.getItem("live-studio.locale")).toBe("vi");
  });
});

describe("i18n catalogue", () => {
  it("vi has exactly the same keys as zh-TW", () => {
    const keys = (o: object, p = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === "object" && v !== null ? keys(v, `${p}${k}.`) : [`${p}${k}`],
      );
    expect(keys(viMessages).sort()).toEqual(keys(zhTW).sort());
  });
});
