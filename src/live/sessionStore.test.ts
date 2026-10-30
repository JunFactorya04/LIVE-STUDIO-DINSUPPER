import { describe, expect, it } from "vitest";
import { DemoLiveCommentProvider } from "./demoProvider";
import { LiveSessionStore, MAX_COMMENTS } from "./sessionStore";
import type { LiveCommentEvent, LiveProviderStatus } from "./types";

function makeStore() {
  let n = 0;
  return new LiveSessionStore({
    newId: () => `sess-${++n}`,
    // Long interval: tests push events by hand instead of waiting for timers.
    createDemoProvider: () => new DemoLiveCommentProvider({ intervalMs: 3_600_000 }),
  });
}

function event(sessionId: string, id: string, text = "A12"): LiveCommentEvent {
  const t = new Date(0).toISOString();
  return {
    eventId: id,
    platform: "tiktok",
    sessionId,
    username: "u1",
    commentText: text,
    commentTimestamp: t,
    receivedAt: t,
    source: "DEMO",
  };
}

describe("LiveSessionStore", () => {
  it("rejects an empty or malformed config and does not create a session", async () => {
    const store = makeStore();
    expect(await store.connectSource()).toBe(false);
    expect(store.getSnapshot().issues).toEqual(["NEED_URL_OR_USERNAME"]);
    store.updateForm({ liveUrl: "https://example.com/x" });
    expect(await store.connectSource()).toBe(false);
    expect(store.getSnapshot().issues).toContain("URL_FORMAT");
    expect(store.getSnapshot().status).toBe("DISCONNECTED");
  });

  it("valid URL but no live provider -> UNAVAILABLE, cannot start, never CONNECTED", async () => {
    const store = makeStore();
    const seen: LiveProviderStatus[] = [];
    store.subscribe(() => seen.push(store.getSnapshot().status));
    store.updateForm({ liveUrl: "https://www.tiktok.com/@shop/live", acknowledged: true });
    await store.connectSource();
    expect(store.getSnapshot().status).toBe("UNAVAILABLE");
    expect(store.canStart()).toBe(false);
    expect(store.startSession()).toBe(false);
    expect(seen).not.toContain("CONNECTED");
  });

  it("demo mode runs with no URL, username or credentials", async () => {
    const store = makeStore();
    store.updateForm({ demo: true });
    expect(await store.connectSource()).toBe(true);
    expect(store.getSnapshot().status).toBe("DEMO");
    expect(store.getSnapshot().providerType).toBe("demo");
    expect(store.canStart()).toBe(true);
    expect(store.startSession()).toBe(true);
    expect(store.getSnapshot().startedAt).toBeDefined();
    await store.dispose();
  });

  it("stores a repeated event once and counts the duplicate", async () => {
    const store = makeStore();
    store.updateForm({ demo: true });
    await store.connectSource();
    const sid = store.getSnapshot().sessionId;
    expect(store.receive(event(sid, "e1"))).toBe(true);
    expect(store.receive(event(sid, "e1"))).toBe(false); // e.g. replay after reconnect
    expect(store.getSnapshot().comments).toHaveLength(1);
    expect(store.getSnapshot().duplicates).toBe(1);
    await store.dispose();
  });

  it("ignores events from another session, including after reconnecting", async () => {
    const store = makeStore();
    store.updateForm({ demo: true });
    await store.connectSource();
    const first = store.getSnapshot().sessionId;
    store.receive(event(first, "e1"));
    await store.connectSource(); // new session
    expect(store.getSnapshot().comments).toHaveLength(0);
    expect(store.receive(event(first, "e2"))).toBe(false);
    expect(store.getSnapshot().comments).toHaveLength(0);
    await store.dispose();
  });

  it("keeps zh-TW, Vietnamese, emoji and special characters intact", async () => {
    const store = makeStore();
    store.updateForm({ demo: true });
    await store.connectSource();
    const sid = store.getSnapshot().sessionId;
    const texts = ["黑色 M ×2", "Cho mình 2 cái nhé!!", "🔥😍", '<b>&amp;</b> "quote"'];
    texts.forEach((t, i) => store.receive(event(sid, `u${i}`, t)));
    expect(store.getSnapshot().comments.map((c) => c.commentText)).toEqual(texts);
    await store.dispose();
  });

  it("caps stored comments and stays fast under a burst", async () => {
    const store = makeStore();
    store.updateForm({ demo: true });
    await store.connectSource();
    const sid = store.getSnapshot().sessionId;
    const total = MAX_COMMENTS + 2000;
    const started = performance.now();
    for (let i = 0; i < total; i++) store.receive(event(sid, `b${i}`));
    const elapsed = performance.now() - started;
    const snap = store.getSnapshot();
    expect(snap.comments).toHaveLength(MAX_COMMENTS);
    expect(snap.dropped).toBe(2000);
    expect(snap.comments[0].eventId).toBe("b2000");
    expect(elapsed).toBeLessThan(3000);
    // A dropped event id can be accepted again (its key was released).
    expect(store.receive(event(sid, "b0"))).toBe(true);
    await store.dispose();
  });

  it("clearComments deletes the stored feed", async () => {
    const store = makeStore();
    store.updateForm({ demo: true });
    await store.connectSource();
    const sid = store.getSnapshot().sessionId;
    store.receive(event(sid, "e1"));
    store.clearComments();
    expect(store.getSnapshot().comments).toHaveLength(0);
    expect(store.receive(event(sid, "e1"))).toBe(true);
    await store.dispose();
  });

  it("endSession disconnects the provider and records the end time", async () => {
    const store = makeStore();
    store.updateForm({ demo: true });
    await store.connectSource();
    store.startSession();
    await store.endSession();
    expect(store.getSnapshot().status).toBe("DISCONNECTED");
    expect(store.getSnapshot().endedAt).toBeDefined();
  });
});
