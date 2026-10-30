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
import { AiError, unavailableAi, type AiClient } from "./ai/client";
import { AiSection } from "./pages/AiSection";
import { ApiKeysSection } from "./pages/ApiKeysSection";
import type { SecretsClient } from "./secrets/client";

function setup(initialPage?: "setup" | "console" | "orders" | "settings") {
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
    fireEvent.click(screen.getByLabelText(new RegExp(`^${zhTW.setup.sources.live}`)));
    fireEvent.change(screen.getByLabelText(zhTW.setup.liveUrl), {
      target: { value: "https://www.tiktok.com/@shop/live" },
    });
    fireEvent.click(screen.getByLabelText(zhTW.setup.ack));
    fireEvent.click(screen.getByRole("button", { name: zhTW.setup.connect }));
    await waitFor(() => expect(statusChip().dataset.status).toBe("UNAVAILABLE"));
    expect(screen.getByText(zhTW.statusHelp.UNAVAILABLE)).toBeInTheDocument();
    // Why: a plain browser cannot hold the API key or open the connection.
    expect(screen.getByText(zhTW.statusReason.BROWSER)).toBeInTheDocument();
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
    fireEvent.click(screen.getByLabelText(new RegExp(`^${zhTW.setup.sources.demo}`)));
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

  it("manual paste: MANUAL status, pasted lines become MANUAL rows, repeats are skipped", async () => {
    const store = setup("setup");
    fireEvent.click(screen.getByRole("button", { name: zhTW.setup.connect }));
    await waitFor(() => expect(statusChip().dataset.status).toBe("MANUAL"));
    fireEvent.click(screen.getByRole("button", { name: zhTW.setup.start }));

    const box = await screen.findByLabelText(zhTW.console.pasteLabel);
    fireEvent.change(box, { target: { value: "amy: 黑色 M ×2\n@bob: còn hàng không" } });
    fireEvent.click(screen.getByRole("button", { name: zhTW.console.pasteSubmit }));
    expect(await screen.findByText("新增 2 則，略過重複 0 則。")).toBeInTheDocument();

    fireEvent.change(box, { target: { value: "amy: 黑色 M ×2" } });
    fireEvent.click(screen.getByRole("button", { name: zhTW.console.pasteSubmit }));
    expect(await screen.findByText("新增 0 則，略過重複 1 則。")).toBeInTheDocument();

    const rows = within(screen.getByRole("grid")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    rows.forEach((row) =>
      expect(within(row).getByText(zhTW.console.sources.MANUAL)).toBeInTheDocument(),
    );
    expect(document.querySelector('[data-status="CONNECTED"]')).toBeNull();
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

describe("API keys", () => {
  beforeEach(() => localStorage.clear());

  it("in a plain browser it says keys need the desktop app and offers no input", () => {
    setup("settings");
    expect(screen.getByText(zhTW.settings.apiBrowser)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(zhTW.settings.apiKeyPlaceholder)).toBeNull();
  });

  it("with a client: save, show only 'set', replace, remove; the key is never rendered", async () => {
    const vault = new Map<string, string>();
    const client: SecretsClient = {
      available: true,
      exists: async (slot) => vault.has(slot),
      set: async (slot, v) => void vault.set(slot, v),
      remove: async (slot) => void vault.delete(slot),
    };
    render(
      <I18nProvider initial="zh-TW">
        <ApiKeysSection client={client} />
      </I18nProvider>,
    );
    const input = screen.getAllByPlaceholderText(zhTW.settings.apiKeyPlaceholder)[0];
    fireEvent.change(input, { target: { value: "sk-secret-123" } });
    fireEvent.click(screen.getAllByRole("button", { name: zhTW.settings.apiSave })[0]);
    expect(await screen.findByText(zhTW.settings.apiSaved)).toBeInTheDocument();
    expect(vault.get("claude")).toBe("sk-secret-123");
    expect(screen.getByText(zhTW.settings.apiSet)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("sk-secret-123");
    expect((input as HTMLInputElement).value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: zhTW.settings.apiRemove }));
    await waitFor(() => expect(vault.has("claude")).toBe(false));
  });
});

describe("Orders page", () => {
  beforeEach(() => localStorage.clear());

  it("shows drafts with reasons, confirms only clean ones, and updates the console counts", async () => {
    const store = setup("orders");
    store.saveCatalogItem({
      sku: "A12",
      name: "連帽衫",
      colors: ["黑色"],
      sizes: ["M"],
      aliases: [],
    });
    await act(async () => {
      await store.connectSource();
      store.startSession();
      store.submitManual("amy: A12 黑色 M x2\nbob: Z99 x1");
    });
    const table = screen.getByRole("table", { name: zhTW.orders.tabs.drafts });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    // Newest first: bob (needs review) above amy (draft).
    const bobRow = rows[0];
    const amyRow = rows[1];
    expect(within(bobRow).getByText(zhTW.orders.reasons.SKU_NOT_FOUND)).toBeInTheDocument();
    expect(within(bobRow).getByRole("button", { name: zhTW.orders.confirm })).toBeDisabled();
    expect(within(amyRow).getByText("A12")).toBeInTheDocument();

    fireEvent.click(within(amyRow).getByRole("button", { name: zhTW.orders.confirm }));
    expect(within(table).getByText(zhTW.orders.status.CONFIRMED)).toBeInTheDocument();
    expect(within(amyRow).getByRole("button", { name: zhTW.orders.confirm })).toBeDisabled();
    expect(store.getSnapshot().drafts.map((d) => d.status)).toEqual(["CONFIRMED", "NEEDS_REVIEW"]);
  });

  it("explains an empty state and imports a catalog from pasted text", async () => {
    const store = setup("orders");
    expect(screen.getByText(zhTW.orders.emptyTitle)).toBeInTheDocument();
    expect(screen.getByText(zhTW.orders.noCatalogHint)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: zhTW.orders.tabs.catalog }));
    fireEvent.change(screen.getByLabelText(zhTW.orders.catalog.importTitle), {
      target: { value: "A12\t黑色連帽衫\t790\t黑色|黑;白色\tM;L\t帽T\nbad" },
    });
    fireEvent.click(screen.getByRole("button", { name: zhTW.orders.catalog.importButton }));
    expect(await screen.findByText("已匯入 1 項，1 行無法讀取。")).toBeInTheDocument();
    expect(store.getSnapshot().catalog[0]).toMatchObject({ sku: "A12", price: 790 });
    expect(
      screen.getByRole("button", { name: `${zhTW.orders.catalog.edit} A12` }),
    ).toBeInTheDocument();
  });

  it("rejects a catalog item without code and name", () => {
    setup("orders");
    fireEvent.click(screen.getByRole("button", { name: zhTW.orders.tabs.catalog }));
    fireEvent.click(screen.getByRole("button", { name: zhTW.orders.catalog.save }));
    expect(screen.getByRole("alert")).toHaveTextContent(zhTW.orders.catalog.skuRequired);
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

describe("AI settings", () => {
  beforeEach(() => localStorage.clear());

  it("lists the four services, remembers the choice and reports test failures by code", async () => {
    const calls: Array<{ provider: string; model?: string }> = [];
    const client: AiClient = {
      available: true,
      complete: async (req) => {
        calls.push({ provider: req.provider, model: req.model });
        throw new AiError("AUTH");
      },
    };
    render(
      <I18nProvider initial="zh-TW">
        <AiSection client={client} />
      </I18nProvider>,
    );
    for (const name of ["OpenAI", "Claude（Anthropic）", "Gemini（Google）", "DeepSeek"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "DeepSeek" }));
    fireEvent.change(screen.getByLabelText(zhTW.settings.ai.model), {
      target: { value: "deepseek-reasoner" },
    });
    fireEvent.click(screen.getByRole("button", { name: zhTW.settings.ai.test }));
    expect(await screen.findByRole("alert")).toHaveTextContent(zhTW.settings.ai.errors.AUTH);
    expect(calls).toEqual([{ provider: "deepseek", model: "deepseek-reasoner" }]);
    expect(JSON.parse(localStorage.getItem("live-studio.ai") ?? "{}")).toMatchObject({
      provider: "deepseek",
    });
  });

  it("in a plain browser the test button is disabled", () => {
    render(
      <I18nProvider initial="zh-TW">
        <AiSection client={unavailableAi} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "OpenAI" }));
    expect(screen.getByRole("button", { name: zhTW.settings.ai.test })).toBeDisabled();
  });
});
