import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ tauri: true, remote: false }));
vi.mock("../platform/backend", () => ({
  hasTauri: () => backend.tauri,
  isRemote: () => backend.remote,
}));

import {
  buyerUrl,
  loadOpenMode,
  onBrowserRequest,
  openWeb,
  saveOpenMode,
  takeBrowserRequest,
  type BrowserRequest,
} from "./route";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  Object.assign(backend, { tauri: true, remote: false });
  takeBrowserRequest();
});
afterEach(() => vi.unstubAllGlobals());

describe("where carrier and TikTok pages open", () => {
  it("opens inside the app by default, TikTok in phone layout, and remembers where from", async () => {
    const seen: BrowserRequest[] = [];
    const off = onBrowserRequest((r) => seen.push(r));
    const external = vi.fn(async () => {});
    expect(await openWeb("carrier", "https://myship.7-11.com.tw/", external, "ship")).toBe("app");
    expect(await openWeb("tiktok", buyerUrl("@mai_tran"), external, "flow")).toBe("app");
    off();
    expect(external).not.toHaveBeenCalled();
    expect(seen).toEqual([
      { url: "https://myship.7-11.com.tw/", mobile: false, from: "ship" },
      { url: "https://www.tiktok.com/@mai_tran", mobile: true, from: "flow" },
    ]);
    // the Browser tab, mounting after the request, still finds the last one
    expect(takeBrowserRequest()?.url).toBe("https://www.tiktok.com/@mai_tran");
    expect(takeBrowserRequest()).toBeUndefined();
  });

  it("uses the system browser when chosen, on a phone, or outside the desktop app", async () => {
    const external = vi.fn(async () => {});
    saveOpenMode("tiktok", "external");
    expect(loadOpenMode("tiktok")).toBe("external");
    expect(loadOpenMode("carrier")).toBe("app");
    expect(await openWeb("tiktok", buyerUrl("x"), external)).toBe("external");
    backend.remote = true;
    expect(await openWeb("carrier", "https://myship.7-11.com.tw/", external)).toBe("external");
    Object.assign(backend, { tauri: false, remote: false });
    expect(await openWeb("carrier", "https://myship.7-11.com.tw/", external)).toBe("external");
    expect(external).toHaveBeenCalledTimes(3);
    expect(takeBrowserRequest()).toBeUndefined();
  });

  it("keeps a TikTok id inside its own path", () => {
    expect(buyerUrl(" @a/../b?x ")).toBe("https://www.tiktok.com/@a%2F..%2Fb%3Fx");
  });
});
