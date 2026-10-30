// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const load = async () => {
  vi.resetModules();
  return import("./backend");
};

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(() => vi.unstubAllGlobals());

describe("backend transport", () => {
  it("has no backend in a plain browser", async () => {
    const b = await load();
    expect(b.hasBackend()).toBe(false);
    expect(b.isRemote()).toBe(false);
    await expect(b.invoke("x")).rejects.toThrow("NOT_DESKTOP");
  });

  it("takes the token from the link, keeps it for the tab and hides it from the address bar", async () => {
    window.history.replaceState(null, "", "/?t=abc123&x=1");
    const b = await load();
    expect(b.isRemote()).toBe(true);
    expect(b.hasBackend()).toBe(true);
    expect(window.location.search).toBe("?x=1");
    expect(sessionStorage.getItem("live-studio.share-token")).toBe("abc123");
    // after a reload the address no longer has it, the tab still does
    const again = await load();
    expect(again.isRemote()).toBe(true);
  });

  it("posts the command with the token and returns the data", async () => {
    sessionStorage.setItem("live-studio.share-token", "tok");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: [1, 2] })));
    vi.stubGlobal("fetch", fetchMock);
    const b = await load();
    await expect(b.invoke("ship_orders", { a: 1 })).resolves.toEqual([1, 2]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/invoke");
    expect((init.headers as Record<string, string>)["x-token"]).toBe("tok");
    expect(JSON.parse(init.body as string)).toEqual({ cmd: "ship_orders", args: { a: 1 } });
  });

  it("maps failures to short codes", async () => {
    sessionStorage.setItem("live-studio.share-token", "tok");
    const b = await load();
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
    await expect(b.invoke("x")).rejects.toBe("UNAUTHORIZED");
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ ok: false, error: "FORBIDDEN" })),
    );
    await expect(b.invoke("x")).rejects.toBe("FORBIDDEN");
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("network");
    });
    await expect(b.invoke("x")).rejects.toBe("UNREACHABLE");
  });
});
