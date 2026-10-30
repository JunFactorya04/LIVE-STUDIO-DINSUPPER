import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoLiveCommentProvider } from "./demoProvider";
import type { LiveCommentEvent, LiveProviderStatus } from "./types";

describe("DemoLiveCommentProvider", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("goes CONNECTING -> DEMO and never reports CONNECTED", async () => {
    const provider = new DemoLiveCommentProvider({ intervalMs: 100 });
    const seen: LiveProviderStatus[] = [];
    provider.onStatusChange((s) => seen.push(s));
    await provider.connect({ sessionId: "s1" });
    expect(seen).toEqual(["CONNECTING", "DEMO"]);
    expect(await provider.getStatus()).toBe("DEMO");
    await provider.disconnect("s1");
    expect(seen).not.toContain("CONNECTED");
    expect(await provider.getStatus()).toBe("DISCONNECTED");
  });

  it("labels every comment as DEMO with a unique event id", async () => {
    const provider = new DemoLiveCommentProvider({
      intervalMs: 100,
      script: ["A12", "黑色 M", "😍"],
    });
    const events: LiveCommentEvent[] = [];
    provider.onComment((e) => events.push(e));
    await provider.connect({ sessionId: "s1" });
    vi.advanceTimersByTime(350);
    expect(events.map((e) => e.commentText)).toEqual(["A12", "黑色 M", "😍"]);
    expect(events.every((e) => e.source === "DEMO" && e.platform === "tiktok")).toBe(true);
    expect(new Set(events.map((e) => e.eventId)).size).toBe(3);
    await provider.disconnect("s1");
  });

  it("stops emitting after disconnect and works without any credentials", async () => {
    const provider = new DemoLiveCommentProvider({ intervalMs: 100 });
    const events: LiveCommentEvent[] = [];
    provider.onComment((e) => events.push(e));
    await provider.connect({ sessionId: "s1" }); // no URL, username or key
    vi.advanceTimersByTime(250);
    await provider.disconnect("s1");
    const count = events.length;
    vi.advanceTimersByTime(1000);
    expect(events.length).toBe(count);
  });
});
