// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const load = async () => {
  vi.resetModules();
  return import("./backend");
};

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
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

  it("takes the token from the link, keeps it in the link and on the phone", async () => {
    window.history.replaceState(null, "", "/?t=abc123&x=1");
    const b = await load();
    expect(b.isRemote()).toBe(true);
    expect(b.hasBackend()).toBe(true);
    // the address keeps it, so an icon saved to the home screen opens signed in
    expect(window.location.search).toBe("?t=abc123&x=1");
    expect(localStorage.getItem("live-studio.share-token")).toBe("abc123");
    // opened again without it (an older home-screen icon): the phone still has it
    window.history.replaceState(null, "", "/");
    const again = await load();
    expect(again.isRemote()).toBe(true);
    // a newer link wins over the remembered one
    window.history.replaceState(null, "", "/?t=new456");
    expect((await load()).isRemote()).toBe(true);
    expect(localStorage.getItem("live-studio.share-token")).toBe("new456");
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
