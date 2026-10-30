// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";
import { I18nProvider } from "./i18n";
import { zhTW } from "./i18n/zh-TW";
import { vi as viMessages } from "./i18n/vi";
import { DemoLiveCommentProvider } from "./live/demoProvider";
import { LiveSessionStore, type StoreDeps } from "./live/sessionStore";
import { LiveSessionProvider } from "./live/useLiveSession";
import type { LiveCommentEvent } from "./live/types";
import { AiError, unavailableAi, type AiClient } from "./ai/client";
import { AiSection } from "./pages/AiSection";
import { OverlayPage } from "./pages/OverlayPage";
import type { OverlayClient, OverlayPayload } from "./overlay/controller";
import { ApiKeysSection } from "./pages/ApiKeysSection";
import type { SecretsClient } from "./secrets/client";

function setup(
  initialPage?: "setup" | "console" | "orders" | "replies" | "overlay" | "settings",
  deps: Partial<StoreDeps> = {},
) {
  let n = 0;
  const store = new LiveSessionStore({
    newId: () => `sess-${++n}`,
    createDemoProvider: () => new DemoLiveCommentProvider({ intervalMs: 3_600_000 }),
    ...deps,
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

  it("a username with no verified provider ends UNAVAILABLE and cannot start", async () => {
    setup("setup");
    fireEvent.change(screen.getByLabelText(zhTW.setup.username), { target: { value: "shop" } });
    fireEvent.click(screen.getByLabelText(zhTW.setup.ack));
    fireEvent.click(screen.getByRole("button", { name: zhTW.setup.start }));
    await waitFor(() => expect(statusChip().dataset.status).toBe("UNAVAILABLE"));
    // Why: a plain browser cannot hold the API key or open the connection.
    expect(screen.getByText(zhTW.statusReason.BROWSER)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: zhTW.setup.start })).not.toBeDisabled();
  });

  it("rejects a missing TikTok ID with a readable message", async () => {
    setup("setup");
    fireEvent.click(screen.getByLabelText(zhTW.setup.ack));
    fireEvent.click(screen.getByRole("button", { name: zhTW.setup.start }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      zhTW.setup.issues.NEED_URL_OR_USERNAME,
    );
    expect(statusChip().dataset.status).toBe("DISCONNECTED");
  });

  it("demo flow: DEMO status, DEMO banner, every row labelled DEMO, never CONNECTED", async () => {
    // The Setup tab only exposes Euler Stream now; demo mode is still a store-level source
    // (used elsewhere, e.g. the phone preview), so it's driven here directly on the console page.
    const store = setup("console");
    await act(async () => {
      store.updateForm({ source: "demo" });
      await store.connectSource();
    });
    await waitFor(() => expect(statusChip().dataset.status).toBe("DEMO"));
    act(() => {
      store.startSession();
    });

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
    // Store default source is "manual"; driven directly since the Setup tab no longer exposes it.
    const store = setup("console");
    await act(async () => {
      await store.connectSource();
    });
    await waitFor(() => expect(statusChip().dataset.status).toBe("MANUAL"));
    act(() => {
      store.startSession();
    });

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

  it("AI filters are empty until comments are classified, then use the AI labels", async () => {
    const store = setup("console", {
      ai: {
        available: true,
        complete: async () =>
          '[{"i":0,"intent":"PURCHASE","confidence":0.9},{"i":1,"intent":"QUESTION","confidence":0.8}]',
      },
      loadAiConfig: () => ({ provider: "claude", models: {} }),
    });
    await act(async () => {
      await store.connectSource();
      store.startSession();
      store.submitManual("amy: A12 x2\nbob: 多少錢?");
    });
    fireEvent.click(screen.getByRole("button", { name: zhTW.console.filters.purchase }));
    expect(screen.getByText(zhTW.console.filterNeedsAi)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "AI 分類（2）" }));
    });
    const grid = await screen.findByRole("grid");
    expect(within(grid).getByText("A12 x2")).toBeInTheDocument();
    expect(within(grid).queryByText("多少錢?")).not.toBeInTheDocument();
    expect(within(grid).getByText(zhTW.console.intents.PURCHASE)).toBeInTheDocument();
  });

  it("asks for an AI service in Settings when none is chosen", async () => {
    const store = setup("console", { loadAiConfig: () => ({ models: {} }) });
    await act(async () => {
      await store.connectSource();
      store.startSession();
      store.submitManual("amy: hi");
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "AI 分類（1）" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(zhTW.console.aiNoProvider);
  });

  // Phase 6 hardening: §13 measured 10k comments only at the SQLite layer; this is the React
  // layer under the same kind of continuous burst — the UI must stay bounded and responsive.
  it("a burst of 2000 comments stays bounded at MAX_COMMENTS and the grid stays usable", async () => {
    const store = setup("console");
    await act(async () => {
      await store.connectSource();
      store.startSession();
    });
    const sid = store.getSnapshot().sessionId;
    const started = performance.now();
    await act(async () => {
      const batch = Array.from({ length: 2000 }, (_, i) =>
        demoEvent(sid, `burst-${i}`, `A12 ${i}`),
      );
      store.receiveMany(batch);
    });
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(5000);

    const snap = store.getSnapshot();
    expect(snap.comments).toHaveLength(1000); // MAX_COMMENTS
    expect(snap.dropped).toBe(1000);

    // The console only renders its newest window (VISIBLE_LIMIT) of the kept comments, so the
    // grid itself stays small and responsive even though the store holds up to MAX_COMMENTS.
    const grid = screen.getByRole("grid");
    const rows = within(grid).getAllByRole("row").slice(1);
    expect(rows.length).toBeLessThanOrEqual(200);
    expect(within(grid).getByText("A12 1999")).toBeInTheDocument();
    expect(within(grid).queryByText("A12 0")).not.toBeInTheDocument();
    await act(async () => store.dispose());
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
    fireEvent.click(screen.getByRole("tab", { name: zhTW.settingsTabs.ai }));
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

describe("Reply suggestions UI", () => {
  beforeEach(() => localStorage.clear());

  it("copy records COPIED (not sent), and there is no send button", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (t: string) => void written.push(t) },
      configurable: true,
    });
    const store = setup("console", {
      ai: { available: true, complete: async () => "明天出貨喔" },
      loadAiConfig: () => ({ provider: "claude", models: {} }),
    });
    await act(async () => {
      await store.connectSource();
      store.startSession();
      store.submitManual("amy: 什麼時候出貨?");
    });
    fireEvent.click(screen.getByText("什麼時候出貨?"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: zhTW.replies.suggest }));
    });
    const box = await screen.findByLabelText(zhTW.replies.textLabel);
    expect(box).toHaveValue("明天出貨喔");
    expect(screen.queryByRole("button", { name: /送出|send|gửi/i })).not.toBeInTheDocument();

    fireEvent.change(box, { target: { value: "今天下單明天出貨" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: zhTW.replies.copy }));
    });
    expect(written).toEqual(["今天下單明天出貨"]);
    expect(store.getSnapshot().replies[0]).toMatchObject({
      text: "今天下單明天出貨",
      status: "COPIED",
    });
    expect(await screen.findByText(zhTW.replies.copied)).toBeInTheDocument();
  });

  it("the replies page explains the empty state", () => {
    setup("replies");
    expect(screen.getByText(zhTW.replies.emptyTitle)).toBeInTheDocument();
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

describe("Overlay page", () => {
  beforeEach(() => localStorage.clear());

  it("pushes only the chosen product fields and can hide it again", async () => {
    const sent: OverlayPayload[] = [];
    const client: OverlayClient = {
      available: true,
      set: async (p) => void sent.push(p),
      url: async () => "http://127.0.0.1:17891/overlay/live-product",
    };
    const store = setup();
    store.saveCatalogItem({
      sku: "A12",
      name: "連帽衫",
      price: 790,
      colors: ["黑色|黑", "白色"],
      sizes: ["M"],
      aliases: [],
    });
    cleanup();
    render(
      <I18nProvider initial="zh-TW">
        <LiveSessionProvider store={store}>
          <OverlayPage client={client} />
        </LiveSessionProvider>
      </I18nProvider>,
    );
    expect(
      await screen.findByText("http://127.0.0.1:17891/overlay/live-product"),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(zhTW.overlay.product), { target: { value: "A12" } });
    expect(screen.getByLabelText(zhTW.overlay.priceText)).toHaveValue("NT$790");
    fireEvent.change(screen.getByLabelText(zhTW.overlay.promo), {
      target: { value: "第二件 9 折" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: zhTW.overlay.show }));
    });
    expect(sent[0]).toEqual({
      visible: true,
      name: "連帽衫",
      sku: "A12",
      priceText: "NT$790",
      colors: ["黑色", "白色"],
      sizes: ["M"],
      promo: "第二件 9 折",
    });
    // The payload type has no field that could carry a comment or a username.
    expect(Object.keys(sent[0]).sort()).toEqual([
      "colors",
      "name",
      "priceText",
      "promo",
      "sizes",
      "sku",
      "visible",
    ]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: zhTW.overlay.hide }));
    });
    expect(sent[1].visible).toBe(false);
    expect(sent[1].name).toBe("");
  });

  it("in a plain browser it previews but cannot publish", () => {
    setup("overlay");
    expect(screen.getByText(zhTW.overlay.emptyTitle)).toBeInTheDocument();
    expect(screen.getByText(zhTW.overlay.desktopOnly)).toBeInTheDocument();
  });
});
